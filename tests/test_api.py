import os
import sys
from unittest.mock import MagicMock, patch

os.environ["AUTH_DISABLED"] = "true"

import httpx
import pytest
from fastapi.testclient import TestClient

from app import app
from database import init_db

client = TestClient(app)



@pytest.fixture(autouse=True)
async def setup_env():
    os.environ["API_KEYS"] = "test-key"
    os.environ["DISABLE_SSRF_CHECK"] = "true"
    await init_db()
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

@pytest.mark.asyncio
async def test_batch_crawl_creation(async_client):
    headers = {"x-api-key": "test-key"}
    csv_data = "url\nhttps://example.com\nhttps://example.org\n"
    files = {"file": ("test.csv", csv_data.encode("utf-8"), "text/csv")}
    
    r = await async_client.post("/api/crawl/batch", headers=headers, files=files)
    assert r.status_code == 200
    data = r.json()
    assert "batch_id" in data
    assert data["total_urls"] == 2
    assert data["status"] == "processing"


@pytest.mark.asyncio
async def test_batch_crawl_json_creation(async_client):
    headers = {"x-api-key": "test-key"}
    payload = {
        "urls": ["https://example.com", "https://example.org/docs"],
        "concurrency": 3,
        "options": {"render_js": False, "output_format": "markdown"}
    }
    
    r = await async_client.post("/api/batch", headers=headers, json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "batch_id" in data
    assert data["total_urls"] == 2
    assert data["status"] == "processing"


@pytest.mark.asyncio
async def test_crawl_lifecycle(async_client):
    headers = {"x-api-key": "test-key"}
    # 1. Start crawl
    payload = {"url": "https://example.com", "max_pages": 5, "max_depth": 2}
    r_create = await async_client.post("/api/crawl", headers=headers, json=payload)
    assert r_create.status_code == 200
    data_create = r_create.json()
    assert "crawl_id" in data_create
    assert data_create["status"] == "running"
    crawl_id = data_create["crawl_id"]

    # 2. Get crawl details
    r_get = await async_client.get(f"/api/crawl/{crawl_id}", headers=headers)
    assert r_get.status_code == 200
    data_get = r_get.json()
    assert data_get["id"] == crawl_id
    assert data_get["url"] == "https://example.com/"

    # 3. List crawls
    r_list = await async_client.get("/api/crawl", headers=headers)
    assert r_list.status_code == 200
    crawls = r_list.json()
    assert any(
        c.get("crawl_id") == crawl_id or c.get("id") == crawl_id for c in crawls
    )

    # 4. Delete crawl
    r_delete = await async_client.delete(f"/api/crawl/{crawl_id}", headers=headers)
    assert r_delete.status_code == 200
    assert r_delete.json() == {"deleted": True, "crawl_id": crawl_id}

    # 5. Get deleted crawl -> 404
    r_get_deleted = await async_client.get(f"/api/crawl/{crawl_id}", headers=headers)
    assert r_get_deleted.status_code == 404

    # 6. Delete non-existent crawl -> 404
    r_delete_fake = await async_client.delete("/api/crawl/fake-id-9999", headers=headers)
    assert r_delete_fake.status_code == 404


@pytest.mark.asyncio
async def test_schedule_cron(async_client):
    headers = {"x-api-key": "test-key"}

    # 1. Create valid schedule
    valid_payload = {
        "cron_expression": "*/5 * * * *",
        "payload": {"url": "https://example.com", "max_pages": 10},
    }
    r_create = await async_client.post(
        "/api/schedule", headers=headers, json=valid_payload
    )
    assert r_create.status_code == 200
    data_create = r_create.json()
    assert "id" in data_create
    assert data_create["cron_expression"] == "*/5 * * * *"
    sched_id = data_create["id"]

    # 2. Create invalid schedule -> 400
    invalid_payload = {
        "cron_expression": "invalid-cron-expr",
        "payload": {"url": "https://example.com"},
    }
    r_invalid = await async_client.post(
        "/api/schedule", headers=headers, json=invalid_payload
    )
    assert r_invalid.status_code == 400
    assert r_invalid.json()["detail"] == "Invalid cron expression"

    # 3. List schedules
    r_list = await async_client.get("/api/schedule", headers=headers)
    assert r_list.status_code == 200
    schedules = r_list.json()
    assert any(s["id"] == sched_id for s in schedules)

    # 4. Delete schedule
    r_delete = await async_client.delete(f"/api/schedule/{sched_id}", headers=headers)
    assert r_delete.status_code == 200
    assert r_delete.json() == {"deleted": True, "id": sched_id}

    # 5. Delete non-existent schedule -> 404
    r_delete_fake = await async_client.delete(
        "/api/schedule/fake-schedule-id-9999", headers=headers
    )
    assert r_delete_fake.status_code == 404


@pytest.mark.asyncio
async def test_destination_push_mocked(async_client):
    headers = {"x-api-key": "test-key"}

    # 1. Create a Pinecone destination via API
    payload = {
        "name": "test-pinecone-dest",
        "type": "pinecone",
        "config": {"api_key": "fake-pc-key", "index_name": "test-idx"},
    }
    r_create = await async_client.post(
        "/api/destinations", headers=headers, json=payload
    )
    assert r_create.status_code == 200
    dest_data = r_create.json()
    dest_id = dest_data["id"]
    assert dest_data["name"] == "test-pinecone-dest"
    assert dest_data["type"] == "pinecone"

    # 2. List destinations
    r_list = await async_client.get("/api/destinations", headers=headers)
    assert r_list.status_code == 200
    destinations = r_list.json()
    assert any(d["id"] == dest_id for d in destinations)

    # 3. Test destination push (mocked) in worker.py
    from worker import process_destinations

    mock_pc_instance = MagicMock()
    mock_index = MagicMock()
    mock_pc_instance.Index.return_value = mock_index
    mock_pinecone_mod = MagicMock()
    mock_pinecone_mod.Pinecone.return_value = mock_pc_instance

    with (
        patch.dict(sys.modules, {"pinecone": mock_pinecone_mod}),
        patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test-123"}),
        patch("openai.AsyncOpenAI") as mock_openai_cls,
    ):
        mock_openai_client = MagicMock()
        mock_openai_cls.return_value = mock_openai_client
        mock_embed_resp = MagicMock()
        mock_embed_item = MagicMock()
        mock_embed_item.embedding = [0.1, 0.2, 0.3]
        mock_embed_resp.data = [mock_embed_item]

        async def fake_embed_create(*args, **kwargs):
            return mock_embed_resp

        mock_openai_client.embeddings.create = fake_embed_create

        results = [
            {
                "url": "https://example.com/page1",
                "content": "This is page 1 content",
                "title": "Page 1",
            }
        ]

        await process_destinations(results, [dest_id])

        mock_pc_instance.Index.assert_called_once_with("test-idx")
        mock_index.upsert.assert_called_once()
        upsert_kwargs = mock_index.upsert.call_args.kwargs
        vectors = (
            upsert_kwargs.get("vectors")
            or mock_index.upsert.call_args[1].get("vectors")
            or mock_index.upsert.call_args[0][0]
        )
        assert len(vectors) == 1
        assert vectors[0]["id"] == "crawl-https://example.com/page1"
        assert vectors[0]["metadata"]["url"] == "https://example.com/page1"

    # 4. Delete destination via API
    r_del = await async_client.delete(f"/api/destinations/{dest_id}", headers=headers)
    assert r_del.status_code == 200
    assert r_del.json() == {"deleted": True, "id": dest_id}

    # 5. Verify deleting non-existent destination -> 404
    r_del_fake = await async_client.delete(
        "/api/destinations/fake-dest-id-999", headers=headers
    )
    assert r_del_fake.status_code == 404


@pytest.mark.asyncio
async def test_proxy_routes(async_client):
    headers = {"x-api-key": "test-key"}
    proxy_url = "http://user:pass@10.0.0.1:8080"

    # 1. Add proxy
    r_add = await async_client.post(
        "/api/proxies", headers=headers, json={"url": proxy_url}
    )
    assert r_add.status_code == 200
    data_add = r_add.json()
    assert data_add["status"] == "added"
    assert "id" in data_add
    proxy_id = data_add["id"]

    # 2. Add same proxy again -> already_exists
    r_add_dup = await async_client.post(
        "/api/proxies", headers=headers, json={"url": proxy_url}
    )
    assert r_add_dup.status_code == 200
    data_dup = r_add_dup.json()
    assert data_dup["status"] == "already_exists"
    assert data_dup["id"] == proxy_id

    # 3. List proxies
    r_list = await async_client.get("/api/proxies", headers=headers)
    assert r_list.status_code == 200
    proxies = r_list.json()
    assert isinstance(proxies, list)
    matching = [p for p in proxies if p["id"] == proxy_id]
    assert len(matching) == 1
    assert matching[0]["url"] == proxy_url
    assert matching[0]["is_active"] is True
    assert matching[0]["fail_count"] == 0


@pytest.mark.asyncio
async def test_auth_modes(async_client):
    # Mode 1: x-api-key header
    r_header = await async_client.get(
        "/api/destinations", headers={"x-api-key": "test-key"}
    )
    assert r_header.status_code == 200

    # Mode 2: Authorization Bearer header
    r_bearer = await async_client.get(
        "/api/destinations", headers={"Authorization": "Bearer test-key"}
    )
    assert r_bearer.status_code == 200

    # Mode 3: Database-backed API key
    from database import ApiKey, async_session_maker

    async with async_session_maker() as session:
        session.add(ApiKey(key="db-test-key-001", label="test db key"))
        await session.commit()

    r_db_key = await async_client.get(
        "/api/destinations", headers={"x-api-key": "db-test-key-001"}
    )
    assert r_db_key.status_code == 200

    r_db_bearer = await async_client.get(
        "/api/destinations",
        headers={"Authorization": "Bearer db-test-key-001"},
    )
    assert r_db_bearer.status_code == 200

    # Mode 4: Missing or invalid API key -> 401
    r_missing = await async_client.get("/api/destinations")
    assert r_missing.status_code == 401
    assert r_missing.json()["detail"] == "Invalid or missing API key"

    r_invalid = await async_client.get(
        "/api/destinations", headers={"x-api-key": "wrong-key-999"}
    )
    assert r_invalid.status_code == 401
    assert r_invalid.json()["detail"] == "Invalid or missing API key"

    # Mode 5: AUTH_DISABLED=true with empty VALID_KEYS and no DB keys
    from sqlalchemy import delete

    import auth

    async with async_session_maker() as session:
        await session.execute(delete(ApiKey))
        await session.commit()

    with (
        patch.object(auth, "VALID_KEYS", set()),
        patch.dict(os.environ, {"AUTH_DISABLED": "true"}),
    ):
        r_disabled = await async_client.get("/api/destinations")
        assert r_disabled.status_code == 200


