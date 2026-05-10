import threading
from collections import deque

class SharedFrameBuffer:
    def __init__(self):
        self._buf = deque(maxlen=1)
        self._frame_id = 0
        self._lock = threading.Lock()

    def set_frame(self, frame) -> None:
        self._buf.append(frame)
        with self._lock:
            self._frame_id += 1

    def set_frame_from_base64(self, base64_str: str) -> bool:
        """Decodes a base64 string from the frontend and puts it in the buffer."""
        import cv2
        import numpy as np
        import base64

        try:
            if "," in base64_str:
                base64_str = base64_str.split(",")[1]
            
            data = base64.b64decode(base64_str)
            np_arr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            
            if frame is not None:
                self.set_frame(frame)
                return True
        except Exception as e:
            print(f"Error decoding frame: {e}")
        return False

    def get_frame(self):
        try:
            # Returns (frame, timestamp) to match standalone_test expectation
            return self._buf[-1], 0 
        except IndexError:
            return None, 0

    def get_frame_with_id(self):
        try:
            with self._lock:
                fid = self._frame_id
            return self._buf[-1], fid
        except IndexError:
            return None, 0

    def stop(self):
        pass
