import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import httpx
from arq.connections import RedisSettings
from bs4 import BeautifulSoup

from database import BatchJob, CrawlJob, ProxyManager, async_session_maker, init_db
from fetcher import extract_links, playwright_mgr, run_fetch

logger = logging.getLogger("crawlix.worker")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

def get_redis_settings() -> RedisSettings:
    parsed = urlparse(REDIS_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    database = int(parsed.path.lstrip("/")) if parsed.path and parsed.path.lstrip("/") else 0
    return RedisSettings(host=host, port=port, database=database)

async def notify_webhook(webhook_url: str, payload: dict):
    if not webhook_url:
        return
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(webhook_url, json=payload)
            logger.info(f"Webhook notification sent to {webhook_url}, status: {resp.status_code}")
    except Exception as e:
        logger.error(f"Failed to send webhook to {webhook_url}: {e}")

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
    webhook_url: str | None = None
):
    logger.info(f"ARQ Worker starting crawl job {crawl_id} for URL {seed_url}")
    await init_db()

    queue: list[tuple[str, int]] = [(seed_url, 0)]
    visited: set[str] = set()
    crawled_count = 0
    base_domain = urlparse(seed_url).netloc

    CONCURRENCY = 3
    semaphore = asyncio.Semaphore(CONCURRENCY)
    lock = asyncio.Lock()
    active_tasks: set[asyncio.Task] = set()

    async def update_job_state(results: list, count: int, status: str | None = None, error_msg: str | None = None):
        async with async_session_maker() as session:
            job = await session.get(CrawlJob, crawl_id)
            if not job:
                return
            new_results = list(job.results) if job.results else []
            new_results.extend(results)
            job.results = new_results

            new_stats = dict(job.stats) if job.stats else {}
            new_stats["pages_crawled"] = count
            job.stats = new_stats

            if status:
                job.status = status
                if status in ("completed", "failed", "interrupted"):
                    job.completed_at = datetime.now(timezone.utc)
            if error_msg:
                job.error_message = error_msg

            session.add(job)
            await session.commit()

    async def crawl_worker(url: str, depth: int):
        nonlocal crawled_count
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
                strip_links=strip_links,
                llm_api_key=None,
                llm_provider="openai" if os.getenv("OPENAI_API_KEY") else "gemini",
                json_schema=None,
                css_selector=css_selector,
                actions=actions,
                extraction_prompt=extraction_prompt,
                stealth=stealth
            )

            async with lock:
                new_result = None
                if res.get("error") is None:
                    if proxy_url:
                        await ProxyManager.report_success(proxy_url)
                    crawled_count += 1
                    html = res.get("raw_html", "")
                    content = res.get("content", "")

                    title = "No Title"
                    if html:
                        try:
                            soup = BeautifulSoup(html, "lxml")
                            title = soup.find("title").get_text().strip() if soup.find("title") else "No Title"
                        except Exception:
                            pass

                    new_result = {
                        "url": url,
                        "status_code": res.get("status_code"),
                        "title": title,
                        "content": content
                    }

                    if depth < max_depth:
                        new_links = extract_links(html, url)
                        for link in new_links:
                            if limit_domain and urlparse(link).netloc != base_domain:
                                continue
                            if link not in visited and not any(q[0] == link for q in queue):
                                queue.append((link, depth + 1))
                else:
                    if proxy_url:
                        await ProxyManager.report_failure(proxy_url)
                    new_result = {
                        "url": url,
                        "status_code": res.get("status_code", 0),
                        "error": res.get("error"),
                        "error_message": res.get("error_message")
                    }

                if new_result:
                    await update_job_state([new_result], crawled_count)

        except Exception as e:
            logger.error(f"Error crawling {url}: {e}")
            if proxy_url:
                await ProxyManager.report_failure(proxy_url)
        finally:
            semaphore.release()

    try:
        while (queue or active_tasks) and crawled_count < max_pages:
            async with async_session_maker() as session:
                job = await session.get(CrawlJob, crawl_id)
                if not job:
                    logger.info(f"Job {crawl_id} deleted. Exiting.")
                    break

            finished = {t for t in active_tasks if t.done()}
            active_tasks -= finished

            async with lock:
                while queue and queue[0][0] in visited:
                    queue.pop(0)

                if queue and len(active_tasks) < CONCURRENCY and crawled_count + len(active_tasks) < max_pages:
                    url, depth = queue.pop(0)
                    visited.add(url)
                    await semaphore.acquire()
                    task = asyncio.create_task(crawl_worker(url, depth))
                    active_tasks.add(task)
                    continue

            if active_tasks:
                await asyncio.wait(active_tasks, return_when=asyncio.FIRST_COMPLETED)
            else:
                break
            await asyncio.sleep(0.1)

        if active_tasks:
            await asyncio.gather(*active_tasks, return_exceptions=True)

        await update_job_state([], crawled_count, status="completed")

        # Fetch completed job and trigger webhook
        async with async_session_maker() as session:
            completed_job = await session.get(CrawlJob, crawl_id)
            if completed_job and completed_job.webhook_url:
                await notify_webhook(completed_job.webhook_url, completed_job.model_dump())

    except Exception as e:
        logger.error(f"ARQ crawl task {crawl_id} failed: {e}")
        await update_job_state([], crawled_count, status="failed", error_msg=str(e))
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

    with open(export_path, "w", encoding="utf-8") as f:  # noqa: ASYNC230
        json.dump(aggregated_results, f, indent=2)

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

async def startup(ctx):
    await init_db()
    logger.info("ARQ Worker initialized.")

async def shutdown(ctx):
    await playwright_mgr.close()
    logger.info("ARQ Worker shutdown.")

class WorkerSettings:
    functions: list = [run_crawl_task, run_batch_crawl_task]  # noqa: RUF012
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = get_redis_settings()
    max_jobs = 10
