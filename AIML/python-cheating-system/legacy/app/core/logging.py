import logging
import structlog
from app.config import get_settings


def setup_logging() -> None:
    settings = get_settings()
    level = getattr(logging, settings.LOG_LEVEL)
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
    ]
    if settings.LOG_JSON:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
    )


def get_logger(name: str = __name__):
    return structlog.get_logger(name)
