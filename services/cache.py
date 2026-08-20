import asyncio
import hashlib
import json
import os
import time
from typing import Any

from .log_filter import logger

CACHE_ENABLED = os.getenv("CACHE_ENABLED", "true").lower() != "false"
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "3600"))


class _InMemoryCache:
    """Process-local TTL cache used when Redis is unavailable."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[float, Any]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any:
        entry = self._data.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            async with self._lock:
                self._data.pop(key, None)
            return None
        return value

    async def set(self, key: str, value: Any, ttl: int) -> None:
        async with self._lock:
            self._data[key] = (time.monotonic() + ttl, value)

    async def invalidate(self, prefix: str) -> int:
        async with self._lock:
            keys = [k for k in self._data if k.startswith(prefix)]
            for k in keys:
                self._data.pop(k, None)
        return len(keys)


_memory_cache = _InMemoryCache()


def _redis_available() -> bool:
    try:
        from .session_manager import redis_client

        return bool(redis_client)
    except Exception:
        return False


async def cache_get(key: str) -> Any:
    """Fetch a cached payload. Returns None on miss or backend failure."""
    if not CACHE_ENABLED:
        return None
    try:
        if _redis_available():
            from .session_manager import redis_client

            raw = await redis_client.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        return await _memory_cache.get(key)
    except Exception as e:
        logger.debug(f"cache read failed for {key}: {e}")
        return None


async def cache_set(key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
    """Store a payload with a TTL. Never raises on backend failure."""
    if not CACHE_ENABLED:
        return
    try:
        if _redis_available():
            from .session_manager import redis_client

            await redis_client.set(key, json.dumps(value, default=str), ex=ttl)
        else:
            await _memory_cache.set(key, value, ttl)
    except Exception as e:
        logger.debug(f"cache write failed for {key}: {e}")


def cache_key(
    url: str,
    method: str,
    render_js: bool,
    output_format: str,
    strip_links: bool,
    css_selector: str | None,
    json_schema: dict | None,
    extraction_prompt: str | None,
    llm_provider: str,
    llm_model: str | None,
) -> str:
    """Stable content cache key. Headers/cookies/session are intentionally
    excluded so authenticated content is never cached."""

    def _stable(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            return json.dumps(value, sort_keys=True, default=str)
        return str(value)

    raw = "|".join(
        [
            url,
            method.upper(),
            str(render_js),
            output_format,
            str(strip_links),
            _stable(css_selector),
            _stable(json_schema),
            _stable(extraction_prompt),
            llm_provider,
            _stable(llm_model),
        ]
    )
    return "crawlix:content:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def invalidate_url_cache(url: str) -> int:
    """Purge cached payloads for a URL (used after crawls or manual invalidation)."""
    prefix = f"crawlix:content:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:16]}"
    removed = await _memory_cache.invalidate(prefix)
    if _redis_available():
        try:
            from .session_manager import redis_client

            keys = await redis_client.keys(f"{prefix}*")
            if keys:
                await redis_client.delete(*keys)
                removed += len(keys)
        except Exception as e:
            logger.debug(f"cache invalidation failed for {url}: {e}")
    return removed