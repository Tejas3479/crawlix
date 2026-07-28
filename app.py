import asyncio
import os
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Literal
from urllib.parse import urlparse

import redis.asyncio as redis
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl, field_validator

from database import init_db
from fetcher import (
    SensitiveDataFilter,
    crawl_manager,
    playwright_mgr,
    run_fetch,
    session_manager,
)

# Set up logging configuration with SensitiveDataFilter
logger = logging.getLogger("crawlix.app")
logger.addFilter(SensitiveDataFilter())

log_handler = logging.StreamHandler()
log_handler.addFilter(SensitiveDataFilter())
log_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
logging.basicConfig(level=logging.INFO, handlers=[log_handler])

# API KEY AUTH
VALID_KEYS: set[str] = {
    k.strip() for k in os.getenv("API_KEYS", "").split(",") if k.strip()
}
if not VALID_KEYS:
    logger.warning("API_KEYS not set. Authentication is DISABLED.")

security_header = APIKeyHeader(name="x-api-key", auto_error=False)
security_bearer = HTTPBearer(auto_error=False)

async def verify_api_key(
    x_api_key: str | None = Depends(security_header),
    bearer: HTTPAuthorizationCredentials | None = Depends(security_bearer)
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


# RATE LIMITER & RESOURCE LIMIT CONSTANTS
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))
MAX_BODY_SIZE_BYTES = int(os.getenv("MAX_REQUEST_BODY_SIZE", str(10 * 1024 * 1024))) # 10MB
MAX_SERVER_CRAWL_PAGES = int(os.getenv("MAX_CRAWL_PAGES", "100"))
MAX_SERVER_CRAWL_DEPTH = int(os.getenv("MAX_CRAWL_DEPTH", "10"))

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.from_url(REDIS_URL, decode_responses=True)

class RateLimiter:
    """
    In-memory sliding window rate limiter per client IP or API key.
    """
    def __init__(self, requests_per_minute: int = RATE_LIMIT_PER_MINUTE, window_seconds: int = 60):
        self.rpm = requests_per_minute
        self.window = window_seconds

    async def check(self, key: str) -> tuple[bool, int, int]:
        if self.rpm <= 0:
            return False, 9999, 0

        now = time.time()
        cutoff = now - self.window
        redis_key = f"rate_limit:{key}"

        async with redis_client.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(redis_key, 0, cutoff)
            pipe.zadd(redis_key, {str(now): now})
            pipe.zcard(redis_key)
            pipe.expire(redis_key, self.window)
            results = await pipe.execute()

        count = results[2]
        if count > self.rpm:
            return True, 0, self.window

        remaining = self.rpm - count
        return False, remaining, self.window

    async def cleanup_loop(self):
        try:
            while True:
                await asyncio.sleep(86400)
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
    try:
        await init_db()
        await playwright_mgr.initialize()
    except Exception as e:
        logger.warning(f"Playwright pre-initialization skipped on startup ({e}). Will initialize lazily when JS rendering is requested.")
    _cleanup_task = asyncio.create_task(session_manager.cleanup_loop())
    _rate_limit_task = asyncio.create_task(rate_limiter.cleanup_loop())
    logger.info("Crawlix application started, engine initialized, and rate limiter active.")
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
async def resource_limits_middleware(request: Request, call_next):
    # Payload size limit check
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_BODY_SIZE_BYTES:
                client_ip = request.client.host if request.client else "127.0.0.1"
                logger.warning(f"Rejected oversized payload ({content_length} bytes) from {client_ip}")
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"Request payload size exceeds maximum server limit of {MAX_BODY_SIZE_BYTES // (1024 * 1024)}MB."}
                )
        except ValueError:
            pass

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


# ALLOWED LLM MODELS ALLOWLIST
ALLOWED_LLM_MODELS = {
    "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1", "o1-mini", "o3-mini",
    "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229",
    "gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"
}

# PYDANTIC SCHEMAS
class ProxyConfig(BaseModel):
    url: str = Field(..., max_length=2000, description="Full proxy URL e.g. http://user:pass@host:port")
    country_code: str | None = Field(None, max_length=10)

    @field_validator("url")
    @classmethod
    def validate_proxy_url(cls, v: str) -> str:
        v_str = v.strip()
        parsed = urlparse(v_str)
        if parsed.scheme.lower() not in ("http", "https", "socks5", "socks4", "socks5h"):
            raise ValueError("Proxy URL scheme must be http, https, socks5, or socks4")
        if not parsed.netloc:
            raise ValueError("Invalid proxy URL format")
        return v_str


class ActionConfig(BaseModel):
    type: Literal["click", "wait", "scroll", "fill", "hover", "press"]
    selector: str | None = Field(None, max_length=500)
    value: str | None = Field(None, max_length=2000)
    duration: int | None = Field(None, ge=0, le=60)


class FetchRequest(BaseModel):
    url: HttpUrl
    method: str = Field("GET", max_length=10)
    headers: dict[str, str] = Field(default_factory=dict)
    cookies: dict[str, str] = Field(default_factory=dict)
    body: str | None = Field(None, max_length=10_000_000) # 10MB max body
    json_body: dict | None = None
    session_id: str | None = Field(None, max_length=100)
    render_js: bool = False
    scroll: bool = False
    output_format: Literal["html", "markdown", "structured"] = "html"
    strip_links: bool = False
    proxy: ProxyConfig | None = None
    max_retries: int = Field(2, ge=0, le=5)
    timeout: int = Field(30, ge=1, le=120)
    impersonate: str = Field("chrome120", max_length=50)
    llm_api_key: str | None = Field(None, max_length=500)
    llm_provider: Literal["openai", "anthropic", "gemini"] = "openai"
    json_schema: dict | None = None
    wait_for_selector: str | None = Field(None, max_length=500)
    wait_timeout: int = Field(30, ge=1, le=120)
    css_selector: str | None = Field(None, max_length=500)
    llm_model: str | None = Field(None, max_length=100)
    actions: list[ActionConfig] | None = Field(None, max_length=20)
    screenshot: bool = False
    screenshot_format: Literal["png", "jpeg"] = "png"
    extraction_prompt: str | None = Field(None, max_length=5000)
    wait_until: Literal["domcontentloaded", "load", "networkidle"] = "networkidle"
    stealth: bool = False

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: HttpUrl) -> HttpUrl:
        scheme = v.scheme.lower() if v.scheme else ""
        if scheme not in ("http", "https"):
            raise ValueError("Target URL scheme must be http or https")
        return v

    @field_validator("llm_model")
    @classmethod
    def validate_llm_model(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v_clean = v.strip()
        if not v_clean:
            return None
        if v_clean not in ALLOWED_LLM_MODELS and not any(v_clean.startswith(prefix) for prefix in ("gpt-", "claude-", "gemini-", "o1", "o3")):
            raise ValueError(f"LLM model '{v_clean}' is not supported. Must be a valid OpenAI, Anthropic, or Gemini model.")
        return v_clean

    @field_validator("json_schema")
    @classmethod
    def validate_json_schema_size(cls, v: dict | None) -> dict | None:
        if v is None:
            return None
        serialized = json.dumps(v)
        if len(serialized) > 50_000:
            raise ValueError("JSON schema size exceeds maximum limit of 50KB")
        return v


class FetchResponse(BaseModel):
    success: bool
    url: str
    status_code: int
    output_format: str
    content: str | dict
    session_id: str | None
    latency_ms: int
    retries_used: int
    error: str | None = None
    error_message: str | None = None
    screenshot: str | None = None
    timing: dict | None = None


class CrawlRequest(BaseModel):
    url: HttpUrl
    max_pages: int = Field(10, ge=1, le=100)
    max_depth: int = Field(3, ge=1, le=10)
    render_js: bool = False
    output_format: Literal["html", "markdown", "structured"] = "markdown"
    strip_links: bool = False
    css_selector: str | None = Field(None, max_length=500)
    limit_domain: bool = True
    actions: list[ActionConfig] | None = Field(None, max_length=20)
    extraction_prompt: str | None = Field(None, max_length=5000)
    stealth: bool = False

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: HttpUrl) -> HttpUrl:
        scheme = v.scheme.lower() if v.scheme else ""
        if scheme not in ("http", "https"):
            raise ValueError("Crawl target URL scheme must be http or https")
        return v

    @field_validator("max_pages")
    @classmethod
    def validate_max_pages(cls, v: int) -> int:
        if v > MAX_SERVER_CRAWL_PAGES:
            raise ValueError(f"Requested max_pages ({v}) exceeds server limit of {MAX_SERVER_CRAWL_PAGES}")
        return v

    @field_validator("max_depth")
    @classmethod
    def validate_max_depth(cls, v: int) -> int:
        if v > MAX_SERVER_CRAWL_DEPTH:
            raise ValueError(f"Requested max_depth ({v}) exceeds server limit of {MAX_SERVER_CRAWL_DEPTH}")
        return v

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
    return await session_manager.list_sessions()

# DELETE /api/sessions/{session_id}
@app.delete("/api/sessions/{session_id}", dependencies=[Depends(verify_api_key)])
async def delete_session(session_id: str):
    if not await session_manager.get_session_meta(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    await session_manager.delete_session(session_id)
    return {"deleted": True, "session_id": session_id}

# GET /api/health
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "active_sessions": await session_manager.count_sessions(),
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
    crawl = await crawl_manager.get_crawl(crawl_id)
    if not crawl:
        raise HTTPException(status_code=404, detail="Crawl not found")
    return crawl

@app.get("/api/crawl", dependencies=[Depends(verify_api_key)])
async def list_crawls():
    return await crawl_manager.list_crawls()

@app.delete("/api/crawl/{crawl_id}", dependencies=[Depends(verify_api_key)])
async def delete_crawl(crawl_id: str):
    if not await crawl_manager.delete_crawl(crawl_id):
        raise HTTPException(status_code=404, detail="Crawl not found")
    return {"deleted": True, "crawl_id": crawl_id}

# Mount static files
if os.path.isdir("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)





from pydantic import BaseModel
from sqlalchemy import select

from database import Proxy, async_session_maker


class ProxyCreate(BaseModel):
    url: str

@app.post("/api/proxies", dependencies=[Depends(verify_api_key)])
async def add_proxy(proxy: ProxyCreate):
    async with async_session_maker() as session:
        # Check if exists
        result = await session.execute(select(Proxy).where(Proxy.url == proxy.url))
        existing = result.scalars().first()
        if existing:
            return {"status": "already_exists", "id": existing.id}
        
        new_proxy = Proxy(url=proxy.url)
        session.add(new_proxy)
        await session.commit()
        await session.refresh(new_proxy)
        return {"status": "added", "id": new_proxy.id}

@app.get("/api/proxies", dependencies=[Depends(verify_api_key)])
async def list_proxies():
    async with async_session_maker() as session:
        result = await session.execute(select(Proxy))
        proxies = result.scalars().all()
        return [{"id": p.id, "url": p.url, "is_active": p.is_active, "fail_count": p.fail_count} for p in proxies]
