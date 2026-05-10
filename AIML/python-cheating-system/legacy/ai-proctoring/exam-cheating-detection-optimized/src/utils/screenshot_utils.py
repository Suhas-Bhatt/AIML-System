"""
Evidence screenshot capture — with per-type cooldown.

Addresses review issue #14: capturing on every violation loop spammed
disk I/O. We now keep at most one screenshot per type per cooldown
window (default 10s).
"""

import os
import time
import threading
from datetime import datetime
from typing import Optional, Dict

import cv2


class ViolationCapturer:
    def __init__(self, config: dict):
        out = config["global"]["output_path"]
        self.output_dir = os.path.join(out, "violation_captures")
        os.makedirs(self.output_dir, exist_ok=True)

        self.cooldown = float(config.get("logging", {}).get("screenshot_cooldown", 10))
        self.jpeg_quality = int(config.get("video", {}).get("jpeg_quality", 80))
        self._last_capture: Dict[str, float] = {}
        self._lock = threading.Lock()

    def capture(self, frame, violation_type: str, metadata: Optional[dict] = None) -> Optional[str]:
        """Save an annotated frame. Returns the path, or None if cooled-down."""
        if frame is None:
            return None

        now = time.time()
        with self._lock:
            last = self._last_capture.get(violation_type, 0.0)
            if now - last < self.cooldown:
                return None
            self._last_capture[violation_type] = now

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
        filename = f"{violation_type}_{timestamp}.jpg"
        path = os.path.join(self.output_dir, filename)

        # Annotate a copy — the live frame must stay untouched for other
        # consumers (UI, recorder).
        labeled = frame.copy()
        cv2.putText(
            labeled,
            f"{violation_type}  {timestamp}",
            (15, 35),
            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2,
        )

        try:
            cv2.imwrite(path, labeled, [cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality])
            return os.path.abspath(path)
        except Exception as e:
            print(f"[ViolationCapturer] save failed: {e}")
            return None
