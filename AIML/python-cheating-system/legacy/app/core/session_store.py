"""Thread-safe in-memory session store for proctoring agents.

NOTE: Single-process only. For multi-worker deployments, replace with Redis
using a serialisable agent state (see README § Scaling).
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from app.core.logging import get_logger

log = get_logger("session_store")

# Agent idle timeout in seconds — sessions older than this are auto-evicted
_IDLE_TIMEOUT = 3600  # 1 hour


@dataclass
class AgentSession:
    session_id: str
    created_at: float = field(default_factory=time.monotonic)
    last_activity: float = field(default_factory=time.monotonic)
    frame_count: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # Lazy imports avoid loading CV on session creation
    _proctor: object = field(default=None, repr=False)
    _logic: object = field(default=None, repr=False)
    _suspicion: dict = field(default_factory=lambda: {
        "cell_phone": 0.0,
        "multiple_faces": 0.0,
        "no_face": 0.0,
        "looking_away": 0.0,
    })

    DECAY: float = 0.05
    THRESHOLD: float = 0.8

    def get_proctor(self):
        if self._proctor is None:
            from app.core.proctoring.proctor import Proctor
            self._proctor = Proctor()
        return self._proctor

    def touch(self) -> None:
        self.last_activity = time.monotonic()

    def update_suspicion(self, detections: dict) -> tuple[list[str], dict[str, float]]:
        """Agentic confidence update. Returns (confirmed_violations, scores)."""
        d = detections
        s = self._suspicion

        s["cell_phone"] = min(1.0, s["cell_phone"] + 0.4) if "cell phone" in d.get("objects", []) else max(0.0, s["cell_phone"] - self.DECAY)
        s["multiple_faces"] = min(1.0, s["multiple_faces"] + 0.5) if d.get("face_count", 0) > 1 else max(0.0, s["multiple_faces"] - self.DECAY * 2)
        s["no_face"] = min(1.0, s["no_face"] + 0.3) if d.get("face_count", 0) == 0 else max(0.0, s["no_face"] - self.DECAY * 2)
        s["looking_away"] = min(1.0, s["looking_away"] + 0.2) if d.get("pose") != "Forward" else max(0.0, s["looking_away"] - self.DECAY)

        confirmed = [k for k, v in s.items() if v >= self.THRESHOLD]
        return confirmed, dict(s)


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, AgentSession] = {}
        self._lock = threading.Lock()
        self._start_reaper()

    def get_or_create(self, session_id: str) -> AgentSession:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = AgentSession(session_id=session_id)
                log.info("session_created", session_id=session_id)
            return self._sessions[session_id]

    def get(self, session_id: str) -> Optional[AgentSession]:
        with self._lock:
            return self._sessions.get(session_id)

    def delete(self, session_id: str) -> bool:
        with self._lock:
            existed = session_id in self._sessions
            self._sessions.pop(session_id, None)
            return existed

    def count(self) -> int:
        with self._lock:
            return len(self._sessions)

    def _reaper(self) -> None:
        while True:
            time.sleep(300)
            now = time.monotonic()
            with self._lock:
                expired = [sid for sid, s in self._sessions.items() if now - s.last_activity > _IDLE_TIMEOUT]
            for sid in expired:
                log.info("session_evicted_idle", session_id=sid)
                self.delete(sid)

    def _start_reaper(self) -> None:
        t = threading.Thread(target=self._reaper, daemon=True, name="session-reaper")
        t.start()


# Module-level singleton
_store: Optional[SessionStore] = None


def get_session_store() -> SessionStore:
    global _store
    if _store is None:
        _store = SessionStore()
    return _store
