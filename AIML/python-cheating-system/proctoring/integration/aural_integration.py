import cv2
import base64
import numpy as np
import time
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

from .head_pose import HeadPoseEstimator
from .eye_gaze import EyeAnalyzer
from .liveness import LivenessTracker
from .mouth_analyzer import MouthAnalyzer
from .object_detection import ObjectDetector
from .cheating_logic import CheatingLogic

class Proctor:
    """
    Optimized Enterprise Proctoring Orchestrator.
    Uses a single-pass MediaPipe FaceLandmarker for high performance on i3 CPUs.
    Integrates Head Pose, Gaze Tracking, Liveness, and Mouth Analysis.
    """
    def __init__(self):
        # Configuration (Simulating the config dict from the optimized suite)
        self.config = {
            "detection": {
                "face_pipeline": {"landmarker_model": "models/face_landmarker.task", "num_faces": 2, "min_confidence": 0.55},
                "mouth": {"open_threshold": 0.035},
                "liveness": {"enabled": True, "ear_threshold": 0.21, "consec_frames": 2, "min_blinks_per_minute": 6}
            }
        }

        # 1. Initialize MediaPipe FaceLandmarker
        base_options = mp_python.BaseOptions(model_asset_path="models/face_landmarker.task")
        options = mp_vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            num_faces=2,
            min_face_detection_confidence=0.55,
            min_face_presence_confidence=0.55,
            min_tracking_confidence=0.5,
        )
        self.landmarker = mp_vision.FaceLandmarker.create_from_options(options)

        # 2. Initialize Specialized Analyzers
        self.head_pose = HeadPoseEstimator()
        self.eye_analyzer = EyeAnalyzer()
        self.liveness = LivenessTracker(self.config)
        self.mouth_analyzer = MouthAnalyzer(self.config)
        self.object_detector = ObjectDetector()
        self.logic = CheatingLogic()

    def process_frame(self, frame_b64, audio_level=0):
        """Main entry point for optimized frame processing."""
        try:
            # 1. Decode Frame
            header, encoded = frame_b64.split(',')
            nparr = np.frombuffer(base64.b64decode(encoded), np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None: return {"success": False}

            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            # 2. Run Face Pipeline (ONE inference for all face signals)
            result = self.landmarker.detect(mp_image)
            
            face_present = bool(result.face_landmarks) and len(result.face_landmarks) > 0
            num_faces = len(result.face_landmarks) if face_present else 0
            
            pose = "Center"
            yaw, pitch, roll = 0.0, 0.0, 0.0
            ear, gaze_offset = 0.3, 0.0
            liveness_data = {"suspicious": False}
            mouth_open = False
            
            if face_present:
                landmarks = result.face_landmarks[0]
                
                # Head Pose
                pose_angles = self.head_pose.estimate(landmarks, (h, w))
                if pose_angles:
                    yaw, pitch, roll = pose_angles
                    pose = self.head_pose.classify(yaw, pitch, 15, 10)
                
                # Eye Gaze + EAR
                eye_data = self.eye_analyzer.analyze(landmarks, (h, w))
                if eye_data:
                    ear, gaze_offset = eye_data
                
                # Liveness
                liveness_data = self.liveness.update(ear)
                
                # Mouth
                mouth_sep = self.mouth_analyzer.analyze(landmarks)
                if mouth_sep is not None:
                    mouth_open = self.mouth_analyzer.is_open(mouth_sep)
            else:
                self.liveness.reset_tracking()

            # 3. Run Object Detection (YOLO)
            objects = self.object_detector.detect(frame)
            
            # 4. Aggregate Detections
            detections = {
                "face_count": num_faces,
                "pose": pose,
                "head_angles": {"yaw": yaw, "pitch": pitch, "roll": roll},
                "eye_gaze": {"ear": ear, "offset": gaze_offset},
                "liveness": liveness_data,
                "mouth_moving": mouth_open,
                "objects": objects,
                "audio_level": audio_level
            }
            
            # 5. Apply Enterprise Cheating Logic
            results = self.logic.update_score(detections)
            results["success"] = True
            results["detections"] = detections
            
            return results
            
        except Exception as e:
            print(f"[Optimized Proctor Error] {e}")
            return {"success": False, "error": str(e)}

    def close(self):
        self.landmarker.close()
