import time
import logging
from proctoring.core.engine import DetectorWorker

class ObjectWorker(DetectorWorker):
    def __init__(self, buffer, event_queue, interval=25):
        super().__init__(buffer, event_queue, interval)
        self.model = None
        try:
            from ultralytics import YOLO
            self.model = YOLO("yolov8n.pt")
            # Only track relevant classes: 67 is cell phone, 63 is laptop, 73 is book
            self.target_classes = [67, 63, 73] 
        except ImportError:
            logging.error("Ultralytics not installed. Object detection disabled.")

    def process(self, frame):
        if self.model is None:
            return None

        results = self.model(frame, verbose=False, imgsz=320)[0]
        
        detected_label = "clear"
        for box in results.boxes:
            cls = int(box.cls[0])
            if cls in self.target_classes:
                detected_label = results.names[cls]
                break # Just report the first suspicious object

        return {
            "type": "OBJECT_EVENT",
            "label": detected_label,
            "timestamp": time.time()
        }
