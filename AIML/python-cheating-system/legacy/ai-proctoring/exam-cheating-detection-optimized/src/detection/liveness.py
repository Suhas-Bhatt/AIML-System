"""
Blink-based liveness detection.

Addresses review issue #16: a printed photo or static webcam feed will
never blink. We track the EAR over time and flag liveness failure if no
blinks are observed in the last minute.

Cheap to compute — uses the same shared landmarks already on hand.
"""

import time
from collections import deque


class LivenessTracker:
    def __init__(self, config: dict):
        cfg = config["detection"].get("liveness", {})
        self.enabled = cfg.get("enabled", True)
        self.ear_threshold = float(cfg.get("ear_threshold", 0.21))
        self.consec_frames = int(cfg.get("consec_frames", 2))
        self.min_bpm = int(cfg.get("min_blinks_per_minute", 6))

        self._below_count = 0
        self._blink_times: deque = deque()   # timestamps within last 60s
        self._last_state_eyes_closed = False
        self._tracking_started_at = time.time()

    def update(self, ear: float) -> dict:
        """Call once per gaze cycle.

        Returns dict with: blinks_in_last_min, is_alive (bool|None),
        suspicious (True if we have enough data and blink rate is too low).
        """
        now = time.time()

        # Drop blinks older than 60s.
        while self._blink_times and now - self._blink_times[0] > 60.0:
            self._blink_times.popleft()

        if ear < self.ear_threshold:
            self._below_count += 1
            self._last_state_eyes_closed = True
        else:
            # Rising edge: eyes were closed for >= consec_frames → blink
            if self._last_state_eyes_closed and self._below_count >= self.consec_frames:
                self._blink_times.append(now)
            self._below_count = 0
            self._last_state_eyes_closed = False

        elapsed = now - self._tracking_started_at
        # Need at least 30s of data before we accuse anyone.
        is_suspicious = (
            self.enabled
            and elapsed > 30.0
            and len(self._blink_times) < self.min_bpm
        )

        return {
            "blinks_last_min": len(self._blink_times),
            "elapsed_sec": elapsed,
            "suspicious": is_suspicious,
        }

    def reset_tracking(self):
        """Call when the face disappears; tracking restarts on reappear."""
        self._tracking_started_at = time.time()
        self._blink_times.clear()
        self._below_count = 0
        self._last_state_eyes_closed = False
