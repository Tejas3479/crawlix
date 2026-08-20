import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from services.browser_manager import PlaywrightManager, playwright_mgr
from services.cache import cache_get, cache_key, cache_set, invalidate_url_cache
from services.content import process_content
from services.crawl_manager import CrawlManager, crawl_manager, extract_links
from services.fetch_engine import run_fetch
from services.log_filter import (
    SensitiveDataFilter,
    logger,
    sanitize_proxy_url,
    sanitize_url,
)
from services.map import map_site
from services.search import search
from services.session_manager import SessionManager, redis_client, session_manager
from services.ssrf import is_ssrf_safe

__all__ = [
    "CrawlManager",
    "PlaywrightManager",
    "SensitiveDataFilter",
    "SessionManager",
    "cache_get",
    "cache_key",
    "cache_set",
    "crawl_manager",
    "extract_links",
    "invalidate_url_cache",
    "is_ssrf_safe",
    "logger",
    "map_site",
    "playwright_mgr",
    "process_content",
    "redis_client",
    "run_fetch",
    "sanitize_proxy_url",
    "sanitize_url",
    "search",
    "session_manager"
]
