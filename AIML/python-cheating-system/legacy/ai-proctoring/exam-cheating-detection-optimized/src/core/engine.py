"""
Core engine for the proctoring system.

Fixes from review:
  - SharedFrameBuffer uses deque(maxlen=1) — no .copy() per frame  (Issue #6)
  - Bounded event queue (maxsize)                                  (Issue #5)
  - Non-blocking put_nowait so producers never stall                (Issue #5)
  - Shared face data store so face detection runs ONCE              (Issue #2 / #3)
"""

import threading
import queue
from collections import deque
from dataclasses import dataclass, field
from typing import List, Optional, Any
import time


# ---------------------------------------------------------------------------
# Frame buffer — single-slot, no copy, lock-free
# ---------------------------------------------------------------------------
class SharedFrameBuffer:
    """Latest-frame buffer using a 1-slot deque.

    deque.append() is atomic in CPython, so we don't need a lock for the
    common path. Readers get a reference to the most recent frame; they
    must NOT mutate it. This avoids the per-frame frame.copy() that the
    review flagged as a major RAM/CPU sink.
    """

    def __init__(self):
        self._buf = deque(maxlen=1)
        self._frame_id = 0
        self._lock = threading.Lock()

    def set_frame(self, frame) -> None:
        # Pass by reference; consumers must treat as read-only.
        self._buf.append(frame)
        with self._lock:
            self._frame_id += 1

    def get_frame(self):
        try:
            return self._buf[-1]
        except IndexError:
            return None

    def get_frame_with_id(self):
        """Returns (frame, frame_id). Used by detectors that want to skip
        re-processing the same frame."""
        try:
            with self._lock:
                fid = self._frame_id
            return self._buf[-1], fid
        except IndexError:
            return None, 0


# ---------------------------------------------------------------------------
# Shared face data — produced ONCE per frame by the face pipeline,
# consumed by gaze / mouth / head-pose / liveness threads.
# ---------------------------------------------------------------------------
@dataclass
class FaceFrameData:
    """Snapshot of face-related info for one frame.

    Producing this once and sharing it eliminates the duplicate face
    detections that the review identified as the biggest performance bug.
    """
    frame_id: int = 0
    timestamp: float = 0.0
    face_present: bool = False
    num_faces: int = 0
    landmarks: Optional[List[Any]] = None     # MediaPipe NormalizedLandmarkList
    blendshapes: Optional[List[Any]] = None
    transformation_matrix: Optional[Any] = None
    frame_shape: tuple = (0, 0)               # (h, w)


class SharedFaceData:
    """Thread-safe container for the latest FaceFrameData."""

    def __init__(self):
        self._data = FaceFrameData()
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)

    def update(self, data: FaceFrameData) -> None:
        with self._cond:
            self._data = data
            self._cond.notify_all()

    def get(self) -> FaceFrameData:
        with self._lock:
            return self._data

    def wait_for_new(self, last_frame_id: int, timeout: float = 0.5):
        """Block until a frame newer than last_frame_id arrives, or timeout."""
        with self._cond:
            self._cond.wait_for(
                lambda: self._data.frame_id > last_frame_id,
                timeout=timeout,
            )
            return self._data


# ---------------------------------------------------------------------------
# Engine — owns all threads
# ---------------------------------------------------------------------------
class ProctorEngine:
    def __init__(self, config: dict):
        self.config = config
        self.frame_buffer = SharedFrameBuffer()
        self.face_data = SharedFaceData()

        maxsize = config.get('logging', {}).get('event_queue_maxsize', 100)
        self.event_queue: queue.Queue = queue.Queue(maxsize=maxsize)

        self.stop_event = threading.Event()
        self.threads: list = []
        self._dropped_events = 0
        self._start_time = time.time()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self, camera_thread_cls, detector_thread_classes):
        """Start camera + all detector threads.

        Detector classes are instantiated with:
            (frame_buffer, face_data, event_queue, config, stop_event)
        """
        cam = camera_thread_cls(self.frame_buffer, self.config, self.stop_event)
        cam.start()
        self.threads.append(cam)

        for cls in detector_thread_classes:
            t = cls(
                frame_buffer=self.frame_buffer,
                face_data=self.face_data,
                event_queue=self.event_queue,
                config=self.config,
                stop_event=self.stop_event,
            )
            t.start()
            self.threads.append(t)

    def stop(self):
        self.stop_event.set()
        for t in self.threads:
            t.join(timeout=3.0)

    # ------------------------------------------------------------------
    # Producer / consumer helpers
    # ------------------------------------------------------------------
    def push_event(self, event: dict) -> bool:
        """Non-blocking put. Returns False if queue is full (event dropped)."""
        try:
            self.event_queue.put_nowait(event)
            return True
        except queue.Full:
            self._dropped_events += 1
            return False

    def get_event(self):
        try:
            return self.event_queue.get_nowait()
        except queue.Empty:
            return None

    def get_latest_frame(self):
        return self.frame_buffer.get_frame()

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------
    def stats(self) -> dict:
        return {
            "uptime_sec": time.time() - self._start_time,
            "queue_size": self.event_queue.qsize(),
            "dropped_events": self._dropped_events,
            "threads_alive": sum(1 for t in self.threads if t.is_alive()),
        }
