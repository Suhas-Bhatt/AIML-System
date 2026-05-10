"""
Gaze + blink analysis using the SHARED face landmarks.

Replaces the old EyeTracker which ran its own MediaPipe FaceLandmarker
(see review issue #2 — face detection was running 4× per frame).
"""

import numpy as np
from typing import Optional, Tuple

LEFT_EYE_INDICES  = [33, 160, 158, 133, 153, 144]
RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380]


def _ear(eye_pts: np.ndarray) -> float:
    """Eye Aspect Ratio. Lower = eye closed."""
    a = np.linalg.norm(eye_pts[1] - eye_pts[5])
    b = np.linalg.norm(eye_pts[2] - eye_pts[4])
    c = np.linalg.norm(eye_pts[0] - eye_pts[3])
    if c == 0:
        return 0.3
    return (a + b) / (2.0 * c)


class EyeAnalyzer:
    """Computes EAR + simple eye-vs-nose horizontal offset.

    Used as a fallback signal when head-pose isn't conclusive (e.g.
    eyes flicking sideways without turning the head — the classic
    "glance at notes" cheat).
    """

    @staticmethod
    def analyze(landmarks, frame_shape) -> Optional[Tuple[float, float]]:
        """Returns (avg_ear, horizontal_offset_px), or None."""
        if landmarks is None:
            return None
        h, w = frame_shape
        try:
            left  = np.array([(landmarks[i].x * w, landmarks[i].y * h) for i in LEFT_EYE_INDICES])
            right = np.array([(landmarks[i].x * w, landmarks[i].y * h) for i in RIGHT_EYE_INDICES])
        except (IndexError, AttributeError):
            return None

        avg_ear = (_ear(left) + _ear(right)) / 2.0

        # Horizontal offset: positive = pupils right of nose
        nose_x = landmarks[1].x * w
        eye_cx = (left[:, 0].mean() + right[:, 0].mean()) / 2.0
        offset = eye_cx - nose_x

        return float(avg_ear), float(offset)
