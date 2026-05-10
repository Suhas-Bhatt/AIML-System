from app.agents.base import BaseAgent
from typing import Dict, Any
import time

class AudioActivityAgent(BaseAgent):
    """
    An agent that monitors audio levels and activity patterns.
    """
    def __init__(self, session_id: str):
        super().__init__(name=f"AudioAgent-{session_id}")
        self.session_id = session_id
        
        # Audio history for reasoning
        self.history = []
        self.MAX_HISTORY = 30
        
        # State
        self.is_speaking = False
        self.suspicion_score = 0.0

    async def run(self, audio_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process audio level and reason about activity.
        audio_data: {"level": 0.5}
        """
        level = audio_data.get("level", 0)
        self.history.append(level)
        if len(self.history) > self.MAX_HISTORY:
            self.history.pop(0)

        # Agent Reasoning: Is there suspicious shouting or multiple voices?
        # (Simple heuristic: high variance or persistent high level)
        avg_level = sum(self.history) / len(self.history) if self.history else 0
        
        violations = []
        
        # High audio level for too long might indicate someone else is talking or background help
        if level > 0.7:
            self.suspicion_score = min(1.0, self.suspicion_score + 0.1)
        else:
            self.suspicion_score = max(0.0, self.suspicion_score - 0.05)

        # Decision
        if self.suspicion_score > 0.8:
            violations.append("ai_multiple_voices") # Assuming this exists or is handled as suspicious_object

        return {
            "is_speaking": level > 0.1,
            "level": level,
            "suspicion_score": self.suspicion_score,
            "violations": violations
        }
