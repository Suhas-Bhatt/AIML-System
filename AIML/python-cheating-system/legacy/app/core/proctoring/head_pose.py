"""
Head pose estimation via OpenCV solvePnP.

Replaces the brittle "is left_eye_x - nose_x > 15px?" gaze check with
proper yaw/pitch/roll Euler angles. This is what professional proctoring
systems use, and what Issue #11 of the review specifically asks for.

Reads landmarks from SharedFaceData — does NOT run its own face
detection. That's the whole point of the new architecture.
"""

import math
from typing import Optional, Tuple

import numpy as np
import cv2

# Indices into MediaPipe's 478-point face mesh.
# A 6-point subset is enough for a stable pose estimate.
LANDMARK_INDICES = {
    "nose_tip":    1,
    "chin":        152,
    "left_eye":    33,    # outer corner
    "right_eye":   263,   # outer corner
    "left_mouth":  61,
    "right_mouth": 291,
}

# Approximate 3D model of these landmarks in millimeters.
# Coordinates are relative; absolute scale doesn't matter for angles.
MODEL_POINTS_3D = np.array([
    (0.0,    0.0,    0.0),       # nose tip
    (0.0,   -63.6,  -12.5),      # chin
    (-43.3,  32.7,  -26.0),      # left eye outer corner
    ( 43.3,  32.7,  -26.0),      # right eye outer corner
    (-28.9, -28.9,  -24.1),      # left mouth corner
    ( 28.9, -28.9,  -24.1),      # right mouth corner
], dtype=np.float64)


class HeadPoseEstimator:
    def __init__(self):
        self._camera_matrix = None
        self._dist_coeffs = np.zeros((4, 1), dtype=np.float64)

    # ------------------------------------------------------------------
    def _camera_matrix_for(self, w: int, h: int) -> np.ndarray:
        """Approximate intrinsics — focal length ≈ image width.

        Good enough for relative head pose; we don't need calibration.
        """
        if self._camera_matrix is None or \
           self._camera_matrix[0, 2] != w / 2:
            focal = float(w)
            self._camera_matrix = np.array([
                [focal, 0,     w / 2.0],
                [0,     focal, h / 2.0],
                [0,     0,     1],
            ], dtype=np.float64)
        return self._camera_matrix

    # ------------------------------------------------------------------
    def estimate(self, landmarks, frame_shape) -> Optional[Tuple[float, float, float]]:
        """Returns (yaw, pitch, roll) in degrees, or None on failure.

        Convention:
          yaw   — turning head left (-) / right (+)
          pitch — looking up   (-) / down  (+)
          roll  — head tilt
        """
        if landmarks is None:
            return None

        h, w = frame_shape
        try:
            image_points = np.array([
                (landmarks[LANDMARK_INDICES["nose_tip"]].x    * w, landmarks[LANDMARK_INDICES["nose_tip"]].y    * h),
                (landmarks[LANDMARK_INDICES["chin"]].x        * w, landmarks[LANDMARK_INDICES["chin"]].y        * h),
                (landmarks[LANDMARK_INDICES["left_eye"]].x    * w, landmarks[LANDMARK_INDICES["left_eye"]].y    * h),
                (landmarks[LANDMARK_INDICES["right_eye"]].x   * w, landmarks[LANDMARK_INDICES["right_eye"]].y   * h),
                (landmarks[LANDMARK_INDICES["left_mouth"]].x  * w, landmarks[LANDMARK_INDICES["left_mouth"]].y  * h),
                (landmarks[LANDMARK_INDICES["right_mouth"]].x * w, landmarks[LANDMARK_INDICES["right_mouth"]].y * h),
            ], dtype=np.float64)
        except (IndexError, AttributeError):
            return None

        cam_matrix = self._camera_matrix_for(w, h)

        ok, rvec, tvec = cv2.solvePnP(
            MODEL_POINTS_3D,
            image_points,
            cam_matrix,
            self._dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not ok:
            return None

        # Convert rotation vector → Euler angles.
        rmat, _ = cv2.Rodrigues(rvec)
        sy = math.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
        singular = sy < 1e-6

        if not singular:
            pitch = math.atan2(rmat[2, 1], rmat[2, 2])
            yaw   = math.atan2(-rmat[2, 0], sy)
            roll  = math.atan2(rmat[1, 0], rmat[0, 0])
        else:
            pitch = math.atan2(-rmat[1, 2], rmat[1, 1])
            yaw   = math.atan2(-rmat[2, 0], sy)
            roll  = 0.0

        return (
            math.degrees(yaw),
            math.degrees(pitch),
            math.degrees(roll),
        )

    # ------------------------------------------------------------------
    @staticmethod
    def classify(yaw_deg: float, pitch_deg: float,
                 yaw_thresh: float, pitch_thresh: float) -> str:
        """Bucket the pose into a coarse direction string for the UI."""
        if abs(yaw_deg) <= yaw_thresh and abs(pitch_deg) <= pitch_thresh:
            return "Center"
        if yaw_deg < -yaw_thresh:
            return "Right"   # camera-mirrored: turning head left → yaw negative
        if yaw_deg >  yaw_thresh:
            return "Left"
        if pitch_deg >  pitch_thresh:
            return "Down"
        if pitch_deg < -pitch_thresh:
            return "Up"
        return "Center"
