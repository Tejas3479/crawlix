import asyncio
import csv
import logging
import os
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse

from auth import verify_api_key
from database import BatchJob, async_session_maker
from fetcher import crawl_manager
from models import CrawlRequest

logger = logging.getLogger("crawlix.crawl")

router = APIRouter(tags=["crawl"])


# CRAWL ENDPOINTS
@router.post("/api/crawl", dependencies=[Depends(verify_api_key)])
async def start_crawl(req: CrawlRequest):
    crawl_id = await crawl_manager.create_crawl(
        url=str(req.url),
        max_pages=req.max_pages,
        max_depth=req.max_depth,
        render_js=req.render_js,
        output_format=req.output_format,
        strip_links=req.strip_links,
        css_selector=req.css_selector,
        limit_domain=req.limit_domain,
        actions=req.actions,
        extraction_prompt=req.extraction_prompt,
        stealth=req.stealth,
        webhook_url=str(req.webhook_url) if req.webhook_url else None,
        destinations=req.destinations,
    )
    return {"crawl_id": crawl_id, "status": "running"}


@router.get("/api/crawl/{crawl_id}", dependencies=[Depends(verify_api_key)])
async def get_crawl(crawl_id: str):
    crawl = await crawl_manager.get_crawl(crawl_id)
    if not crawl:
        raise HTTPException(status_code=404, detail="Crawl not found")
    return crawl


@router.get("/api/crawl", dependencies=[Depends(verify_api_key)])
async def list_crawls():
    return await crawl_manager.list_crawls()


@router.delete("/api/crawl/{crawl_id}", dependencies=[Depends(verify_api_key)])
async def delete_crawl(crawl_id: str):
    if not await crawl_manager.delete_crawl(crawl_id):
        raise HTTPException(status_code=404, detail="Crawl not found")
    return {"deleted": True, "crawl_id": crawl_id}


# BATCH CRAWL ENDPOINTS
@router.post("/api/crawl/batch", dependencies=[Depends(verify_api_key)])
async def create_batch_crawl(
    request: Request,
    file: UploadFile = File(...),
    render_js: bool = False,
    output_format: str = "markdown",
    webhook_url: str | None = None,
):
    content = await file.read()
    lines = content.decode("utf-8", errors="ignore").splitlines()
    reader = csv.reader(lines)
    urls = []
    for row in reader:
        for col in row:
            col_clean = col.strip()
            if col_clean.startswith(("http://", "https://")):
                urls.append(col_clean)
    urls = list(dict.fromkeys(urls))
    if not urls:
        raise HTTPException(
            status_code=400,
            detail="No valid HTTP/HTTPS URLs found in uploaded CSV file.",
        )

    async with async_session_maker() as session:
        batch = BatchJob(
            total_urls=len(urls), webhook_url=webhook_url, status="pending"
        )
        session.add(batch)
        await session.commit()
        await session.refresh(batch)
        batch_id = batch.id

    pool = getattr(request.app.state, "arq_pool", None)
    if pool:
        try:
            await pool.enqueue_job(
                "run_batch_crawl_task",
                batch_id,
                urls,
                render_js,
                output_format,
                webhook_url,
            )
        except Exception as e:
            logger.warning(
                f"Failed to enqueue batch job to ARQ pool ({e}), running in background task."
            )
            from worker import run_batch_crawl_task

            asyncio.create_task(
                run_batch_crawl_task(
                    {}, batch_id, urls, render_js, output_format, webhook_url
                )
            )
    else:
        from worker import run_batch_crawl_task

        asyncio.create_task(
            run_batch_crawl_task(
                {}, batch_id, urls, render_js, output_format, webhook_url
            )
        )

    return {
        "batch_id": batch_id,
        "total_urls": len(urls),
        "status": "processing",
    }


@router.get(
    "/api/crawl/batch/{batch_id}", dependencies=[Depends(verify_api_key)]
)
async def get_batch_crawl(batch_id: str):
    async with async_session_maker() as session:
        batch = await session.get(BatchJob, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch job not found")
        return batch.model_dump()


@router.get(
    "/api/crawl/batch/{batch_id}/download",
    dependencies=[Depends(verify_api_key)],
)
async def download_batch_results(batch_id: str):
    async with async_session_maker() as session:
        batch = await session.get(BatchJob, batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch job not found")
        if (
            batch.status != "completed"
            or not batch.export_path
            or not os.path.exists(batch.export_path)
        ):
            raise HTTPException(
                status_code=400,
                detail="Batch job is not completed or export file is missing",
            )
        return FileResponse(
            batch.export_path,
            filename=f"batch_{batch_id}.json",
            media_type="application/json",
        )
