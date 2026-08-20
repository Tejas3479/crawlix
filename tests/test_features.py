import asyncio
import os
from unittest.mock import patch

os.environ["AUTH_DISABLED"] = "true"

import httpx
import pytest

from app import app
from services.cache import cache_get, cache_key, cache_set
from services.content import _validate_against_schema, process_content


@pytest.fixture(autouse=True)
async def setup_env():
    os.environ["API_KEYS"] = "test-key"
    os.environ["DISABLE_SSRF_CHECK"] = "true"
    from database import init_db

    await init_db()
    yield
    if "API_KEYS" in os.environ:
        del os.environ["API_KEYS"]
    if "DISABLE_SSRF_CHECK" in os.environ:
        del os.environ["DISABLE_SSRF_CHECK"]


@pytest.fixture
async def async_client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------- CSS selector extraction (no-LLM) ----------

SAMPLE_HTML = """
<html><body>
  <div class="product"><h2>Widget A</h2><span class="price">$10.99</span><a href="/a">buy</a></div>
  <div class="product"><h2>Widget B</h2><span class="price">$20.00</span><a href="/b">buy</a></div>
</body></html>
"""

CSS_SCHEMA = {
    "name": "Products",
    "baseSelector": "div.product",
    "fields": [
        {"name": "title", "selector": "h2", "type": "text"},
        {"name": "price", "selector": ".price", "type": "text", "transform": "strip"},
        {"name": "link", "selector": "a", "type": "attribute", "attribute": "href"},
    ],
}


def test_css_extraction_matches_items():
    result = asyncio.run(process_content(SAMPLE_HTML, "css", "https://example.com", json_schema=CSS_SCHEMA))
    assert isinstance(result, list)
    assert len(result) == 2
    assert result[0]["title"] == "Widget A"
    assert result[0]["price"] == "$10.99"
    assert result[0]["link"] == "/a"


def test_css_extraction_single_object_without_base_selector():
    schema = {
        "fields": [
            {"name": "title", "selector": "h2", "type": "text"},
        ]
    }
    result = asyncio.run(process_content(SAMPLE_HTML, "css", "https://example.com", json_schema=schema))
    assert isinstance(result, dict)
    assert result["title"] == "Widget A"


def test_css_extraction_no_match_returns_error():
    schema = {"baseSelector": "div.nonexistent", "fields": [{"name": "x", "selector": "h2", "type": "text"}]}
    result = asyncio.run(process_content(SAMPLE_HTML, "css", "https://example.com", json_schema=schema))
    assert isinstance(result, dict)
    assert result.get("error") == "css_extraction_failed"


# ---------- Schema validator ----------

def test_validate_schema_valid_and_invalid():
    schema = {
        "type": "object",
        "properties": {"title": {"type": "string"}, "count": {"type": "integer"}},
        "required": ["title"],
    }
    assert _validate_against_schema({"title": "ok", "count": 3}, schema) == []
    errors = _validate_against_schema({"count": "not-an-int"}, schema)
    assert any("title" in e for e in errors)
    assert any("integer" in e for e in errors)


def test_validate_schema_enum():
    schema = {"type": "string", "enum": ["a", "b"]}
    assert _validate_against_schema("a", schema) == []
    assert len(_validate_against_schema("c", schema)) == 1


# ---------- Cache layer ----------

def test_cache_key_is_stable_and_distinct():
    a = cache_key("https://x.com", "GET", False, "markdown", False, None, None, None, "openai", None)
    b = cache_key("https://x.com", "GET", False, "markdown", False, None, None, None, "openai", None)
    c = cache_key("https://x.com", "GET", True, "markdown", False, None, None, None, "openai", None)
    assert a == b
    assert a != c


@pytest.mark.asyncio
async def test_cache_roundtrip():
    key = cache_key("https://cache-test.example", "GET", False, "html", False, None, None, None, "openai", None)
    await cache_set(key, {"content": "hello", "cache_hit": False})
    cached = await cache_get(key)
    assert cached == {"content": "hello", "cache_hit": False}


# ---------- /api/map ----------

@pytest.mark.asyncio
async def test_map_endpoint(async_client):
    fake = {
        "success": True,
        "urls": ["https://example.com/", "https://example.com/about"],
        "count": 2,
        "limit": 100,
        "base_domain": "example.com",
        "discovered_via": "link",
    }
    with patch("routers.map.map_site", return_value=fake) as mocked:
        resp = await async_client.post(
            "/api/map",
            headers={"x-api-key": "test-key"},
            json={"url": "https://example.com", "limit": 100},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert len(data["urls"]) == 2
    assert data["count"] == 2
    mocked.assert_awaited_once()


# ---------- /api/search ----------

@pytest.mark.asyncio
async def test_search_endpoint(async_client):
    fake_results = [
        {"title": "Example", "url": "https://example.com", "snippet": "An example site"},
    ]
    async def fake_search(*args, **kwargs):
        return {"success": True, "query": kwargs.get("query"), "provider": "duckduckgo", "results": fake_results}

    with patch("routers.search.search", new=fake_search):
        resp = await async_client.post(
            "/api/search",
            headers={"x-api-key": "test-key"},
            json={"query": "example domain", "max_results": 5},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert len(data["results"]) == 1
    assert data["results"][0]["url"] == "https://example.com"


# ---------- MCP ----------

@pytest.mark.asyncio
async def test_mcp_initialize(async_client):
    resp = await async_client.post(
        "/mcp",
        headers={"x-api-key": "test-key"},
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"]["serverInfo"]["name"] == "crawlix"
    assert "tools" in data["result"]["capabilities"]


@pytest.mark.asyncio
async def test_mcp_tools_list(async_client):
    resp = await async_client.post(
        "/mcp",
        headers={"x-api-key": "test-key"},
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    )
    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()["result"]["tools"]}
    assert {"scrape", "map", "crawl", "get_crawl", "search"} <= names


@pytest.mark.asyncio
async def test_mcp_tools_call_scrape(async_client):
    fake = {
        "final_url": "https://example.com",
        "status_code": 200,
        "content": "# Hello",
        "error": None,
        "error_message": None,
    }
    with patch("routers.mcp.run_fetch", return_value=fake) as mocked:
        resp = await async_client.post(
            "/mcp",
            headers={"x-api-key": "test-key"},
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "scrape", "arguments": {"url": "https://example.com", "output_format": "markdown"}},
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["result"]["isError"] is False
    assert "# Hello" in data["result"]["content"][0]["text"]
    mocked.assert_awaited_once()


@pytest.mark.asyncio
async def test_mcp_unknown_method(async_client):
    resp = await async_client.post(
        "/mcp",
        headers={"x-api-key": "test-key"},
        json={"jsonrpc": "2.0", "id": 4, "method": "nope"},
    )
    assert resp.status_code == 200
    assert resp.json()["error"]["code"] == -32601


# ---------- Webhook signing ----------

def test_webhook_signature_hmac():
    from worker import _sign_payload

    with patch.dict(os.environ, {"WEBHOOK_SECRET": "test-secret"}):
        sig = _sign_payload(b'{"a": 1}')
    assert isinstance(sig, str) and len(sig) == 64


@pytest.mark.asyncio
async def test_notify_webhook_retries_then_succeeds():
    from worker import notify_webhook

    calls = {"count": 0}

    class FakeResponse:
        status_code = 500

    async def fake_post(self, *args, **kwargs):
        calls["count"] += 1
        if calls["count"] < 3:
            return FakeResponse()
        r = FakeResponse()
        r.status_code = 200
        return r

    with (
        patch("worker.is_ssrf_safe", return_value=True),
        patch("httpx.AsyncClient.post", new=fake_post),
    ):
        await notify_webhook("https://hooks.example/webhook", {"a": 1}, max_retries=3)

    assert calls["count"] == 3


@pytest.mark.asyncio
async def test_notify_webhook_sends_signature_header():
    from worker import _sign_payload, notify_webhook

    captured = {}

    async def fake_post(self, url, content=None, headers=None, **kwargs):
        captured["headers"] = headers
        captured["body"] = content
        r = type("R", (), {"status_code": 200})()
        return r

    with (
        patch("worker.is_ssrf_safe", return_value=True),
        patch.dict(os.environ, {"WEBHOOK_SECRET": "test-secret"}),
        patch("httpx.AsyncClient.post", new=fake_post),
    ):
        await notify_webhook("https://hooks.example/webhook", {"a": 1}, max_retries=1)
        expected = "sha256=" + _sign_payload(captured["body"])

    assert captured["headers"]["X-Crawlix-Signature"] == expected


@pytest.mark.asyncio
async def test_robots_parser_loading():
    from services.crawl_manager import load_robot_parser

    html = "User-agent: *\nDisallow: /private/\n"
    resp = type("R", (), {"status_code": 200, "text": html})()
    with (
        patch("services.crawl_manager.is_ssrf_safe", return_value=True),
        patch("services.crawl_manager.AsyncSession") as mock_session_cls,
    ):
        instance = mock_session_cls.return_value.__aenter__.return_value
        instance.get.return_value = resp
        parser = await load_robot_parser("https://example.com")

    assert parser is not None
    assert parser.can_fetch("*", "https://example.com/private/x") is False
    assert parser.can_fetch("*", "https://example.com/public") is True