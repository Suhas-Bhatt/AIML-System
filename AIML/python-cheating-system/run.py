"""Entrypoint — run directly or via Docker CMD."""
import uvicorn
from app.config import get_settings


def main() -> None:
    s = get_settings()
    uvicorn.run(
        "app.main:app",
        host=s.HOST,
        port=s.PORT,
        reload=s.RELOAD and not s.is_production,
        workers=s.WORKERS,
        log_level=s.LOG_LEVEL.lower(),
        access_log=not s.is_production,
    )


if __name__ == "__main__":
    main()
