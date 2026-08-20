import logging
import time

from fastapi import APIRouter, Depends, HTTPException

from auth import verify_api_key
from fetcher import playwright_mgr, run_fetch, session_manager
from models import FetchRequest, FetchResponse

logger = logging.getLogger("crawlix.fetch")

router = APIRouter(tags=["fetch"])


# POST /fetch
@router.post(
    "/fetch",
    response_model=FetchResponse,
    dependencies=[Depends(verify_api_key)],
)
async def fetch_endpoint(req: FetchRequest):
    start = time.monotonic()
    logger.info(
        f"Received fetch request: {req.method} {req.url} (format: {req.output_format})"
    )

    # Determine session
    sid = req.session_id
    engine = "playwright" if req.render_js else "curl"
    session = None

    if sid:
        session = await session_manager.get_or_create(sid, engine)
    elif req.render_js:
        sid = None

    proxy_url = req.proxy.url if req.proxy else None

    result = await run_fetch(
        url=str(req.url),
        method=req.method.upper(),
        headers=req.headers,
        cookies=req.cookies,
        body=req.body,
        json_body=req.json_body,
        session=session,
        render_js=req.render_js,
        scroll=req.scroll,
        proxy_url=proxy_url,
        max_retries=req.max_retries,
        timeout=req.timeout,
        impersonate=req.impersonate,
        playwright_mgr=playwright_mgr,
        output_format=req.output_format,
        strip_links=req.strip_links,
        llm_api_key=req.llm_api_key,
        llm_provider=req.llm_provider,
        json_schema=req.json_schema,
        wait_for_selector=req.wait_for_selector,
        wait_timeout=req.wait_timeout,
        css_selector=req.css_selector,
        llm_model=req.llm_model,
        actions=req.actions,
        screenshot=req.screenshot,
        screenshot_format=req.screenshot_format,
        extraction_prompt=req.extraction_prompt,
        wait_until=req.wait_until,
        stealth=req.stealth,
        bypass_cache=req.bypass_cache,
    )

    latency_ms = int((time.monotonic() - start) * 1000)
    success = result.get("error") is None

    logger.info(
        f"Fetch request resolved in {latency_ms}ms with success={success}"
    )

    return FetchResponse(
        success=success,
        url=result.get("final_url", str(req.url)),
        status_code=result.get("status_code", 0),
        output_format=req.output_format,
        content=result.get("content") or "",
        session_id=sid,
        latency_ms=latency_ms,
        retries_used=result.get("retries_used", 0),
        error=result.get("error"),
        error_message=result.get("error_message"),
        screenshot=result.get("screenshot"),
        timing=result.get("timing"),
        cache_hit=result.get("cache_hit", False),
    )


# GET /api/sessions
@router.get("/api/sessions", dependencies=[Depends(verify_api_key)])
async def list_sessions():
    return await session_manager.list_sessions()


# DELETE /api/sessions/{session_id}
@router.delete(
    "/api/sessions/{session_id}", dependencies=[Depends(verify_api_key)]
)
async def delete_session(session_id: str):
    if not await session_manager.get_session_meta(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    await session_manager.delete_session(session_id)
    return {"deleted": True, "session_id": session_id}
