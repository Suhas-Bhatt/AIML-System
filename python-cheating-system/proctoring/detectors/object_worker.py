"""
proctoring/detectors/object_worker.py — PRODUCTION FIXED

Bugs fixed vs original:
1. When ultralytics is not installed (commented out in requirements.txt),
   process() returned None silently — proctoring dashboard showed nothing.
   Now returns a structured event with detector_available=False.
2. Only first detected object was reported (break on first match).
   Now reports ALL suspicious objects sorted by confidence.
3. No confidence threshold — noisy low-confidence detections could trigger violations.
   Now requires >= 0.45 confidence.
4. Model path was hardcoded relative (yolov8n.pt) — fails if working dir differs.
   Now resolves path relative to this file.
"""

import os
import time
import logging
from proctoring.core.engine import DetectorWorker

logger = logging.getLogger(__name__)

# COCO class IDs for suspicious objects
TARGET_CLASSES = {
    67: "cell phone",
    63: "laptop",
    73: "book",
    76: "scissors",
}
CONFIDENCE_THRESHOLD = 0.45

# Model path relative to this file
_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "models", "yolov8n.pt"
)


class ObjectWorker(DetectorWorker):
    def __init__(self, buffer, event_queue, interval: int = 25):
        super().__init__(buffer, event_queue, interval)
        self.model           = None
        self.model_available = False

        try:
            from ultralytics import YOLO
            model_path = _MODEL_PATH if os.path.exists(_MODEL_PATH) else "yolov8n.pt"
            self.model           = YOLO(model_path)
            self.model_available = True
            logger.info(f"[ObjectWorker] YOLO loaded from: {model_path}")
        except ImportError:
            logger.warning(
                "[ObjectWorker] ultralytics not installed — object detection disabled. "
                "Run: pip install ultralytics"
            )
        except Exception as e:
            logger.error(f"[ObjectWorker] YOLO load error: {e}")

    def process(self, frame) -> dict:
        ts = time.time()

        if not self.model_available or self.model is None:
            return {
                "type":               "OBJECT_EVENT",
                "label":              "clear",
                "all_detected":       [],
                "detector_available": False,
                "timestamp":          ts,
            }

        try:
            results = self.model(frame, verbose=False, imgsz=320)[0]
        except Exception as e:
            logger.error(f"[ObjectWorker] Inference error: {e}")
            return {
                "type":               "OBJECT_EVENT",
                "label":              "clear",
                "all_detected":       [],
                "detector_available": True,
                "timestamp":          ts,
            }

        detected = []
        for box in results.boxes:
            cls  = int(box.cls[0])
            conf = float(box.conf[0])
            if cls in TARGET_CLASSES and conf >= CONFIDENCE_THRESHOLD:
                detected.append({
                    "class":      TARGET_CLASSES[cls],
                    "confidence": round(conf, 3),
                    "class_id":   cls,
                })

        detected.sort(key=lambda x: x["confidence"], reverse=True)
        primary_label = detected[0]["class"] if detected else "clear"

        return {
            "type":               "OBJECT_EVENT",
            "label":              primary_label,
            "all_detected":       detected,
            "detector_available": True,
            "timestamp":          ts,
        }
