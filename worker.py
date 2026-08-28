import asyncio
import hashlib
import hmac
import json
import logging
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import httpx

try:
    import openai
except ImportError:
    openai = None
from arq.connections import RedisSettings
from arq.cron import cron
from sqlalchemy import select

from database import (
    BatchJob,
    CrawlJob,
    Destination,
    ProxyManager,
    ScheduledCrawl,
    async_session_maker,
    init_db,
)
from fetcher import is_ssrf_safe, playwright_mgr, run_fetch

logger = logging.getLogger("crawlix.worker")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
WEBHOOK_MAX_RETRIES = int(os.getenv("WEBHOOK_MAX_RETRIES", "3"))


def get_redis_settings() -> RedisSettings:
    parsed = urlparse(REDIS_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    database = int(parsed.path.lstrip("/")) if parsed.path and parsed.path.lstrip("/") else 0
    return RedisSettings(host=host, port=port, database=database)


def _sign_payload(body: bytes, secret: str | None = None) -> str:
    secret = os.getenv("WEBHOOK_SECRET", "") if secret is None else secret
    if not secret:
        return ""
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


async def notify_webhook(webhook_url: str, payload: dict, max_retries: int = WEBHOOK_MAX_RETRIES):
    if not webhook_url:
        return
    try:
        if not await is_ssrf_safe(webhook_url):
            logger.error(f"Webhook URL blocked by SSRF protection: {webhook_url}")
            return

        body = json.dumps(payload, default=str).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if os.getenv("WEBHOOK_SECRET"):
            headers["X-Crawlix-Signature"] = "sha256=" + _sign_payload(body)

        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            for attempt in range(1, max_retries + 1):
                try:
                    resp = await client.post(webhook_url, content=body, headers=headers)
                    if resp.status_code < 400:
                        logger.info(f"Webhook notification sent to {webhook_url}, status: {resp.status_code}")
                        return
                    logger.warning(
                        f"Webhook {webhook_url} returned HTTP {resp.status_code} (attempt {attempt}/{max_retries})."
                    )
                except Exception as e:
                    logger.warning(f"Webhook {webhook_url} send failed (attempt {attempt}/{max_retries}): {e}")
                if attempt < max_retries:
                    await asyncio.sleep(2.0 * (2 ** (attempt - 1)))
            logger.error(f"Webhook {webhook_url} failed after {max_retries} attempts.")
    except Exception as e:
        logger.error(f"Failed to send webhook to {webhook_url}: {e}")

async def process_destinations(results: list, destination_ids: list[str]):
    if not destination_ids or not results:
        return
    async with async_session_maker() as session:
        destinations = []
        for d_id in destination_ids:
            dest = await session.get(Destination, d_id)
            if dest:
                destinations.append(dest)
                
    if not destinations:
        return
        
    logger.info(f"Processing {len(results)} results for {len(destinations)} destinations.")
    
    # Generate embeddings if needed
    embeddings = []
    openai_key = os.getenv("OPENAI_API_KEY")
    
    # Try to prepare text blocks
    texts = [str(r.get("content", ""))[:8000] for r in results if r.get("content")]
    if not texts:
        return
        
    try:
        if openai_key:
            client = openai.AsyncOpenAI(api_key=openai_key)
            resp = await client.embeddings.create(input=texts, model="text-embedding-3-small")
            embeddings = [d.embedding for d in resp.data]
    except Exception as e:
        logger.error(f"Failed to generate embeddings: {e}")
        
    for dest in destinations:
        try:
            if dest.type == "pinecone":
                from pinecone import Pinecone
                pc = Pinecone(api_key=dest.config.get("api_key", ""))
                index = pc.Index(dest.config.get("index_name", ""))
                
                vectors = []
                for i, r in enumerate(results):
                    if i < len(embeddings) and embeddings[i]:
                        vectors.append({
                            "id": f"crawl-{r.get('url', str(i))}",
                            "values": embeddings[i],
                            "metadata": {"url": r.get("url"), "title": r.get("title", "")}
                        })
                if vectors:
                    index.upsert(vectors=vectors)
                    logger.info(f"Pushed {len(vectors)} vectors to Pinecone")
                    
            elif dest.type == "supabase":
                from supabase import create_client
                supabase = create_client(dest.config.get("url", ""), dest.config.get("key", ""))
                table_name = dest.config.get("table_name", "documents")
                
                rows = []
                for i, r in enumerate(results):
                    row = {
                        "content": r.get("content", ""),
                        "metadata": {"url": r.get("url"), "title": r.get("title", "")}
                    }
                    if i < len(embeddings) and embeddings[i]:
                        row["embedding"] = embeddings[i]
                    rows.append(row)
                if rows:
                    supabase.table(table_name).insert(rows).execute()
                    logger.info(f"Pushed {len(rows)} rows to Supabase")
                    
            elif dest.type == "weaviate":
                from urllib.parse import urlparse

                import weaviate
                from weaviate.classes.init import Auth
                
                # Wrap synchronous Weaviate calls to prevent event loop blocking
                def _push_to_weaviate(target_dest, target_results, target_embeddings):
                    raw_url = target_dest.config.get("url", "")
                    api_key = target_dest.config.get("api_key", "")
                    
                    parsed = urlparse(raw_url)
                    host = parsed.hostname or "localhost"
                    port = parsed.port or (443 if parsed.scheme == "https" else 80)
                    is_secure = parsed.scheme == "https"
                    
                    auth_creds = Auth.api_key(api_key) if api_key else None
                    
                    with weaviate.connect_to_custom(
                        http_host=host,
                        http_port=port,
                        http_secure=is_secure,
                        auth_credentials=auth_creds
                    ) as client:
                        class_name = target_dest.config.get("class_name", "Document")
                        collection = client.collections.get(class_name)
                        
                        with collection.batch.dynamic() as batch:
                            for i, r in enumerate(target_results):
                                properties = {
                                    "content": r.get("content", ""),
                                    "url": r.get("url", ""),
                                    "title": r.get("title", "")
                                }
                                vector = target_embeddings[i] if i < len(target_embeddings) and target_embeddings[i] else None
                                if vector:
                                    batch.add_object(properties=properties, vector=vector)
                                else:
                                    batch.add_object(properties=properties)
                
                await asyncio.to_thread(_push_to_weaviate, dest, results, embeddings)
                logger.info("Pushed rows to Weaviate (v4 API)")
                    
        except Exception as e:
            logger.error(f"Destination push failed for {dest.name}: {e}")

async def run_scheduled_crawls_cron(ctx: dict):
    await init_db()
    from croniter import croniter
    now = datetime.now(timezone.utc)
    
    async with async_session_maker() as session:
        result = await session.execute(select(ScheduledCrawl).where(ScheduledCrawl.status == "active"))
        schedules = result.scalars().all()
        
        for sched in schedules:
            if not croniter.is_valid(sched.cron_expression):
                continue
                
            cron_obj = croniter(sched.cron_expression, now)
            # If next_run_at is None, set it
            if not sched.next_run_at:
                sched.next_run_at = cron_obj.get_next(datetime)
                session.add(sched)
                continue
                
            if now >= sched.next_run_at:
                # Time to run
                logger.info(f"Triggering scheduled crawl {sched.id}")
                
                # Spawn job
                payload = sched.payload or {}
                url = payload.get("url")
                if url:
                    job = CrawlJob(
                        url=url,
                        max_pages=payload.get("max_pages", 1),
                        max_depth=payload.get("max_depth", 1),
                        render_js=payload.get("render_js", False),
                        output_format=payload.get("output_format", "html"),
                        webhook_url=payload.get("webhook_url"),
                        destinations=payload.get("destinations", [])
                    )
                    session.add(job)
                    await session.commit()
                    
                    redis_pool = ctx.get("redis")
                    if redis_pool:
                        await redis_pool.enqueue_job(
                            "run_crawl_task",
                            job.id,
                            url,
                            job.max_pages,
                            job.max_depth,
                            job.render_js,
                            job.output_format,
                            payload.get("strip_links", False),
                            payload.get("css_selector"),
                            payload.get("limit_domain", False),
                            payload.get("actions"),
                            payload.get("extraction_prompt"),
                            payload.get("stealth", False),
                            job.webhook_url,
                            payload.get("respect_robots", True),
                            payload.get("json_schema")
                        )
                
                # Update next run time
                sched.next_run_at = cron_obj.get_next(datetime)
                session.add(sched)
                
        await session.commit()

async def run_crawl_task(
    ctx: dict,
    crawl_id: str,
    seed_url: str,
    max_pages: int,
    max_depth: int,
    render_js: bool,
    output_format: str,
    strip_links: bool,
    css_selector: str | None,
    limit_domain: bool,
    actions: list | None,
    extraction_prompt: str | None = None,
    stealth: bool = False,
    webhook_url: str | None = None,
    respect_robots: bool = True,
    json_schema: dict | None = None
):
    from fetcher import crawl_manager
    logger.info(f"ARQ Worker starting crawl job {crawl_id} for URL {seed_url}")
    await init_db()

    try:
        await crawl_manager._run_crawl(
            crawl_id=crawl_id,
            seed_url=seed_url,
            max_pages=max_pages,
            max_depth=max_depth,
            render_js=render_js,
            output_format=output_format,
            strip_links=strip_links,
            css_selector=css_selector,
            limit_domain=limit_domain,
            actions=actions,
            extraction_prompt=extraction_prompt,
            stealth=stealth,
            webhook_url=webhook_url,
            respect_robots=respect_robots,
            json_schema=json_schema
        )

        # Fetch completed job and trigger webhook / destinations
        async with async_session_maker() as session:
            completed_job = await session.get(CrawlJob, crawl_id)
            if completed_job:
                if completed_job.destinations and completed_job.results:
                    await process_destinations(completed_job.results, completed_job.destinations)
                    
                if completed_job.webhook_url:
                    await notify_webhook(completed_job.webhook_url, completed_job.model_dump())

    except Exception as e:
        logger.error(f"ARQ crawl task {crawl_id} failed: {e}")
        await crawl_manager._update_job_state(crawl_id, [], 0, status="failed", error_message=str(e))
        if webhook_url:
            await notify_webhook(webhook_url, {"crawl_id": crawl_id, "status": "failed", "error": str(e)})


async def run_batch_crawl_task(
    ctx: dict,
    batch_id: str,
    urls: list[str],
    render_js: bool,
    output_format: str,
    webhook_url: str | None = None
):
    logger.info(f"ARQ Worker starting batch job {batch_id} with {len(urls)} URLs")
    await init_db()

    os.makedirs("data/exports", exist_ok=True)
    export_path = f"data/exports/batch_{batch_id}.json"

    async with async_session_maker() as session:
        batch = await session.get(BatchJob, batch_id)
        if batch:
            batch.status = "processing"
            session.add(batch)
            await session.commit()

    aggregated_results = []
    processed_count = 0

    for url in urls:
        proxy_url = await ProxyManager.get_proxy()
        try:
            res = await run_fetch(
                url=url,
                method="GET",
                headers={},
                cookies={},
                body=None,
                json_body=None,
                session=None,
                render_js=render_js,
                scroll=True,
                proxy_url=proxy_url,
                max_retries=1,
                timeout=20,
                impersonate="chrome120",
                playwright_mgr=playwright_mgr,
                output_format=output_format,
                strip_links=False,
                llm_api_key=None,
                llm_provider="openai" if os.getenv("OPENAI_API_KEY") else "gemini",
                json_schema=None
            )
            processed_count += 1
            item = {
                "url": url,
                "status_code": res.get("status_code", 0),
                "content": res.get("content", ""),
                "error": res.get("error")
            }
            aggregated_results.append(item)
        except Exception as e:
            processed_count += 1
            aggregated_results.append({"url": url, "error": str(e)})

        async with async_session_maker() as session:
            batch = await session.get(BatchJob, batch_id)
            if batch:
                batch.processed_urls = processed_count
                session.add(batch)
                await session.commit()

    def _write_export():
        with open(export_path, "w", encoding="utf-8") as f:
            json.dump(aggregated_results, f, indent=2)
            
    await asyncio.to_thread(_write_export)

    async with async_session_maker() as session:
        batch = await session.get(BatchJob, batch_id)
        if batch:
            batch.status = "completed"
            batch.completed_at = datetime.now(timezone.utc)
            batch.export_path = export_path
            session.add(batch)
            await session.commit()

    if webhook_url:
        await notify_webhook(webhook_url, {
            "batch_id": batch_id,
            "status": "completed",
            "total_urls": len(urls),
            "export_path": export_path,
            "results": aggregated_results
        })

async def run_web_monitors_cron(ctx: dict):
    from croniter import croniter

    from database import WebMonitor
    from services.content import compute_content_diff

    await init_db()
    now = datetime.now(timezone.utc)

    async with async_session_maker() as session:
        result = await session.execute(select(WebMonitor).where(WebMonitor.status == "active"))
        monitors = result.scalars().all()

        for monitor in monitors:
            if not croniter.is_valid(monitor.cron_expression):
                continue

            cron_obj = croniter(monitor.cron_expression, now)
            if not monitor.next_run_at:
                monitor.next_run_at = cron_obj.get_next(datetime)
                session.add(monitor)
                continue

            if now >= monitor.next_run_at:
                logger.info(f"Checking web monitor {monitor.id} for {monitor.url}")
                try:
                    fetch_res = await run_fetch(
                        url=monitor.url,
                        method="GET",
                        output_format="markdown",
                        css_selector=monitor.css_selector,
                        timeout=25,
                        bypass_cache=True,
                    )
                    current_content = str(fetch_res.get("content") or "")
                    current_hash = hashlib.sha256(current_content.encode("utf-8")).hexdigest()

                    has_changed = False
                    diff_info = {}
                    if monitor.last_content_hash and monitor.last_content_hash != current_hash:
                        has_changed = True
                        diff_info = compute_content_diff(monitor.last_snapshot or "", current_content)

                    monitor.last_content_hash = current_hash
                    monitor.last_snapshot = current_content[:20000]
                    monitor.total_checks += 1
                    if has_changed:
                        monitor.change_count += 1
                        if monitor.webhook_url:
                            await notify_webhook(monitor.webhook_url, {
                                "event": "monitor.change_detected",
                                "monitor_id": monitor.id,
                                "url": monitor.url,
                                "diff": diff_info,
                                "timestamp": datetime.now(timezone.utc).isoformat()
                            })
                except Exception as e:
                    logger.error(f"Failed checking monitor {monitor.id}: {e}")

                monitor.next_run_at = cron_obj.get_next(datetime)
                session.add(monitor)

        await session.commit()


async def startup(ctx):
    await init_db()
    logger.info("ARQ Worker initialized.")

async def shutdown(ctx):
    await playwright_mgr.close()
    logger.info("ARQ Worker shutdown.")

class WorkerSettings:
    functions: list = [run_crawl_task, run_batch_crawl_task]  # noqa: RUF012
    cron_jobs: list = [  # noqa: RUF012
        cron(run_scheduled_crawls_cron, minute=None),
        cron(run_web_monitors_cron, minute=None),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = get_redis_settings()
    max_jobs = 10
