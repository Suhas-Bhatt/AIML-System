"""Motion-gated YOLO object detector. Runs YOLO only when motion is detected,
saving CPU cycles during still frames."""
from __future__ import annotations

import time
import cv2
import numpy as np
from app.config import get_settings
from app.core.logging import get_logger

log = get_logger("object_detection")

TRACKED_LABELS = {"cell phone", "book", "laptop"}


class ObjectDetector:
    def __init__(self) -> None:
        settings = get_settings()
        self._model_path = settings.YOLO_MODEL_PATH
        self._conf = settings.YOLO_CONFIDENCE
        self._interval = settings.YOLO_SCAN_INTERVAL_SECONDS
        self._model = None  # Lazy load — expensive on import
        self._last_run: float = 0.0
        self._cached: list[str] = []
        self._prev_gray: np.ndarray | None = None
        self._MOTION_THRESHOLD = 50_000

    def detect(self, frame: np.ndarray) -> list[str]:
        gray = cv2.GaussianBlur(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (21, 21), 0)

        if self._prev_gray is None:
            self._prev_gray = gray
            return []

        delta = cv2.absdiff(self._prev_gray, gray)
        motion = np.sum(cv2.threshold(delta, 25, 255, cv2.THRESH_BINARY)[1])
        self._prev_gray = gray
        now = time.monotonic()

        if motion > self._MOTION_THRESHOLD and (now - self._last_run) > self._interval:
            self._last_run = now
            self._cached = self._run_yolo(frame)
        elif motion <= self._MOTION_THRESHOLD and (now - self._last_run) > self._interval * 2:
            self._cached = []

        return self._cached

    def _run_yolo(self, frame: np.ndarray) -> list[str]:
        try:
            model = self._get_model()
            if model is None:
                return []
            results = model(frame, verbose=False, conf=self._conf)
            detected = {
                model.names[int(box.cls[0])]
                for r in results
                for box in r.boxes
                if model.names[int(box.cls[0])] in TRACKED_LABELS
            }
            return list(detected)
        except Exception as exc:
            log.warning("yolo_error", error=str(exc))
            return []

    def _get_model(self):
        if self._model is not None:
            return self._model
        try:
            from ultralytics import YOLO
            self._model = YOLO(self._model_path)
            log.info("yolo_loaded", path=self._model_path)
        except Exception as exc:
            log.error("yolo_load_failed", error=str(exc))
        return self._model
