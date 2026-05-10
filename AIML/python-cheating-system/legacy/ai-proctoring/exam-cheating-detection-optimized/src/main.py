"""
Main entry point for the optimized AI proctoring system.

Wiring:
    CameraThread ─► SharedFrameBuffer
                       │
       FacePipelineThread (single inference per frame)
                       │
                       ▼
                SharedFaceData ─► GazeAnalysisThread
                                  MouthAnalysisThread
    ObjectDetectionThread ──────────────────────────────► SuspicionValidator
    AudioMonitor ─────────────────────────────────────────►       │
                                                                  ▼
                                                          Bounded Event Queue
                                                                  │
                                              ┌───────────────────┴────────────────────┐
                                              ▼                                        ▼
                                       Screenshot+Logger                       Alert + UI
"""

import os
import sys
import time
import yaml
import threading
from datetime import datetime

import cv2

# Make `src.*` importable when running `python src/main.py`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.engine import ProctorEngine
from core.suspicion_validator import SuspicionValidator
from core.threads import (
    CameraThread,
    FacePipelineThread,
    GazeAnalysisThread,
    MouthAnalysisThread,
    ObjectDetectionThread,
)
from detection.audio_detection import AudioMonitor
from utils.alert_system import AlertSystem
from utils.logging import AlertLogger
from utils.performance_monitor import PerformanceMonitor
from utils.screen_capture import ScreenRecorder
from utils.screenshot_utils import ViolationCapturer
from utils.video_utils import VideoRecorder
from utils.violation_logger import ViolationLogger
from reporting.report_generator import ReportGenerator


# ---------------------------------------------------------------------------
def load_config(path: str = "config/config.yaml") -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
class ProctoringSystem:
    def __init__(self, config: dict):
        self.config = config
        self.engine = ProctorEngine(config)

        # Validator gets a function pointer that pushes confirmed
        # violations onto the engine's bounded queue.
        self.validator = SuspicionValidator(config, emit_fn=self.engine.push_event)

        # Audio monitor — emits raw "voice activity" signals into the
        # validator AND is queried by MouthAnalysisThread for fusion.
        self.audio = AudioMonitor(
            config,
            on_voice_event=lambda: self.engine.push_event({
                "type": "AUDIO_DETECTED",
                "phase": "instant",
                "started_at": time.time(),
                "duration": 0.0,
                "data": {},
            }),
        )

        # Sinks
        self.alerts = AlertSystem(config)
        self.alert_log = AlertLogger(config)
        self.capturer = ViolationCapturer(config)
        self.violations = ViolationLogger(config)
        self.report = ReportGenerator(config)
        self.video_recorder = VideoRecorder(config)
        self.screen_recorder = ScreenRecorder(config)

        # Performance monitor
        self.perf = PerformanceMonitor(config, on_mode_change=self._on_mode_change)

        # Live UI state
        self.ui_state = {
            "face_present": True,
            "gaze_direction": "Center",
            "yaw": 0.0,
            "pitch": 0.0,
            "mouth_open": False,
            "active_violations": set(),
        }
        self._ui_lock = threading.Lock()

    # ------------------------------------------------------------------
    def _on_mode_change(self, mode: str, params: dict):
        """Adaptive performance hook — downshift / upshift FPS budgets."""
        det = self.config["detection"]
        if "face_fps" in params:
            det["face_pipeline"]["fps"] = params["face_fps"]
        if "gaze_fps" in params:
            det["gaze"]["fps"] = params["gaze_fps"]
        if "mouth_fps" in params:
            det["mouth"]["fps"] = params["mouth_fps"]
        if "object_fps" in params:
            det["objects"]["fps"] = params["object_fps"]
        print(f"[Perf] mode → {mode}  cpu={self.perf.last_cpu:.0f}%  ram={self.perf.last_ram:.0f}%")

    # ------------------------------------------------------------------
    def handle_event(self, event: dict, frame):
        """Called for every confirmed violation from the validator."""
        v_type = event.get("type")
        phase = event.get("phase")
        if not v_type:
            return

        # Update UI state
        with self._ui_lock:
            if phase == "started":
                self.ui_state["active_violations"].add(v_type)
            elif phase == "resolved":
                self.ui_state["active_violations"].discard(v_type)

        # Voice alert + plain-text log + screenshot only on episode start.
        if phase in ("started", "instant"):
            self.alerts.speak(v_type)
            self.alert_log.log(v_type, event.get("data", {}).get("info", v_type))

            shot_path = self.capturer.capture(frame, v_type, event.get("data"))
            if shot_path:
                self.violations.add_evidence(v_type, shot_path)

        # Always feed the structured episode logger.
        self.violations.on_event(event)

    # ------------------------------------------------------------------
    def render_overlay(self, frame):
        if frame is None:
            return
        with self._ui_lock:
            face = self.ui_state["face_present"]
            direction = self.ui_state["gaze_direction"]
            active = list(self.ui_state["active_violations"])

        items = [
            ("Face: " + ("Present" if face else "Absent"), (0, 200, 0) if face else (0, 0, 255)),
            (f"Gaze: {direction}", (0, 200, 0) if direction == "Center" else (0, 165, 255)),
        ]
        if self.config["performance"].get("monitor_enabled", True):
            snap = self.perf.snapshot()
            items.append((f"CPU {snap['cpu']:.0f}%  RAM {snap['ram']:.0f}%  [{snap['mode']}]",
                          (200, 200, 200)))

        y = 28
        for text, color in items:
            cv2.putText(frame, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
            y += 24

        if active:
            cv2.putText(frame, "ACTIVE: " + ", ".join(active),
                        (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)
            y += 24

        ts = datetime.now().strftime("%H:%M:%S")
        cv2.putText(frame, ts, (frame.shape[1] - 100, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    # ------------------------------------------------------------------
    def _refresh_ui_from_threads(self):
        """Pull latest gaze / mouth state from the analysis threads.

        We grab them by walking the engine's thread list — cleaner than
        wiring extra signals.
        """
        for t in self.engine.threads:
            cls_name = type(t).__name__
            if cls_name == "GazeAnalysisThread":
                with self._ui_lock:
                    self.ui_state["gaze_direction"] = t.last_direction
                    self.ui_state["yaw"] = t.last_yaw
                    self.ui_state["pitch"] = t.last_pitch
            elif cls_name == "MouthAnalysisThread":
                with self._ui_lock:
                    self.ui_state["mouth_open"] = t.last_open

        face_data = self.engine.face_data.get()
        with self._ui_lock:
            self.ui_state["face_present"] = face_data.face_present

    # ------------------------------------------------------------------
    def run(self, student_info: dict):
        # Inject the validator into the detector threads.
        # We need a tiny adapter so the engine's start() signature
        # (which takes only thread classes) still works.
        validator = self.validator
        audio_ref = self.audio

        class FaceP(FacePipelineThread):
            def __init__(self, *a, **kw): super().__init__(*a, validator=validator, **kw)
        class GazeP(GazeAnalysisThread):
            def __init__(self, *a, **kw): super().__init__(*a, validator=validator, **kw)
        class MouthP(MouthAnalysisThread):
            def __init__(self, *a, **kw):
                super().__init__(*a, audio_monitor=audio_ref, validator=validator, **kw)
        class ObjP(ObjectDetectionThread):
            def __init__(self, *a, **kw): super().__init__(*a, validator=validator, **kw)

        # Start everything
        self.video_recorder.start()
        if self.config["screen"].get("recording", True):
            self.screen_recorder.start()

        self.audio.start()
        if self.config["performance"].get("monitor_enabled", True):
            self.perf.start()

        self.engine.start(CameraThread, [FaceP, GazeP, MouthP, ObjP])

        print("=" * 60)
        print(" AI Proctoring System (optimized) — started")
        print(" Press 'q' in the video window to stop and generate report.")
        print("=" * 60)

        try:
            last_ui_refresh = 0.0
            while True:
                frame = self.engine.get_latest_frame()
                if frame is None:
                    time.sleep(0.02)
                    continue

                # Drain the event queue — handle all pending events.
                while True:
                    event = self.engine.get_event()
                    if event is None:
                        break
                    self.handle_event(event, frame)

                # Periodic UI refresh from thread state (cheap)
                now = time.time()
                if now - last_ui_refresh > 0.1:
                    self._refresh_ui_from_threads()
                    last_ui_refresh = now

                # Render overlay onto a copy so the recorder & evidence
                # capture have a clean frame in their own threads.
                display = frame.copy()
                self.render_overlay(display)

                self.video_recorder.write(frame)
                cv2.imshow("AI Proctoring (optimized)", display)

                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
        finally:
            self.shutdown(student_info)

    # ------------------------------------------------------------------
    def shutdown(self, student_info: dict):
        print("\nShutting down...")
        self.engine.stop()
        self.audio.stop()
        self.perf.stop()

        # Finalize logs (incremental save was happening throughout)
        self.violations.save()
        violations = self.violations.get_violations()

        report_path = self.report.generate(student_info, violations, output_format="html")
        print(f"Report:        {report_path}")

        rec_info = self.video_recorder.stop()
        if rec_info:
            print(f"Webcam video:  {rec_info['filename']}  ({rec_info['frames']} frames)")
        if self.config["screen"].get("recording", True):
            scr_info = self.screen_recorder.stop()
            if scr_info:
                print(f"Screen video:  {scr_info['filename']}  ({scr_info['frames']} frames)")

        cv2.destroyAllWindows()
        stats = self.engine.stats()
        print(f"Engine stats:  {stats}")


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    config = load_config()
    student = {
        "id":   "STUDENT_001",
        "name": "John Doe",
        "exam": "Optimized Concurrent Proctoring Test",
    }
    system = ProctoringSystem(config)
    system.run(student)
