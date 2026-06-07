"""
detectors/gaze_worker.py

Fix applied:
  Old normalization: / (left_eye_center[0] * 0.1)
    — divides by the eye's X pixel position, which varies across the frame.
    — produces wildly different gaze values depending on where the face sits.

  Fixed normalization: / eye_width
    — uses the actual width of the eye bounding box as the scale reference.
    — produces consistent 0-1 range regardless of face position.
"""

import cv2
import time
import numpy as np
from proctoring.core.engine import DetectorWorker


class GazeWorker(DetectorWorker):
    def __init__(self, buffer, event_queue, interval=8,
                 performance_monitor=None, adaptive_manager=None):
        super().__init__(buffer, event_queue, interval, performance_monitor, adaptive_manager)

        self.mediapipe_available = False
        self.face_mesh           = None

        try:
            import mediapipe as mp
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh    = self.mp_face_mesh.FaceMesh(
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.mediapipe_available = True
            print("[*] GazeWorker: MediaPipe Face Mesh initialized")

        except (ImportError, AttributeError) as e:
            print(f"[!] GazeWorker: MediaPipe unavailable ({e}). Using fallback.")
            self.face_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_eye.xml"
            )

    # ------------------------------------------------------------------
    # MediaPipe path
    # ------------------------------------------------------------------

    def _calc_gaze_direction(self, landmarks, frame_shape):
        """
        Returns ("Left" | "Right" | "Center"), avg_gaze_x float
        Uses iris landmarks (refine_landmarks=True required).
        Normalises by eye width — not eye X position (the old bug).
        """
        h, w = frame_shape[:2]

        LEFT_EYE   = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
        RIGHT_EYE  = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382]
        LEFT_IRIS  = [474, 475, 476, 477]
        RIGHT_IRIS = [469, 470, 471, 472]

        def pts(indices):
            return np.array([(landmarks[i].x * w, landmarks[i].y * h) for i in indices])

        left_eye_pts   = pts(LEFT_EYE)
        right_eye_pts  = pts(RIGHT_EYE)
        left_eye_ctr   = left_eye_pts.mean(axis=0)
        right_eye_ctr  = right_eye_pts.mean(axis=0)

        # Eye width for normalization
        left_eye_w  = max(left_eye_pts[:, 0].max() - left_eye_pts[:, 0].min(), 1)
        right_eye_w = max(right_eye_pts[:, 0].max() - right_eye_pts[:, 0].min(), 1)

        if len(landmarks) > 477:
            left_iris_ctr  = pts(LEFT_IRIS).mean(axis=0)
            right_iris_ctr = pts(RIGHT_IRIS).mean(axis=0)

            # FIX: normalize by eye width (not eye_center[0] * 0.1)
            left_gaze_x  = (left_iris_ctr[0]  - left_eye_ctr[0])  / left_eye_w
            right_gaze_x = (right_iris_ctr[0] - right_eye_ctr[0]) / right_eye_w
            avg_gaze_x   = (left_gaze_x + right_gaze_x) / 2.0

            if avg_gaze_x > 0.15:
                return "Right", avg_gaze_x
            elif avg_gaze_x < -0.15:
                return "Left", avg_gaze_x
            return "Center", avg_gaze_x

        return "Center", 0.0

    def _calc_head_pose(self, landmarks, frame_shape):
        h, w = frame_shape[:2]

        def pt(idx):
            return np.array([landmarks[idx].x * w, landmarks[idx].y * h])

        nose_tip    = pt(1)
        left_eye    = pt(33)
        right_eye   = pt(263)
        left_mouth  = pt(61)
        right_mouth = pt(291)

        eye_center   = (left_eye + right_eye) / 2
        mouth_center = (left_mouth + right_mouth) / 2

        yaw   = float(np.arctan2(eye_center[0] - w / 2, w) * 180 / np.pi)
        pitch = float(np.arctan2(nose_tip[1] - eye_center[1], h) * 180 / np.pi)

        return yaw, pitch

    def _process_with_mediapipe(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb)

        if results.multi_face_landmarks:
            lm = results.multi_face_landmarks[0].landmark

            gaze_dir, gaze_x = self._calc_gaze_direction(lm, frame.shape)
            yaw, pitch        = self._calc_head_pose(lm, frame.shape)

            looking_away = abs(yaw) > 30 or abs(pitch) > 25 or gaze_dir in ("Left", "Right")

            return {
                "type":         "GAZE_DATA",
                "direction":    gaze_dir,
                "head_yaw":     round(yaw, 1),
                "head_pitch":   round(pitch, 1),
                "looking_away": looking_away,
                "timestamp":    time.time(),
            }

        return {
            "type":         "GAZE_DATA",
            "direction":    "No Face",
            "head_yaw":     0.0,
            "head_pitch":   0.0,
            "looking_away": False,
            "timestamp":    time.time(),
        }

    # ------------------------------------------------------------------
    # Fallback (no MediaPipe)
    # ------------------------------------------------------------------

    def _process_basic(self, frame):
        small = cv2.resize(frame, (320, 240))
        gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        eyes  = self.face_cascade.detectMultiScale(gray, 1.1, 10, minSize=(15, 15))

        direction    = "Center" if len(eyes) >= 2 else ("No Face" if len(eyes) == 0 else "Tracking")
        looking_away = len(eyes) == 0

        return {
            "type":         "GAZE_DATA",
            "direction":    direction,
            "head_yaw":     0.0,
            "head_pitch":   0.0,
            "looking_away": looking_away,
            "timestamp":    time.time(),
        }

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------

    def process(self, frame):
        if self.mediapipe_available and self.face_mesh:
            return self._process_with_mediapipe(frame)
        return self._process_basic(frame)
