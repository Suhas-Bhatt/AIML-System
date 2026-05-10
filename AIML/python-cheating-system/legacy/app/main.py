"""Application factory — wires together all routers, middleware, and handlers."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.api.routes.proctor import router as proctor_router
from app.config import get_settings
from app.core.exceptions import unhandled_exception_handler, validation_exception_handler
from app.core.logging import get_logger, setup_logging
from app.core.session_store import get_session_store
from app.schemas import HealthResponse
from app.ws.proctor_ws import ws_router

log = get_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    settings = get_settings()
    # Pre-warm the session store
    get_session_store()
    log.info("service_started", env=settings.ENVIRONMENT, version=settings.APP_VERSION)
    yield
    log.info("service_stopped")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Exception handlers ────────────────────────────────────────────────
    app.add_exception_handler(ValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    # ── Routers ───────────────────────────────────────────────────────────
    app.include_router(proctor_router, prefix="/api/v1", tags=["Proctoring"])
    app.include_router(ws_router, tags=["WebSocket"])

    # ── Health ────────────────────────────────────────────────────────────
    @app.get("/health", response_model=HealthResponse, tags=["Health"])
    async def health():
        return HealthResponse(
            version=settings.APP_VERSION,
            active_sessions=get_session_store().count(),
        )

    return app


app = create_app()
