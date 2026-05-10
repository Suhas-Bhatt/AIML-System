"""
Single, central face pipeline.

This replaces the FOUR independent face detectors that the review flagged
as the biggest performance bug:

  Before:
    FaceDetector       — MTCNN
    MultiFaceDetector  — MTCNN
    EyeTracker         — MediaPipe FaceLandmarker
    MouthMonitor       — MediaPipe FaceLandmarker      (4 inferences/frame!)

  After:
    FacePipeline       — MediaPipe FaceLandmarker (ONE inference/frame)
                         publishes landmarks to SharedFaceData;
                         downstream gaze/mouth/headpose threads read them
                         without running their own face detection.
"""

import time
from typing import Optional

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

from core.engine import FaceFrameData, SharedFrameBuffer, SharedFaceData


class FacePipeline:
    """Thin wrapper around MediaPipe Tasks FaceLandmarker.

    Configured with num_faces > 1 so multi-face detection is free —
    we get the count from the same inference pass.
    """

    def __init__(self, config: dict):
        cfg = config["detection"]["face_pipeline"]

        base_options = mp_python.BaseOptions(
            model_asset_path=cfg.get("landmarker_model", "face_landmarker.task")
        )
        options = mp_vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            num_faces=cfg.get("num_faces", 3),
            min_face_detection_confidence=cfg.get("min_confidence", 0.55),
            min_face_presence_confidence=cfg.get("min_confidence", 0.55),
            min_tracking_confidence=0.5,
        )
        self._landmarker = mp_vision.FaceLandmarker.create_from_options(options)

    def process(self, frame, frame_id: int) -> FaceFrameData:
        """Run inference on one frame, package the result."""
        h, w = frame.shape[:2]

        # MediaPipe wants RGB. The input frame is BGR (from OpenCV).
        # We slice rather than cv2.cvtColor — same memory cost,
        # but no Python-level dependency on cv2 here.
        rgb = frame[:, :, ::-1]
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb.copy())

        result = self._landmarker.detect(mp_image)

        face_present = bool(result.face_landmarks) and len(result.face_landmarks) > 0
        num_faces = len(result.face_landmarks) if face_present else 0

        # We only publish landmarks for the FIRST (most prominent) face.
        # Multi-face check just needs the count.
        return FaceFrameData(
            frame_id=frame_id,
            timestamp=time.time(),
            face_present=face_present,
            num_faces=num_faces,
            landmarks=result.face_landmarks[0] if face_present else None,
            blendshapes=(result.face_blendshapes[0]
                         if face_present and result.face_blendshapes else None),
            transformation_matrix=(result.facial_transformation_matrixes[0]
                                   if face_present and result.facial_transformation_matrixes else None),
            frame_shape=(h, w),
        )

    def close(self):
        try:
            self._landmarker.close()
        except Exception:
            pass
