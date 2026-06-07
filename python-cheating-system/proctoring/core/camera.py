"""
proctoring/core/camera.py — FIXED

Bugs fixed:
1. Camera was capturing at 100fps (sleep=0.01s), burning CPU for frames
   immediately discarded by the maxlen=1 buffer. Now capped at TARGET_FPS.
2. No graceful handling of camera failure during init.
3. Camera index not validated before capture loop.
"""

import threading
import time
import cv2
import logging

logger = logging.getLogger(__name__)

TARGET_FPS     = 15                  # Capture at 15fps — matches actual processing needs
FRAME_INTERVAL = 1.0 / TARGET_FPS   # ~0.067s between frames


class CameraThread(threading.Thread):
    def __init__(self, frame_buffer, camera_index: int = 0):
        super().__init__(daemon=True, name=f"CameraThread-{camera_index}")
        self.frame_buffer  = frame_buffer
        self.camera_index  = camera_index
        self.stop_event    = threading.Event()
        self.cap           = None
        self._started_ok   = threading.Event()
        self._start_error  = None

    def run(self):
        try:
            self.cap = cv2.VideoCapture(self.camera_index)

            if not self.cap.isOpened():
                self._start_error = RuntimeError(
                    f"Camera index {self.camera_index} could not be opened. "
                    "Check that a webcam is connected and not in use."
                )
                self._started_ok.set()
                return

            # Hint the camera driver to use our target FPS
            self.cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)
            # Reduce buffer size to 1 so we always get the latest frame
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            self._started_ok.set()
            logger.info(
                f"[CameraThread] Camera {self.camera_index} opened at target {TARGET_FPS}fps"
            )

            last_capture = 0.0
            consecutive_failures = 0

            while not self.stop_event.is_set():
                now = time.monotonic()

                # Rate-limit: only capture when the frame interval has elapsed
                remaining = FRAME_INTERVAL - (now - last_capture)
                if remaining > 0:
                    # Sleep in small chunks so stop_event is checked frequently
                    time.sleep(min(remaining, 0.01))
                    continue

                ret, frame = self.cap.read()
                if ret:
                    self.frame_buffer.set_frame(frame)
                    last_capture = time.monotonic()
                    consecutive_failures = 0
                else:
                    consecutive_failures += 1
                    if consecutive_failures >= 10:
                        logger.error(
                            f"[CameraThread] Camera {self.camera_index}: "
                            f"{consecutive_failures} consecutive read failures — stopping"
                        )
                        break
                    time.sleep(0.05)

        except Exception as e:
            logger.exception(f"[CameraThread] Fatal error: {e}")
            if not self._started_ok.is_set():
                self._start_error = e
                self._started_ok.set()
        finally:
            if self.cap:
                self.cap.release()
                self.cap = None
            logger.info(f"[CameraThread] Camera {self.camera_index} released")

    def wait_for_start(self, timeout: float = 5.0) -> bool:
        """
        Wait for camera to open. Returns True if started successfully.
        Raises RuntimeError if camera failed to open.
        """
        ok = self._started_ok.wait(timeout=timeout)
        if not ok:
            raise RuntimeError(f"Camera {self.camera_index} did not open within {timeout}s")
        if self._start_error:
            raise self._start_error
        return True

    def stop(self):
        self.stop_event.set()
        if self.is_alive():
            self.join(timeout=3.0)
