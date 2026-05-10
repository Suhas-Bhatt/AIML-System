"""
main.py — FastAPI Proctoring Server

Provides:
  POST   /api/sessions/{session_id}/start       start proctoring
  POST   /api/sessions/{session_id}/stop        stop proctoring
  POST   /api/sessions/{session_id}/event       inject client-side event (tab-switch etc.)
  GET    /api/sessions/{session_id}/status      live detection state
  GET    /api/sessions/{session_id}/violations  all violations
  GET    /api/sessions/{session_id}/report      full JSON report
  GET    /api/sessions/{session_id}/report/pdf  downloadable PDF
  GET    /api/sessions                          list active sessions
  WS     /ws/{session_id}                       live push stream

Run:
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from dotenv import load_dotenv
load_dotenv()

from api.session_manager import registry
from reports.report_generator import ReportGenerator

# ── Logging ─────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("proctoring.api")

# ── Config from env ──────────────────────────────────────────────────
API_SECRET_KEY    = os.getenv("API_SECRET_KEY", "")       # empty = auth disabled
ALLOWED_ORIGINS   = os.getenv("ALLOWED_ORIGINS", "*").split(",")
MAX_SESSIONS      = int(os.getenv("MAX_CONCURRENT_SESSIONS", "10"))

# ── WebSocket connection manager ─────────────────────────────────────
class WSManager:
    def __init__(self):
        self._connections: Dict[str, List[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.setdefault(session_id, []).append(ws)
        logger.info(f"WS connected: {session_id}")

    async def disconnect(self, session_id: str, ws: WebSocket):
        async with self._lock:
            clients = self._connections.get(session_id, [])
            if ws in clients:
                clients.remove(ws)
        logger.info(f"WS disconnected: {session_id}")

    async def broadcast(self, session_id: str, payload: Dict[str, Any]):
        async with self._lock:
            clients = list(self._connections.get(session_id, []))
        dead = []
        for ws in clients:
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_id, ws)


ws_manager = WSManager()


# ── Violation callback (called from sync thread, schedules coroutine) ─
_loop: Optional[asyncio.AbstractEventLoop] = None

def on_violation(session_id: str, violation: Dict[str, Any]):
    """Called from a background thread when a violation fires."""
    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(
            ws_manager.broadcast(session_id, {
                "type":      "VIOLATION",
                "violation": violation,
                "ts":        time.time(),
            }),
            _loop,
        )


# ── App lifespan ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _loop
    _loop = asyncio.get_event_loop()
    logger.info("Proctoring server started")
    yield
    registry.stop_all()
    logger.info("Proctoring server shut down")


app = FastAPI(
    title="AI Proctoring Server",
    version="2.0.0",
    description="Real-time webcam-based cheating detection for remote interviews",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth dependency ───────────────────────────────────────────────────
def require_auth(authorization: str = Header(default="")):
    if not API_SECRET_KEY:
        return          # auth disabled
    token = authorization.removeprefix("Bearer ").strip()
    if token != API_SECRET_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Pydantic models ───────────────────────────────────────────────────
class StartSessionRequest(BaseModel):
    interview_id:   str
    candidate_name: str
    camera_index:   int = 0

class ClientEventRequest(BaseModel):
    type:      str                          # e.g. "TAB_SWITCH", "WINDOW_BLUR"
    timestamp: Optional[float] = None
    details:   Optional[Dict[str, Any]] = None


# ── Helpers ───────────────────────────────────────────────────────────
def _get_session_or_404(session_id: str):
    session = registry.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    return session


def _ok(data: Any = None, message: str = "ok") -> Dict[str, Any]:
    return {"success": True, "message": message, "data": data}


def _err(message: str, code: int = 400) -> JSONResponse:
    return JSONResponse(status_code=code, content={"success": False, "message": message})


# ── Global exception handler ──────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception(f"Unhandled error: {exc}")
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Internal server error", "detail": str(exc)},
    )


# ═══════════════════════════════════════════════════════════════════════
# REST Endpoints
# ═══════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "sessions": len(registry.list_sessions())}


@app.get("/api/sessions", dependencies=[Depends(require_auth)])
async def list_sessions():
    return _ok(registry.list_sessions())


@app.post("/api/sessions/{session_id}/start", dependencies=[Depends(require_auth)])
async def start_session(session_id: str, body: StartSessionRequest):
    if registry.get(session_id):
        raise HTTPException(status_code=409, detail=f"Session '{session_id}' already active")

    try:
        session = registry.create(
            session_id       = session_id,
            interview_id     = body.interview_id,
            candidate_name   = body.candidate_name,
            on_violation     = on_violation,
            camera_index     = body.camera_index,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    success = session.start()
    if not success:
        registry.remove(session_id)
        raise HTTPException(status_code=500, detail="Failed to start proctoring session (camera error?)")

    logger.info(f"Started session: {session_id} for '{body.candidate_name}'")
    return _ok(session.get_status(), "Proctoring started")


@app.post("/api/sessions/{session_id}/stop", dependencies=[Depends(require_auth)])
async def stop_session(session_id: str):
    session = _get_session_or_404(session_id)
    session.stop()

    # Generate and persist final report
    report = ReportGenerator(session).generate_json()
    registry.remove(session_id)

    return _ok({"report_summary": report.get("summary")}, "Proctoring stopped")


@app.get("/api/sessions/{session_id}/status", dependencies=[Depends(require_auth)])
async def get_status(session_id: str):
    return _ok(_get_session_or_404(session_id).get_status())


@app.get("/api/sessions/{session_id}/violations", dependencies=[Depends(require_auth)])
async def get_violations(session_id: str):
    session    = _get_session_or_404(session_id)
    violations = session.get_violations()
    return _ok({
        "session_id":    session_id,
        "count":         len(violations),
        "violations":    violations,
    })


@app.post("/api/sessions/{session_id}/event", dependencies=[Depends(require_auth)])
async def inject_event(session_id: str, body: ClientEventRequest):
    """
    Frontend sends tab-switch, window-blur, fullscreen-exit etc. here.
    These are translated into violation events just like camera detections.
    """
    session = _get_session_or_404(session_id)
    event = {
        "type":      body.type,
        "timestamp": body.timestamp or time.time(),
        **(body.details or {}),
    }
    violation = session.inject_event(event)
    return _ok({
        "event_received": True,
        "violation_triggered": violation is not None,
        "violation": violation,
    })


@app.get("/api/sessions/{session_id}/report", dependencies=[Depends(require_auth)])
async def get_report(session_id: str):
    session = _get_session_or_404(session_id)
    report  = ReportGenerator(session).generate_json()
    return _ok(report)


@app.get("/api/sessions/{session_id}/report/pdf", dependencies=[Depends(require_auth)])
async def get_report_pdf(session_id: str):
    session = _get_session_or_404(session_id)
    try:
        pdf_bytes = ReportGenerator(session).generate_pdf()
        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="report-{session_id[:8]}.pdf"'
            },
        )
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="PDF generation requires 'reportlab'. Install it: pip install reportlab"
        )


# ═══════════════════════════════════════════════════════════════════════
# WebSocket endpoint
# ═══════════════════════════════════════════════════════════════════════

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(session_id: str, ws: WebSocket):
    """
    Bidirectional live feed for a session.
    Server → client: VIOLATION, STATUS_UPDATE, STATS
    Client → server: ping (optional keepalive)
    """
    await ws_manager.connect(session_id, ws)
    try:
        # Push status update every 2 seconds while session is active
        async def push_status():
            while True:
                await asyncio.sleep(2)
                session = registry.get(session_id)
                if not session:
                    break
                try:
                    await ws.send_text(json.dumps({
                        "type":   "STATUS_UPDATE",
                        "status": session.get_status(),
                        "ts":     time.time(),
                    }))
                except Exception:
                    break

        status_task = asyncio.create_task(push_status())

        try:
            while True:
                msg = await ws.receive_text()
                # Client can send { "type": "ping" } for keepalive
                if msg:
                    try:
                        data = json.loads(msg)
                        if data.get("type") == "ping":
                            await ws.send_text(json.dumps({"type": "pong"}))
                    except json.JSONDecodeError:
                        pass
        finally:
            status_task.cancel()

    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(session_id, ws)
