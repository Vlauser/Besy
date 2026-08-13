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

from .. import cities
from ..config import settings
from ..models import Event

logger = logging.getLogger(__name__)

API_ROOT = "https://kudago.com/public-api/v1.4"
FIELDS = "id,title,short_title,place,dates,location,site_url,categories,images"
EXPAND = "place,dates"
SOURCE = "kudago"

def city_for(location: str) -> str:
    """Слаг источника → название города, как оно хранится в анкете."""
    return cities.name_for_slug(location)


# Дольше этого событие считаем бессрочным и конец не храним: у КудаGo
# постоянные экспозиции размечены концом в далёком будущем, и такой конец
# ничего не говорит о том, когда туда идти.
MAX_RUN = timedelta(days=180)


def _moment(value: object) -> datetime | None:
    """Unix-время в datetime. None для мусора и служебных значений.

    КудаGo размечает бессрочные расписания числами вроде -62135433000 и
    253370754000 — без проверки они превращаются в первый и десятитысячный
    год.
    """
    if not isinstance(value, int) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _pick_start(dates: list[dict], now: datetime) -> tuple[datetime, datetime | None] | None:
    """Ближайший подходящий слот события.

    Подходит не только тот, что ещё не начался, но и тот, что ещё не
    закончился: выставка, открывшаяся неделю назад и идущая до сентября, —
    это событие, на которое можно пойти сегодня. Раньше брались только
    будущие начала, и вся афиша длительных событий отсеивалась целиком —
    а КудаGo по actual_since отдаёт как раз идущие сейчас.
    """
    horizon = now - timedelta(hours=6)
    best: tuple[datetime, datetime | None] | None = None

    for slot in dates or []:
        if not isinstance(slot, dict):
            continue
        start = _moment(slot.get("start"))
        if start is None:
            continue

        end = _moment(slot.get("end"))
        if end is not None and (end <= start or end - start > MAX_RUN):
            end = None

        still_running = end is not None and end >= now
        not_started_yet = start >= horizon
        if not (still_running or not_started_yet):
            continue

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


async def sync_location(
    session: AsyncSession, client: httpx.AsyncClient, location: str, pages: int, since: datetime
) -> dict:
    """Забрать афишу одного города. Считает, что вышло."""
    created = updated = skipped = 0
    failed = False

    for page in range(1, pages + 1):
        try:
            data = await fetch_page(client, location, page, since)
        except httpx.HTTPError:
            logger.exception("KudaGo: %s, страница %s не загрузилась", location, page)
            failed = True
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

    return {
        "location": location,
        "city": city_for(location),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
    }


async def sync(
    session: AsyncSession, location: str | None = None, pages: int = 3
) -> dict:
    """Забрать афишу по всем нужным городам.

    Городов больше одного намеренно: человек, зарегистрировавшийся в
    Москве, должен увидеть московскую афишу, а для этого её надо забрать
    заранее — искать по запросу конкретного пользователя поздно.

    Недоступность одного города не отменяет остальные: у источника
    бывают и опечатки в слагах, и временные отказы.
    """
    locations = [location] if location else settings.kudago_location_list
    since = datetime.now(timezone.utc)
    by_location: list[dict] = []

    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "Treffit/1.0"}) as client:
        for slug in locations:
            by_location.append(await sync_location(session, client, slug, pages, since))
            # Пишем после каждого города, чтобы отказ на пятом не терял
            # первые четыре.
            await session.commit()

    report = {
        "created": sum(item["created"] for item in by_location),
        "updated": sum(item["updated"] for item in by_location),
        "skipped": sum(item["skipped"] for item in by_location),
        "locations": by_location,
    }
    logger.info("KudaGo sync: %s", report)
    return report
