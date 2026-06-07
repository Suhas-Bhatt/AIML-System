"""
Process webcam JPEG frames sent from the browser.

Mirrors test_interview_app rules:
  - No face for 3 consecutive frames  → ai_no_face
  - Multiple faces                    → ai_multiple_faces
  - Cell phone detected               → ai_cell_phone
"""

import logging
import queue
import threading
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

from proctoring.core.buffer import SharedFrameBuffer
from proctoring.detectors.face_worker import FaceWorker
from proctoring.detectors.object_worker import ObjectWorker

logger = logging.getLogger(__name__)

VIOLATION_NO_FACE = "ai_no_face"
VIOLATION_MULTIPLE_FACES = "ai_multiple_faces"
VIOLATION_CELL_PHONE = "ai_cell_phone"

MISSING_FACE_THRESHOLD = 3


class _DetectorStub:
    def __init__(self):
        self.buffer = SharedFrameBuffer()
        self.event_queue = queue.Queue()


class RemoteFrameProcessor:
    """Synchronous frame analyzer for browser-sent JPEG bytes."""

    def __init__(self):
        self._stub = _DetectorStub()
        self._face_worker: Optional[FaceWorker] = None
        self._object_worker: Optional[ObjectWorker] = None
        self._init_lock = threading.Lock()
        self._missing_face_streak: Dict[str, int] = defaultdict(int)
        self._state_lock = threading.Lock()

    def _ensure_workers(self) -> None:
        if self._face_worker and self._object_worker:
            return
        with self._init_lock:
            if self._face_worker and self._object_worker:
                return
            logger.info("Initializing remote frame detectors…")
            self._face_worker = FaceWorker(self._stub.buffer, self._stub.event_queue, interval=1)
            self._object_worker = ObjectWorker(self._stub.buffer, self._stub.event_queue, interval=1)

    def process_jpeg(self, session_id: str, jpeg_bytes: bytes) -> Dict[str, Any]:
        if not jpeg_bytes:
            return {"success": False, "error": "empty_frame"}

        nparr = np.frombuffer(jpeg_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            return {"success": False, "error": "decode_failed"}

        try:
            self._ensure_workers()
            face_result = self._face_worker.process(frame)
            object_result = self._object_worker.process(frame)
        except Exception as exc:
            logger.exception("[%s] Frame processing error: %s", session_id, exc)
            return {"success": False, "error": str(exc)}

        face_count = int(face_result.get("count", 0))
        objects = object_result.get("all_detected") or []
        phone_detected = object_result.get("label") == "cell phone" or any(
            obj.get("class") == "cell phone" for obj in objects
        )

        violations: List[str] = []

        with self._state_lock:
            if face_count == 0:
                self._missing_face_streak[session_id] += 1
                if self._missing_face_streak[session_id] >= MISSING_FACE_THRESHOLD:
                    violations.append(VIOLATION_NO_FACE)
            elif face_count > 1:
                self._missing_face_streak[session_id] = 0
                violations.append(VIOLATION_MULTIPLE_FACES)
            else:
                self._missing_face_streak[session_id] = 0

            if phone_detected:
                violations.append(VIOLATION_CELL_PHONE)

        return {
            "success": True,
            "violations": violations,
            "detections": {
                "face_count": face_count,
                "phone_detected": phone_detected,
                "objects": objects,
                "detector": face_result.get("detector"),
            },
            "timestamp": time.time(),
        }

    def reset_session(self, session_id: str) -> None:
        with self._state_lock:
            self._missing_face_streak.pop(session_id, None)


frame_processor = RemoteFrameProcessor()
