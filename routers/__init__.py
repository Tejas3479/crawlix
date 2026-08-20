from .admin import router as admin_router
from .crawl import router as crawl_router
from .fetch import router as fetch_router
from .health import router as health_router
from .map import router as map_router
from .mcp import router as mcp_router
from .search import router as search_router

__all__ = [
    "admin_router",
    "crawl_router",
    "fetch_router",
    "health_router",
    "map_router",
    "mcp_router",
    "search_router",
]