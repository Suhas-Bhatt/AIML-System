"""
app/config.py — Centralised configuration via pydantic-settings.
All settings are read from environment variables or a .env file.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Service identity ───────────────────────────────────────────
    APP_NAME: str = "Aural AI Proctoring Service"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

    # ── Server ─────────────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    RELOAD: bool = False  # Uvicorn hot-reload (dev only)
    WORKERS: int = 1      # Increase for production (must be 1 for in-memory state)

    # ── CORS ───────────────────────────────────────────────────────
    ALLOWED_ORIGINS: list[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        description="Comma-separated list of allowed CORS origins",
    )

    # ── Security ───────────────────────────────────────────────────
    # The Next.js app sends this header on every request to the AI service.
    # Set to a strong random secret and rotate regularly.
    INTERNAL_API_SECRET: str = Field(
        default="change-me-in-production",
        description="Shared secret between Next.js backend and AI service",
    )

    # ── AI Providers ───────────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-1.5-flash-latest"

    OPENAI_API_KEY: str = ""          # Fallback evaluator
    OPENAI_MODEL: str = "gpt-4o-mini"

    # ── Proctoring behaviour ───────────────────────────────────────
    YOLO_MODEL_PATH: str = "yolov8n.pt"
    YOLO_CONFIDENCE: float = 0.4
    YOLO_SCAN_INTERVAL_SECONDS: float = 5.0   # Seconds between YOLO runs
    FRAME_SKIP: int = 3                        # Process every Nth frame

    # ── Storage (optional — for evidence uploads) ──────────────────
    EVIDENCE_DIR: str = "/tmp/aural-evidence"

    # ── Logging ────────────────────────────────────────────────────
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    LOG_JSON: bool = False  # True in production for structured log pipelines

    # ─────────────────────────────────────────────────────────────
    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def _parse_origins(cls, v: str | list[str]) -> list[str]:
        """Allow the env var to be a comma-separated string."""
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
