from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from app.config import get_settings

_header = APIKeyHeader(name="X-Internal-Secret", auto_error=False)


async def require_internal_secret(key: str | None = Security(_header)) -> None:
    settings = get_settings()
    if settings.is_production and key != settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
