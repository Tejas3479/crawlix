import asyncio
import os
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from sqlalchemy import desc, select

from database import CrawlJob, ProxyManager, async_session_maker

from .browser_manager import playwright_mgr
from .fetch_engine import run_fetch
from .log_filter import logger


def extract_links(html: str, base_url: str) -> list[str]:
    if not html:
        return []
    try:
        soup = BeautifulSoup(html, "lxml")
        links = []
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            # Skip javascript/mailto links
            if href.lower().startswith(("javascript:", "mailto:", "tel:", "#")):
                continue
            resolved = urljoin(base_url, href)
            # Strip fragment
            parsed = urlparse(resolved)
            cleaned = parsed._replace(fragment="").geturl()
            links.append(cleaned)
        return list(set(links))
    except Exception as e:
        logger.error(f"Error extracting links: {e}")
        return []

class CrawlManager:
    def __init__(self):
        self.tasks: dict[str, asyncio.Task] = {}
        self.arq_pool = None

    async def create_crawl(
        self,
        url: str,
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
        destinations: list[str] | None = None,
        arq_pool=None
    ) -> str:
        async with async_session_maker() as session:
            job = CrawlJob(
                url=url,
                max_pages=max_pages,
                max_depth=max_depth,
                render_js=render_js,
                output_format=output_format,
                webhook_url=webhook_url,
                destinations=destinations or [],
                status="running"
            )
            session.add(job)
            await session.commit()
            await session.refresh(job)
            crawl_id = job.id
            
        pool = arq_pool or self.arq_pool
        if pool:
            try:
                await pool.enqueue_job(
                    "run_crawl_task",
                    crawl_id,
                    url,
                    max_pages,
                    max_depth,
                    render_js,
                    output_format,
                    strip_links,
                    css_selector,
                    limit_domain,
                    actions,
                    extraction_prompt,
                    stealth,
                    webhook_url
                )
                logger.info(f"Enqueued crawl job {crawl_id} to ARQ worker queue")
                return crawl_id
            except Exception as e:
                logger.warning(f"Failed to enqueue to ARQ pool ({e}), falling back to local task.")

        task = asyncio.create_task(self._run_crawl(crawl_id, url, max_pages, max_depth, render_js, output_format, strip_links, css_selector, limit_domain, actions, extraction_prompt, stealth, webhook_url))
        self.tasks[crawl_id] = task
        return crawl_id

    async def get_crawl(self, crawl_id: str) -> dict | None:
        async with async_session_maker() as session:
            job = await session.get(CrawlJob, crawl_id)
            if job:
                return job.model_dump()
            return None

    async def list_crawls(self) -> list[dict]:
        async with async_session_maker() as session:
            result = await session.execute(select(CrawlJob).order_by(desc(CrawlJob.created_at)))
            jobs = result.scalars().all()
            return [
                {
                    "crawl_id": j.id,
                    "url": j.url,
                    "status": j.status,
                    "pages_crawled": j.stats.get("pages_crawled", 0),
                    "max_pages": j.max_pages,
                    "created_at": j.created_at.isoformat(),
                    "url_count": len(j.results) if isinstance(j.results, list) else 0
                }
                for j in jobs
            ]

    async def delete_crawl(self, crawl_id: str) -> bool:
        async with async_session_maker() as session:
            job = await session.get(CrawlJob, crawl_id)
            if job:
                await session.delete(job)
                await session.commit()
                task = self.tasks.pop(crawl_id, None)
                if task and not task.done():
                    task.cancel()
                return True
            return False

    async def _update_job_state(self, crawl_id: str, results: list, crawled_count: int, status: str | None = None, error_message: str | None = None):
        async with async_session_maker() as session:
            job = await session.get(CrawlJob, crawl_id)
            if not job:
                return
            
            # Create new lists/dicts to ensure SQLAlchemy detects changes to JSON columns
            new_results = list(job.results) if job.results else []
            new_results.extend(results)
            job.results = new_results
            
            new_stats = dict(job.stats) if job.stats else {}
            new_stats["pages_crawled"] = crawled_count
            job.stats = new_stats
            
            if status:
                job.status = status
            if error_message:
                job.error_message = error_message
                
            session.add(job)
            await session.commit()

    async def _run_crawl(self, crawl_id: str, seed_url: str, max_pages: int, max_depth: int, render_js: bool, output_format: str, strip_links: bool, css_selector: str | None, limit_domain: bool, actions: list | None, extraction_prompt: str | None = None, stealth: bool = False, webhook_url: str | None = None):
        queue = [(seed_url, 0)] # (url, depth)
        visited = set()
        crawled_count = 0
        base_domain = urlparse(seed_url).netloc

        CONCURRENCY = 3
        semaphore = asyncio.Semaphore(CONCURRENCY)
        lock = asyncio.Lock()
        active_tasks: set[asyncio.Task] = set()

        async def crawl_worker(url, depth):
            nonlocal crawled_count
            proxy_url = await ProxyManager.get_proxy()
            try:
                logger.info(f"Crawl {crawl_id}: scraping {url} (depth: {depth}) using proxy {proxy_url}")
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
                    async with async_session_maker() as session:
                        job = await session.get(CrawlJob, crawl_id)
                        if not job:
                            return

                    new_result = None
                    if res.get("error") is None:
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

                        # Extract links if not at max depth and crawled_count < max_pages
                        if depth < max_depth:
                            new_links = extract_links(html, url)
                            for link in new_links:
                                if limit_domain and urlparse(link).netloc != base_domain:
                                    continue
                                if link not in visited and not any(q[0] == link for q in queue):
                                    queue.append((link, depth + 1))
                    else:
                        new_result = {
                            "url": url,
                            "status_code": res.get("status_code", 0),
                            "error": res.get("error"),
                            "error_message": res.get("error_message")
                        }
                    
                    if new_result:
                        await self._update_job_state(crawl_id, [new_result], crawled_count)
                        
            except Exception as e:
                logger.error(f"Failed to crawl {url}: {e}")
            finally:
                semaphore.release()

        
        try:
            while (queue or active_tasks) and crawled_count < max_pages:
                async with async_session_maker() as session:
                    job = await session.get(CrawlJob, crawl_id)
                    if not job:
                        logger.info(f"Crawl {crawl_id} was deleted/cancelled. Exiting loop.")
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
                
            await self._update_job_state(crawl_id, [], crawled_count, status="completed")

        except asyncio.CancelledError:
            logger.info(f"Crawl {crawl_id} task was explicitly cancelled.")
            for t in active_tasks:
                t.cancel()
            if active_tasks:
                await asyncio.gather(*active_tasks, return_exceptions=True)
            await self._update_job_state(crawl_id, [], crawled_count, status="interrupted", error_message="Crawl explicitly cancelled.")
        except Exception as e:
            logger.error(f"Crawl {crawl_id} failed with error: {e}")
            await self._update_job_state(crawl_id, [], crawled_count, status="failed", error_message=str(e))
        finally:
            if crawl_id in self.tasks:
                del self.tasks[crawl_id]


crawl_manager = CrawlManager()
