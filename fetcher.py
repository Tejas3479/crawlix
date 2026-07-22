import asyncio
import base64
import datetime
from datetime import datetime as dt_class, timezone
import json
import os
import random
import re
import logging
import socket
import ipaddress
import uuid
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urljoin, urlparse

from curl_cffi.requests import AsyncSession as CurlSession
from playwright.async_api import async_playwright, BrowserContext, Browser
from bs4 import BeautifulSoup
from markdownify import markdownify
import httpx


async def is_ssrf_safe(url: str) -> bool:
    """Async-safe SSRF check. Uses executor for DNS resolution to avoid blocking the event loop."""
    if os.getenv("DISABLE_SSRF_CHECK") == "true":
        return True
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        if not host:
            return False

        # Check if it's already an IP address (no DNS needed)
        try:
            ip = ipaddress.ip_address(host)
            return not (ip.is_private or ip.is_loopback or ip.is_link_local)
        except ValueError:
            pass

        # Resolve hostname in thread executor to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        addr_info = await loop.run_in_executor(None, socket.getaddrinfo, host, None)
        for _family, _type, _proto, _canonname, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return False
        return True
    except Exception as e:
        logger.error(f"SSRF safety check failed for {url}: {e}")
        return False


# Module-level logger — basicConfig is configured once in app.py lifespan
logger = logging.getLogger("crawlix.fetcher")

# CONSTANTS
MAX_PLAYWRIGHT_INSTANCES = int(os.getenv("MAX_PLAYWRIGHT_INSTANCES", "3"))
SESSION_TTL_MINUTES = int(os.getenv("SESSION_TTL_MINUTES", "30"))
MAX_SESSIONS = int(os.getenv("MAX_SESSIONS", "100"))


class PlaywrightManager:
    """
    Manages a single shared Chromium browser instance + a semaphore for concurrency.
    """
    def __init__(self):
        self.browser: Browser | None = None
        self.semaphore: asyncio.Semaphore = asyncio.Semaphore(MAX_PLAYWRIGHT_INSTANCES)
        self._playwright = None
        self._slots_lock: asyncio.Lock = asyncio.Lock()
        self.slots_free: int = MAX_PLAYWRIGHT_INSTANCES

    async def start(self):
        logger.info("Initializing Playwright driver...")
        self._playwright = await async_playwright().start()
        self.browser = await self._playwright.chromium.launch(headless=True)
        logger.info("Playwright driver and headless Chromium browser started.")

    async def stop(self):
        logger.info("Stopping Playwright driver...")
        if self.browser:
            await self.browser.close()
            self.browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        logger.info("Playwright driver stopped successfully.")

    @asynccontextmanager
    async def acquire_context(self, proxy_url: str | None = None, extra_headers: dict = {}, stealth: bool = False):
        await self.semaphore.acquire()
        async with self._slots_lock:
            self.slots_free -= 1
            _free = self.slots_free
        logger.info(f"Acquired Playwright slot. Free slots: {_free}")

        # Crash Auto-Recovery
        if not self.browser or not self.browser.is_connected():
            logger.warning("Playwright browser is disconnected or crashed. Relaunching...")
            try:
                if self.browser:
                    await self.browser.close()
            except Exception:
                pass
            try:
                self.browser = await self._playwright.chromium.launch(headless=True)
                logger.info("Playwright Chromium browser successfully relaunched.")
            except Exception as e:
                logger.error(f"Failed to relaunch Playwright browser: {e}")
                self.semaphore.release()
                self.slots_free += 1
                raise e

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

            if extra_headers:
                await context.set_extra_http_headers(extra_headers)
                
            yield context
        finally:
            if context:
                try:
                    await context.close()
                except Exception as e:
                    logger.error(f"Error closing playwright context: {e}")
            self.semaphore.release()
            async with self._slots_lock:
                self.slots_free += 1
                _free = self.slots_free
            logger.info(f"Released Playwright slot. Free slots: {_free}")


class SessionManager:
    """
    Manages both curl_cffi and Playwright sessions keyed by session_id.
    """
    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self.ttl_seconds: int = SESSION_TTL_MINUTES * 60
        self._lock: asyncio.Lock = asyncio.Lock()

    async def get_or_create(self, session_id: str, engine: str) -> dict:
        async with self._lock:
            now = dt_class.now(timezone.utc)
            if session_id not in self.sessions:
                logger.info(f"Creating new session context: {session_id} (engine: {engine})")
                self.sessions[session_id] = {
                    "session_id": session_id,
                    "curl_session": None,
                    "playwright_context": None,
                    "cookies": {},
                    "last_active": now,
                    "created_at": now,
                    "request_count": 0,
                    "engine": engine
                }
            else:
                session = self.sessions[session_id]
                if session["engine"] != engine:
                    logger.info(f"Switching session engine for {session_id} from {session['engine']} to {engine}")
                    # Close old engine resource
                    if session["curl_session"]:
                        try:
                            await session["curl_session"].close()
                        except Exception as e:
                            logger.error(f"Error closing curl session: {e}")
                        session["curl_session"] = None
                    if session["playwright_context"]:
                        try:
                            await session["playwright_context"].close()
                        except Exception as e:
                            logger.error(f"Error closing playwright context: {e}")
                        session["playwright_context"] = None
                    
                    session["engine"] = engine
            
            session = self.sessions[session_id]
            session["last_active"] = now
            session["request_count"] += 1
            
            # Enforce MAX_SESSIONS: evict LRU session when at or over the limit
            if len(self.sessions) >= MAX_SESSIONS:
                lru_id = None
                lru_time = None
                for sid, s in self.sessions.items():
                    if sid == session_id:
                        continue
                    if lru_time is None or s["last_active"] < lru_time:
                        lru_time = s["last_active"]
                        lru_id = sid
                if lru_id:
                    logger.info(f"Evicting least recently used session: {lru_id}")
                    evict_session = self.sessions.pop(lru_id)
                    if evict_session["curl_session"]:
                        try:
                            await evict_session["curl_session"].close()
                        except Exception:
                            pass
                    if evict_session["playwright_context"]:
                        try:
                            await evict_session["playwright_context"].close()
                        except Exception:
                            pass
            
            return session

    async def update_cookies(self, session_id: str, new_cookies: dict):
        async with self._lock:
            if session_id in self.sessions:
                self.sessions[session_id]["cookies"].update(new_cookies)

    async def delete_session(self, session_id: str):
        async with self._lock:
            if session_id in self.sessions:
                logger.info(f"Deleting session context: {session_id}")
                session = self.sessions.pop(session_id)
                if session["curl_session"]:
                    try:
                        await session["curl_session"].close()
                    except Exception:
                        pass
                if session["playwright_context"]:
                    try:
                        await session["playwright_context"].close()
                    except Exception:
                        pass

    async def close_all(self):
        logger.info("Closing all active session contexts...")
        session_ids = list(self.sessions.keys())
        for sid in session_ids:
            await self.delete_session(sid)

    async def cleanup_loop(self):
        try:
            while True:
                await asyncio.sleep(300)
                now = dt_class.now(timezone.utc)
                expired_ids = []
                async with self._lock:
                    for sid, s in self.sessions.items():
                        delta = (now - s["last_active"]).total_seconds()
                        if delta > self.ttl_seconds:
                            expired_ids.append(sid)

                for sid in expired_ids:
                    logger.info(f"Session {sid} expired due to inactivity. Cleaning up.")
                    await self.delete_session(sid)
        except asyncio.CancelledError:
            logger.info("Session cleanup loop cancelled gracefully.")
            raise

    def list_sessions(self) -> list[dict]:
        result = []
        # Shallow copy to prevent dictionary modification errors during async execution
        sessions_copy = list(self.sessions.items())
        for sid, s in sessions_copy:
            result.append({
                "session_id": s["session_id"],
                "engine": s["engine"],
                "created_at": s["created_at"].isoformat() + "Z",
                "last_active": s["last_active"].isoformat() + "Z",
                "request_count": s["request_count"],
                "cookie_count": len(s["cookies"])
            })
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
                        logger.error(f"LLM API request failed after 3 attempts. Last error: {llm_err}")
                        raise llm_err
            
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
      final_url, status_code, raw_html, content, retries_used, error, error_message, screenshot
    """
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
            "screenshot": None
        }

    # 2. Parse Proxy Pool (handles comma, newline, and CRLF delimiters)
    proxies_list = []
    if proxy_url:
        proxies_list = [p.strip() for p in re.split(r'[,\r\n]+', proxy_url) if p.strip()]

    last_error = None
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
                final_url = str(resp.url)
                status_code = resp.status_code
                raw_html = resp.text
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
                        except Exception as goto_err:
                            if "timeout" in str(goto_err).lower():
                                logger.warning(f"Navigation to {url} timed out (wait_until={wait_until}). Continuing with partially loaded page content.")
                            else:
                                raise goto_err
                        status_code = response.status if response else 200
                        last_status = status_code
                        final_url = page.url
                        
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
                                        logger.info(f"Action Fill: {act_selector} with '{act_value}'")
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
                                        logger.info(f"Action Press Key '{act_value}' on {act_selector}")
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
            last_error = e
            if attempt < max_retries:
                wait = 1.0 * (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Exception encountered: {e}. Retrying in {wait:.2f}s...")
                await asyncio.sleep(wait)
            else:
                logger.error(f"Max retries exceeded for URL {url}. Last exception: {e}")
                return {
                    "error": "max_retries_exceeded",
                    "error_message": str(e),
                    "last_status": last_status,
                    "retries_used": attempt,
                    "final_url": final_url,
                    "status_code": status_code,
                    "content": None,
                    "raw_html": "",
                    "screenshot": None
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
    
    return {
        "final_url": final_url,
        "status_code": status_code,
        "content": content,
        "raw_html": raw_html,
        "retries_used": attempt,
        "error": None,
        "error_message": None,
        "screenshot": screenshot_data_url
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
                    "url_count": len(c["crawled_urls"])
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


# SINGLETONS
playwright_mgr = PlaywrightManager()
session_manager = SessionManager()
crawl_manager = CrawlManager()
