from app.agents.base import BaseAgent
from app.agents.audio_agent import AudioActivityAgent
from app.core.proctoring.proctor import Proctor
from typing import Dict, Any, List
import time

class AutonomousProctorAgent(BaseAgent):
    """
    Optimized Enterprise Proctoring Agent.
    Orchestrates multi-modal signals using high-fidelity vision and audio modules.
    Maintains session-level suspicion and performs autonomous reasoning.
    """
    def __init__(self, session_id: str):
        super().__init__(name=f"EnterpriseProctor-{session_id}")
        self.session_id = session_id
        self.proctor_engine = Proctor()
        self.audio_agent = AudioActivityAgent(session_id)
        
        # Agent Memory (Temporal Suspicion)
        self.suspicion_scores = {
            "cell_phone": 0.0,
            "multiple_faces": 0.0,
            "no_face": 0.0,
            "looking_away": 0.0,
            "liveness": 0.0,
            "unauthorized_audio": 0.0
        }
        
        self.REPORT_THRESHOLD = 0.8
        self.DECAY_RATE = 0.05

    async def run(self, frame_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a frame and update the Agent's reasoning state.
        """
        frame_b64 = frame_data.get("frame")
        audio_level = frame_data.get("audio_level", 0)
        
        # 1. High-Fidelity Signal Acquisition
        signal_result = self.proctor_engine.process_frame(frame_b64, audio_level)
        
        if not signal_result.get("success"):
            return signal_result

        detections = signal_result.get("detections", {})
        raw_violations = signal_result.get("violations", [])
        
        # 2. Multi-Modal Reasoning & State Update
        
        # Gaze/Pose Suspicion
        if detections.get("pose") != "Center" or abs(detections.get("eye_gaze", {}).get("offset", 0)) > 20:
            self.suspicion_scores["looking_away"] = min(1.0, self.suspicion_scores["looking_away"] + 0.2)
        else:
            self.suspicion_scores["looking_away"] = max(0.0, self.suspicion_scores["looking_away"] - self.DECAY_RATE)

        # Object Suspicion (YOLO confirmed)
        if "cell phone" in detections.get("objects", []):
            self.suspicion_scores["cell_phone"] = min(1.0, self.suspicion_scores["cell_phone"] + 0.5)
        else:
            self.suspicion_scores["cell_phone"] = max(0.0, self.suspicion_scores["cell_phone"] - self.DECAY_RATE)

        # Multi-Face Suspicion
        if detections.get("face_count", 0) > 1:
            self.suspicion_scores["multiple_faces"] = min(1.0, self.suspicion_scores["multiple_faces"] + 0.6)
        else:
            self.suspicion_scores["multiple_faces"] = max(0.0, self.suspicion_scores["multiple_faces"] - 0.2)

        # Liveness Suspicion
        if detections.get("liveness", {}).get("suspicious"):
            self.suspicion_scores["liveness"] = min(1.0, self.suspicion_scores["liveness"] + 0.1)
        else:
            self.suspicion_scores["liveness"] = max(0.0, self.suspicion_scores["liveness"] - 0.05)

        # 3. Decision Logic: Confirm violations based on persistence
        confirmed_violations = []
        for v_type, score in self.suspicion_scores.items():
            if score >= self.REPORT_THRESHOLD:
                confirmed_violations.append(f"ai_{v_type}")
        
        # Add raw triggers if they are high-severity (like multiple faces)
        if detections.get("face_count", 0) > 1:
            confirmed_violations.append("ai_multiple_faces")

        # 4. Final Agent Assessment
        status = "Safe"
        overall_integrity = 1.0 - (sum(self.suspicion_scores.values()) / len(self.suspicion_scores))
        
        if overall_integrity < 0.4:
            status = "Violation"
        elif overall_integrity < 0.7:
            status = "Suspicious"

        return {
            "success": True,
            "status": status,
            "integrity_score": round(overall_integrity, 2),
            "agent_confidence": self.suspicion_scores,
            "violations": list(set(confirmed_violations)),
            "detections": detections,
            "timestamp": time.time()
        }

    def close(self):
        self.proctor_engine.close()
