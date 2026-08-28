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
    import hmac
    import hashlib
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
