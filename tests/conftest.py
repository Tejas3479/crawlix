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
import fetcher


@pytest.fixture(autouse=True)
def mock_redis(monkeypatch):
    fake_redis = FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(fetcher, "redis_client", fake_redis)
    monkeypatch.setattr(app, "redis_client", fake_redis)
    yield fake_redis
