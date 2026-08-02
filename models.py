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
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-4o",
    "gpt-4o-mini",
    "o4-mini",
    "o3-pro",
    "o3-mini",
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-3-5-sonnet-20241022",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro",
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
    wait_until: Literal["domcontentloaded", "load", "networkidle"] = (
        "networkidle"
    )
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
    webhook_url: HttpUrl | None = None
    destinations: list[str] | None = None

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


class ScheduleCreate(BaseModel):
    cron_expression: str
    payload: dict


class ProxyCreate(BaseModel):
    url: str
