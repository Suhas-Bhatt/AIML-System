"""
Object detection — YOLOv8n at low FPS.

Optimizations vs. original:
  - 2 FPS by default (review's recommendation; was 5)
  - imgsz=320 (smaller input = much faster on CPU)
  - verbose=False (suppress per-call logging)
  - Skips entirely if not enough time has passed
"""

import time
from typing import List, Tuple, Optional

import cv2
import torch
from ultralytics import YOLO


class ObjectDetector:
    def __init__(self, config: dict):
        cfg = config["detection"]["objects"]
        self.cfg = cfg
        self.target_classes: dict = cfg.get("target_classes", {
            67: "cell phone", 73: "book", 63: "laptop", 62: "tv",
        })
        self.min_conf = float(cfg.get("min_confidence", 0.55))
        self.imgsz = int(cfg.get("imgsz", 320))
        self.fps = float(cfg.get("fps", 2))
        self._period = 1.0 / max(self.fps, 0.1)
        self._last_run = 0.0

        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = YOLO(cfg.get("model_path", "models/yolov8n.pt"))
        self.model.overrides["conf"] = self.min_conf
        self.model.overrides["device"] = device
        self.model.overrides["imgsz"] = self.imgsz
        self.model.overrides["iou"] = 0.45
        self.model.overrides["verbose"] = False

        # Warm up.
        try:
            dummy = torch.zeros((1, 3, self.imgsz, self.imgsz)).to(device)
            self.model(dummy)
        except Exception:
            pass

    # ------------------------------------------------------------------
    def detect(self, frame) -> Tuple[bool, List[dict]]:
        """Returns (any_target_found, list_of_detection_dicts)."""
        now = time.time()
        if now - self._last_run < self._period:
            return False, []
        self._last_run = now

        try:
            h, w = frame.shape[:2]
            new_w = self.imgsz
            new_h = int(h * (new_w / w))
            small = cv2.resize(frame, (new_w, new_h))

            results = self.model(small, verbose=False)
            detections: List[dict] = []
            scale_x = w / new_w
            scale_y = h / new_h

            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    cls = int(box.cls)
                    conf = float(box.conf)
                    if cls in self.target_classes and conf >= self.min_conf:
                        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                        detections.append({
                            "label": self.target_classes[cls],
                            "confidence": conf,
                            "bbox": [
                                int(x1 * scale_x), int(y1 * scale_y),
                                int(x2 * scale_x), int(y2 * scale_y),
                            ],
                        })

            return (len(detections) > 0, detections)
        except Exception as e:
            print(f"[ObjectDetector] inference failed: {e}")
            return False, []
