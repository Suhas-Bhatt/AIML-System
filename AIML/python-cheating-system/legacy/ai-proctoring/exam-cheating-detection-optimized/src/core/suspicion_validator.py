"""
SuspicionValidator — converts raw detector signals into confirmed
violation events using temporal thresholds and state-change detection.

Fixes from review:
  - Issue #4 / #9: state-change events (no per-loop spam, no instant flags)
  - Recommended thresholds: face missing > 3s, gaze away > 2s, etc.
"""

import time
import threading
from dataclasses import dataclass, field
from typing import Optional, Callable, Dict


@dataclass
class _SignalState:
    """Tracks how long a raw signal has been active."""
    active: bool = False
    started_at: Optional[float] = None
    confirmed: bool = False           # True once threshold crossed
    last_emit_at: float = 0.0


class SuspicionValidator:
    """Single source of truth for 'is this actually a violation yet?'

    Each detector reports a *raw* signal (e.g. face_missing=True/False
    every cycle). The validator only emits a violation event when:
      - the signal has been active continuously for >= threshold, AND
      - we haven't already emitted that violation for this episode.

    When the signal goes away, the episode ends and a *_resolved event
    fires (useful for UI + report duration tracking).
    """

    def __init__(self, config: dict, emit_fn: Callable[[dict], None]):
        self._cfg = config.get("suspicion", {})
        self._emit = emit_fn
        self._lock = threading.Lock()
        self._states: Dict[str, _SignalState] = {}

        self.thresholds = {
            "face_missing":   float(self._cfg.get("face_missing_sec", 3.0)),
            "gaze_away":      float(self._cfg.get("gaze_away_sec", 2.0)),
            "talking":        float(self._cfg.get("talking_sec", 4.0)),
            "multi_face":     0.0 if self._cfg.get("multi_face_immediate", True) else 0.5,
            "object":         0.0 if self._cfg.get("object_immediate", True) else 0.5,
            "liveness_fail":  10.0,   # 10s without a blink before flagging
        }

        # Map raw signal name → official violation type emitted to the rest
        # of the system.
        self.violation_map = {
            "face_missing":  "FACE_DISAPPEARED",
            "gaze_away":     "GAZE_AWAY",
            "talking":       "TALKING_DETECTED",
            "multi_face":    "MULTIPLE_FACES",
            "object":        "OBJECT_DETECTED",
            "liveness_fail": "LIVENESS_FAILED",
        }

    # ------------------------------------------------------------------
    # Public API — detectors call report(...) every cycle
    # ------------------------------------------------------------------
    def report(self, signal: str, active: bool, data: Optional[dict] = None):
        """Report a raw signal's active/inactive state for this cycle."""
        if signal not in self.thresholds:
            return

        with self._lock:
            st = self._states.setdefault(signal, _SignalState())
            now = time.time()
            threshold = self.thresholds[signal]

            if active:
                if not st.active:
                    # Rising edge — start the clock.
                    st.active = True
                    st.started_at = now
                    st.confirmed = False

                # Has it been active long enough?
                if not st.confirmed and (now - st.started_at) >= threshold:
                    st.confirmed = True
                    st.last_emit_at = now
                    self._emit({
                        "type": self.violation_map[signal],
                        "phase": "started",
                        "started_at": st.started_at,
                        "duration": now - st.started_at,
                        "data": data or {},
                    })
            else:
                if st.active:
                    # Falling edge — episode over.
                    duration = now - (st.started_at or now)
                    was_confirmed = st.confirmed
                    st.active = False
                    st.started_at = None
                    st.confirmed = False
                    if was_confirmed:
                        self._emit({
                            "type": self.violation_map[signal],
                            "phase": "resolved",
                            "duration": duration,
                            "data": data or {},
                        })

    def force_reset(self, signal: str):
        """Reset a signal — useful after a one-shot like 'object detected'."""
        with self._lock:
            if signal in self._states:
                self._states[signal] = _SignalState()

    def get_active_episodes(self) -> dict:
        """Snapshot of all currently active confirmed violations."""
        with self._lock:
            return {
                name: {
                    "started_at": st.started_at,
                    "confirmed": st.confirmed,
                }
                for name, st in self._states.items()
                if st.active
            }
