import json
import re
import os
import logging
from typing import List, Dict, Any
from app.agents.base import BaseAgent

class InterviewEvaluationAgent(BaseAgent):
    """
    An agentic evaluator that performs multi-step analysis of an interview.
    """
    def __init__(self, model_name="gemini-1.5-flash-latest"):
        super().__init__(name="Evaluator")
        self.model_name = model_name
        self.api_key = os.getenv("GEMINI_API_KEY", "")
        self._model = None

    def _get_model(self):
        if self._model: return self._model
        if not self.api_key: return None
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self._model = genai.GenerativeModel(self.model_name)
            return self._model
        except Exception as e:
            self.logger.error(f"Error initializing Gemini: {e}")
            return None

    async def run(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Runs the full evaluation pipeline.
        input_data: {
            "role": "...",
            "topic": "...",
            "messages": [...],
            "proctor_logs": [...]
        }
        """
        role = input_data.get("role", "Candidate")
        topic = input_data.get("topic", "Technical Interview")
        messages = input_data.get("messages", [])
        proctor_logs = input_data.get("proctor_logs", [])

        # Step 1: Analyze Transcript
        transcript_analysis = await self._analyze_transcript(role, topic, messages)
        
        # Step 2: Cross-reference with Proctoring logs (Reasoning)
        integrity_score = self._analyze_integrity(messages, proctor_logs)
        
        # Step 3: Final Synthesis
        return await self._synthesize_report(transcript_analysis, integrity_score, role, topic)

    async def _analyze_transcript(self, role: str, topic: str, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        model = self._get_model()
        if not model: return {"error": "AI Model not initialized"}

        transcript = "\n".join([
            f"{'Interviewer' if m.get('role') == 'ASSISTANT' else 'Candidate'}: {m.get('content')}"
            for m in messages
        ])

        prompt = f"""Analyze the following interview for a {role} role on "{topic}".
Extract:
1. Technical Depth (1-10)
2. Communication Clarity (1-10)
3. Key Strengths
4. Areas for improvement

TRANSCRIPT:
{transcript}

Return JSON.
"""
        try:
            response = model.generate_content(prompt)
            return self._extract_json(response.text)
        except Exception as e:
            return {"error": str(e)}

    def _analyze_integrity(self, messages: list, proctor_logs: list) -> Dict[str, Any]:
        """
        Agent reasoning: Check if violations happened during complex questions.
        """
        violations = [l for l in proctor_logs if "ai_" in l.get("type", "")]
        if not violations:
            return {"score": 10, "status": "Clear", "reasoning": "No AI violations detected."}
        
        # Simple heuristic: more violations = lower integrity
        score = max(0, 10 - len(violations) * 2)
        status = "Suspicious" if score < 7 else "Flagged"
        
        return {
            "score": score,
            "status": status,
            "violation_count": len(violations),
            "reasoning": f"Detected {len(violations)} AI-based violations during the session."
        }

    async def _synthesize_report(self, analysis: dict, integrity: dict, role: str, topic: str) -> Dict[str, Any]:
        """
        Combine technical analysis with integrity audit.
        """
        model = self._get_model()
        
        prompt = f"""Synthesize a final recruitment report for a {role} candidate.
        
TECHNICAL ANALYSIS: {json.dumps(analysis)}
INTEGRITY AUDIT: {json.dumps(integrity)}

Provide a unified summary, strengths, weaknesses, and a final recommendation (Hire/Consider/Reject).
If integrity is low (score < 6), the recommendation should likely be Reject regardless of technical skill.

Return ONLY valid JSON:
{{
  "summary": "...",
  "strengths": [],
  "weaknesses": [],
  "recommendation": "...",
  "overall_score": 0-10,
  "integrity_status": "..."
}}
"""
        try:
            response = model.generate_content(prompt)
            result = self._extract_json(response.text)
            # Add some meta info
            result["integrity_score"] = integrity["score"]
            return result
        except Exception:
            return analysis # Fallback

    def _extract_json(self, text: str) -> Dict[str, Any]:
        try:
            cleaned = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
            return json.loads(cleaned)
        except Exception:
            return {}
