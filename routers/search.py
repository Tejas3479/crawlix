import os
import time

from fastapi import APIRouter, Depends

from auth import verify_api_key
from fetcher import playwright_mgr, run_fetch
from models import SearchRequest, SearchResponse
from services.search import search

router = APIRouter(tags=["search"])


@router.post(
    "/api/search",
    response_model=SearchResponse,
    dependencies=[Depends(verify_api_key)],
)
async def search_endpoint(req: SearchRequest):
    start = time.monotonic()
    api_key = req.api_key or os.getenv("SERPER_API_KEY")
    result = await search(
        query=req.query,
        provider=req.provider,
        max_results=req.max_results,
        api_key=api_key,
    )
    results = result.get("results", [])

    if req.fetch_content and results:
        fetch_limit = min(req.content_limit, len(results))

        for i in range(fetch_limit):
            item = results[i]
            fetched = await run_fetch(
                url=item["url"],
                method="GET",
                render_js=req.render_js,
                output_format="markdown",
                strip_links=True,
                playwright_mgr=playwright_mgr,
                timeout=req.timeout,
            )
            item["markdown"] = fetched.get("content") or ""
            item["status_code"] = fetched.get("status_code")
            item["error"] = fetched.get("error")

    return SearchResponse(
        success=result.get("success", False),
        error=result.get("error"),
        query=req.query,
        provider=req.provider,
        results=results,
        latency_ms=int((time.monotonic() - start) * 1000),
    )