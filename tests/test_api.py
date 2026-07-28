import os

import httpx
import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)

# We will use pytest-asyncio for async httpx tests
# But for now, we'll configure pytest-asyncio to handle our tests.

@pytest.fixture(autouse=True)
def setup_env():
    os.environ["API_KEYS"] = "test-key"
    os.environ["DISABLE_SSRF_CHECK"] = "true"
    yield
    if "API_KEYS" in os.environ:
        del os.environ["API_KEYS"]
    if "DISABLE_SSRF_CHECK" in os.environ:
        del os.environ["DISABLE_SSRF_CHECK"]

@pytest.fixture
async def async_client():
    from app import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

@pytest.mark.asyncio
async def test_curl_cffi_basic_fetch(async_client):
    headers = {"x-api-key": "test-key"}
    payload = {"url": "https://example.com", "output_format": "html", "render_js": False}
    
    response = await async_client.post("/fetch", headers=headers, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["status_code"] == 200
    assert "Example Domain" in data["content"]

@pytest.mark.asyncio
async def test_markdown_output_clean(async_client):
    headers = {"x-api-key": "test-key"}
    payload = {"url": "https://example.com", "output_format": "markdown", "render_js": False}
    
    response = await async_client.post("/fetch", headers=headers, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    content = data["content"]
    assert "<script" not in content
    assert "<style" not in content
    assert len(content.strip()) > 0

@pytest.mark.skip(reason="httpbin.org is currently flaky with 503 errors")
@pytest.mark.asyncio
async def test_session_cookie_persistence(async_client):
    headers = {"x-api-key": "test-key"}
    p1 = {
        "url": "https://httpbin.org/cookies/set?fetchtest=hello123",
        "session_id": "verify-session-001",
        "output_format": "html"
    }
    r1 = await async_client.post("/fetch", headers=headers, json=p1)
    assert r1.status_code == 200
    
    p2 = {
        "url": "https://httpbin.org/cookies",
        "session_id": "verify-session-001",
        "output_format": "html"
    }
    r2 = await async_client.post("/fetch", headers=headers, json=p2)
    assert r2.status_code == 200
    data = r2.json()
    assert "hello123" in data.get("content", "")

@pytest.mark.asyncio
async def test_session_list_and_delete(async_client):
    headers = {"x-api-key": "test-key"}
    # List
    r1 = await async_client.get("/api/sessions", headers=headers)
    assert r1.status_code == 200
    sessions = r1.json()
    assert isinstance(sessions, list)
    
    # Assuming verify-session-001 exists from previous test
    session_ids = [s["session_id"] for s in sessions]
    if "verify-session-001" in session_ids:
        r2 = await async_client.delete("/api/sessions/verify-session-001", headers=headers)
        assert r2.status_code == 200
        
        r3 = await async_client.get("/api/sessions", headers=headers)
        session_ids_after = [s["session_id"] for s in r3.json()]
        assert "verify-session-001" not in session_ids_after
