import json
import os
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, HttpUrl, field_validator

# CONFIG & LIMIT CONSTANTS
MAX_SERVER_CRAWL_PAGES = int(os.getenv("MAX_CRAWL_PAGES", "100"))
MAX_SERVER_CRAWL_DEPTH = int(os.getenv("MAX_CRAWL_DEPTH", "10"))

# ALLOWED LLM MODELS ALLOWLIST
ALLOWED_LLM_MODELS = {
    # OpenAI
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5",
    "gpt-5-mini",
    "o4-mini",
    "o3-pro",
    "o3-mini",
    "o3",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.5-preview",
    "gpt-4.5",
    "chatgpt-4o-latest",
    # Anthropic
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-fable-5",
    "claude-3-7-sonnet-latest",
    "claude-3-7-sonnet-20250219",
    "claude-3-7-sonnet",
    "claude-3-5-sonnet-latest",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet",
    "claude-3-5-haiku-latest",
    "claude-3-5-haiku-20241022",
    # Google Gemini
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-pro-exp-02-05",
    "gemini-2.0-pro",
}


# PYDANTIC SCHEMAS
class ProxyConfig(BaseModel):
    url: str = Field(
        ...,
        max_length=2000,
        description="Full proxy URL e.g. http://user:pass@host:port",
    )
    country_code: str | None = Field(None, max_length=10)

    @field_validator("url")
    @classmethod
    def validate_proxy_url(cls, v: str) -> str:
        v_str = v.strip()
        parsed = urlparse(v_str)
        if parsed.scheme.lower() not in (
            "http",
            "https",
            "socks5",
            "socks4",
            "socks5h",
        ):
            raise ValueError(
                "Proxy URL scheme must be http, https, socks5, or socks4"
            )
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
    body: str | None = Field(None, max_length=10_000_000)  # 10MB max body
    json_body: dict | None = None
    session_id: str | None = Field(None, max_length=100)
    render_js: bool = False
    scroll: bool = False
    output_format: Literal["html", "markdown", "structured", "css", "vlm", "screenshot"] = "markdown"
    strip_links: bool = False
    proxy: ProxyConfig | None = None
    max_retries: int = Field(2, ge=0, le=5)
    timeout: int = Field(30, ge=1, le=120)
    impersonate: str = Field("chrome120", max_length=50)
    bypass_cache: bool = False
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
    wait_until: Literal["domcontentloaded", "load", "networkidle"] = (
        "networkidle"
    )
    stealth: bool = False
    compress_tokens: bool = False
    auto_dismiss_banners: bool = True

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
        if v_clean not in ALLOWED_LLM_MODELS and not any(
            v_clean.startswith(prefix)
            for prefix in ("gpt-", "claude-", "gemini-", "o1", "o3")
        ):
            raise ValueError(
                f"LLM model '{v_clean}' is not supported. Must be a valid OpenAI, Anthropic, or Gemini model."
            )
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
    content: str | dict | list
    session_id: str | None
    latency_ms: int
    retries_used: int
    error: str | None = None
    error_message: str | None = None
    screenshot: str | None = None
    timing: dict | None = None
    cache_hit: bool = False


class CrawlRequest(BaseModel):
    url: HttpUrl
    max_pages: int = Field(10, ge=1, le=5000)
    max_depth: int = Field(3, ge=1, le=20)
    render_js: bool = False
    output_format: Literal["html", "markdown", "structured", "css"] = "markdown"
    strip_links: bool = False
    css_selector: str | None = Field(None, max_length=500)
    json_schema: dict | None = None
    limit_domain: bool = True
    respect_robots: bool = True
    actions: list[ActionConfig] | None = Field(None, max_length=20)
    extraction_prompt: str | None = Field(None, max_length=5000)
    stealth: bool = False
    compress_tokens: bool = False
    auto_dismiss_banners: bool = True
    include_patterns: list[str] = Field(default_factory=list)
    exclude_patterns: list[str] = Field(default_factory=list)
    semantic_filter: str | None = Field(None, max_length=500)
    webhook_url: HttpUrl | None = None
    destinations: list[str] | None = None

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: HttpUrl) -> HttpUrl:
        scheme = v.scheme.lower() if v.scheme else ""
        if scheme not in ("http", "https"):
            raise ValueError("Crawl target URL scheme must be http or https")
        return v

    @field_validator("json_schema")
    @classmethod
    def validate_json_schema_size(cls, v: dict | None) -> dict | None:
        if v is None:
            return None
        serialized = json.dumps(v)
        if len(serialized) > 50_000:
            raise ValueError("JSON schema size exceeds maximum limit of 50KB")
        return v

    @field_validator("max_pages")
    @classmethod
    def validate_max_pages(cls, v: int) -> int:
        if v > MAX_SERVER_CRAWL_PAGES:
            raise ValueError(
                f"Requested max_pages ({v}) exceeds server limit of {MAX_SERVER_CRAWL_PAGES}"
            )
        return v

    @field_validator("max_depth")
    @classmethod
    def validate_max_depth(cls, v: int) -> int:
        if v > MAX_SERVER_CRAWL_DEPTH:
            raise ValueError(
                f"Requested max_depth ({v}) exceeds server limit of {MAX_SERVER_CRAWL_DEPTH}"
            )
        return v


class DestinationCreate(BaseModel):
    name: str
    type: Literal["pinecone", "weaviate", "supabase"]
    config: dict


class MapRequest(BaseModel):
    url: HttpUrl
    limit: int = Field(100, ge=1, le=100_000)
    include_sitemap: bool = True
    allow_subdomains: bool = False
    render_js: bool = False
    timeout: int = Field(15, ge=1, le=60)
    proxy: ProxyConfig | None = None

    @field_validator("url")
    @classmethod
    def validate_url_scheme(cls, v: HttpUrl) -> HttpUrl:
        scheme = v.scheme.lower() if v.scheme else ""
        if scheme not in ("http", "https"):
            raise ValueError("Map target URL scheme must be http or https")
        return v


class MapResponse(BaseModel):
    success: bool
    error: str | None = None
    urls: list[str] = []
    count: int = 0
    limit: int = 0
    base_domain: str | None = None
    discovered_via: str | None = None
    latency_ms: int = 0


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    provider: Literal["duckduckgo", "serper"] = "duckduckgo"
    api_key: str | None = Field(None, max_length=500)
    max_results: int = Field(10, ge=1, le=50)
    fetch_content: bool = False
    content_limit: int = Field(3, ge=1, le=10)
    render_js: bool = False
    timeout: int = Field(30, ge=1, le=120)


class SearchResponse(BaseModel):
    success: bool
    error: str | None = None
    query: str
    provider: str
    results: list[dict] = []
    latency_ms: int = 0


class ScheduleCreate(BaseModel):
    cron_expression: str
    payload: dict


class ProxyCreate(BaseModel):
    url: str


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    rate_limit: int = Field(60, ge=1, le=10000, description="Requests per minute")


class ApiKeyResponse(BaseModel):
    key: str
    name: str
    created_at: str
    rate_limit: int = 60


class SchemaGenerateRequest(BaseModel):
    url: HttpUrl
    render_js: bool = False
    llm_provider: Literal["openai", "anthropic", "gemini"] = "openai"
    llm_api_key: str | None = None
    extraction_goal: str | None = None


class SchemaGenerateResponse(BaseModel):
    success: bool
    schema_definition: dict
    suggested_fields: list[dict]
    latency_ms: int = 0
    error: str | None = None


class WebhookTestRequest(BaseModel):
    target_url: HttpUrl
    secret: str | None = None
    custom_payload: dict | None = None


class WebhookTestResponse(BaseModel):
    success: bool
    status_code: int | None = None
    latency_ms: int = 0
    signature_header: str | None = None
    error: str | None = None


class BatchCrawlOptions(BaseModel):
    render_js: bool = False
    output_format: Literal["html", "markdown", "structured", "css"] = "markdown"
    stealth: bool = True
    compress_tokens: bool = False
    webhook_url: HttpUrl | None = None


class BatchCrawlJsonRequest(BaseModel):
    urls: list[str] = Field(..., min_length=1, max_length=1000)
    concurrency: int = Field(5, ge=1, le=50)
    options: BatchCrawlOptions | None = None
    render_js: bool = False
    output_format: str = "markdown"
    webhook_url: HttpUrl | None = None

