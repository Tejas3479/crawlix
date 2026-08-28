import logging
import os

from fastapi import Depends, HTTPException
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from database import ApiKey, async_session_maker

logger = logging.getLogger("crawlix.auth")

# API KEY AUTH
VALID_KEYS: set[str] = {
    k.strip() for k in os.getenv("API_KEYS", "").split(",") if k.strip()
}
if not VALID_KEYS:
    logger.warning("API_KEYS not set. Authentication is DISABLED.")

security_header = APIKeyHeader(name="x-api-key", auto_error=False)
security_bearer = HTTPBearer(auto_error=False)


async def verify_api_key(
    x_api_key: str | None = Depends(security_header),
    bearer: HTTPAuthorizationCredentials | None = Depends(security_bearer),
):
    token = None
    if x_api_key:
        token = x_api_key.strip()
    elif bearer:
        token = bearer.credentials.strip()

    if token:
        # Check ENV first
        if token in VALID_KEYS or (os.getenv("API_KEY") and token == os.getenv("API_KEY")):
            return

        # Check DB
        async with async_session_maker() as session:
            key_record = await session.get(ApiKey, token)
            if key_record:
                return

    # If no token provided or invalid token, check if auth is disabled
    if not VALID_KEYS and not os.getenv("API_KEY"):
        async with async_session_maker() as session:
            result = await session.execute(select(ApiKey).limit(1))
            has_keys = result.scalars().first() is not None
        if not has_keys and os.getenv("AUTH_DISABLED") == "true":
            return  # Auth is disabled completely
        if not has_keys and not os.getenv("AUTH_DISABLED"):
            return

    raise HTTPException(status_code=401, detail="Invalid or missing API key")
