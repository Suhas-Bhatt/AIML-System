import cv2

class EyeTracker:
    """Optimized eye and gaze tracking for i3 systems."""
    def __init__(self):
        self.eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')

    def track(self, frame, faces):
        if len(faces) == 0:
            return {"gaze": "Away", "looking_away": True}

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        
        # Use first face
        (x, y, w, h) = faces[0]
        roi_gray = gray[y:y+h, x:x+w]
        
        eyes = self.eye_cascade.detectMultiScale(roi_gray, 1.1, 4)
        
        looking_away = len(eyes) < 2
        return {
            "gaze": "Center" if len(eyes) >= 2 else "Away",
            "looking_away": looking_away
        }
