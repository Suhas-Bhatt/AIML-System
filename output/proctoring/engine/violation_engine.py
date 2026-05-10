"""
ViolationEngine — processes detector events, throttles, syncs to Supabase.

Fixes applied:
  - GAZE_DATA added to event_history (was silently dropped before)
  - violation entry keys standardized to 'type' / 'detail' / 'timestamp' / 'severity'
  - portable .env loading (uses project root, not hard-coded relative path)
"""

import time
import logging
import os
import json
import requests
from collections import deque
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv

# Portable .env loading — works from any working directory
_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(_root, ".env"))


class ViolationEngine:
    """
    Receives raw detector events, checks thresholds, throttles duplicates,
    and syncs confirmed violations to Supabase.
    """

    SEVERITY_MAP = {
        "OBJECT_EVENT":  "CRITICAL",
        "FACE_DATA":     "WARNING",
        "GAZE_DATA":     "WARNING",
        "TAB_SWITCH":    "HIGH",
        "NO_FACE":       "CRITICAL",
        "MULTIPLE_FACES":"HIGH",
    }

    def __init__(self, session_id: str, threshold_seconds: float = 3.0,
                 throttle_seconds: float = 3.0):
        self.session_id = session_id
        self.threshold = threshold_seconds
        self.throttle_seconds = throttle_seconds

        # BUG FIX: GAZE_DATA was not tracked before — now it is
        self.event_history: Dict[str, deque] = {
            "FACE_DATA":    deque(maxlen=30),
            "OBJECT_EVENT": deque(maxlen=30),
            "GAZE_DATA":    deque(maxlen=30),
            "TAB_SWITCH":   deque(maxlen=30),
        }

        self.confirmed_violations: List[Dict[str, Any]] = []
        self.logger = logging.getLogger(__name__)

        # Supabase
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self.db_enabled = bool(self.supabase_url and self.supabase_key)
        self.retry_attempts = 3

        if not self.db_enabled:
            self.logger.warning(
                "Supabase credentials missing — violations logged locally only. "
                "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"
            )

        # Stats
        self.sync_successes = 0
        self.sync_failures = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Call this for every detector result.
        Returns the violation dict if one was triggered, else None.
        """
        try:
            event_type = event.get("type", "UNKNOWN")

            if event_type not in self.event_history:
                # Unknown event type — log but don't crash
                self.logger.debug(f"Untracked event type: {event_type}")
                return None

            ts = event.get("timestamp", time.time())
            self.event_history[event_type].append(ts)

            # Phones trigger immediately regardless of duration
            if event_type == "OBJECT_EVENT" and event.get("label") == "phone":
                return self._trigger_violation(event)

            # Tab switch also triggers immediately
            if event_type == "TAB_SWITCH":
                return self._trigger_violation(event)

            # Face / Gaze violations need sustained detection
            history = self.event_history[event_type]
            if len(history) >= 2:
                duration = history[-1] - history[0]
                if duration >= self.threshold:
                    # Only trigger for actual bad states
                    if self._is_bad_state(event):
                        return self._trigger_violation(event)

            return None

        except Exception as e:
            self.logger.error(f"Error processing event: {e}")
            return None

    def get_violations(self) -> List[Dict[str, Any]]:
        """Return all confirmed violations for this session."""
        return list(self.confirmed_violations)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "total_violations": len(self.confirmed_violations),
            "sync_successes": self.sync_successes,
            "sync_failures": self.sync_failures,
            "event_history_sizes": {k: len(v) for k, v in self.event_history.items()},
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _is_bad_state(self, event: Dict[str, Any]) -> bool:
        """Return True only when the event actually indicates a problem."""
        etype = event.get("type")

        if etype == "FACE_DATA":
            count = event.get("count", 1)
            return count == 0 or count > 1

        if etype == "GAZE_DATA":
            return event.get("looking_away", False)

        return True  # all other registered types are inherently bad

    def _trigger_violation(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        etype = event.get("type")

        # Throttle: don't re-log the same violation type within throttle window
        if self._is_throttled(etype):
            return None

        # Build standardized violation record
        # Keys: type, detail, severity, timestamp, formatted_time
        detail = self._build_detail(event)
        severity = self.SEVERITY_MAP.get(etype, "WARNING")

        # More specific severity for face count
        if etype == "FACE_DATA":
            count = event.get("count", 1)
            if count == 0:
                severity = "CRITICAL"
                detail = "No face detected"
            else:
                severity = "HIGH"
                detail = f"Multiple faces: {count}"

        violation = {
            "type":           etype,
            "detail":         detail,        # FIX: was sometimes 'details' (plural) — now always 'detail'
            "severity":       severity,
            "timestamp":      int(time.time() * 1000),   # ms
            "formatted_time": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        self.confirmed_violations.append(violation)
        self.logger.warning(f"VIOLATION [{severity}]: {etype} — {detail}")

        # Async-friendly: sync in background via a thread so we don't block detection
        import threading
        t = threading.Thread(target=self._sync_to_database, args=(violation,), daemon=True)
        t.start()

        return violation

    def _build_detail(self, event: Dict[str, Any]) -> str:
        etype = event.get("type")
        if etype == "OBJECT_EVENT":
            return f"Detected: {event.get('label', 'unknown object')}"
        if etype == "GAZE_DATA":
            yaw = event.get("head_yaw", 0)
            direction = event.get("direction", "unknown")
            return f"Looking away ({direction}, yaw={yaw:.1f}°)"
        if etype == "TAB_SWITCH":
            return "Candidate switched tab or minimized window"
        return str(event.get("label", event.get("count", "detected")))

    def _is_throttled(self, violation_type: str) -> bool:
        if not self.confirmed_violations:
            return False
        last = self.confirmed_violations[-1]
        if last["type"] == violation_type:
            age_s = (time.time() * 1000 - last["timestamp"]) / 1000
            return age_s < self.throttle_seconds
        return False

    def _sync_to_database(self, violation: Dict[str, Any]) -> bool:
        """Sync violation to Supabase with exponential backoff retry."""
        if not self.db_enabled:
            return False

        headers = {
            "apikey":         self.supabase_key,
            "Authorization":  f"Bearer {self.supabase_key}",
            "Content-Type":   "application/json",
            "Prefer":         "return=representation",
        }
        url = f"{self.supabase_url}/rest/v1/sessions?id=eq.{self.session_id}"

        for attempt in range(self.retry_attempts):
            try:
                # Fetch current log
                resp = requests.get(url, headers=headers, timeout=10)
                if resp.status_code != 200:
                    raise RuntimeError(f"GET failed: {resp.status_code}")

                data = resp.json()
                if not data:
                    self.logger.error(f"Session {self.session_id} not found in DB")
                    return False

                current_log = data[0].get("antiCheatingLog") or []
                if not isinstance(current_log, list):
                    current_log = []

                current_log.append(violation)

                # Patch back
                patch = requests.patch(
                    url,
                    headers=headers,
                    json={"antiCheatingLog": current_log},
                    timeout=10,
                )
                if patch.status_code in (200, 204):
                    self.sync_successes += 1
                    return True

                raise RuntimeError(f"PATCH failed: {patch.status_code}")

            except Exception as e:
                wait = 2 ** attempt  # 1s, 2s, 4s
                self.logger.warning(f"DB sync attempt {attempt+1} failed: {e}. Retrying in {wait}s")
                if attempt < self.retry_attempts - 1:
                    time.sleep(wait)

        self.sync_failures += 1
        self.logger.error(f"All sync attempts failed for violation: {violation['type']}")
        return False

    def health_check(self) -> bool:
        """Quick ping to verify Supabase connectivity."""
        if not self.db_enabled:
            return False
        try:
            resp = requests.get(
                f"{self.supabase_url}/rest/v1/sessions?limit=1",
                headers={
                    "apikey": self.supabase_key,
                    "Authorization": f"Bearer {self.supabase_key}",
                },
                timeout=5,
            )
            return resp.status_code == 200
        except Exception:
            return False
