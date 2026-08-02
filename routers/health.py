from fastapi import APIRouter

from fetcher import playwright_mgr, session_manager

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health():
    return {
        "status": "ok",
        "active_sessions": await session_manager.count_sessions(),
        "playwright_slots_free": playwright_mgr.slots_free,
    }
