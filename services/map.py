import gzip
import re
from collections import deque
from urllib.parse import urldefrag, urljoin, urlparse

from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession

from .log_filter import logger
from .ssrf import is_ssrf_safe

SITEMAP_CANDIDATES = (
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/sitemap/sitemap.xml",
    "/sitemap1.xml",
    "/sitemap.xml.gz",
)
_LINK_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.IGNORECASE)
_SITEMAP_DIRECTIVE_RE = re.compile(r"(?i)^sitemap:\s*([^\r\n\s]+)", re.MULTILINE)
_WWW_RE = re.compile(r"^www\.", re.IGNORECASE)


def _normalize_domain(host: str) -> str:
    host = host.lower()
    host = host.removeprefix("www.")
    return host


def _in_domain(url: str, base_domain: str, allow_subdomains: bool) -> bool:
    host = _normalize_domain(urlparse(url).netloc or "")
    base = _normalize_domain(base_domain)
    if not host:
        return False
    if allow_subdomains:
        return host == base or host.endswith("." + base)
    return host == base


async def _fetch_text(url: str, timeout: float, proxy_url: str | None) -> str | None:
    if not await is_ssrf_safe(url):
        return None
    try:
        kwargs: dict = {"impersonate": "chrome120", "timeout": timeout, "allow_redirects": True}
        if proxy_url:
            kwargs["proxies"] = {"http": proxy_url, "https": proxy_url}
        async with AsyncSession(**kwargs) as session:
            resp = await session.get(url)
            if resp.status_code != 200:
                return None
            if resp.headers.get("content-encoding") == "gzip" or url.lower().endswith(".gz"):
                try:
                    return gzip.decompress(resp.content).decode("utf-8", errors="ignore")
                except Exception:
                    pass
            return resp.text
    except Exception as e:
        logger.debug(f"map fetch failed for {url}: {e}")
        return None


async def _parse_sitemap(
    url: str,
    timeout: float,
    proxy_url: str | None,
    limit: int,
    visited_sitemaps: set[str],
) -> set[str]:
    if url in visited_sitemaps:
        return set()
    visited_sitemaps.add(url)

    body = await _fetch_text(url, timeout, proxy_url)
    if not body:
        return set()

    urls: set[str] = set()
    for loc in _LINK_RE.findall(body):
        loc = loc.strip()
        if len(urls) >= limit:
            break
        if not loc.lower().startswith(("http://", "https://")):
            continue
        if _looks_like_sitemap(loc):
            nested = await _parse_sitemap(loc, timeout, proxy_url, limit - len(urls), visited_sitemaps)
            urls |= nested
        else:
            urls.add(urldefrag(loc)[0])
    return urls


def _looks_like_sitemap(url: str) -> bool:
    lower = url.lower()
    return lower.endswith(".xml") or lower.endswith(".xml.gz") or "sitemap" in lower


async def _discover_links(
    start_url: str,
    base_domain: str,
    limit: int,
    timeout: float,
    proxy_url: str | None,
    allow_subdomains: bool,
) -> set[str]:
    found: set[str] = set()
    seen: set[str] = set()
    queue: deque[str] = deque([start_url])

    while queue and len(found) < limit:
        current = queue.popleft()
        if current in seen:
            continue
        seen.add(current)

        body = await _fetch_text(current, timeout, proxy_url)
        if not body:
            continue

        try:
            soup = BeautifulSoup(body, "lxml")
        except Exception as e:
            logger.debug(f"map parse failed for {current}: {e}")
            continue

        for anchor in soup.find_all("a", href=True):
            if len(found) >= limit:
                break
            href = (anchor.get("href") or "").strip()
            if not href or href.startswith(("javascript:", "mailto:", "tel:", "#", "data:")):
                continue
            absolute = urldefrag(urljoin(current, href))[0]
            if not absolute.lower().startswith(("http://", "https://")):
                continue
            if not _in_domain(absolute, base_domain, allow_subdomains):
                continue
            if absolute in found or absolute in seen:
                continue
            found.add(absolute)
            queue.append(absolute)

    return found


async def map_site(
    url: str,
    limit: int = 100,
    include_sitemap: bool = True,
    allow_subdomains: bool = False,
    render_js: bool = False,
    timeout: float = 15.0,
    proxy_url: str | None = None,
) -> dict:
    """Discover the URLs of a site via robots.txt, sitemaps (including .xml.gz), and BFS DOM exploration."""
    parsed = urlparse(url)
    base_domain = parsed.netloc or ""
    urls: set[str] = set()
    discovered_via = "link"

    if not await is_ssrf_safe(url):
        return {"success": False, "error": "URL failed SSRF safety check.", "urls": [], "count": 0}

    if include_sitemap:
        scheme = parsed.scheme or "https"
        visited_sm: set[str] = set()

        # 1. Discover sitemaps declared in robots.txt
        robots_txt = await _fetch_text(f"{scheme}://{base_domain}/robots.txt", timeout, proxy_url)
        candidates_to_try = list(SITEMAP_CANDIDATES)
        if robots_txt:
            for declared in _SITEMAP_DIRECTIVE_RE.findall(robots_txt):
                declared_clean = declared.strip()
                if declared_clean.startswith(("http://", "https://")):
                    candidates_to_try.insert(0, declared_clean)

        for candidate in candidates_to_try:
            if len(urls) >= limit:
                break
            sm_url = candidate if candidate.startswith(("http://", "https://")) else f"{scheme}://{base_domain}{candidate}"
            if not await is_ssrf_safe(sm_url):
                continue
            sitemap_urls = await _parse_sitemap(sm_url, timeout, proxy_url, limit, visited_sm)
            if sitemap_urls:
                urls |= sitemap_urls
                discovered_via = "sitemap"
                if len(urls) >= limit:
                    break

    if len(urls) < limit:
        links = await _discover_links(
            url, base_domain, limit - len(urls), timeout, proxy_url, allow_subdomains
        )
        urls |= links

    if not urls:
        urls.add(urldefrag(url)[0])

    ordered = sorted(u for u in urls if u.lower().startswith(("http://", "https://")))
    return {
        "success": True,
        "urls": ordered,
        "count": len(ordered),
        "limit": limit,
        "base_domain": base_domain,
        "discovered_via": discovered_via,
    }
