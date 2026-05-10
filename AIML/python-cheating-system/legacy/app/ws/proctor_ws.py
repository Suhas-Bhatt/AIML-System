"""WebSocket endpoint for real-time per-frame proctoring.

Message in:  {"frame": "data:image/jpeg;base64,...", "audio_level": 0.02}
Message out: {"success": bool, "status": str, "score": float, "violations": [...],
               "agent_confidence": {...}, "timestamp": float}
"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.logging import get_logger
from app.core.session_store import get_session_store
from app.config import get_settings

ws_router = APIRouter()
log = get_logger("ws_proctor")


@ws_router.websocket("/ws/proctor/{session_id}")
async def ws_proctor(websocket: WebSocket, session_id: str):
    await websocket.accept()
    store = get_session_store()
    session = store.get_or_create(session_id)
    settings = get_settings()
    log.info("ws_connected", session_id=session_id)

    try:
        while True:
            raw_msg = await websocket.receive_text()
            data = json.loads(raw_msg)

            frame_b64 = data.get("frame")
            audio_level = float(data.get("audio_level", 0.0))

            if not frame_b64:
                await websocket.send_json({"success": False, "error": "Missing frame"})
                continue

            session.touch()
            session.frame_count += 1

            # Frame skipping
            if session.frame_count % settings.FRAME_SKIP != 0:
                await websocket.send_json({"success": True, "status": "Safe", "skipped": True})
                continue

            raw = session.get_proctor().process_frame(frame_b64, audio_level)
            if not raw.get("success"):
                await websocket.send_json({"success": False, "error": raw.get("error")})
                continue

            detections = raw.get("detections", {})
            confirmed, confidence = session.update_suspicion(detections)

            await websocket.send_json({
                "success": True,
                "status": raw.get("status", "Safe"),
                "score": raw.get("score", 0.0),
                "violations": raw.get("violations", []),
                "confirmed_violations": confirmed,
                "agent_confidence": confidence,
                "timestamp": time.time(),
            })

    except WebSocketDisconnect:
        log.info("ws_disconnected", session_id=session_id)
    except json.JSONDecodeError:
        log.warning("ws_bad_json", session_id=session_id)
        await websocket.close(code=1003)
    except Exception as exc:
        log.error("ws_error", session_id=session_id, error=str(exc))
        await websocket.close(code=1011)
