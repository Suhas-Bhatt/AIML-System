"""
Screen recorder — runs in its own thread.

Defaults to 5 FPS (the review noted disk-I/O bottlenecks at 15 FPS).
"""

import os
import threading
import time
from datetime import datetime
from typing import Optional

import cv2
import numpy as np


class ScreenRecorder:
    def __init__(self, config: dict):
        self.cfg = config["screen"]
        self.path = config["video"]["recording_path"]
        self.enabled = self.cfg.get("recording", True)
        self.fps = float(self.cfg.get("fps", 5))

        self.writer: Optional[cv2.VideoWriter] = None
        self.filename: Optional[str] = None
        self.frame_count = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.monitor = {"top": 0, "left": 0, "width": 1920, "height": 1080}

    # ------------------------------------------------------------------
    def start(self):
        if not self.enabled:
            return
        os.makedirs(self.path, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.filename = os.path.join(self.path, f"screen_{ts}.mp4")
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3.0)
        if self.writer is not None:
            self.writer.release()
            self.writer = None
        return {"filename": self.filename, "frames": self.frame_count}

    # ------------------------------------------------------------------
    def _loop(self):
        try:
            from mss import mss
        except Exception as e:
            print(f"[ScreenRecorder] mss unavailable: {e}")
            return

        with mss() as sct:
            mons = sct.monitors
            idx = self.cfg.get("monitor_index", 0) + 1
            self.monitor = mons[idx] if idx < len(mons) else mons[1]

            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            self.writer = cv2.VideoWriter(
                self.filename, fourcc, self.fps,
                (self.monitor["width"], self.monitor["height"]),
            )

            period = 1.0 / max(self.fps, 0.5)
            while not self._stop.is_set():
                t0 = time.time()
                shot = sct.grab(self.monitor)
                frame = np.array(shot)
                frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
                self.writer.write(frame)
                self.frame_count += 1
                rem = period - (time.time() - t0)
                if rem > 0:
                    time.sleep(rem)
