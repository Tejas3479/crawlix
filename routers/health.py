import asyncio

from fastapi import APIRouter
from sqlalchemy import text

from database import async_session_maker
from fetcher import playwright_mgr, redis_client, session_manager

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health():
    # Check Database
    db_status = "ok"
    try:
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"error: {e!s}"

    # Check Redis (with 1.0s timeout to prevent hanging when offline)
    redis_status = "ok"
    try:
        await asyncio.wait_for(redis_client.ping(), timeout=1.0)
    except Exception as e:
        redis_status = f"error: {e!s}"

    # Count active sessions (depends on Redis)
    active_sessions = 0
    try:
        active_sessions = await asyncio.wait_for(session_manager.count_sessions(), timeout=1.0)
    except Exception:
        pass

    return {
        "status": "ok" if db_status == "ok" and redis_status == "ok" else "degraded",
        "database": db_status,
        "redis": redis_status,
        "active_sessions": active_sessions,
        "playwright_slots_free": playwright_mgr.slots_free,
    }
