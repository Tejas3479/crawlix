import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import JSON, Column, Field, SQLModel, String

# Retrieve DATABASE_URL from env, default to local SQLite
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///data/crawlix.db")

engine = create_async_engine(DATABASE_URL, echo=False)
async_session_maker = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

async def init_db():
    if "sqlite" in DATABASE_URL:
        db_path = DATABASE_URL.split(":///")[-1]
        if ("/" in db_path or "\\" in db_path) and not db_path.startswith(":memory:"):
            dir_name = os.path.dirname(db_path)
            if dir_name:
                os.makedirs(dir_name, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

async def get_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session

class CrawlJob(SQLModel, table=True):  # type: ignore[call-arg]
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    url: str
    status: str = Field(default="pending")  # pending, running, completed, failed, interrupted
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    results: list[dict[str, Any]] = Field(default=[], sa_column=Column(JSON))
    stats: dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    error_message: str | None = None
    
    # Configuration metadata
    max_pages: int = 1
    max_depth: int = 1
    render_js: bool = False
    output_format: str = "html"
    webhook_url: str | None = None
    destinations: list[str] = Field(default=[], sa_column=Column(JSON))

class Destination(SQLModel, table=True):  # type: ignore[call-arg]
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    name: str
    type: str  # pinecone, weaviate, supabase
    config: dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ScheduledCrawl(SQLModel, table=True):  # type: ignore[call-arg]
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    cron_expression: str
    payload: dict[str, Any] = Field(default={}, sa_column=Column(JSON))
    next_run_at: datetime | None = None
    status: str = Field(default="active")  # active, paused
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BatchJob(SQLModel, table=True):  # type: ignore[call-arg]
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    status: str = Field(default="pending")  # pending, processing, completed, failed
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    total_urls: int = 0
    processed_urls: int = 0
    webhook_url: str | None = None
    export_path: str | None = None
    error_message: str | None = None

class ApiKey(SQLModel, table=True):  # type: ignore[call-arg]
    key: str = Field(primary_key=True)
    name: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Proxy(SQLModel, table=True):  # type: ignore[call-arg]
    id: int | None = Field(default=None, primary_key=True)
    url: str = Field(sa_column=Column("url", String, unique=True))
    is_active: bool = Field(default=True)
    fail_count: int = Field(default=0)
    last_used_at: datetime | None = None


class ProxyManager:
    @staticmethod
    async def get_proxy() -> str | None:
        async with async_session_maker() as session:
            # Get the least recently used, active proxy
            result = await session.execute(
                select(Proxy)
                .where(Proxy.is_active == True)
                .order_by(Proxy.last_used_at.asc().nullsfirst())  # type: ignore[union-attr]
                .limit(1)
            )
            proxy = result.scalars().first()
            if not proxy:
                return None
            
            # Update last used
            proxy.last_used_at = datetime.now(timezone.utc)
            session.add(proxy)
            await session.commit()
            
            return proxy.url

    @staticmethod
    async def report_failure(url: str):
        async with async_session_maker() as session:
            result = await session.execute(select(Proxy).where(Proxy.url == url))
            proxy = result.scalars().first()
            if proxy:
                proxy.fail_count += 1
                if proxy.fail_count >= 3:
                    proxy.is_active = False
                session.add(proxy)
                await session.commit()
                
    @staticmethod
    async def report_success(url: str):
        async with async_session_maker() as session:
            result = await session.execute(select(Proxy).where(Proxy.url == url))
            proxy = result.scalars().first()
            if proxy and proxy.fail_count > 0:
                proxy.fail_count = 0
                session.add(proxy)
                await session.commit()
