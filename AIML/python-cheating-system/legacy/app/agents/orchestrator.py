import logging
from typing import Dict, Any, List
from app.agents.base import BaseAgent
from app.agents.proctor_agent import AutonomousProctorAgent
from app.agents.audio_agent import AudioActivityAgent

class EnterpriseAgentOrchestrator(BaseAgent):
    """
    The central intelligence that coordinates multiple sub-agents.
    It manages the lifecycle of an interview and aggregates multi-modal signals.
    """
    def __init__(self, session_id: str):
        super().__init__(name=f"Orchestrator-{session_id}")
        self.session_id = session_id
        
        # Sub-Agents
        self.vision_agent = AutonomousProctorAgent(session_id)
        self.audio_agent = AudioActivityAgent(session_id)
        
        # Session State
        self.session_active = True
        self.violations_log = []
        self.global_integrity_score = 1.0

    async def process_frame(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Main entry point for real-time processing.
        Coordinates sub-agents and performs higher-level reasoning.
        """
        # 1. Delegate to Vision Agent
        vision_result = await self.vision_agent.run(data)
        
        # 2. Delegate to Audio Agent
        audio_result = await self.audio_agent.run({"level": data.get("audio_level", 0)})
        
        # 3. Aggregate Results (Orchestration Reasoning)
        aggregated_violations = list(set(vision_result.get("violations", []) + audio_result.get("violations", [])))
        
        # Update session logs
        for v in aggregated_violations:
            if v not in [log.get("type") for log in self.violations_log]:
                self.violations_log.append({
                    "type": v,
                    "timestamp": data.get("timestamp"),
                    "confirmed_by": "Orchestrator"
                })

        # 4. Global Integrity reasoning
        # If multiple agents flag different issues simultaneously, integrity drops faster
        if len(vision_result.get("violations", [])) > 0 and len(audio_result.get("violations", [])) > 0:
            self.global_integrity_score -= 0.1
            
        return {
            "session_id": self.session_id,
            "status": "Active",
            "vision": vision_result,
            "audio": audio_result,
            "orchestrator": {
                "global_integrity": round(self.global_integrity_score, 2),
                "active_violations": aggregated_violations
            }
        }

    async def generate_final_audit(self) -> Dict[str, Any]:
        """
        Prepares data for the Evaluation Agent.
        """
        return {
            "session_id": self.session_id,
            "total_violations": len(self.violations_log),
            "integrity_score": self.global_integrity_score,
            "logs": self.violations_log
        }
