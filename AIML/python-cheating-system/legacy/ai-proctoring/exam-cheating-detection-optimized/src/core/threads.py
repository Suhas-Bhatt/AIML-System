"""
Thread layout
=============

       Camera ─► SharedFrameBuffer ──┐
                                     │
            ┌────────────────────────┴────────────────────────┐
            ▼                                                 ▼
    FacePipelineThread                              ObjectDetectionThread
    (single face inference, 10 FPS)                       (YOLOv8n, 2 FPS)
            │
            │ publishes FaceFrameData
            ▼
       SharedFaceData
            │
            ├──► GazeAnalysisThread     (head pose + EAR + liveness, 8 FPS)
            └──► MouthAnalysisThread    (mouth-open + audio fusion, 5 FPS)

       AudioThread (independent — runs at audio chunk rate)

All threads talk to SuspicionValidator with raw signals; the validator
emits confirmed violations into the engine's bounded event queue.
"""

import threading
import time
from typing import Optional

import cv2

from core.engine import SharedFrameBuffer, SharedFaceData, FaceFrameData
from core.suspicion_validator import SuspicionValidator
from detection.face_pipeline import FacePipeline
from detection.head_pose import HeadPoseEstimator
from detection.eye_gaze import EyeAnalyzer
from detection.mouth_analyzer import MouthAnalyzer
from detection.liveness import LivenessTracker
from detection.object_detection import ObjectDetector
from detection.audio_detection import AudioMonitor


# ---------------------------------------------------------------------------
# Camera
# ---------------------------------------------------------------------------
class CameraThread(threading.Thread):
    def __init__(self, frame_buffer: SharedFrameBuffer, config: dict, stop_event):
        super().__init__(daemon=True, name="CameraThread")
        self.frame_buffer = frame_buffer
        self.config = config
        self.stop_event = stop_event

        src = config["video"]["source"]
        self.cap = cv2.VideoCapture(src)
        w, h = config["video"]["resolution"]
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        self.target_fps = float(config["video"].get("fps", 20))

    def run(self):
        period = 1.0 / max(self.target_fps, 1.0)
        while not self.stop_event.is_set():
            t0 = time.time()
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.05)
                continue

            # Soft-resize if camera ignored CAP_PROP_*. 480p cap ≈ low-end win.
            h, w = frame.shape[:2]
            if w > 640:
                scale = 640.0 / w
                frame = cv2.resize(frame, (640, int(h * scale)))

            self.frame_buffer.set_frame(frame)

            sleep_for = period - (time.time() - t0)
            if sleep_for > 0:
                time.sleep(sleep_for)

        self.cap.release()


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------
class _BaseDetectorThread(threading.Thread):
    """Common scaffolding for FPS-rate-limited detector threads."""

    def __init__(self, frame_buffer, face_data, event_queue, config, stop_event,
                 validator: Optional[SuspicionValidator] = None):
        super().__init__(daemon=True, name=self.__class__.__name__)
        self.frame_buffer = frame_buffer
        self.face_data = face_data
        self.event_queue = event_queue
        self.config = config
        self.stop_event = stop_event
        self.validator = validator
        self._target_fps = 5.0   # subclasses override

    def _sleep_for_fps(self, t_start: float):
        remaining = (1.0 / max(self._target_fps, 0.1)) - (time.time() - t_start)
        if remaining > 0:
            time.sleep(remaining)


# ---------------------------------------------------------------------------
# Face pipeline (the big one — runs ONCE per frame, replaces 4 detectors)
# ---------------------------------------------------------------------------
class FacePipelineThread(_BaseDetectorThread):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._target_fps = float(self.config["detection"]["face_pipeline"].get("fps", 10))
        self._pipeline = FacePipeline(self.config)
        self._last_frame_id = -1

    def run(self):
        while not self.stop_event.is_set():
            t0 = time.time()
            frame, fid = self.frame_buffer.get_frame_with_id()
            if frame is None or fid == self._last_frame_id:
                time.sleep(0.02)
                continue
            self._last_frame_id = fid

            data = self._pipeline.process(frame, fid)
            self.face_data.update(data)

            # ---------------- Raw signals ----------------
            if self.validator is not None:
                self.validator.report("face_missing", not data.face_present)
                self.validator.report(
                    "multi_face",
                    data.num_faces >= 2,
                    {"count": data.num_faces},
                )
            self._sleep_for_fps(t0)

        self._pipeline.close()


# ---------------------------------------------------------------------------
# Gaze + liveness (consumes shared landmarks)
# ---------------------------------------------------------------------------
class GazeAnalysisThread(_BaseDetectorThread):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        gcfg = self.config["detection"]["gaze"]
        self._target_fps = float(gcfg.get("fps", 8))
        self._yaw_thresh   = float(gcfg.get("yaw_threshold_deg", 22))
        self._pitch_thresh = float(gcfg.get("pitch_threshold_deg", 18))
        self._head_pose = HeadPoseEstimator()
        self._liveness = LivenessTracker(self.config)
        self.last_direction = "Center"
        self.last_yaw = 0.0
        self.last_pitch = 0.0
        self._last_seen_id = -1

    def run(self):
        while not self.stop_event.is_set():
            t0 = time.time()

            data: FaceFrameData = self.face_data.wait_for_new(self._last_seen_id, timeout=0.3)
            if data.frame_id == self._last_seen_id:
                continue
            self._last_seen_id = data.frame_id

            if not data.face_present or data.landmarks is None:
                self._liveness.reset_tracking()
                if self.validator is not None:
                    self.validator.report("gaze_away", False)
                self._sleep_for_fps(t0)
                continue

            # --- head pose ---
            pose = self._head_pose.estimate(data.landmarks, data.frame_shape)
            if pose is not None:
                yaw, pitch, _roll = pose
                self.last_yaw, self.last_pitch = yaw, pitch
                direction = self._head_pose.classify(
                    yaw, pitch, self._yaw_thresh, self._pitch_thresh
                )
                self.last_direction = direction
                gaze_away = (direction != "Center")

                if self.validator is not None:
                    self.validator.report(
                        "gaze_away",
                        gaze_away,
                        {"direction": direction, "yaw": yaw, "pitch": pitch},
                    )

            # --- liveness via EAR ---
            eye = EyeAnalyzer.analyze(data.landmarks, data.frame_shape)
            if eye is not None:
                ear, _offset = eye
                liveness_state = self._liveness.update(ear)
                if self.validator is not None:
                    self.validator.report(
                        "liveness_fail",
                        liveness_state["suspicious"],
                        liveness_state,
                    )

            self._sleep_for_fps(t0)


# ---------------------------------------------------------------------------
# Mouth + audio fusion
# ---------------------------------------------------------------------------
class MouthAnalysisThread(_BaseDetectorThread):
    def __init__(self, *args, audio_monitor: Optional[AudioMonitor] = None, **kwargs):
        super().__init__(*args, **kwargs)
        mcfg = self.config["detection"]["mouth"]
        self._target_fps = float(mcfg.get("fps", 5))
        self._require_audio = bool(mcfg.get("require_audio", True))
        self._mouth = MouthAnalyzer(self.config)
        self._audio = audio_monitor
        self._last_seen_id = -1
        self.last_open = False

    def run(self):
        while not self.stop_event.is_set():
            t0 = time.time()
            data: FaceFrameData = self.face_data.wait_for_new(self._last_seen_id, timeout=0.3)
            if data.frame_id == self._last_seen_id:
                continue
            self._last_seen_id = data.frame_id

            if not data.face_present or data.landmarks is None:
                if self.validator is not None:
                    self.validator.report("talking", False)
                self._sleep_for_fps(t0)
                continue

            sep = self._mouth.analyze(data.landmarks)
            mouth_open = sep is not None and self._mouth.is_open(sep)
            self.last_open = mouth_open

            if self._require_audio and self._audio is not None:
                voice = self._audio.is_voice_active()
                signal_active = mouth_open and voice
            else:
                signal_active = mouth_open

            if self.validator is not None:
                self.validator.report(
                    "talking",
                    signal_active,
                    {"mouth_open": mouth_open, "audio_present":
                     (self._audio.is_voice_active() if self._audio else None)},
                )
            self._sleep_for_fps(t0)


# ---------------------------------------------------------------------------
# Objects (independent of face data)
# ---------------------------------------------------------------------------
class ObjectDetectionThread(_BaseDetectorThread):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._detector = ObjectDetector(self.config)
        self._target_fps = float(self.config["detection"]["objects"].get("fps", 2))
        self._last_seen = -1

    def run(self):
        while not self.stop_event.is_set():
            t0 = time.time()
            frame, fid = self.frame_buffer.get_frame_with_id()
            if frame is None or fid == self._last_seen:
                time.sleep(0.05)
                continue
            self._last_seen = fid

            found, dets = self._detector.detect(frame)
            if self.validator is not None:
                self.validator.report("object", found, {"detections": dets})
            self._sleep_for_fps(t0)
