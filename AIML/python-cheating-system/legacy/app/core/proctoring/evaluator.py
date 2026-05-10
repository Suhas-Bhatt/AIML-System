import json
import re
import os
from typing import List, Dict, Any

class InterviewEvaluator:
    """
    Handles AI-powered evaluation of interview sessions.
    Generates summaries, insights, strengths, and weaknesses.
    """
    def __init__(self, model_name="gemini-1.5-flash-latest"):
        self.model_name = model_name
        self.api_key = os.getenv("GEMINI_API_KEY", "")
        self._client = None
        self._model = None

    def _get_model(self):
        if self._model:
            return self._model
        
        if not self.api_key:
            return None

        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self._model = genai.GenerativeModel(self.model_name)
            return self._model
        except Exception as e:
            print(f"[Evaluator] Error initializing Gemini: {e}")
            return None

    def _extract_json(self, text: str) -> Dict[str, Any]:
        try:
            cleaned = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
            return json.loads(cleaned)
        except Exception:
            return {}

    async def generate_summary(self, role: str, topic: str, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generates a comprehensive analysis of the interview session.
        """
        model = self._get_model()
        if not model:
            return {"error": "AI Model not initialized"}

        # Prepare conversation summary for the prompt
        transcript = ""
        for msg in messages:
            role_label = "Interviewer" if msg.get("role") == "ASSISTANT" else "Candidate"
            transcript += f"{role_label}: {msg.get('content')}\n"

        prompt = f"""You are an expert technical recruiter evaluating a candidate for a {role} position.
Review the following interview transcript on the topic: "{topic}".

TRANSCRIPT:
{transcript}

Provide a professional performance analysis. Return ONLY valid JSON:
{{
  "summary": "2-3 sentences summarizing the candidate's performance",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["area to improve 1", "area 2", "area 3"],
  "insights": ["insight about technical depth", "insight about communication"],
  "themes": ["theme 1", "theme 2"],
  "sentiment": "positive/neutral/negative",
  "recommendation": "Hire/Consider/Reject",
  "overall_score": 0-10
}}
"""
        try:
            response = model.generate_content(prompt)
            return self._extract_json(response.text)
        except Exception as e:
            print(f"[Evaluator] Generation error: {e}")
            return {"error": str(e)}
