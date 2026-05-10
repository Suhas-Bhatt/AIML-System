import cv2
import time
from proctoring.core.engine import DetectorWorker

class FaceWorker(DetectorWorker):
    def __init__(self, buffer, event_queue, interval=5):
        super().__init__(buffer, event_queue, interval)
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    def process(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, 1.1, 4)
        
        face_list = []
        for (x, y, w, h) in faces:
            face_list.append([int(x), int(y), int(w), int(h)])

        return {
            "type": "FACE_DATA",
            "count": len(faces),
            "faces": face_list,
            "timestamp": time.time()
        }
