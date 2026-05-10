import time

class CheatingLogic:
    """
    Enterprise-Grade Cheating Logic with Multi-Modal Signal Fusion.
    Integrates Liveness detection, Head Pose angles, and Persistence-based scoring.
    """
    def __init__(self):
        self.score = 0
        self.accumulators = {
            "face_missing": 0,
            "looking_away": 0,
            "mouth_moving": 0,
            "noise": 0,
            "liveness_fail": 0
        }
        
        # Thresholds (Number of frames violation must persist)
        self.THRESHOLDS = {
            "face_missing": 15,
            "looking_away": 25,
            "mouth_moving": 10,
            "noise": 5,
            "liveness_fail": 60 # Flag after 60 frames (~12s) of static behavior
        }
        
        # Weights for score calculation
        self.WEIGHTS = {
            "face_missing": 0.5,
            "multiple_faces": 5.0,
            "looking_away": 1.0,
            "phone_detected": 10.0,
            "book_detected": 3.0,
            "mouth_moving": 2.0,
            "suspicious_noise": 4.0,
            "liveness_fail": 15.0 # High weight for static image/spoof detection
        }

    def update_score(self, detections):
        """
        Processes high-fidelity detections and returns proctoring status.
        """
        current_violations = []
        
        # 1. Face Count Analysis
        face_count = detections.get("face_count", 0)
        if face_count == 0:
            self.accumulators["face_missing"] += 1
            if self.accumulators["face_missing"] >= self.THRESHOLDS["face_missing"]:
                self.score += self.WEIGHTS["face_missing"]
                current_violations.append("No face detected")
        else:
            self.accumulators["face_missing"] = max(0, self.accumulators["face_missing"] - 2)
            if face_count > 1:
                self.score += self.WEIGHTS["multiple_faces"]
                current_violations.append(f"Multiple faces ({face_count})")

        # 2. Optimized Head Pose & Gaze Analysis
        pose = detections.get("pose", "Center")
        gaze = detections.get("eye_gaze", {})
        
        # If head is turned OR eyes are flicking (offset > 15)
        if pose != "Center" or abs(gaze.get("offset", 0)) > 20:
            self.accumulators["looking_away"] += 1
            if self.accumulators["looking_away"] >= self.THRESHOLDS["looking_away"]:
                self.score += self.WEIGHTS["looking_away"]
                detail = f"Looking {pose}" if pose != "Center" else "Eye gaze suspicious"
                current_violations.append(detail)
        else:
            self.accumulators["looking_away"] = max(0, self.accumulators["looking_away"] - 2)

        # 3. Object Detection (YOLOv8)
        objects = detections.get("objects", [])
        for obj in objects:
            if obj == "cell phone":
                self.score += self.WEIGHTS["phone_detected"]
                current_violations.append("Mobile phone detected")
            elif obj in ["book", "laptop"]:
                self.score += self.WEIGHTS["book_detected"]
                current_violations.append(f"Suspicious {obj} detected")

        # 4. Mouth Movement & Audio Fusion
        # (Decision to flag talking is stronger if both mouth and audio are active)
        mouth_open = detections.get("mouth_moving")
        audio_level = detections.get("audio_level", 0)
        
        if mouth_open or audio_level > 0.04:
            self.accumulators["mouth_moving"] += 1
            if self.accumulators["mouth_moving"] >= self.THRESHOLDS["mouth_moving"]:
                # Stronger weight if both triggers are active
                multiplier = 2.0 if (mouth_open and audio_level > 0.04) else 1.0
                self.score += self.WEIGHTS["mouth_moving"] * multiplier
                current_violations.append("Talking / Voice activity detected")
        else:
            self.accumulators["mouth_moving"] = max(0, self.accumulators["mouth_moving"] - 1)

        # 5. Liveness Analysis (Anti-Spoofing)
        liveness = detections.get("liveness", {})
        if liveness.get("suspicious"):
            self.accumulators["liveness_fail"] += 1
            if self.accumulators["liveness_fail"] >= self.THRESHOLDS["liveness_fail"]:
                self.score += self.WEIGHTS["liveness_fail"]
                current_violations.append("Liveness failure (Static feed detected)")
        else:
             self.accumulators["liveness_fail"] = max(0, self.accumulators["liveness_fail"] - 1)

        # Determine Status Level
        status = "Safe"
        if self.score > 25:   status = "Cheating"
        elif self.score > 15: status = "Suspicious"
        elif self.score > 5:  status = "Warning"
            
        return {
            "status": status,
            "score": round(self.score, 2),
            "violations": list(set(current_violations))
        }
