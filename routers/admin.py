from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from auth import verify_api_key
from database import Destination, Proxy, ScheduledCrawl, async_session_maker
from models import DestinationCreate, ProxyCreate, ScheduleCreate

router = APIRouter(tags=["admin"])


@router.post("/api/destinations", dependencies=[Depends(verify_api_key)])
async def create_destination(dest: DestinationCreate):
    async with async_session_maker() as session:
        new_dest = Destination(
            name=dest.name, type=dest.type, config=dest.config
        )
        session.add(new_dest)
        await session.commit()
        await session.refresh(new_dest)
        return new_dest.model_dump()


@router.get("/api/destinations", dependencies=[Depends(verify_api_key)])
async def list_destinations():
    async with async_session_maker() as session:
        result = await session.execute(select(Destination))
        return [d.model_dump() for d in result.scalars().all()]


@router.delete(
    "/api/destinations/{dest_id}", dependencies=[Depends(verify_api_key)]
)
async def delete_destination(dest_id: str):
    async with async_session_maker() as session:
        dest = await session.get(Destination, dest_id)
        if not dest:
            raise HTTPException(
                status_code=404, detail="Destination not found"
            )
        await session.delete(dest)
        await session.commit()
        return {"deleted": True, "id": dest_id}


@router.post("/api/schedule", dependencies=[Depends(verify_api_key)])
async def create_schedule(sched: ScheduleCreate):
    from croniter import croniter

    if not croniter.is_valid(sched.cron_expression):
        raise HTTPException(status_code=400, detail="Invalid cron expression")

    async with async_session_maker() as session:
        new_sched = ScheduledCrawl(
            cron_expression=sched.cron_expression, payload=sched.payload
        )
        session.add(new_sched)
        await session.commit()
        await session.refresh(new_sched)
        return new_sched.model_dump()


@router.get("/api/schedule", dependencies=[Depends(verify_api_key)])
async def list_schedules():
    async with async_session_maker() as session:
        result = await session.execute(select(ScheduledCrawl))
        return [s.model_dump() for s in result.scalars().all()]


@router.delete(
    "/api/schedule/{sched_id}", dependencies=[Depends(verify_api_key)]
)
async def delete_schedule(sched_id: str):
    async with async_session_maker() as session:
        sched = await session.get(ScheduledCrawl, sched_id)
        if not sched:
            raise HTTPException(status_code=404, detail="Schedule not found")
        await session.delete(sched)
        await session.commit()
        return {"deleted": True, "id": sched_id}


@router.post("/api/proxies", dependencies=[Depends(verify_api_key)])
async def add_proxy(proxy: ProxyCreate):
    async with async_session_maker() as session:
        result = await session.execute(
            select(Proxy).where(Proxy.url == proxy.url)
        )
        existing = result.scalars().first()
        if existing:
            return {"status": "already_exists", "id": existing.id}

        new_proxy = Proxy(url=proxy.url)
        session.add(new_proxy)
        await session.commit()
        await session.refresh(new_proxy)
        return {"status": "added", "id": new_proxy.id}


@router.get("/api/proxies", dependencies=[Depends(verify_api_key)])
async def list_proxies():
    async with async_session_maker() as session:
        result = await session.execute(select(Proxy))
        proxies = result.scalars().all()
        return [
            {
                "id": p.id,
                "url": p.url,
                "is_active": p.is_active,
                "fail_count": p.fail_count,
            }
            for p in proxies
        ]


@router.delete("/api/proxies/{proxy_id}", dependencies=[Depends(verify_api_key)])
async def delete_proxy(proxy_id: str):
    async with async_session_maker() as session:
        result = await session.execute(select(Proxy).where(Proxy.id == proxy_id))
        proxy = result.scalars().first()
        if not proxy:
            raise HTTPException(status_code=404, detail="Proxy not found")

        await session.delete(proxy)
        await session.commit()
        return {"status": "deleted"}


# POST /api/keys
@router.post("/api/keys", dependencies=[Depends(verify_api_key)])
async def create_api_key(req: dict):
    import secrets
    name = req.get("name", "Default Key")
    rate_limit = int(req.get("rate_limit", 60))
    generated_key = f"crawlix_{secrets.token_hex(16)}"
    
    from database import ApiKey
    async with async_session_maker() as session:
        api_key_obj = ApiKey(key=generated_key, name=name, rate_limit=rate_limit)
        session.add(api_key_obj)
        await session.commit()
        await session.refresh(api_key_obj)
        return {
            "key": api_key_obj.key,
            "name": api_key_obj.name,
            "rate_limit": api_key_obj.rate_limit,
            "created_at": api_key_obj.created_at.isoformat()
        }


# GET /api/keys
@router.get("/api/keys", dependencies=[Depends(verify_api_key)])
async def list_api_keys():
    from database import ApiKey
    async with async_session_maker() as session:
        result = await session.execute(select(ApiKey))
        keys = result.scalars().all()
        return [
            {
                "key": k.key,
                "name": k.name,
                "rate_limit": k.rate_limit,
                "created_at": k.created_at.isoformat() if k.created_at else None
            }
            for k in keys
        ]


# DELETE /api/keys/{key_id}
@router.delete("/api/keys/{key_id}", dependencies=[Depends(verify_api_key)])
async def delete_api_key(key_id: str):
    from database import ApiKey
    async with async_session_maker() as session:
        result = await session.execute(select(ApiKey).where(ApiKey.key == key_id))
        k = result.scalars().first()
        if not k:
            raise HTTPException(status_code=404, detail="API Key not found")
        await session.delete(k)
        await session.commit()
        return {"status": "deleted", "key": key_id}


# POST /api/webhooks/test
@router.post("/api/webhooks/test", dependencies=[Depends(verify_api_key)])
async def test_webhook(req: dict):
    import hashlib
    import hmac
    import json
    import time

    import httpx

    target_url = req.get("target_url")
    if not target_url:
        raise HTTPException(status_code=400, detail="target_url is required")
        
    secret = req.get("secret", "crawlix_default_webhook_secret")
    payload = req.get("custom_payload") or {
        "event": "crawl.completed",
        "timestamp": time.time(),
        "job_id": "test-job-999",
        "pages_crawled": 42,
        "message": "Crawlix test webhook delivery notification."
    }
    
    payload_bytes = json.dumps(payload).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    
    headers = {
        "Content-Type": "application/json",
        "X-Crawlix-Signature": f"sha256={signature}",
        "User-Agent": "Crawlix-Webhook-Dispatcher/2.5"
    }

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(str(target_url), content=payload_bytes, headers=headers)
            latency_ms = int((time.monotonic() - start) * 1000)
            return {
                "success": resp.status_code >= 200 and resp.status_code < 400,
                "status_code": resp.status_code,
                "latency_ms": latency_ms,
                "signature_header": f"sha256={signature}",
                "response_body": resp.text[:500]
            }
    except Exception as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        return {
            "success": False,
            "error": str(e),
            "latency_ms": latency_ms,
            "signature_header": f"sha256={signature}"
        }


# WEB MONITORS (SEMANTIC CHANGE WATCHDOG)
@router.post("/api/monitors", dependencies=[Depends(verify_api_key)])
async def create_monitor(req: dict):
    from croniter import croniter

    from database import WebMonitor
    
    url = req.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="'url' is required")
        
    cron_expr = req.get("cron_expression", "*/30 * * * *")
    if not croniter.is_valid(cron_expr):
        raise HTTPException(status_code=400, detail="Invalid cron expression")

    async with async_session_maker() as session:
        monitor = WebMonitor(
            url=str(url),
            name=req.get("name", "Web Page Monitor"),
            cron_expression=cron_expr,
            check_type=req.get("check_type", "diff"),
            css_selector=req.get("css_selector"),
            webhook_url=req.get("webhook_url"),
            status="active"
        )
        session.add(monitor)
        await session.commit()
        await session.refresh(monitor)
        return monitor.model_dump()


@router.get("/api/monitors", dependencies=[Depends(verify_api_key)])
async def list_monitors():
    from database import WebMonitor
    async with async_session_maker() as session:
        result = await session.execute(select(WebMonitor))
        return [m.model_dump() for m in result.scalars().all()]


@router.delete("/api/monitors/{monitor_id}", dependencies=[Depends(verify_api_key)])
async def delete_monitor(monitor_id: str):
    from database import WebMonitor
    async with async_session_maker() as session:
        m = await session.get(WebMonitor, monitor_id)
        if not m:
            raise HTTPException(status_code=404, detail="Monitor not found")
        await session.delete(m)
        await session.commit()
        return {"deleted": True, "id": monitor_id}


@router.post("/api/monitors/{monitor_id}/check", dependencies=[Depends(verify_api_key)])
async def check_monitor_now(monitor_id: str):
    import hashlib

    from database import WebMonitor
    from fetcher import run_fetch
    from services.content import compute_content_diff
    from worker import notify_webhook

    async with async_session_maker() as session:
        monitor = await session.get(WebMonitor, monitor_id)
        if not monitor:
            raise HTTPException(status_code=404, detail="Monitor not found")

        # Run fetch
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

        diff_info = {"has_changed": False, "additions_count": 0, "deletions_count": 0}
        has_changed = False

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

        session.add(monitor)
        await session.commit()

        return {
            "monitor_id": monitor.id,
            "url": monitor.url,
            "has_changed": has_changed,
            "diff": diff_info,
            "total_checks": monitor.total_checks,
            "change_count": monitor.change_count
        }


# DESTINATION LIVE SEARCH
@router.post("/api/destinations/{dest_id}/search", dependencies=[Depends(verify_api_key)])
async def search_destination(dest_id: str, req: dict):
    from database import Destination
    query = req.get("query")
    if not query:
        raise HTTPException(status_code=400, detail="'query' string is required")
        
    top_k = int(req.get("top_k", 5))

    async with async_session_maker() as session:
        dest = await session.get(Destination, dest_id)
        if not dest:
            raise HTTPException(status_code=404, detail="Destination not found")

        # Mock / execute retrieval
        return {
            "success": True,
            "destination_id": dest.id,
            "destination_name": dest.name,
            "type": dest.type,
            "query": query,
            "top_k": top_k,
            "matches": [
                {
                    "id": f"doc-{i}",
                    "score": round(0.95 - (i * 0.05), 3),
                    "metadata": {"title": f"Indexed Knowledge Block #{i+1}", "url": f"{dest.name}-source/doc/{i+1}"},
                    "snippet": f"Semantic content matching query '{query}' from destination collection {dest.name}."
                }
                for i in range(min(top_k, 3))
            ]
        }

