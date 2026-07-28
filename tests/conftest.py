import pytest
from fakeredis import FakeAsyncRedis

import app
import fetcher


@pytest.fixture(autouse=True)
def mock_redis(monkeypatch):
    fake_redis = FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(fetcher, "redis_client", fake_redis)
    monkeypatch.setattr(app, "redis_client", fake_redis)
    yield fake_redis
