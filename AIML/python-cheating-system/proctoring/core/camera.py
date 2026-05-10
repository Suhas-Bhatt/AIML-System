import threading
import time
import cv2

class CameraThread(threading.Thread):
    def __init__(self, frame_buffer, camera_index=0):
        super().__init__(daemon=True, name="CameraThread")
        self.frame_buffer = frame_buffer
        self.camera_index = camera_index
        self.stop_event = threading.Event()
        self.cap = None

    def run(self):
        self.cap = cv2.VideoCapture(self.camera_index)
        while not self.stop_event.is_set():
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.1)
                continue
            self.frame_buffer.set_frame(frame)
            time.sleep(0.01) # Small sleep to avoid CPU hogging
        self.cap.release()

    def stop(self):
        self.stop_event.set()
        if self.is_alive():
            self.join(timeout=2.0)
