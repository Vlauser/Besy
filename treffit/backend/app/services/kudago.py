"""Event sync from the KudaGo open API.

https://docs.kudago.com/api/ — public, no key required.

Run it from cron rather than in-process; see scripts/sync_events.py. Events
are keyed by (source, external_id), so re-running only updates.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Event

logger = logging.getLogger(__name__)

API_ROOT = "https://kudago.com/public-api/v1.4"
FIELDS = "id,title,short_title,place,dates,location,site_url,categories,images"
EXPAND = "place,dates"
SOURCE = "kudago"

# KudaGo location slug → the city name stored on profiles.
CITY_BY_LOCATION = {
    "ekb": "Екатеринбург",
    "msk": "Москва",
    "spb": "Санкт-Петербург",
    "nsk": "Новосибирск",
    "kzn": "Казань",
    "nnv": "Нижний Новгород",
}


def city_for(location: str) -> str:
    return CITY_BY_LOCATION.get(location, location)


def _pick_start(dates: list[dict], now: datetime) -> tuple[datetime, datetime | None] | None:
    """First upcoming slot of an event, as timezone-aware datetimes.

    KudaGo returns unix timestamps and uses sentinel values for open-ended
    schedules, which would otherwise land in the year 10000.
    """
    best: tuple[datetime, datetime | None] | None = None
    for slot in dates or []:
        start_ts = slot.get("start")
        if not isinstance(start_ts, int) or start_ts <= 0:
            continue
        try:
            start = datetime.fromtimestamp(start_ts, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            continue
        if start < now - timedelta(hours=6):
            continue

        end = None
        end_ts = slot.get("end")
        if isinstance(end_ts, int) and end_ts > start_ts:
            try:
                candidate_end = datetime.fromtimestamp(end_ts, tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                candidate_end = None
            # Ignore "runs forever" sentinels — they break the Live window.
            if candidate_end and candidate_end - start <= timedelta(days=2):
                end = candidate_end

        if best is None or start < best[0]:
            best = (start, end)
    return best


def _pick_image(images: list[dict] | None) -> str | None:
    """Ссылка на афишу.

    КудаGo кладёт в `images` список, где у каждой картинки есть оригинал и
    набор уменьшенных копий. Оригинал бывает в несколько мегабайт — на
    телефоне это лишний трафик, поэтому берём подходящую по размеру копию,
    а к оригиналу откатываемся, только если копий нет.
    """
    for image in images or []:
        if not isinstance(image, dict):
            continue
        thumbnails = image.get("thumbnails")
        if isinstance(thumbnails, dict):
            for size in ("640x384", "640x auto", "144x96"):
                url = thumbnails.get(size)
                if isinstance(url, str) and url.startswith("http"):
                    return url[:500]
        url = image.get("image")
        if isinstance(url, str) and url.startswith("http"):
            return url[:500]
    return None


def parse_event(raw: dict, location: str, now: datetime | None = None) -> dict | None:
    """Map one KudaGo item to Event fields, or None if it is unusable."""
    now = now or datetime.now(timezone.utc)
    slot = _pick_start(raw.get("dates") or [], now)
    if slot is None:
        return None
    starts_at, ends_at = slot

    title = (raw.get("short_title") or raw.get("title") or "").strip()
    if not title:
        return None

    place = raw.get("place") or {}
    coords = (place.get("coords") or {}) if isinstance(place, dict) else {}
    return {
        "external_id": str(raw.get("id")),
        "title": title[:255],
        "venue": (place.get("title") or "").strip()[:255] or None,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "lat": coords.get("lat"),
        "lng": coords.get("lon"),
        "city": city_for(location),
        "source": SOURCE,
        "image_url": _pick_image(raw.get("images")),
        "site_url": (raw.get("site_url") or None),
    }


async def fetch_page(client: httpx.AsyncClient, location: str, page: int, since: datetime) -> dict:
    response = await client.get(
        f"{API_ROOT}/events/",
        params={
            "location": location,
            "actual_since": int(since.timestamp()),
            "fields": FIELDS,
            "expand": EXPAND,
            "page_size": settings.kudago_page_size,
            "page": page,
            "order_by": "dates",
            "text_format": "text",
        },
    )
    response.raise_for_status()
    return response.json()


async def upsert(session: AsyncSession, payload: dict) -> bool:
    """Insert or update one event. Returns True when it was newly created."""
    existing = await session.scalar(
        select(Event).where(Event.source == payload["source"], Event.external_id == payload["external_id"])
    )
    if existing is None:
        session.add(Event(**payload))
        return True
    for field, value in payload.items():
        setattr(existing, field, value)
    return False


async def sync(session: AsyncSession, location: str | None = None, pages: int = 3) -> dict:
    """Pull upcoming events and store them. Returns a small report."""
    location = location or settings.kudago_location
    since = datetime.now(timezone.utc)
    created = updated = skipped = 0

    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "Treffit/1.0"}) as client:
        for page in range(1, pages + 1):
            try:
                data = await fetch_page(client, location, page, since)
            except httpx.HTTPError:
                logger.exception("KudaGo: страница %s не загрузилась", page)
                break

            results = data.get("results") or []
            for raw in results:
                payload = parse_event(raw, location, since)
                if payload is None:
                    skipped += 1
                    continue
                if await upsert(session, payload):
                    created += 1
                else:
                    updated += 1

            if not data.get("next") or not results:
                break

    await session.commit()
    report = {"location": location, "created": created, "updated": updated, "skipped": skipped}
    logger.info("KudaGo sync: %s", report)
    return report
