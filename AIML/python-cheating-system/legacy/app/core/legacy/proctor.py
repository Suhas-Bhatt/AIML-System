"""Proctor — orchestrates face + object detection and cheating logic."""
from __future__ import annotations

import base64

import cv2
import numpy as np

from app.core.cheating_logic import CheatingLogic
from app.core.face_detection import FaceDetector
from app.core.logging import get_logger
from app.core.object_detection import ObjectDetector

log = get_logger("proctor")


class Proctor:
    def __init__(self) -> None:
        self.face = FaceDetector()
        self.objects = ObjectDetector()
        self.logic = CheatingLogic()

    # ── Frame processing ────────────────────────────────────────────────────

    def process_frame(self, frame_b64: str, audio_level: float = 0.0) -> dict:
        frame = self._decode(frame_b64)
        if frame is None:
            return {"success": False, "error": "Failed to decode frame"}

        small = cv2.resize(frame, (320, 240))

        face_count, pose, mouth_moving, identity_match, lighting_low = self.face.detect(small)
        detected_objects = self.objects.detect(small)

        detections = {
            "face_count": face_count,
            "pose": pose,
            "mouth_moving": mouth_moving,
            "objects": detected_objects,
            "audio_level": audio_level,
            "identity_match": identity_match,
            "lighting_low": lighting_low,
        }

        result = self.logic.update(detections)
        result["success"] = True
        result["detections"] = detections
        return result

    def set_reference(self, frame_b64: str) -> bool:
        frame = self._decode(frame_b64)
        if frame is None:
            return False
        return self.face.set_reference(frame)

    # ── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _decode(frame_b64: str) -> np.ndarray | None:
        try:
            if "," in frame_b64:
                frame_b64 = frame_b64.split(",", 1)[1]
            data = base64.b64decode(frame_b64)
            arr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            return frame  # May be None if decode fails
        except Exception as exc:
            log.debug("frame_decode_error", error=str(exc))
            return None
