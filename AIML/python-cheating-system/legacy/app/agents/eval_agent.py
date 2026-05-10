"""Interview evaluation agent — Gemini primary, OpenAI fallback."""
from __future__ import annotations

import json
import re
from typing import Any

from app.config import get_settings
from app.core.logging import get_logger
from app.schemas import EvalRequest, EvalResponse

log = get_logger("eval_agent")


class EvaluationAgent:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._gemini = None
        self._openai = None

    async def evaluate(self, req: EvalRequest) -> EvalResponse:
        transcript = self._build_transcript(req)
        integrity = self._analyze_integrity(req.proctor_logs)

        analysis = await self._analyze_transcript(req.role, req.topic, transcript)
        return await self._synthesize(analysis, integrity, req.role)

    # ── Private ─────────────────────────────────────────────────────────────

    def _build_transcript(self, req: EvalRequest) -> str:
        lines = []
        for m in req.messages:
            speaker = "Interviewer" if m.role.upper() == "ASSISTANT" else "Candidate"
            lines.append(f"{speaker}: {m.content}")
        return "\n".join(lines)

    def _analyze_integrity(self, logs: list[dict]) -> dict[str, Any]:
        ai_violations = [l for l in logs if "ai_" in l.get("type", "")]
        if not ai_violations:
            return {"score": 10.0, "status": "Clear", "violation_count": 0, "reasoning": "No AI violations."}
        score = max(0.0, 10.0 - len(ai_violations) * 2.0)
        return {
            "score": score,
            "status": "Suspicious" if score < 7 else "Flagged",
            "violation_count": len(ai_violations),
            "reasoning": f"{len(ai_violations)} AI-confirmed violations.",
        }

    async def _analyze_transcript(self, role: str, topic: str, transcript: str) -> dict:
        prompt = (
            f"Analyze this {role} interview on '{topic}'.\n"
            f"Return ONLY valid JSON with keys: technical_depth (1-10), communication_clarity (1-10), "
            f"strengths (list), weaknesses (list).\n\nTRANSCRIPT:\n{transcript}"
        )
        text = await self._call_ai(prompt)
        return self._parse_json(text) or {}

    async def _synthesize(self, analysis: dict, integrity: dict, role: str) -> EvalResponse:
        prompt = (
            f"You are a senior technical recruiter. Synthesise a final report for a {role} candidate.\n"
            f"TECHNICAL ANALYSIS: {json.dumps(analysis)}\n"
            f"INTEGRITY AUDIT: {json.dumps(integrity)}\n"
            "If integrity score < 6, recommendation should be Reject.\n"
            "Return ONLY valid JSON: {summary, strengths[], weaknesses[], recommendation, overall_score (0-10), integrity_status}"
        )
        text = await self._call_ai(prompt)
        data = self._parse_json(text) or {}
        return EvalResponse(
            summary=data.get("summary", ""),
            strengths=data.get("strengths", []),
            weaknesses=data.get("weaknesses", []),
            recommendation=data.get("recommendation", "Consider"),
            overall_score=float(data.get("overall_score", 0)),
            integrity_score=integrity["score"],
            integrity_status=data.get("integrity_status", integrity["status"]),
        )

    async def _call_ai(self, prompt: str) -> str:
        # Try Gemini first
        if self._settings.GEMINI_API_KEY:
            try:
                return await self._call_gemini(prompt)
            except Exception as exc:
                log.warning("gemini_failed", error=str(exc))
        # Fallback to OpenAI
        if self._settings.OPENAI_API_KEY:
            try:
                return await self._call_openai(prompt)
            except Exception as exc:
                log.error("openai_failed", error=str(exc))
        return "{}"

    async def _call_gemini(self, prompt: str) -> str:
        import google.generativeai as genai
        genai.configure(api_key=self._settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(self._settings.GEMINI_MODEL)
        resp = model.generate_content(prompt)
        return resp.text

    async def _call_openai(self, prompt: str) -> str:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=self._settings.OPENAI_API_KEY)
        resp = await client.chat.completions.create(
            model=self._settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        return resp.choices[0].message.content or "{}"

    @staticmethod
    def _parse_json(text: str) -> dict | None:
        try:
            cleaned = re.sub(r"```(?:json)?\s*", "", text).replace("```", "").strip()
            return json.loads(cleaned)
        except Exception:
            return None
