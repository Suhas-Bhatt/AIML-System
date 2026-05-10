from fastapi import Request
from fastapi.responses import JSONResponse
from app.core.logging import get_logger

log = get_logger("exceptions")


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.warning("validation_error", path=str(request.url), error=str(exc))
    return JSONResponse(status_code=422, content={"error": "Validation error", "detail": str(exc)})


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled_error", path=str(request.url), error=str(exc), exc_info=True)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})
