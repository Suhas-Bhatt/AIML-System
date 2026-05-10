"""REST API routes — sessions, frame analysis, evaluation."""
from __future__ import annotations

import time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.agents.eval_agent import EvaluationAgent
from app.config import get_settings
from app.core.logging import get_logger
from app.core.security import require_internal_secret
from app.core.session_store import get_session_store
from app.schemas import (
    EvalRequest, EvalResponse,
    FrameRequest, FrameResponse,
    SessionStartRequest, SessionStartResponse,
    SetReferenceRequest,
)

router = APIRouter(dependencies=[Depends(require_internal_secret)])
log = get_logger("routes")


# ── Session lifecycle ────────────────────────────────────────────────────────

@router.post("/session/start", response_model=SessionStartResponse)
async def start_session(req: SessionStartRequest):
    store = get_session_store()
    session = store.get_or_create(req.session_id)

    if req.reference_frame:
        ok = session.get_proctor().set_reference(req.reference_frame)
        if not ok:
            log.warning("reference_set_failed", session_id=req.session_id)

    return SessionStartResponse(status="started", session_id=req.session_id)


@router.post("/session/stop/{session_id}")
async def stop_session(session_id: str):
    deleted = get_session_store().delete(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "stopped", "session_id": session_id}


# ── Frame analysis ───────────────────────────────────────────────────────────

@router.post("/proctor/frame", response_model=FrameResponse)
async def analyze_frame(req: FrameRequest):
    store = get_session_store()
    session = store.get_or_create(req.session_id)
    session.touch()
    session.frame_count += 1

    settings = get_settings()

    # Frame skipping — return cached state for non-processed frames
    if session.frame_count % settings.FRAME_SKIP != 0:
        return FrameResponse(success=True, status="Safe")

    raw = session.get_proctor().process_frame(req.frame, req.audio_level)

    if not raw.get("success"):
        return FrameResponse(success=False, error=raw.get("error", "Processing failed"))

    detections = raw.get("detections", {})
    confirmed, confidence = session.update_suspicion(detections)

    return FrameResponse(
        success=True,
        status=raw.get("status", "Safe"),
        score=raw.get("score", 0.0),
        violations=raw.get("violations", []),
        agent_confidence=confidence,
        detections=detections,
    )


@router.post("/proctor/reference")
async def set_reference(req: SetReferenceRequest):
    store = get_session_store()
    session = store.get_or_create(req.session_id)
    ok = session.get_proctor().set_reference(req.frame)
    return {"success": ok, "session_id": req.session_id}


# ── Evaluation ───────────────────────────────────────────────────────────────

@router.post("/session/evaluate", response_model=EvalResponse)
async def evaluate_session(req: EvalRequest):
    agent = EvaluationAgent()
    try:
        return await agent.evaluate(req)
    except Exception as exc:
        log.error("eval_failed", error=str(exc), session_id=req.session_id)
        return EvalResponse(error=str(exc))
