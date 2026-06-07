"""
proctoring/engine/violation_engine.py — Production Hardened

Key improvements over original:
1. Thread-safe violations list (lock)
2. Per-type deque event history with configurable threshold window
3. Per-type throttle to suppress duplicate alerts
4. Typed severity levels with risk score weights
5. Async Supabase sync via httpx (non-blocking, replaces blocking requests.post)
6. set_event_loop() called from FastAPI lifespan for safe cross-thread coroutine scheduling
"""

import asyncio
import logging
import os
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Severity + weight table
# ---------------------------------------------------------------------------

VIOLATION_CONFIG: Dict[str, Dict[str, Any]] = {
    # type              severity   weight  throttle(s)
    "OBJECT_EVENT":     {"severity": "CRITICAL", "weight": 10, "throttle": 5},
    "PHONE_DETECTED":   {"severity": "CRITICAL", "weight": 10, "throttle": 5},
    "MULTIPLE_FACES":   {"severity": "HIGH",     "weight":  6, "throttle": 10},
    "TAB_SWITCH":       {"severity": "HIGH",     "weight":  6, "throttle": 10},
    "WINDOW_BLUR":      {"severity": "HIGH",     "weight":  6, "throttle": 10},
    "FULLSCREEN_EXIT":  {"severity": "HIGH",     "weight":  6, "throttle": 10},
    "FACE_NOT_DETECTED":{"severity": "WARNING",  "weight":  3, "throttle": 15},
    "GAZE_DEVIATION":   {"severity": "WARNING",  "weight":  3, "throttle": 15},
    "LOOKING_AWAY":     {"severity": "WARNING",  "weight":  3, "throttle": 15},
}

# Default config for unknown event types
DEFAULT_CONFIG = {"severity": "LOW", "weight": 1, "throttle": 30}

# Threshold: number of seconds a violation event must persist before confirming
THRESHOLD_WINDOW_SECONDS = float(os.getenv("VIOLATION_THRESHOLD_WINDOW", "3.0"))


# ---------------------------------------------------------------------------
# ViolationEngine
# ---------------------------------------------------------------------------

class ViolationEngine:
    """
    Per-session violation engine — thread-safe with async Supabase sync.

    Lifecycle:
        engine = ViolationEngine("session-id")
        engine.set_event_loop(asyncio.get_event_loop())  # call from FastAPI lifespan
        ...
        violation = engine.process_event({"type": "TAB_SWITCH", "timestamp": time.time()})
        ...
        all_violations = engine.get_violations()
        score = engine.compute_risk_score()
    """

    def __init__(self, session_id: str, on_violation: Optional[Callable] = None):
        self.session_id = session_id
        self.on_violation = on_violation   # optional callback for immediate WS broadcast

        self._violations: List[Dict] = []
        self._violations_lock = threading.Lock()

        # Per-type deque of event timestamps (maxlen=30 prevents unbounded growth)
        self._event_history: Dict[str, deque] = {}

        # Per-type last alert timestamp (for throttle)
        self._last_alert_time: Dict[str, float] = {}

        self.is_active = True
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Register the event loop for cross-thread async scheduling."""
        self._loop = loop

    def stop(self) -> None:
        self.is_active = False

    def process_event(self, event_data: Dict[str, Any]) -> Optional[Dict]:
        """
        Process one detection event. Returns a confirmed violation dict, or None.

        Args:
            event_data: Must contain at least {"type": str, "timestamp": float}
        """
        if not self.is_active:
            return None

        event_type = event_data.get("type", "UNKNOWN")
        ts = float(event_data.get("timestamp", time.time()))
        details = event_data.get("details", {})

        # Maintain per-type event history
        history = self._event_history.setdefault(event_type, deque(maxlen=30))
        history.append(ts)

        # Need at least 2 events within the threshold window before confirming
        cutoff = ts - THRESHOLD_WINDOW_SECONDS
        recent_count = sum(1 for t in history if t >= cutoff)
        if recent_count < 2:
            return None

        # Check throttle
        cfg = VIOLATION_CONFIG.get(event_type, DEFAULT_CONFIG)
        throttle = cfg["throttle"]
        last_alert = self._last_alert_time.get(event_type, 0.0)
        if ts - last_alert < throttle:
            return None  # suppressed

        # Confirm violation
        self._last_alert_time[event_type] = ts
        violation = {
            "type":                  event_type,
            "severity":              cfg["severity"],
            "timestamp":             datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
            "session_id":            self.session_id,
            "details":               details,
            "event_count_in_window": recent_count,
        }

        with self._violations_lock:
            self._violations.append(violation)

        # Async Supabase sync (non-blocking — fire and forget)
        self._schedule_supabase_sync(violation)

        # Call on_violation callback if registered (for WebSocket broadcast)
        if self.on_violation:
            try:
                self.on_violation(self.session_id, violation)
            except Exception as e:
                logger.warning(f"on_violation callback error: {e}")

        logger.info(
            f"[{self.session_id}] Violation: {event_type} ({cfg['severity']}) "
            f"— {recent_count} events in {THRESHOLD_WINDOW_SECONDS}s window"
        )

        return violation

    def get_violations(self) -> List[Dict]:
        with self._violations_lock:
            return list(self._violations)

    def compute_risk_score(self) -> int:
        """
        Weighted risk score capped at 100.
        CRITICAL=10, HIGH=6, WARNING=3, LOW=1
        """
        score = 0
        with self._violations_lock:
            for v in self._violations:
                cfg = VIOLATION_CONFIG.get(v["type"], DEFAULT_CONFIG)
                score += cfg["weight"]
        return min(score, 100)

    def get_summary(self) -> Dict[str, Any]:
        violations = self.get_violations()
        by_severity: Dict[str, int] = {"CRITICAL": 0, "HIGH": 0, "WARNING": 0, "LOW": 0}
        for v in violations:
            sev = v.get("severity", "LOW")
            by_severity[sev] = by_severity.get(sev, 0) + 1

        return {
            "session_id":    self.session_id,
            "total":         len(violations),
            "risk_score":    self.compute_risk_score(),
            "by_severity":   by_severity,
            "violations":    violations,
        }

    def get_stats(self) -> dict:
        """
        Returns a simplified statistics summary of violations.
        Called by session_manager.py get_engine_stats().
        """
        violations = self.get_violations()
        by_severity = {}
        for v in violations:
            sev = v.get("severity", "UNKNOWN")
            by_severity[sev] = by_severity.get(sev, 0) + 1

        return {
            "total":       len(violations),
            "by_severity": by_severity,
            "is_active":   self.is_active,
        }

    # ------------------------------------------------------------------
    # Internal — async Supabase sync
    # ------------------------------------------------------------------

    def _schedule_supabase_sync(self, violation: Dict) -> None:
        """Schedule async Supabase sync from a sync thread."""
        if self._loop and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(
                self._sync_to_supabase(violation), self._loop
            )

    async def _sync_to_supabase(self, violation: Dict) -> None:
        """
        Non-blocking async HTTP POST to Supabase REST API.
        Retries 3× with exponential backoff (0.3s, 0.6s, 1.2s).
        """
        supabase_url = os.getenv("SUPABASE_URL", "")
        service_key  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

        if not supabase_url or not service_key:
            logger.debug("Supabase not configured — skipping violation sync")
            return

        # httpx is preferred; fall back gracefully if not installed
        try:
            import httpx
        except ImportError:
            logger.warning("httpx not installed — Supabase sync disabled. Run: pip install httpx")
            return

        url = f"{supabase_url}/rest/v1/violations"
        headers = {
            "apikey":        service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal",
        }

        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.post(url, json=violation, headers=headers)
                    if resp.status_code < 300:
                        logger.debug(f"Violation synced to Supabase: {violation['type']}")
                        return
                    logger.warning(
                        f"Supabase sync attempt {attempt+1}: HTTP {resp.status_code} — {resp.text[:100]}"
                    )
            except Exception as exc:
                logger.warning(f"Supabase sync attempt {attempt+1} exception: {exc}")

            await asyncio.sleep(0.3 * (2 ** attempt))  # 0.3s → 0.6s → 1.2s

        logger.error(f"Supabase sync failed after 3 attempts for violation: {violation['type']}")
