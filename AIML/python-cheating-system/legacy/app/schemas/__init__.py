from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Proctoring ──────────────────────────────────────────────────────────────

class SessionStartRequest(BaseModel):
    session_id: str
    reference_frame: Optional[str] = None  # base64 JPEG


class SessionStartResponse(BaseModel):
    status: str
    session_id: str


class FrameRequest(BaseModel):
    session_id: str
    frame: str            # base64 data-URI  "data:image/jpeg;base64,..."
    audio_level: float = Field(default=0.0, ge=0.0, le=1.0)


class DetectionDetail(BaseModel):
    face_count: int = 0
    pose: str = "Forward"
    mouth_moving: bool = False
    objects: list[str] = []
    audio_level: float = 0.0
    identity_match: bool = True
    lighting_low: bool = False


class FrameResponse(BaseModel):
    success: bool
    status: str = "Safe"          # Safe | Warning | Suspicious | Cheating
    score: float = 0.0
    violations: list[str] = []
    agent_confidence: dict[str, float] = {}
    detections: Optional[DetectionDetail] = None
    error: Optional[str] = None


class SetReferenceRequest(BaseModel):
    session_id: str
    frame: str


# ── Evaluation ──────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str   # "ASSISTANT" | "USER"
    content: str


class EvalRequest(BaseModel):
    session_id: str
    role: str
    topic: str
    messages: list[Message]
    proctor_logs: list[dict[str, Any]] = []


class EvalResponse(BaseModel):
    summary: str = ""
    strengths: list[str] = []
    weaknesses: list[str] = []
    recommendation: str = "Consider"
    overall_score: float = 0.0
    integrity_score: float = 10.0
    integrity_status: str = "Clear"
    error: Optional[str] = None


# ── Health ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str
    active_sessions: int
