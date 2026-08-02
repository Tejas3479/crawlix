from .admin import router as admin_router
from .crawl import router as crawl_router
from .fetch import router as fetch_router
from .health import router as health_router

__all__ = [
    "admin_router",
    "crawl_router",
    "fetch_router",
    "health_router",
]
