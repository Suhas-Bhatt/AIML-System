"""
Webcam recorder. Writes the actual displayed-resolution frames so we
don't get stretched/squashed video files (a bug in the original).
"""

import os
from datetime import datetime
from typing import Optional

import cv2


class VideoRecorder:
    def __init__(self, config: dict):
        self.path = config["video"]["recording_path"]
        self.fps = float(config["video"].get("fps", 20))
        self.writer: Optional[cv2.VideoWriter] = None
        self.filename: Optional[str] = None
        self.frame_count = 0
        self.start_time: Optional[datetime] = None
        self._size: Optional[tuple] = None

    def start(self):
        os.makedirs(self.path, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.filename = os.path.join(self.path, f"webcam_{ts}.mp4")
        self.start_time = datetime.now()
        # writer is created lazily on first frame so we know the real size

    def write(self, frame):
        if frame is None:
            return
        if self.writer is None:
            self._size = (frame.shape[1], frame.shape[0])
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            self.writer = cv2.VideoWriter(self.filename, fourcc, self.fps, self._size)
        self.writer.write(frame)
        self.frame_count += 1

    def stop(self):
        if self.writer is not None:
            self.writer.release()
            self.writer = None
        if self.start_time is None:
            return None
        dur = (datetime.now() - self.start_time).total_seconds()
        return {
            "filename": self.filename,
            "frames": self.frame_count,
            "duration_sec": dur,
            "fps": self.frame_count / dur if dur > 0 else 0,
        }
