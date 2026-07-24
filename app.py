import asyncio
import os
import time
import uuid
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal, Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

from fetcher import playwright_mgr, session_manager, run_fetch, crawl_manager

# Set up logging configuration (single source of truth — fetcher.py uses getLogger only)
logger = logging.getLogger("crawlix.app")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# API KEY AUTH
VALID_KEYS: set[str] = set(
    k.strip() for k in os.getenv("API_KEYS", "").split(",") if k.strip()
)
if not VALID_KEYS:
    logger.warning("API_KEYS not set. Authentication is DISABLED.")

security_header = APIKeyHeader(name="x-api-key", auto_error=False)
security_bearer = HTTPBearer(auto_error=False)

async def verify_api_key(
    x_api_key: Optional[str] = Depends(security_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer)
):
    if not VALID_KEYS:
        return
        
    token = None
    if x_api_key:
        token = x_api_key.strip()
    elif bearer:
        token = bearer.credentials.strip()
        
    if not token or token not in VALID_KEYS:
         raise HTTPException(status_code=401, detail="Invalid or missing API key")


# RATE LIMITER
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))

class RateLimiter:
    """
    In-memory sliding window rate limiter per client IP or API key.
    """
    def __init__(self, requests_per_minute: int = RATE_LIMIT_PER_MINUTE, window_seconds: int = 60):
        self.rpm = requests_per_minute
        self.window = window_seconds
        self.requests: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def check(self, key: str) -> tuple[bool, int, int]:
        """
        Returns (is_limited, remaining_requests, reset_seconds)
        """
        if self.rpm <= 0:
            return False, 9999, 0

        now = time.monotonic()
        async with self._lock:
            timestamps = self.requests.get(key, [])
            cutoff = now - self.window
            timestamps = [t for t in timestamps if t > cutoff]

            if len(timestamps) >= self.rpm:
                oldest = timestamps[0]
                reset_seconds = max(1, int(self.window - (now - oldest)))
                self.requests[key] = timestamps
                return True, 0, reset_seconds

            timestamps.append(now)
            self.requests[key] = timestamps
            remaining = self.rpm - len(timestamps)
            return False, remaining, self.window

    async def cleanup_loop(self):
        try:
            while True:
                await asyncio.sleep(120)
                now = time.monotonic()
                cutoff = now - self.window
                async with self._lock:
                    to_delete = []
                    for key, ts_list in self.requests.items():
                        filtered = [t for t in ts_list if t > cutoff]
                        if filtered:
                            self.requests[key] = filtered
                        else:
                            to_delete.append(key)
                    for k in to_delete:
                        del self.requests[k]
        except asyncio.CancelledError:
            pass

rate_limiter = RateLimiter()


# LIFESPAN
_cleanup_task: asyncio.Task | None = None
_rate_limit_task: asyncio.Task | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cleanup_task, _rate_limit_task
    # STARTUP
    await playwright_mgr.initialize()
    _cleanup_task = asyncio.create_task(session_manager.cleanup_loop())
    _rate_limit_task = asyncio.create_task(rate_limiter.cleanup_loop())
    logger.info("Crawlix application started, Playwright engine initialized, and rate limiter active.")
    yield
    # SHUTDOWN
    if _cleanup_task:
        _cleanup_task.cancel()
    if _rate_limit_task:
        _rate_limit_task.cancel()
    await session_manager.close_all()
    await playwright_mgr.close()
    logger.info("Crawlix application shutdown complete.")

# APP INIT
app = FastAPI(title="Crawlix", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8000").split(","),
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False
)

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    # Exempt health check and static asset requests from rate limiting
    if path == "/api/health" or path.startswith("/static") or ("." in path.split("/")[-1] and not path.startswith("/api")):
        return await call_next(request)

    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "127.0.0.1")
    api_key = request.headers.get("x-api-key") or ""
    client_key = f"key:{api_key}" if api_key else f"ip:{client_ip}"

    is_limited, remaining, reset_sec = await rate_limiter.check(client_key)
    if is_limited:
        logger.warning(f"Rate limit exceeded for client: {client_key} on path {path}")
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Rate limit exceeded."},
            headers={
                "X-RateLimit-Limit": str(rate_limiter.rpm),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(reset_sec),
                "Retry-After": str(reset_sec)
            }
        )

    response = await call_next(request)
    if rate_limiter.rpm > 0:
        response.headers["X-RateLimit-Limit"] = str(rate_limiter.rpm)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset_sec)
    return response


# PYDANTIC SCHEMAS
class ProxyConfig(BaseModel):
    url: str                          # full proxy URL e.g. "http://user:pass@host:port"
    country_code: Optional[str] = None

class ActionConfig(BaseModel):
    type: Literal["click", "wait", "scroll", "fill", "hover", "press"]
    selector: Optional[str] = None
    value: Optional[str] = None
    duration: Optional[int] = None

class FetchRequest(BaseModel):
    url: HttpUrl
    method: str = "GET"
    headers: dict[str, str] = {}
    cookies: dict[str, str] = {}
    body: Optional[str] = None
    json_body: Optional[dict] = None
    session_id: Optional[str] = None
    render_js: bool = False
    scroll: bool = False
    output_format: Literal["html", "markdown", "structured"] = "html"
    strip_links: bool = False
    proxy: Optional[ProxyConfig] = None
    max_retries: int = 2
    timeout: int = 30
    impersonate: str = "chrome120"
    llm_api_key: Optional[str] = None
    llm_provider: Literal["openai", "anthropic", "gemini"] = "openai"
    json_schema: Optional[dict] = None
    wait_for_selector: Optional[str] = None
    wait_timeout: int = 30
    css_selector: Optional[str] = None
    llm_model: Optional[str] = None
    actions: Optional[list[ActionConfig]] = None
    screenshot: bool = False
    screenshot_format: Literal["png", "jpeg"] = "png"
    extraction_prompt: Optional[str] = None
    wait_until: Literal["domcontentloaded", "load", "networkidle"] = "networkidle"
    stealth: bool = False

class FetchResponse(BaseModel):
    success: bool
    url: str
    status_code: int
    output_format: str
    content: str | dict
    session_id: Optional[str]
    latency_ms: int
    retries_used: int
    error: Optional[str] = None
    error_message: Optional[str] = None
    screenshot: Optional[str] = None
    timing: Optional[dict] = None

class CrawlRequest(BaseModel):
    url: HttpUrl
    max_pages: int = 10
    max_depth: int = 3
    render_js: bool = False
    output_format: Literal["html", "markdown", "structured"] = "markdown"
    strip_links: bool = False
    css_selector: Optional[str] = None
    limit_domain: bool = True
    actions: Optional[list[ActionConfig]] = None
    extraction_prompt: Optional[str] = None
    stealth: bool = False

# POST /fetch
@app.post("/fetch", response_model=FetchResponse, dependencies=[Depends(verify_api_key)])
async def fetch_endpoint(req: FetchRequest):
    start = time.monotonic()
    logger.info(f"Received fetch request: {req.method} {req.url} (format: {req.output_format})")

    # Determine session
    sid = req.session_id
    engine = "playwright" if req.render_js else "curl"
    session = None

    if sid:
        session = await session_manager.get_or_create(sid, engine)
    elif req.render_js:
        sid = None

    proxy_url = req.proxy.url if req.proxy else None

    result = await run_fetch(
        url=str(req.url),
        method=req.method.upper(),
        headers=req.headers,
        cookies=req.cookies,
        body=req.body,
        json_body=req.json_body,
        session=session,
        render_js=req.render_js,
        scroll=req.scroll,
        proxy_url=proxy_url,
        max_retries=req.max_retries,
        timeout=req.timeout,
        impersonate=req.impersonate,
        playwright_mgr=playwright_mgr,
        output_format=req.output_format,
        strip_links=req.strip_links,
        llm_api_key=req.llm_api_key,
        llm_provider=req.llm_provider,
        json_schema=req.json_schema,
        wait_for_selector=req.wait_for_selector,
        wait_timeout=req.wait_timeout,
        css_selector=req.css_selector,
        llm_model=req.llm_model,
        actions=req.actions,
        screenshot=req.screenshot,
        screenshot_format=req.screenshot_format,
        extraction_prompt=req.extraction_prompt,
        wait_until=req.wait_until,
        stealth=req.stealth
    )

    latency_ms = int((time.monotonic() - start) * 1000)
    success = result.get("error") is None

    logger.info(f"Fetch request resolved in {latency_ms}ms with success={success}")

    return FetchResponse(
        success=success,
        url=result.get("final_url", str(req.url)),
        status_code=result.get("status_code", 0),
        output_format=req.output_format,
        content=result.get("content") or "",
        session_id=sid,
        latency_ms=latency_ms,
        retries_used=result.get("retries_used", 0),
        error=result.get("error"),
        error_message=result.get("error_message"),
        screenshot=result.get("screenshot"),
        timing=result.get("timing")
    )

# GET /api/sessions
@app.get("/api/sessions", dependencies=[Depends(verify_api_key)])
async def list_sessions():
    return session_manager.list_sessions()

# DELETE /api/sessions/{session_id}
@app.delete("/api/sessions/{session_id}", dependencies=[Depends(verify_api_key)])
async def delete_session(session_id: str):
    if session_id not in session_manager.sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    await session_manager.delete_session(session_id)
    return {"deleted": True, "session_id": session_id}

# GET /api/health
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "active_sessions": len(session_manager.sessions),
        "playwright_slots_free": playwright_mgr.slots_free
    }

# CRAWL ENDPOINTS
@app.post("/api/crawl", dependencies=[Depends(verify_api_key)])
async def start_crawl(req: CrawlRequest):
    crawl_id = await crawl_manager.create_crawl(
        url=str(req.url),
        max_pages=req.max_pages,
        max_depth=req.max_depth,
        render_js=req.render_js,
        output_format=req.output_format,
        strip_links=req.strip_links,
        css_selector=req.css_selector,
        limit_domain=req.limit_domain,
        actions=req.actions,
        extraction_prompt=req.extraction_prompt,
        stealth=req.stealth
    )
    return {"crawl_id": crawl_id, "status": "running"}

@app.get("/api/crawl/{crawl_id}", dependencies=[Depends(verify_api_key)])
async def get_crawl(crawl_id: str):
    crawl = crawl_manager.get_crawl(crawl_id)
    if not crawl:
        raise HTTPException(status_code=404, detail="Crawl not found")
    return crawl

@app.get("/api/crawl", dependencies=[Depends(verify_api_key)])
async def list_crawls():
    return crawl_manager.list_crawls()

@app.delete("/api/crawl/{crawl_id}", dependencies=[Depends(verify_api_key)])
async def delete_crawl(crawl_id: str):
    if not crawl_manager.delete_crawl(crawl_id):
        raise HTTPException(status_code=404, detail="Crawl not found")
    return {"deleted": True, "crawl_id": crawl_id}

# Mount static files
if os.path.isdir("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")
