import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from services.browser_manager import PlaywrightManager, playwright_mgr
from services.content import process_content
from services.crawl_manager import CrawlManager, crawl_manager, extract_links
from services.fetch_engine import run_fetch
from services.log_filter import (
    SensitiveDataFilter,
    logger,
    sanitize_proxy_url,
    sanitize_url,
)
from services.session_manager import SessionManager, redis_client, session_manager
from services.ssrf import is_ssrf_safe

__all__ = [
    "CrawlManager",
    "PlaywrightManager",
    "SensitiveDataFilter",
    "SessionManager",
    "crawl_manager",
    "extract_links",
    "is_ssrf_safe",
    "logger",
    "playwright_mgr",
    "process_content",
    "redis_client",
    "run_fetch",
    "sanitize_proxy_url",
    "sanitize_url",
    "session_manager"
]
