"""Face, gaze, mouth, and identity detection using OpenCV Haar Cascades."""
from __future__ import annotations

import cv2
import numpy as np


class FaceDetector:
    def __init__(self) -> None:
        base = cv2.data.haarcascades
        self.face_cascade = cv2.CascadeClassifier(f"{base}haarcascade_frontalface_default.xml")
        self.eye_cascade = cv2.CascadeClassifier(f"{base}haarcascade_eye.xml")
        self.smile_cascade = cv2.CascadeClassifier(f"{base}haarcascade_smile.xml")
        self._ref_gray: np.ndarray | None = None

    # ── Public API ──────────────────────────────────────────────────────────

    def set_reference(self, frame: np.ndarray) -> bool:
        """Capture reference face for identity verification. Returns True on success."""
        gray = self._preprocess(frame)
        faces = self.face_cascade.detectMultiScale(gray, 1.1, 5)
        if len(faces) != 1:
            return False
        x, y, w, h = faces[0]
        self._ref_gray = cv2.resize(gray[y : y + h, x : x + w], (100, 100))
        return True

    def detect(self, frame: np.ndarray) -> tuple[int, str, bool, bool, bool]:
        """
        Returns:
            face_count, pose, mouth_moving, identity_match, lighting_low
        """
        gray = self._preprocess(frame)
        faces = self.face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
        face_count = len(faces)

        pose = "Forward"
        mouth_moving = False
        identity_match = True
        lighting_low = np.mean(gray) < 45

        if face_count == 1:
            x, y, w, h = faces[0]
            roi = gray[y : y + h, x : x + w]

            eyes = self.eye_cascade.detectMultiScale(roi, 1.1, 10, minSize=(15, 15))
            if len(eyes) < 2:
                pose = "Looking Away"

            mouth_roi = roi[int(h / 2) :, :]
            smiles = self.smile_cascade.detectMultiScale(mouth_roi, 1.7, 20)
            mouth_moving = len(smiles) > 0

            if self._ref_gray is not None:
                face_resized = cv2.resize(roi, (100, 100))
                result = cv2.matchTemplate(face_resized, self._ref_gray, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, _ = cv2.minMaxLoc(result)
                identity_match = max_val >= 0.4

        return face_count, pose, mouth_moving, identity_match, lighting_low

    # ── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _preprocess(frame: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.equalizeHist(gray)
