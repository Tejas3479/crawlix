import os

import pytest

test_db = "data/test_crawlix.db"
if os.path.exists(test_db):
    try:
        os.remove(test_db)
    except Exception:
        pass
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{test_db}"

from fakeredis import FakeAsyncRedis

import app


@pytest.fixture(autouse=True)
def mock_redis(monkeypatch):
    fake_redis = FakeAsyncRedis(decode_responses=True)
    # Patch the single source and every module that imported the reference
    import services.session_manager
    monkeypatch.setattr(services.session_manager, "redis_client", fake_redis)
    monkeypatch.setattr(app, "redis_client", fake_redis)
    import routers.health
    monkeypatch.setattr(routers.health, "redis_client", fake_redis)
    yield fake_redis
