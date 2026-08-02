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
