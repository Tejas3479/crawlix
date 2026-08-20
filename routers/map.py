import time

from fastapi import APIRouter, Depends

from auth import verify_api_key
from models import MapRequest, MapResponse
from services.map import map_site

router = APIRouter(tags=["map"])


@router.post(
    "/api/map",
    response_model=MapResponse,
    dependencies=[Depends(verify_api_key)],
)
async def map_endpoint(req: MapRequest):
    start = time.monotonic()
    result = await map_site(
        url=str(req.url),
        limit=req.limit,
        include_sitemap=req.include_sitemap,
        allow_subdomains=req.allow_subdomains,
        render_js=req.render_js,
        timeout=req.timeout,
        proxy_url=req.proxy.url if req.proxy else None,
    )
    return MapResponse(
        success=result.get("success", False),
        error=result.get("error"),
        urls=result.get("urls", []),
        count=result.get("count", 0),
        limit=result.get("limit", req.limit),
        base_domain=result.get("base_domain"),
        discovered_via=result.get("discovered_via"),
        latency_ms=int((time.monotonic() - start) * 1000),
    )
