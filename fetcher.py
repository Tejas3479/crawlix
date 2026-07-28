import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import base64
import datetime
import ipaddress
import json
import logging
import os
import random
import re
import socket
import time
import redis.asyncio as redis
import uuid
from contextlib import asynccontextmanager
from datetime import datetime as dt_class
from datetime import time
import redis.asyncio as rediszone
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession as CurlSession
from markdownify import markdownify
from playwright.async_api import Browser, async_playwright

# RESTRICTED IP NETWORKS & HOSTNAMES FOR ENHANCED SSRF PROTECTION
RESTRICTED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),       # AWS/Azure IMDS & Link-Local
    ipaddress.ip_network("100.64.0.0/10"),        # CGNAT & Cloud Internal
    ipaddress.ip_network("100.100.100.200/32"),   # Alibaba IMDS
    ipaddress.ip_network("10.96.0.0/12"),         # Kubernetes Service CIDR
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),             # IPv6 Unique Local
    ipaddress.ip_network("fe80::/10")             # IPv6 Link-Local
]

RESTRICTED_HOSTNAME_SUFFIXES = (
    ".internal", ".local", ".localhost", ".cluster.local", ".localdomain"
)

RESTRICTED_HOSTNAMES = {
    "localhost", "metadata.google.internal", "metadata.gcp.internal"
}


def _is_ip_restricted(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return True
    return any(ip in net for net in RESTRICTED_NETWORKS)


async def is_ssrf_safe(url: str) -> bool:
    """Enhanced async-safe SSRF check validating URL schemes, cloud metadata IPs, and restricted network ranges."""
    if os.getenv("DISABLE_SSRF_CHECK") == "true":
        return True
    try:
        parsed = urlparse(url)
        # 1. Scheme Validation
        if not parsed.scheme or parsed.scheme.lower() not in ("http", "https"):
            return False

        host = parsed.hostname
        if not host:
            return False

        host_lower = host.lower().strip()

        # 2. Hostname / Domain Blocklist
        if host_lower in RESTRICTED_HOSTNAMES or host_lower.endswith(RESTRICTED_HOSTNAME_SUFFIXES):
            return False

        # 3. Direct IP Address Check
        try:
            ip = ipaddress.ip_address(host_lower)
            return not _is_ip_restricted(ip)
        except ValueError:
            pass

        # 4. Async DNS Resolution Check
        loop = asyncio.get_event_loop()
        addr_info = await loop.run_in_executor(None, socket.getaddrinfo, host_lower, None)
        for _family, _type, _proto, _canonname, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if _is_ip_restricted(ip):
                return False
        return True
    except Exception as e:
        logger.error(f"SSRF safety check failed for {url}: {e}")
        return False


# Module-level logger — logging configuration is initialized in app.py lifespan
logger = logging.getLogger("crawlix.fetcher")


class SensitiveDataFilter(logging.Filter):
    """
    Custom logging filter that automatically redacts sensitive query parameters,
    proxy basic auth credentials, authorization tokens, and secrets from all log messages.
    """
    SENSITIVE_PARAM_REGEX = re.compile(
        r'(?i)([\?&](?:api[_-]?key|token|access[_-]?token|auth|secret|password|passwd|pwd|key|session[_-]?id|jwt|bearer|signature|sig|credential)=)([^&\s#]+)'
    )
    PROXY_CREDS_REGEX = re.compile(
        r'(?i)(https?://[^:\s/@]+):([^@\s/]+)@'
    )
    AUTH_HEADER_REGEX = re.compile(
        r'(?i)(bearer\s+|token\s+|x-api-key:\s*)[a-zA-Z0-9_\-\.]{6,}'
    )

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            msg = record.msg
            msg = self.SENSITIVE_PARAM_REGEX.sub(r'\1***REDACTED***', msg)
            msg = self.PROXY_CREDS_REGEX.sub(r'\1:***REDACTED***@', msg)
            msg = self.AUTH_HEADER_REGEX.sub(r'\1***REDACTED***', msg)
            record.msg = msg
        if record.args:
            new_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    arg = self.SENSITIVE_PARAM_REGEX.sub(r'\1***REDACTED***', arg)
                    arg = self.PROXY_CREDS_REGEX.sub(r'\1:***REDACTED***@', arg)
                    arg = self.AUTH_HEADER_REGEX.sub(r'\1***REDACTED***', arg)
                new_args.append(arg)
            record.args = tuple(new_args)
        return True


def sanitize_url(url: str) -> str:
    """Masks sensitive query parameters from URLs."""
    if not url:
        return ""
    return SensitiveDataFilter.SENSITIVE_PARAM_REGEX.sub(r'\1***REDACTED***', str(url))


def sanitize_proxy_url(proxy_url: str | None) -> str | None:
    """Masks username/password credentials in proxy URLs."""
    if not proxy_url:
        return None
    return SensitiveDataFilter.PROXY_CREDS_REGEX.sub(r'\1:***REDACTED***@', str(proxy_url))


logger.addFilter(SensitiveDataFilter())

# CONSTANTS
MAX_PLAYWRIGHT_INSTANCES = int(os.getenv("MAX_PLAYWRIGHT_INSTANCES", "3"))
PLAYWRIGHT_SLOT_TIMEOUT = int(os.getenv("PLAYWRIGHT_SLOT_TIMEOUT", "30"))
SESSION_TTL_MINUTES = int(os.getenv("SESSION_TTL_MINUTES", "30"))
MAX_SESSIONS = int(os.getenv("MAX_SESSIONS", "100"))

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
CRAWLS_FILE = os.path.join(DATA_DIR, "crawls.json")


class PlaywrightManager:
    """
    Manages Playwright browser instance, context pool, and anti-bot evasion settings.
    """
    def __init__(self):
        self.playwright = None
        self.browser: Browser | None = None
        self.slots_free = MAX_PLAYWRIGHT_INSTANCES
        self._slots_lock = asyncio.Lock()
        self._init_lock = asyncio.Lock()

    async def initialize(self):
        async with self._init_lock:
            if self.playwright is None:
                logger.info("Initializing global Playwright Chromium instance...")
                self.playwright = await async_playwright().start()
                self.browser = await self.playwright.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-accelerated-2d-canvas",
                        "--no-first-run",
                        "--no-zygote",
                        "--disable-gpu"
                    ]
                )

    async def start(self):
        await self.initialize()

    async def stop(self):
        await self.close()

    async def close(self):
        async with self._init_lock:
            if self.browser:
                logger.info("Closing Playwright Chromium browser...")
                await self.browser.close()
                self.browser = None
            if self.playwright:
                await self.playwright.stop()
                self.playwright = None

    @asynccontextmanager
    async def acquire_context(self, proxy_url: str | None = None, user_headers: dict | None = None, stealth: bool = False):
        await self.initialize()

        start_wait = time.monotonic()
        async with self._slots_lock:
            if self.slots_free <= 0:
                logger.warning("Max Playwright instances reached. Waiting for available slot...")
            while self.slots_free <= 0:
                if time.monotonic() - start_wait > PLAYWRIGHT_SLOT_TIMEOUT:
                    logger.error(f"Playwright slot acquisition timed out after {PLAYWRIGHT_SLOT_TIMEOUT}s.")
                    raise TimeoutError(f"All Playwright browser slots are occupied. Acquisition timed out after {PLAYWRIGHT_SLOT_TIMEOUT}s.")
                await asyncio.sleep(0.1)
            self.slots_free -= 1
            _free = self.slots_free
        logger.info(f"Acquired Playwright slot. Free slots: {_free}")

        context = None
        try:
            context_args = {}
            if proxy_url:
                context_args["proxy"] = {"server": proxy_url}
            
            # Evasion: Use standard desktop browser User-Agent
            context_args["user_agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            
            context_args.update({
                "viewport": {"width": 1920 if stealth else 1280, "height": 1080 if stealth else 720},
                "device_scale_factor": 1,
                "is_mobile": False,
                "has_touch": False,
                "locale": "en-US",
                "timezone_id": "America/New_York"
            })
            
            context = await self.browser.new_context(**context_args)
            
            # Evasion: Remove navigator.webdriver property to bypass simple bot checks
            await context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            if stealth:
                # Mock WebGL params
                webgl_script = """
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    // UNMASKED_VENDOR_WEBGL
                    if (parameter === 37445) {
                        return 'Intel Open Source Technology Center';
                    }
                    // UNMASKED_RENDERER_WEBGL
                    if (parameter === 37446) {
                        return 'Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)';
                    }
                    return getParameter.apply(this, arguments);
                };
                """
                await context.add_init_script(webgl_script)

                # Mock plugins, languages, hardwareConcurrency
                nav_script = """
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                    get: () => 8
                });
                """
                await context.add_init_script(nav_script)

            if user_headers:
                await context.set_extra_http_headers(user_headers)
                
            yield context
        finally:
            if context:
                try:
                    await context.close()
                except Exception as e:
                    logger.error(f"Error closing playwright context: {e}")
            async with self._slots_lock:
                self.slots_free += 1
                _free = self.slots_free
            logger.info(f"Released Playwright slot. Free slots: {_free}")


class SessionManager:
    """
    Manages both curl_cffi and Playwright sessions keyed by session_id.
    Metadata is persisted in Redis, while actual connections are held in local memory.
    """
    def __init__(self):
        self.local_sessions: dict[str, dict] = {}
        self.ttl_seconds: int = SESSION_TTL_MINUTES * 60
        self._lock: asyncio.Lock = asyncio.Lock()

    async def get_session_meta(self, session_id: str) -> dict | None:
        data = await redis_client.get(f"session:{session_id}")
        if data:
            return json.loads(data)
        return None

    async def count_sessions(self) -> int:
        cursor = 0
        count = 0
        while True:
            cursor, keys = await redis_client.scan(cursor, match="session:*", count=100)
            count += len(keys)
            if cursor == 0:
                break
        return count

    async def get_or_create(self, session_id: str, engine: str) -> dict:
        async with self._lock:
            now_str = dt_class.now(timezone.utc).isoformat()
            redis_key = f"session:{session_id}"
            
            data = await redis_client.get(redis_key)
            if data:
                session_meta = json.loads(data)
                if session_meta["engine"] != engine:
                    logger.info(f"Switching session engine for {session_id} from {session_meta['engine']} to {engine}")
                    session_meta["engine"] = engine
                    if session_id in self.local_sessions:
                        await self._close_local(session_id)
                session_meta["last_active"] = now_str
                session_meta["request_count"] += 1
            else:
                logger.info(f"Creating new session context: {session_id} (engine: {engine})")
                session_meta = {
                    "session_id": session_id,
                    "cookies": {},
                    "last_active": now_str,
                    "created_at": now_str,
                    "request_count": 1,
                    "engine": engine
                }
                
            await redis_client.setex(redis_key, self.ttl_seconds, json.dumps(session_meta))
            
            if session_id not in self.local_sessions:
                self.local_sessions[session_id] = {
                    "curl_session": None,
                    "playwright_context": None
                }
                
            self.local_sessions[session_id].update(session_meta)
            return self.local_sessions[session_id]

    async def update_cookies(self, session_id: str, new_cookies: dict):
        async with self._lock:
            redis_key = f"session:{session_id}"
            data = await redis_client.get(redis_key)
            if data:
                session_meta = json.loads(data)
                session_meta["cookies"].update(new_cookies)
                await redis_client.setex(redis_key, self.ttl_seconds, json.dumps(session_meta))

    async def delete_session(self, session_id: str):
        async with self._lock:
            await redis_client.delete(f"session:{session_id}")
            await self._close_local(session_id)

    async def _close_local(self, session_id: str):
        if session_id in self.local_sessions:
            logger.info(f"Deleting local session context: {session_id}")
            session = self.local_sessions.pop(session_id)
            if session.get("curl_session"):
                try:
                    await session["curl_session"].close()
                except Exception:
                    pass
            if session.get("playwright_context"):
                try:
                    await session["playwright_context"].close()
                except Exception:
                    pass

    async def close_all(self):
        logger.info("Closing all active local session contexts...")
        for sid in list(self.local_sessions.keys()):
            await self._close_local(sid)

    async def cleanup_loop(self):
        try:
            while True:
                await asyncio.sleep(300)
                expired_ids = []
                async with self._lock:
                    for sid in list(self.local_sessions.keys()):
                        if not await redis_client.exists(f"session:{sid}"):
                            expired_ids.append(sid)
                for sid in expired_ids:
                    logger.info(f"Session {sid} expired in Redis. Cleaning up locally.")
                    await self._close_local(sid)
        except asyncio.CancelledError:
            logger.info("Session cleanup loop cancelled gracefully.")
            raise

    async def list_sessions(self) -> list[dict]:
        result = []
        cursor = 0
        while True:
            cursor, keys = await redis_client.scan(cursor, match="session:*", count=100)
            if keys:
                values = await redis_client.mget(keys)
                for val in values:
                    if val:
                        s = json.loads(val)
                        created_str = s["created_at"]
                        last_active_str = s["last_active"]
                        result.append({
                            "session_id": s["session_id"],
                            "engine": s["engine"],
                            "created_at": created_str + ("Z" if not created_str.endswith("Z") else ""),
                            "last_active": last_active_str + ("Z" if not last_active_str.endswith("Z") else ""),
                            "request_count": s["request_count"],
                            "cookie_count": len(s["cookies"])
                        })
            if cursor == 0:
                break
        return result


async def process_content(
    html: str,
    output_format: str,
    base_url: str,
    strip_links: bool = False,
    llm_api_key: str | None = None,
    llm_provider: str = "openai",
    json_schema: dict | None = None,
    css_selector: str | None = None,
    llm_model: str | None = None,
    extraction_prompt: str | None = None
) -> str | dict:
    # DOM Slicing (Pruning) if css_selector is provided
    if css_selector:
        logger.info(f"Applying DOM pruning with selector: {css_selector}")
        soup = BeautifulSoup(html, "lxml")
        selected_elements = soup.select(css_selector)
        if selected_elements:
            html = "".join(str(elem) for elem in selected_elements)
        else:
            logger.warning(f"CSS Selector '{css_selector}' not found in DOM.")
            html = "<!-- CSS Selector not found -->"

    if output_format == "html":
        return html

    if output_format == "markdown":
        soup = BeautifulSoup(html, "lxml")
        
        # Remove structural tag elements
        for tag in soup(["script", "style", "noscript", "iframe", "svg", "canvas", "nav", "footer", "header", "aside", "form"]):
            tag.decompose()
        
        # Remove navigation/banner layout roles
        for tag in soup.find_all(attrs={"role": ["navigation", "banner", "complementary"]}):
            tag.decompose()
            
        # Clean specific layout/interaction attributes from remaining DOM tags
        for tag in soup.find_all(True):
            attrs_to_remove = []
            for attr in list(tag.attrs.keys()):
                if attr in ("class", "id", "style", "onclick") or attr.startswith("data-"):
                    attrs_to_remove.append(attr)
            for attr in attrs_to_remove:
                del tag[attr]
                
        markdown_text = markdownify(
            str(soup),
            heading_style="ATX",
            strip=["a"] if strip_links else []
        )
        return markdown_text

    if output_format == "structured":
        resolved_key = llm_api_key or os.getenv(f"{llm_provider.upper()}_API_KEY")
        
        if resolved_key is None:
            soup = BeautifulSoup(html, "lxml")
            
            title_tag = soup.find("title")
            title = title_tag.get_text().strip() if title_tag else ""
            
            meta_desc_tag = soup.find("meta", attrs={"name": "description"})
            meta_desc = meta_desc_tag.get("content", "").strip() if meta_desc_tag else ""
            
            meta_kw_tag = soup.find("meta", attrs={"name": "keywords"})
            meta_kw = meta_kw_tag.get("content", "").strip() if meta_kw_tag else ""
            
            h1_list = [h.get_text().strip() for h in soup.find_all("h1") if h.get_text().strip()]
            h2_list = [h.get_text().strip() for h in soup.find_all("h2") if h.get_text().strip()]
            h3_list = [h.get_text().strip() for h in soup.find_all("h3") if h.get_text().strip()]
            
            links = []
            seen_hrefs = set()
            for a in soup.find_all("a", href=True):
                href = a["href"].strip()
                resolved_href = urljoin(base_url, href)
                if resolved_href not in seen_hrefs:
                    seen_hrefs.add(resolved_href)
                    links.append({
                        "text": a.get_text().strip(),
                        "href": resolved_href
                    })
                    
            images = []
            for img in soup.find_all("img", src=True):
                src = img["src"].strip()
                resolved_src = urljoin(base_url, src)
                images.append({
                    "alt": img.get("alt", "").strip(),
                    "src": resolved_src
                })
                
            tables = []
            for table in soup.find_all("table"):
                headers = []
                rows = []
                for th in table.find_all("th"):
                    headers.append(th.get_text().strip())
                for tr in table.find_all("tr"):
                    row_cells = []
                    tds = tr.find_all("td")
                    if tds:
                        for td in tds:
                            row_cells.append(td.get_text().strip())
                        rows.append(row_cells)
                tables.append({
                    "headers": headers,
                    "rows": rows
                })
                
            forms = []
            for form in soup.find_all("form"):
                inputs = []
                for inp in form.find_all("input"):
                    inputs.append({
                        "name": inp.get("name", ""),
                        "type": inp.get("type", "text"),
                        "placeholder": inp.get("placeholder", "")
                    })
                forms.append({
                    "action": urljoin(base_url, form.get("action", "")),
                    "method": form.get("method", "get").lower(),
                    "inputs": inputs
                })
                
            text_blocks = []
            for p in soup.find_all("p"):
                txt = p.get_text().strip()
                if txt:
                    text_blocks.append(txt)
                    if len(text_blocks) >= 50:
                        break
                        
            return {
                "title": title,
                "meta_description": meta_desc,
                "meta_keywords": meta_kw,
                "h1": h1_list,
                "h2": h2_list,
                "h3": h3_list,
                "links": links,
                "images": images,
                "tables": tables,
                "forms": forms,
                "text_blocks": text_blocks
            }
        else:
            # LLM Structured Mapping Path
            markdown_content = await process_content(
                html=html,
                output_format="markdown",
                base_url=base_url,
                strip_links=strip_links,
                css_selector=None  # Already cropped if css_selector was present
            )
            truncated_markdown = markdown_content[:12000]
            
            system = "You are a data extractor. Extract data from the markdown and return ONLY a valid JSON object matching the schema. No explanation, no markdown fences, no preamble."
            if extraction_prompt:
                system += f" Extraction Instructions: {extraction_prompt}"
                
            schema_str = json.dumps(json_schema) if json_schema else "Return a structured JSON object reflecting the extracted data."
            user = f"Schema:\n{schema_str}\n\nContent:\n{truncated_markdown}"
            
            result = ""
            for attempt in range(3):
                try:
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        if llm_provider == "openai":
                            target_model = llm_model or "gpt-4o-mini"
                            headers = {
                                "Authorization": f"Bearer {resolved_key}",
                                "Content-Type": "application/json"
                            }
                            payload = {
                                "model": target_model,
                                "messages": [
                                    {"role": "system", "content": system},
                                    {"role": "user", "content": user}
                                ],
                                "max_tokens": 2000
                            }
                            if json_schema:
                                payload["response_format"] = {
                                    "type": "json_schema",
                                    "json_schema": {
                                        "name": "extracted_data",
                                        "strict": True,
                                        "schema": json_schema
                                    }
                                }
                            else:
                                payload["response_format"] = {"type": "json_object"}
                                
                            logger.info(f"Requesting OpenAI structured outputs using model: {target_model} (attempt {attempt + 1})")
                            resp = await client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
                            resp.raise_for_status()
                            result = resp.json()["choices"][0]["message"]["content"]
                        elif llm_provider == "anthropic":
                            target_model = llm_model or "claude-3-5-haiku-20241022"
                            headers = {
                                "x-api-key": resolved_key,
                                "anthropic-version": "2023-06-01",
                                "Content-Type": "application/json"
                            }
                            payload = {
                                "model": target_model,
                                "max_tokens": 2000,
                                "system": system,
                                "messages": [
                                    {"role": "user", "content": user}
                                ]
                            }
                            logger.info(f"Requesting Anthropic structured outputs using model: {target_model} (attempt {attempt + 1})")
                            resp = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
                            resp.raise_for_status()
                            result = resp.json()["content"][0]["text"]
                        elif llm_provider == "gemini":
                            target_model = llm_model or "gemini-2.5-flash"
                            url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={resolved_key}"
                            headers = {
                                "Content-Type": "application/json"
                            }
                            payload = {
                                "contents": [
                                    {
                                        "parts": [
                                            {"text": system + "\n\n" + user}
                                        ]
                                    }
                                ],
                                "generationConfig": {
                                    "responseMimeType": "application/json"
                                }
                            }
                            if json_schema:
                                payload["generationConfig"]["responseSchema"] = json_schema
                                
                            logger.info(f"Requesting Gemini structured outputs using model: {target_model} (attempt {attempt + 1})")
                            resp = await client.post(url, headers=headers, json=payload)
                            resp.raise_for_status()
                            result = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                    break
                except Exception as llm_err:
                    if attempt < 2:
                        wait = 2.0 * (attempt + 1)
                        logger.warning(f"LLM API request failed: {llm_err}. Retrying in {wait}s...")
                        await asyncio.sleep(wait)
                    else:
                        logger.error(f"LLM API request ({llm_provider}) failed after 3 attempts. Last error: {llm_err}")
                        return {
                            "error": "llm_api_failed",
                            "error_message": f"LLM API request ({llm_provider}) failed after 3 attempts: {llm_err!s}"
                        }
            
            result = result.strip()
            if result.startswith("```"):
                result = re.sub(r"^```(?:json)?\n", "", result)
                result = re.sub(r"\n```$", "", result)
                result = result.strip()
                
            try:
                return json.loads(result)
            except Exception as e:
                logger.error(f"Failed to parse LLM response as JSON: {e}")
                return {"error": "llm_parse_failed", "raw": result}


async def run_fetch(
    url: str,
    method: str,
    headers: dict,
    cookies: dict,
    body: str | None,
    json_body: dict | None,
    session: dict | None,
    render_js: bool,
    scroll: bool,
    proxy_url: str | None,
    max_retries: int,
    timeout: int,
    impersonate: str,
    playwright_mgr: "PlaywrightManager",
    output_format: str,
    strip_links: bool,
    llm_api_key: str | None,
    llm_provider: str,
    json_schema: dict | None,
    wait_for_selector: str | None = None,
    wait_timeout: int = 30,
    css_selector: str | None = None,
    llm_model: str | None = None,
    actions: list | None = None,
    screenshot: bool = False,
    screenshot_format: str = "png",
    extraction_prompt: str | None = None,
    wait_until: str = "networkidle",
    stealth: bool = False
) -> dict:
    """
    Returns dict with keys:
      final_url, status_code, raw_html, content, retries_used, error, error_message, screenshot, timing
    """
    import time
import redis.asyncio as redis as _time
    _t0 = _time.monotonic()
    # 1. SSRF Safety Check (async-safe DNS resolution)
    if not await is_ssrf_safe(url):
        logger.warning(f"Blocking request to restricted URL: {url}")
        return {
            "final_url": url,
            "status_code": 403,
            "content": "Forbidden: Target URL resolves to a restricted local or private address.",
            "raw_html": "",
            "retries_used": 0,
            "error": "forbidden_address",
            "error_message": f"URL {url} resolves to a restricted local or private address.",
            "screenshot": None,
            "timing": None
        }
    _t_security = _time.monotonic()

    # 2. Parse Proxy Pool (handles comma, newline, and CRLF delimiters)
    proxies_list = []
    if proxy_url:
        proxies_list = [p.strip() for p in re.split(r'[,\r\n]+', proxy_url) if p.strip()]

    last_status = 0
    final_url = url
    status_code = 0
    raw_html = ""
    screenshot_data_url = None

    all_cookies = {}
    if session:
        all_cookies.update(cookies)
        all_cookies.update(session["cookies"])
    else:
        all_cookies.update(cookies)

    for attempt in range(max_retries + 1):
        # 3. Rotate Proxy
        current_proxy = None
        if proxies_list:
            current_proxy = proxies_list[attempt % len(proxies_list)]
            logger.info(f"Using rotated proxy: {current_proxy}")

        try:
            logger.info(f"Fetch attempt {attempt + 1}/{max_retries + 1} for URL: {url} (JS-rendering: {render_js})")
            if not render_js:
                # CURL PATH
                curl_session = None
                if session:
                    if session["curl_session"] is None:
                        session["curl_session"] = CurlSession(impersonate=impersonate)
                    curl_session = session["curl_session"]
                else:
                    curl_session = CurlSession(impersonate=impersonate)

                kwargs = {
                    "headers": headers,
                    "cookies": all_cookies,
                    "timeout": timeout
                }
                if current_proxy:
                    kwargs["proxies"] = {"https": current_proxy, "http": current_proxy}
                
                if json_body is not None:
                    kwargs["json"] = json_body
                elif body is not None:
                    kwargs["content"] = body.encode()

                resp = await curl_session.request(method, str(url), **kwargs)
                _t_connect = _time.monotonic()  # first response received
                final_url = str(resp.url)
                status_code = resp.status_code
                raw_html = resp.text
                _t_ttfb = _time.monotonic()  # content fully read
                last_status = status_code

                resp_cookies_dict = dict(resp.cookies)
                all_cookies.update(resp_cookies_dict)
                if session:
                    session["cookies"].update(resp_cookies_dict)

            else:
                # PLAYWRIGHT PATH
                async with playwright_mgr.acquire_context(current_proxy, headers, stealth=stealth) as context:
                    page = None
                    try:
                        await context.add_cookies([{"name": k, "value": v, "url": str(url)} for k, v in all_cookies.items()])
                        page = await context.new_page()
                        response = None
                        try:
                            response = await page.goto(str(url), wait_until=wait_until, timeout=timeout * 1000)
                            _t_connect = _time.monotonic()  # page navigation complete
                        except Exception as goto_err:
                            _t_connect = _time.monotonic()
                            if "timeout" in str(goto_err).lower():
                                logger.warning(f"Navigation to {url} timed out (wait_until={wait_until}). Continuing with partially loaded page content.")
                            else:
                                raise
                        status_code = response.status if response else 200
                        last_status = status_code
                        final_url = page.url
                        _t_ttfb = _time.monotonic()  # DOM available
                        
                        # Custom Actions processor
                        if actions:
                            logger.info(f"Processing {len(actions)} custom browser actions...")
                            for action in actions:
                                # Handle both object attributes and dict get (in case of dict deserialization)
                                act_type = action.type if hasattr(action, 'type') else action.get('type')
                                act_selector = action.selector if hasattr(action, 'selector') else action.get('selector')
                                act_value = action.value if hasattr(action, 'value') else action.get('value')
                                act_duration = action.duration if hasattr(action, 'duration') else action.get('duration')
                                
                                try:
                                    if act_type == "click" and act_selector:
                                        logger.info(f"Action Click: {act_selector}")
                                        await page.click(act_selector, timeout=5000, no_wait_after=True)
                                    elif act_type == "fill" and act_selector:
                                        is_sensitive = any(k in act_selector.lower() for k in ["pass", "secret", "token", "key", "auth", "cred"])
                                        log_val = "***REDACTED***" if is_sensitive else (act_value or "")
                                        logger.info(f"Action Fill: {act_selector} with '{log_val}'")
                                        await page.fill(act_selector, act_value or "", timeout=5000)
                                    elif act_type == "wait":
                                        duration_s = act_duration or 1
                                        logger.info(f"Action Wait: {duration_s}s")
                                        await page.wait_for_timeout(duration_s * 1000)
                                    elif act_type == "scroll":
                                        if act_selector:
                                            logger.info(f"Action Scroll to element: {act_selector}")
                                            await page.locator(act_selector).scroll_into_view_if_needed(timeout=5000)
                                        else:
                                            logger.info("Action Scroll down")
                                            await page.evaluate("window.scrollBy(0, window.innerHeight)")
                                            await page.wait_for_timeout(500)
                                    elif act_type == "hover" and act_selector:
                                        logger.info(f"Action Hover: {act_selector}")
                                        await page.hover(act_selector, timeout=5000)
                                    elif act_type == "press" and act_selector:
                                        is_sensitive = any(k in act_selector.lower() for k in ["pass", "secret", "token", "key", "auth", "cred"])
                                        log_key = "***REDACTED***" if is_sensitive else (act_value or "Enter")
                                        logger.info(f"Action Press Key '{log_key}' on {act_selector}")
                                        await page.press(act_selector, act_value or "Enter", timeout=5000, no_wait_after=True)
                                except Exception as action_err:
                                    logger.error(f"Action {act_type} failed: {action_err}")
                            
                            try:
                                # Wait for any navigations triggered by actions to load
                                await page.wait_for_load_state("load", timeout=5000)
                            except Exception as load_err:
                                logger.warning(f"Wait for load state after actions timed out/failed: {load_err}")
                        
                        if wait_for_selector:
                            logger.info(f"Waiting for selector '{wait_for_selector}' (timeout: {wait_timeout}s)")
                            await page.wait_for_selector(wait_for_selector, timeout=wait_timeout * 1000)
                        
                        if scroll:
                            logger.info("Scrolling down page to trigger lazy loading...")
                            for _ in range(10):
                              prev_height = await page.evaluate("document.body.scrollHeight")
                              await page.evaluate("window.scrollBy(0, window.innerHeight)")
                              await page.wait_for_timeout(500)
                              new_height = await page.evaluate("document.body.scrollHeight")
                              curr_y = await page.evaluate("window.scrollY + window.innerHeight")
                              if curr_y >= new_height or new_height == prev_height:
                                   break
                            await page.wait_for_timeout(1000)
                            
                        try:
                            raw_html = await page.content()
                        except Exception as content_err:
                            logger.warning(f"Failed to get page content: {content_err}. Waiting 2s and retrying...")
                            await page.wait_for_timeout(2000)
                            try:
                                raw_html = await page.content()
                            except Exception as content_err_retry:
                                logger.error(f"Failed to get page content on retry: {content_err_retry}")
                                raw_html = "<html><body>Failed to retrieve content due to active navigation.</body></html>"
                        
                        final_url = page.url
                        
                        if screenshot:
                            try:
                                logger.info(f"Capturing screenshot in format: {screenshot_format}")
                                s_bytes = await page.screenshot(type=screenshot_format, full_page=True)
                                screenshot_data_url = f"data:image/{screenshot_format};base64,{base64.b64encode(s_bytes).decode('utf-8')}"
                            except Exception as s_err:
                                logger.error(f"Screenshot capture failed: {s_err}")
                                
                        new_pw_cookies = await context.cookies()
                        
                        pw_cookies_dict = {c["name"]: c["value"] for c in new_pw_cookies}
                        all_cookies.update(pw_cookies_dict)
                        if session:
                            session["cookies"].update(pw_cookies_dict)
                    finally:
                        if page:
                            try:
                                await page.close()
                            except Exception:
                                pass

            if status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
                wait = 1.0 * (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Fetch failed with status {status_code}. Retrying in {wait:.2f}s...")
                await asyncio.sleep(wait)
                continue
            break

        except Exception as e:
            e_str = str(e)
            err_type = type(e).__name__

            # Specific Error Classification
            if current_proxy and any(k in e_str.lower() or k in err_type.lower() for k in ["proxy", "tunnel", "socks", "407"]):
                error_code = "proxy_error"
                error_msg = f"Proxy connection failed for '{sanitize_proxy_url(current_proxy)}': {e_str}"
            elif render_js and any(k in e_str.lower() or k in err_type.lower() for k in ["playwright", "browser", "chromium", "executable", "context"]):
                error_code = "browser_engine_error"
                error_msg = f"Playwright browser engine error: {e_str}"
            elif any(k in e_str.lower() or k in err_type.lower() for k in ["timeout", "timed out", "navigation timeout"]):
                error_code = "request_timeout"
                error_msg = f"Request to target URL timed out after {timeout} seconds."
            elif any(k in e_str.lower() or k in err_type.lower() for k in ["getaddrinfo", "gaierror", "nameresolution", "dns", "servname"]):
                error_code = "dns_resolution_failed"
                error_msg = f"Could not resolve host domain for URL '{sanitize_url(url)}'."
            elif any(k in e_str.lower() or k in err_type.lower() for k in ["ssl", "certificate", "cert", "handshake"]):
                error_code = "ssl_handshake_failed"
                error_msg = f"SSL/TLS handshake failed for '{sanitize_url(url)}': {e_str}"
            else:
                error_code = "fetch_failed"
                error_msg = f"Fetch failed: {e_str}"

            if attempt < max_retries:
                wait = 1.0 * (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Fetch attempt {attempt + 1} failed ({error_code}). Retrying in {wait:.2f}s...")
                await asyncio.sleep(wait)
            else:
                logger.error(f"Max retries exceeded for URL {sanitize_url(url)}. Last error [{error_code}]: {error_msg}")
                return {
                    "error": error_code,
                    "error_message": error_msg,
                    "last_status": last_status,
                    "retries_used": attempt,
                    "final_url": final_url,
                    "status_code": status_code or 502,
                    "content": None,
                    "raw_html": "",
                    "screenshot": None,
                    "timing": None
                }

    content = await process_content(
        html=raw_html,
        output_format=output_format,
        base_url=final_url,
        strip_links=strip_links,
        llm_api_key=llm_api_key,
        llm_provider=llm_provider,
        json_schema=json_schema,
        css_selector=css_selector,
        llm_model=llm_model,
        extraction_prompt=extraction_prompt
    )
    
    _t_done = _time.monotonic()

    # Build timing breakdown (all values in ms)
    _security_ms = int((_t_security - _t0) * 1000)
    _tc = getattr(run_fetch, '_t_connect', None)  # may not exist if error before connect
    _connect_ms = max(0, int((_t_connect - _t_security) * 1000)) if '_t_connect' in dir() else 0
    _ttfb_ms = max(0, int((_t_ttfb - _t_connect) * 1000)) if '_t_ttfb' in dir() and '_t_connect' in dir() else 0
    _transfer_ms = max(0, int((_t_done - (_t_ttfb if '_t_ttfb' in dir() else _t_security)) * 1000))

    return {
        "final_url": final_url,
        "status_code": status_code,
        "content": content,
        "raw_html": raw_html,
        "retries_used": attempt,
        "error": None,
        "error_message": None,
        "screenshot": screenshot_data_url,
        "timing": {
            "security_ms": _security_ms,
            "connect_ms": _connect_ms,
            "ttfb_ms": _ttfb_ms,
            "transfer_ms": _transfer_ms,
            "total_ms": int((_t_done - _t0) * 1000)
        }
    }


# uuid is imported at top of file

def extract_links(html: str, base_url: str) -> list[str]:
    if not html:
        return []
    try:
        soup = BeautifulSoup(html, "lxml")
        links = []
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            # Skip javascript/mailto links
            if href.lower().startswith(("javascript:", "mailto:", "tel:", "#")):
                continue
            resolved = urljoin(base_url, href)
            # Strip fragment
            parsed = urlparse(resolved)
            cleaned = parsed._replace(fragment="").geturl()
            links.append(cleaned)
        return list(set(links))
    except Exception as e:
        logger.error(f"Error extracting links: {e}")
        return []

class CrawlManager:
    def __init__(self):
        self.crawls: dict[str, dict] = {}
        self.tasks: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()
        self._load_from_disk()

    def _save_to_disk(self):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            serializable = list(self.crawls.values())
            tmp_file = CRAWLS_FILE + ".tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(serializable, f, indent=2)
            os.replace(tmp_file, CRAWLS_FILE)
        except Exception as e:
            logger.error(f"Failed to persist crawls to disk: {e}")

    def _load_from_disk(self):
        if not os.path.exists(CRAWLS_FILE):
            return
        try:
            with open(CRAWLS_FILE, "r", encoding="utf-8") as f:
                crawls_list = json.load(f)
            loaded_count = 0
            for c in crawls_list:
                cid = c.get("crawl_id")
                if not cid:
                    continue
                # If a crawl was running when server stopped, mark as interrupted
                if c.get("status") == "running":
                    c["status"] = "interrupted"
                    c["error_message"] = "Crawl was interrupted by a server restart"
                self.crawls[cid] = c
                loaded_count += 1
            if loaded_count > 0:
                logger.info(f"Loaded {loaded_count} crawl jobs from disk persistence.")
        except Exception as e:
            logger.error(f"Failed to load crawls from disk: {e}")

    async def create_crawl(self, url: str, max_pages: int, max_depth: int, render_js: bool, output_format: str, strip_links: bool, css_selector: str | None, limit_domain: bool, actions: list | None, extraction_prompt: str | None = None, stealth: bool = False) -> str:
        crawl_id = str(uuid.uuid4())
        self.crawls[crawl_id] = {
            "crawl_id": crawl_id,
            "url": url,
            "status": "running",
            "pages_crawled": 0,
            "max_pages": max_pages,
            "crawled_urls": [],
            "results": [],
            "created_at": datetime.datetime.now(timezone.utc).isoformat()
        }
        self._save_to_disk()
        # Launch task and track it
        task = asyncio.create_task(self._run_crawl(crawl_id, url, max_pages, max_depth, render_js, output_format, strip_links, css_selector, limit_domain, actions, extraction_prompt, stealth))
        self.tasks[crawl_id] = task
        return crawl_id

    def get_crawl(self, crawl_id: str) -> dict | None:
        return self.crawls.get(crawl_id)

    def list_crawls(self) -> list[dict]:
        # Copy values to a list to prevent dictionary changed size during iteration
        crawls_copy = list(self.crawls.values())
        return sorted(
            [
                {
                    "crawl_id": c["crawl_id"],
                    "url": c["url"],
                    "status": c["status"],
                    "pages_crawled": c["pages_crawled"],
                    "max_pages": c["max_pages"],
                    "created_at": c["created_at"],
                    "url_count": len(c.get("crawled_urls", []))
                }
                for c in crawls_copy
            ],
            key=lambda x: x["created_at"],
            reverse=True
        )

    def delete_crawl(self, crawl_id: str) -> bool:
        if crawl_id in self.crawls:
            del self.crawls[crawl_id]
            # Cancel background task if active
            task = self.tasks.pop(crawl_id, None)
            if task and not task.done():
                task.cancel()
            self._save_to_disk()
            return True
        return False

    async def _run_crawl(self, crawl_id: str, seed_url: str, max_pages: int, max_depth: int, render_js: bool, output_format: str, strip_links: bool, css_selector: str | None, limit_domain: bool, actions: list | None, extraction_prompt: str | None = None, stealth: bool = False):
        queue = [(seed_url, 0)] # (url, depth)
        visited = set()
        crawled_count = 0
        results = []
        base_domain = urlparse(seed_url).netloc

        CONCURRENCY = 3
        semaphore = asyncio.Semaphore(CONCURRENCY)
        lock = asyncio.Lock()
        active_tasks = set()

        async def crawl_worker(url, depth):
            nonlocal crawled_count
            try:
                logger.info(f"Crawl {crawl_id}: scraping {url} (depth: {depth})")
                res = await run_fetch(
                    url=url,
                    method="GET",
                    headers={},
                    cookies={},
                    body=None,
                    json_body=None,
                    session=None,
                    render_js=render_js,
                    scroll=True,
                    proxy_url=None,
                    max_retries=1,
                    timeout=20,
                    impersonate="chrome120",
                    playwright_mgr=playwright_mgr,
                    output_format=output_format,
                    strip_links=strip_links,
                    llm_api_key=None,
                    llm_provider="openai" if os.getenv("OPENAI_API_KEY") else "gemini",
                    json_schema=None,
                    css_selector=css_selector,
                    actions=actions,
                    extraction_prompt=extraction_prompt,
                    stealth=stealth
                )

                async with lock:
                    if crawl_id not in self.crawls:
                        return

                    if res.get("error") is None:
                        crawled_count += 1
                        html = res.get("raw_html", "")
                        content = res.get("content", "")

                        title = "No Title"
                        if html:
                            try:
                                soup = BeautifulSoup(html, "lxml")
                                title = soup.find("title").get_text().strip() if soup.find("title") else "No Title"
                            except Exception:
                                pass

                        results.append({
                            "url": url,
                            "status_code": res.get("status_code"),
                            "title": title,
                            "content": content
                        })

                        self.crawls[crawl_id]["crawled_urls"].append(url)
                        self.crawls[crawl_id]["pages_crawled"] = crawled_count
                        self.crawls[crawl_id]["results"] = results

                        # Extract links if not at max depth and crawled_count < max_pages
                        if depth < max_depth:
                            new_links = extract_links(html, url)
                            for link in new_links:
                                if limit_domain and urlparse(link).netloc != base_domain:
                                    continue
                                if link not in visited and not any(q[0] == link for q in queue):
                                    queue.append((link, depth + 1))
                    else:
                        results.append({
                            "url": url,
                            "status_code": res.get("status_code", 0),
                            "error": res.get("error"),
                            "error_message": res.get("error_message")
                        })
                        self.crawls[crawl_id]["results"] = results
                        self._save_to_disk()
            except Exception as e:
                logger.error(f"Failed to crawl {url}: {e}")
            finally:
                semaphore.release()

        try:
            while (queue or active_tasks) and crawled_count < max_pages:
                if crawl_id not in self.crawls:
                    logger.info(f"Crawl {crawl_id} was deleted/cancelled. Exiting loop.")
                    break

                finished = {t for t in active_tasks if t.done()}
                active_tasks -= finished

                async with lock:
                    while queue and queue[0][0] in visited:
                        queue.pop(0)

                    if queue and len(active_tasks) < CONCURRENCY and crawled_count + len(active_tasks) < max_pages:
                        url, depth = queue.pop(0)
                        visited.add(url)

                        await semaphore.acquire()
                        task = asyncio.create_task(crawl_worker(url, depth))
                        active_tasks.add(task)
                        continue

                if active_tasks:
                    await asyncio.wait(active_tasks, return_when=asyncio.FIRST_COMPLETED)
                else:
                    break

                await asyncio.sleep(0.1)

            if active_tasks:
                await asyncio.gather(*active_tasks, return_exceptions=True)

        except asyncio.CancelledError:
            logger.info(f"Crawl {crawl_id} task was explicitly cancelled.")
            for t in active_tasks:
                t.cancel()
            if active_tasks:
                await asyncio.gather(*active_tasks, return_exceptions=True)
        finally:
            self.tasks.pop(crawl_id, None)
            if crawl_id in self.crawls:
                self.crawls[crawl_id]["status"] = "completed" if crawled_count > 0 else "failed"
                self._save_to_disk()


# SINGLETONS
playwright_mgr = PlaywrightManager()
session_manager = SessionManager()
crawl_manager = CrawlManager()
