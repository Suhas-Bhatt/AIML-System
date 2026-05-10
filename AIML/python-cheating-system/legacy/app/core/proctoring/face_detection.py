import cv2
import numpy as np

class FaceDetector:
    """
    Ultra-lightweight Face, Gaze, and Mouth detector using OpenCV Haar Cascades.
    Supports Identity Verification via reference image matching.
    """
    def __init__(self):
        # Load Cascades
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        self.eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
        self.smile_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_smile.xml')
        
        self.reference_face_gray = None

    def set_reference(self, frame):
        """Sets the reference face for identity comparison."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.face_cascade.detectMultiScale(gray, 1.1, 5)
        if len(faces) == 1:
            (x, y, w, h) = faces[0]
            self.reference_face_gray = cv2.resize(gray[y:y+h, x:x+w], (100, 100))
            return True
        return False

    def detect(self, frame):
        """Detects faces and basic pose/mouth status."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        
        # 1. Detect Face
        faces = self.face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
        face_count = len(faces)
        
        pose, mouth_moving = "Forward", False
        identity_match = True
        
        if face_count == 1:
            (x, y, w, h) = faces[0]
            roi_gray = gray[y:y+h, x:x+w]
            
            # 2. Gaze Detection (Simple Eye Count)
            eyes = self.eye_cascade.detectMultiScale(roi_gray, 1.1, 10, minSize=(15, 15))
            if len(eyes) < 2:
                pose = "Looking Away"
            
            # 3. Mouth Detection
            mouth_roi = roi_gray[int(h/2):h, :]
            smiles = self.smile_cascade.detectMultiScale(mouth_roi, 1.7, 20)
            mouth_moving = len(smiles) > 0
            
            # 4. Identity Verification (Simple Template Matching - FAST)
            if self.reference_face_gray is not None:
                current_face = cv2.resize(roi_gray, (100, 100))
                res = cv2.matchTemplate(current_face, self.reference_face_gray, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, _ = cv2.minMaxLoc(res)
                if max_val < 0.4: # Similarity threshold
                    identity_match = False

        # 5. Lighting Check (New)
        brightness = np.mean(gray)
        lighting_low = brightness < 45 # 0-255 scale

        return face_count, pose, mouth_moving, identity_match, lighting_low
