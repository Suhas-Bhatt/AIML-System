"""
api/session_manager.py

Manages one proctoring session: camera, detection workers, violation engine,
and WebSocket broadcasting.

Each session is self-contained and can be started/stopped independently.
"""

import threading
import queue
import time
import logging
from typing import Dict, Any, Optional, List, Callable

from proctoring.core.buffer           import SharedFrameBuffer
from proctoring.core.camera           import CameraThread
from proctoring.core.engine           import SentinelEngine
from proctoring.detectors.face_worker   import FaceWorker
from proctoring.detectors.gaze_worker   import GazeWorker
from proctoring.detectors.object_worker import ObjectWorker
from proctoring.engine.violation_engine import ViolationEngine

logger = logging.getLogger(__name__)


class ProctoringSession:
    """
    Encapsulates all threads/state for one candidate's proctoring session.
    Thread-safe: start() / stop() can be called from FastAPI request handlers.
    """

    def __init__(self, session_id: str, interview_id: str,
                 candidate_name: str,
                 on_violation: Optional[Callable] = None,
                 camera_index: int = 0):
        self.session_id     = session_id
        self.interview_id   = interview_id
        self.candidate_name = candidate_name
        self.on_violation   = on_violation  # async callback → FastAPI WebSocket broadcast
        self.camera_index   = camera_index

        self.started_at:  Optional[float] = None
        self.stopped_at:  Optional[float] = None
        self.is_running:  bool = False

        # Core components (created on start)
        self._buffer:           Optional[SharedFrameBuffer] = None
        self._camera:           Optional[CameraThread]      = None
        self._engine:           Optional[SentinelEngine]    = None
        self._violation_engine: Optional[ViolationEngine]  = None

        # Event processor thread
        self._processor_thread: Optional[threading.Thread] = None
        self._processor_stop   = threading.Event()

        # Last known detection state (for status endpoint)
        self._current_state: Dict[str, Any] = {
            "faces":       0,
            "gaze":        "unknown",
            "head_yaw":    0.0,
            "head_pitch":  0.0,
            "objects":     "clear",
            "looking_away": False,
            "last_frame_ts": 0,
        }
        self._state_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> bool:
        if self.is_running:
            logger.warning(f"Session {self.session_id} already running")
            return False

        try:
            self._buffer  = SharedFrameBuffer()
            self._camera  = CameraThread(self._buffer, self.camera_index)
            self._engine  = SentinelEngine(self._buffer)
            self._violation_engine = ViolationEngine(
                self.session_id, threshold_seconds=3.0, throttle_seconds=4.0
            )

            self._engine.add_worker(FaceWorker,   interval=5)
            self._engine.add_worker(GazeWorker,   interval=8)
            self._engine.add_worker(ObjectWorker, interval=25)

            self._processor_stop.clear()
            self._processor_thread = threading.Thread(
                target=self._event_processor_loop,
                daemon=True,
                name=f"proc-{self.session_id[:8]}"
            )

            self._camera.start()
            self._engine.start()
            self._processor_thread.start()

            self.is_running = True
            self.started_at = time.time()
            logger.info(f"[{self.session_id}] Proctoring session started (camera {self.camera_index})")
            return True

        except Exception as e:
            logger.error(f"[{self.session_id}] Failed to start: {e}")
            self._cleanup()
            return False

    def stop(self):
        if not self.is_running:
            return
        self.is_running = False
        self.stopped_at = time.time()

        self._processor_stop.set()
        if self._processor_thread and self._processor_thread.is_alive():
            self._processor_thread.join(timeout=3.0)

        self._cleanup()
        logger.info(f"[{self.session_id}] Proctoring session stopped")

    def _cleanup(self):
        if self._camera:
            self._camera.stop()
        if self._engine:
            self._engine.stop()
        if self._buffer:
            self._buffer.stop()

    # ------------------------------------------------------------------
    # Event processing loop (runs in its own thread)
    # ------------------------------------------------------------------

    def _event_processor_loop(self):
        """Drain the detection event queue and run violation logic."""
        while not self._processor_stop.is_set():
            try:
                event = self._engine.event_queue.get(timeout=0.1)
                self._handle_event(event)
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"[{self.session_id}] Event processor error: {e}")

    def _handle_event(self, event: Dict[str, Any]):
        etype = event.get("type")

        # Update live state
        with self._state_lock:
            self._current_state["last_frame_ts"] = event.get("timestamp", time.time())

            if etype == "FACE_DATA":
                self._current_state["faces"] = event.get("count", 0)

            elif etype == "GAZE_DATA":
                self._current_state["gaze"]        = event.get("direction", "unknown")
                self._current_state["head_yaw"]    = event.get("head_yaw", 0.0)
                self._current_state["head_pitch"]  = event.get("head_pitch", 0.0)
                self._current_state["looking_away"] = event.get("looking_away", False)

            elif etype == "OBJECT_EVENT":
                self._current_state["objects"] = event.get("label", "clear")

        # Violation check
        violation = self._violation_engine.process_event(event)
        if violation and self.on_violation:
            try:
                self.on_violation(self.session_id, violation)
            except Exception as e:
                logger.error(f"[{self.session_id}] on_violation callback error: {e}")

    # ------------------------------------------------------------------
    # Frontend-triggered events (tab switch, etc.)
    # ------------------------------------------------------------------

    def inject_event(self, event: Dict[str, Any]):
        """Called by the API when the frontend sends a client-side event."""
        violation = self._violation_engine.process_event(event)
        if violation and self.on_violation:
            try:
                self.on_violation(self.session_id, violation)
            except Exception as e:
                logger.error(f"[{self.session_id}] inject_event callback error: {e}")
        return violation

    # ------------------------------------------------------------------
    # Status / data accessors
    # ------------------------------------------------------------------

    def get_status(self) -> Dict[str, Any]:
        with self._state_lock:
            state = dict(self._current_state)

        duration = 0.0
        if self.started_at:
            end = self.stopped_at or time.time()
            duration = round(end - self.started_at, 1)

        return {
            "session_id":     self.session_id,
            "interview_id":   self.interview_id,
            "candidate_name": self.candidate_name,
            "is_running":     self.is_running,
            "started_at":     self.started_at,
            "duration_s":     duration,
            "current_state":  state,
            "violation_count": len(self._violation_engine.get_violations()) if self._violation_engine else 0,
        }

    def get_violations(self) -> List[Dict[str, Any]]:
        if not self._violation_engine:
            return []
        return self._violation_engine.get_violations()

    def get_engine_stats(self) -> Dict[str, Any]:
        stats: Dict[str, Any] = {}
        if self._engine:
            stats["engine"] = self._engine.get_engine_stats()
        if self._violation_engine:
            stats["violations"] = self._violation_engine.get_stats()
        return stats


# ------------------------------------------------------------------
# Global registry
# ------------------------------------------------------------------

class SessionRegistry:
    """Thread-safe registry of all active ProctoringSession instances."""

    def __init__(self, max_sessions: int = 10):
        self._sessions: Dict[str, ProctoringSession] = {}
        self._lock = threading.Lock()
        self.max_sessions = max_sessions

    def create(self, session_id: str, interview_id: str,
               candidate_name: str, on_violation: Optional[Callable] = None,
               camera_index: int = 0) -> ProctoringSession:
        with self._lock:
            if session_id in self._sessions:
                raise ValueError(f"Session {session_id} already exists")
            if len(self._sessions) >= self.max_sessions:
                raise RuntimeError(f"Max concurrent sessions ({self.max_sessions}) reached")
            session = ProctoringSession(
                session_id, interview_id, candidate_name,
                on_violation=on_violation, camera_index=camera_index
            )
            self._sessions[session_id] = session
            return session

    def get(self, session_id: str) -> Optional[ProctoringSession]:
        with self._lock:
            return self._sessions.get(session_id)

    def remove(self, session_id: str):
        with self._lock:
            self._sessions.pop(session_id, None)

    def list_sessions(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [s.get_status() for s in self._sessions.values()]

    def stop_all(self):
        with self._lock:
            for session in self._sessions.values():
                session.stop()
            self._sessions.clear()


# Singleton instance used by main.py
registry = SessionRegistry(max_sessions=10)
