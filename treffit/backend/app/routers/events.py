from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import onboarded_user
from ..models import Event, LiveSession, User, UserEvent
from ..schemas import CheckinIn, EventOut, LiveNeighbourOut
from ..serializers import event_out, visible_photos
from ..services.matching import haversine_meters

router = APIRouter(tags=["events"])


@router.get("/events", response_model=list[EventOut])
async def list_events(
    user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> list[EventOut]:
    """Upcoming events in the user's city, synced from the KudaGo bot."""
    now = datetime.now(timezone.utc)
    rows = await session.execute(
        select(Event)
        .where(Event.city == user.city, Event.starts_at >= now - timedelta(hours=6))
        .order_by(Event.starts_at.asc())
        .limit(50)
    )
    events = list(rows.scalars())
    attending = set(
        (
            await session.execute(
                select(UserEvent.event_id).where(
                    UserEvent.user_id == user.id, UserEvent.event_id.in_([e.id for e in events] or [0])
                )
            )
        ).scalars()
    )
    return [event_out(e, attending=e.id in attending) for e in events]


@router.post("/events/{event_id}/attend", response_model=EventOut)
async def attend(
    event_id: int, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> EventOut:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    existing = await session.scalar(
        select(UserEvent).where(UserEvent.user_id == user.id, UserEvent.event_id == event_id)
    )
    if existing is None:
        session.add(UserEvent(user_id=user.id, event_id=event_id))
        await session.commit()
    return event_out(event, attending=True)


@router.delete("/events/{event_id}/attend", response_model=EventOut)
async def unattend(
    event_id: int, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> EventOut:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    existing = await session.scalar(
        select(UserEvent).where(UserEvent.user_id == user.id, UserEvent.event_id == event_id)
    )
    if existing is not None:
        await session.delete(existing)
        await session.commit()
    return event_out(event, attending=False)


@router.post("/live/checkin")
async def live_checkin(
    payload: CheckinIn, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> dict:
    """Check in at an event. Rejected outside the radius or the time window —
    Live must mean *actually there*, or the whole mode is meaningless."""
    event = await session.get(Event, payload.event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    if event.lat is None or event.lng is None:
        raise HTTPException(status_code=409, detail="У события нет координат")

    now = datetime.now(timezone.utc)
    window = timedelta(hours=settings.live_window_hours)
    ends_at = event.ends_at or (event.starts_at + window)
    if not (event.starts_at - window <= now <= ends_at + window):
        raise HTTPException(status_code=409, detail="Окно Live для этого события закрыто")

    distance = haversine_meters(payload.lat, payload.lng, event.lat, event.lng)
    if distance > settings.live_radius_meters:
        raise HTTPException(status_code=409, detail="Вы слишком далеко от места события")

    user.lat, user.lng = payload.lat, payload.lng
    existing = await session.scalar(
        select(LiveSession).where(
            LiveSession.user_id == user.id, LiveSession.event_id == event.id, LiveSession.expires_at > now
        )
    )
    if existing:
        existing.lat, existing.lng, existing.checked_in_at = payload.lat, payload.lng, now
    else:
        session.add(
            LiveSession(
                user_id=user.id,
                event_id=event.id,
                lat=payload.lat,
                lng=payload.lng,
                expires_at=ends_at + window,
            )
        )
    await session.commit()
    return {"ok": True, "event_id": event.id, "expires_at": ends_at + window, "distance_m": int(distance)}


@router.get("/live/nearby", response_model=list[LiveNeighbourOut])
async def live_nearby(
    event_id: int, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> list[LiveNeighbourOut]:
    now = datetime.now(timezone.utc)
    mine = await session.scalar(
        select(LiveSession).where(
            LiveSession.user_id == user.id, LiveSession.event_id == event_id, LiveSession.expires_at > now
        )
    )
    if mine is None:
        raise HTTPException(status_code=403, detail="Сначала отметьтесь на месте")

    rows = await session.execute(
        select(LiveSession, User)
        .join(User, User.id == LiveSession.user_id)
        .where(
            LiveSession.event_id == event_id,
            LiveSession.expires_at > now,
            LiveSession.user_id != user.id,
            User.is_active.is_(True),
            User.is_banned.is_(False),
        )
        .limit(50)
    )
    out: list[LiveNeighbourOut] = []
    for live, other in rows.all():
        photos = visible_photos(other)
        out.append(
            LiveNeighbourOut(
                user_id=other.id,
                first_name=other.first_name,
                gradient=photos[0].blur_gradient if photos else "linear-gradient(135deg,#B9C6FF,#6E85E8)",
                distance_m=int(haversine_meters(mine.lat, mine.lng, live.lat, live.lng)),
            )
        )
    out.sort(key=lambda n: n.distance_m)
    return out
