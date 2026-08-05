from fastapi import APIRouter
from sqlalchemy import text
from fetcher import playwright_mgr, session_manager, redis_client
from database import async_session_maker

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health():
    # Check Database
    db_status = "ok"
    try:
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"error: {str(e)}"

    # Check Redis
    redis_status = "ok"
    try:
        await redis_client.ping()
    except Exception as e:
        redis_status = f"error: {str(e)}"

    return {
        "status": "ok" if db_status == "ok" and redis_status == "ok" else "degraded",
        "database": db_status,
        "redis": redis_status,
        "active_sessions": await session_manager.count_sessions(),
        "playwright_slots_free": playwright_mgr.slots_free,
    }
