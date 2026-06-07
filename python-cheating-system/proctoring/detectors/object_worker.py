"""
proctoring/detectors/object_worker.py — OPTIMIZATION: YOLO Singleton

Improvements:
1. Uses YOLO singleton model manager (initialized once at app startup)
   - Saves ~200MB per session (only loaded once total)
   - Saves 200ms initialization time per session
2. Reports ALL suspicious objects sorted by confidence
3. Confidence threshold: >= 0.45 (reduces false positives)
4. Model path resolved relative to this file
5. Graceful handling when model unavailable
"""

import time
import logging
from proctoring.core.engine import DetectorWorker
from proctoring.detectors.yolo_model_manager import get_yolo_model, is_model_available

logger = logging.getLogger(__name__)

# COCO class IDs for suspicious objects
TARGET_CLASSES = {
    67: "cell phone",
    63: "laptop",
    73: "book",
    76: "scissors",
}
CONFIDENCE_THRESHOLD = 0.45


class ObjectWorker(DetectorWorker):
    def __init__(self, buffer, event_queue, interval: int = 25):
        super().__init__(buffer, event_queue, interval)
        # OPTIMIZATION: Get reference to singleton model (already initialized)
        self.model           = get_yolo_model()
        self.model_available = is_model_available()
        
        if self.model_available:
            logger.info("[ObjectWorker] Using YOLO singleton model (shared across sessions)")
        else:
            logger.warning(
                "[ObjectWorker] YOLO model unavailable — object detection disabled. "
                "Ensure initialize_yolo_model() was called in FastAPI lifespan."
            )

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
