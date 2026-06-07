"""
proctoring/detectors/face_worker.py — Production Enhanced

Detector priority chain (best accuracy first):
  1. MediaPipe Face Detection  — sub-pixel accuracy, good in varied lighting
  2. OpenCV DNN (ResNet SSD)   — better than Haar, no extra dependency
  3. OpenCV Haar Cascades      — last resort, lower accuracy

The detector type is chosen once at __init__ and logged.
Frame is downscaled to 640×360 before processing for ~80% CPU reduction.
"""

import cv2
import time
import logging

from proctoring.core.engine import DetectorWorker

logger = logging.getLogger(__name__)

# Downscale target for faster processing
PROCESS_WIDTH  = 640
PROCESS_HEIGHT = 360


class FaceWorker(DetectorWorker):
    """
    Multi-backend face detector with automatic fallback.

    Emits events of the form:
        {
            "type": "FACE_DATA",
            "count": int,
            "faces": [{"bbox": [x, y, w, h], "confidence": float}],
            "detector": "mediapipe" | "dnn" | "haar",
            "timestamp": float,
        }
    """

    def __init__(self, buffer, event_queue, interval: int = 5):
        super().__init__(buffer, event_queue, interval)
        self._detector_type = "haar"
        self._init_detector()

    # ------------------------------------------------------------------
    # Detector initialisation
    # ------------------------------------------------------------------

    def _init_detector(self) -> None:
        # 1. Try MediaPipe Face Detection (best accuracy)
        try:
            import mediapipe as mp
            self._mp_face_detection = mp.solutions.face_detection
            self._face_detector = self._mp_face_detection.FaceDetection(
                model_selection=1,               # 1 = full-range (≤5 m)
                min_detection_confidence=0.55,
            )
            self._detector_type = "mediapipe"
            logger.info("[FaceWorker] Using MediaPipe Face Detection")
            return
        except (ImportError, AttributeError, Exception) as e:
            logger.info(f"[FaceWorker] MediaPipe unavailable ({e}); trying DNN")

        # 2. Try OpenCV DNN SSD (better than Haar, ships with OpenCV)
        try:
            prototxt = cv2.data.haarcascades.replace(
                "haarcascades/", "dnn/face_detector/deploy.prototxt"
            )
            model = cv2.data.haarcascades.replace(
                "haarcascades/", "dnn/face_detector/res10_300x300_ssd_iter_140000_fp16.caffemodel"
            )
            self._dnn_net = cv2.dnn.readNetFromCaffe(prototxt, model)
            self._detector_type = "dnn"
            logger.info("[FaceWorker] Using OpenCV DNN Face Detection")
            return
        except Exception as e:
            logger.info(f"[FaceWorker] DNN unavailable ({e}); using Haar Cascades")

        # 3. Fallback to Haar Cascades
        self._face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        if self._face_cascade.empty():
            logger.error("[FaceWorker] Haar Cascade failed to load — face detection disabled")
        else:
            logger.info("[FaceWorker] Using Haar Cascade face detection (fallback)")
        self._detector_type = "haar"

    # ------------------------------------------------------------------
    # DetectorWorker interface
    # ------------------------------------------------------------------

    def process(self, frame) -> dict:
        # Downscale for speed
        small = cv2.resize(frame, (PROCESS_WIDTH, PROCESS_HEIGHT), interpolation=cv2.INTER_LINEAR)
        scale_x = frame.shape[1] / PROCESS_WIDTH
        scale_y = frame.shape[0] / PROCESS_HEIGHT

        if self._detector_type == "mediapipe":
            result = self._process_mediapipe(small)
        elif self._detector_type == "dnn":
            result = self._process_dnn(small)
        else:
            result = self._process_haar(small)

        # Scale bbox back to original frame coordinates
        for face in result["faces"]:
            bx, by, bw, bh = face["bbox"]
            face["bbox"] = [
                int(bx * scale_x),
                int(by * scale_y),
                int(bw * scale_x),
                int(bh * scale_y),
            ]

        result["timestamp"] = time.time()
        return result

    # ------------------------------------------------------------------
    # Backend implementations
    # ------------------------------------------------------------------

    def _process_mediapipe(self, frame) -> dict:
        import mediapipe as mp
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._face_detector.process(rgb)
        h, w = frame.shape[:2]

        faces = []
        if results.detections:
            for det in results.detections:
                bb = det.location_data.relative_bounding_box
                x  = max(0, int(bb.xmin * w))
                y  = max(0, int(bb.ymin * h))
                bw = int(bb.width  * w)
                bh = int(bb.height * h)
                conf = float(det.score[0]) if det.score else 0.8
                faces.append({"bbox": [x, y, bw, bh], "confidence": round(conf, 3)})

        return {"type": "FACE_DATA", "count": len(faces), "faces": faces, "detector": "mediapipe"}

    def _process_dnn(self, frame) -> dict:
        h, w = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(frame, 1.0, (300, 300), (104.0, 177.0, 123.0), swapRB=False)
        self._dnn_net.setInput(blob)
        detections = self._dnn_net.forward()

        faces = []
        for i in range(detections.shape[2]):
            conf = float(detections[0, 0, i, 2])
            if conf < 0.5:
                continue
            box = detections[0, 0, i, 3:7] * [w, h, w, h]
            x1, y1, x2, y2 = box.astype("int")
            faces.append({
                "bbox":       [x1, y1, x2 - x1, y2 - y1],
                "confidence": round(conf, 3),
            })

        return {"type": "FACE_DATA", "count": len(faces), "faces": faces, "detector": "dnn"}

    def _process_haar(self, frame) -> dict:
        gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray  = cv2.equalizeHist(gray)  # improves detection in low light
        rects = self._face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(40, 40),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )

        faces = [
            {"bbox": [int(x), int(y), int(w_), int(h_)], "confidence": 0.65}
            for (x, y, w_, h_) in rects
        ]

        return {"type": "FACE_DATA", "count": len(faces), "faces": faces, "detector": "haar"}
