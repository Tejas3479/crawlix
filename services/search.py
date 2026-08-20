import html
import re
from urllib.parse import urlencode, urlparse

from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession

from .log_filter import logger

_WHITESPACE_RE = re.compile(r"\s+")


def _clean_snippet(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", html.unescape(text or "")).strip()


async def _search_duckduckgo(query: str, max_results: int) -> list[dict]:
    """Keyless provider using DuckDuckGo's lightweight HTML endpoint."""
    url = "https://html.duckduckgo.com/html/?" + urlencode({"q": query})
    try:
        async with AsyncSession(impersonate="chrome120", timeout=20) as session:
            resp = await session.get(
                url, headers={"Accept-Language": "en-US,en;q=0.9"}
            )
            if resp.status_code != 200:
                raise RuntimeError(f"provider returned HTTP {resp.status_code}")
            soup = BeautifulSoup(resp.text, "lxml")
    except Exception as e:
        logger.warning(f"duckduckgo search failed: {e}")
        return []

    results: list[dict] = []
    for result in soup.select(".result"):
        if len(results) >= max_results:
            break
        link = result.select_one("a.result__a")
        if not link or not link.get("href"):
            continue
        href = link["href"]
        # DDG wraps real URLs in a redirect param; unpack it when present.
        if "uddg=" in href:
            parsed = urlparse(href)
            from urllib.parse import parse_qs

            decoded = parse_qs(parsed.query).get("uddg", [None])[0]
            if decoded:
                href = decoded
        title = _clean_snippet(link.get_text())
        snippet_el = result.select_one(".result__snippet")
        snippet = _clean_snippet(snippet_el.get_text()) if snippet_el else ""
        if title and href.startswith(("http://", "https://")):
            results.append({"title": title, "url": href, "snippet": snippet})
    return results


async def _search_serper(query: str, max_results: int, api_key: str) -> list[dict]:
    url = "https://google.serper.dev/search"
    payload = {"q": query, "num": max_results}
    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    try:
        async with AsyncSession(impersonate="chrome120", timeout=20) as session:
            resp = await session.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"serper search failed: {e}")
        return []

    results: list[dict] = []
    for item in data.get("organic", []):
        if len(results) >= max_results:
            break
        link = item.get("link") or ""
        title = item.get("title") or ""
        snippet = item.get("snippet") or ""
        if title and link.startswith(("http://", "https://")):
            results.append(
                {"title": _clean_snippet(title), "url": link, "snippet": _clean_snippet(snippet)}
            )
    return results


async def search(query: str, provider: str = "duckduckgo", max_results: int = 10, api_key: str | None = None) -> dict:
    if provider == "serper":
        if not api_key:
            return {"success": False, "error": "SERPER_API_KEY is required for the 'serper' provider.", "results": []}
        results = await _search_serper(query, max_results, api_key)
    elif provider == "duckduckgo":
        results = await _search_duckduckgo(query, max_results)
    else:
        return {"success": False, "error": f"Unsupported provider '{provider}'.", "results": []}

    return {"success": True, "query": query, "provider": provider, "results": results}
