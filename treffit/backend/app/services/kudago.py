"""Event sync from the KudaGo open API.

https://docs.kudago.com/api/ — public, no key required.

Run it from cron rather than in-process; see scripts/sync_events.py. Events
are keyed by (source, external_id), so re-running only updates.
"""

from __future__ import annotations

import asyncio
import logging
import math
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

# Читать ответ разрешаем долго: у Москвы и Петербурга выборка на порядок
# больше, и на 20 секундах они не укладывались — города выпадали целиком.
# Соединение при этом должно устанавливаться быстро: если хоста нет,
# ждать минуту незачем.
TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# Пауза перед повтором, множится на номер попытки.
RETRY_BACKOFF_SECONDS = 2.0

# Ниже этого дробить страницу бессмысленно: запросов станет столько, что
# синхронизация будет идти дольше, чем источник — отвечать.
MIN_PAGE_SIZE = 25


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


def _schedule(dates: list[dict], now: datetime) -> tuple[datetime, datetime | None, bool] | None:
    """Когда на событие можно попасть: (начало, конец, постоянное).

    У КудаGo три разных случая, и все три встречаются вперемешку:

    • обычный слот с датами — концерт, лекция, вечеринка;
    • длительный слот: выставка открылась неделю назад и идёт до сентября.
      Она подходит, хотя началась в прошлом, — пойти можно сегодня;
    • слот с `is_endless`: постоянная музейная экспозиция. Даты в нём
      служебные (первый год и десятитысячный), а рядом обычно лежит вторая
      запись с датой открытия десятилетней давности.

    Последний случай и оставлял целые города без афиши: обе даты выглядели
    прошедшими, и разбор отвергал всё. Между тем «Кабинет редкостей» в
    музее природы работает и сегодня — на такую выставку сходить можно.
    """
    horizon = now - timedelta(hours=6)
    best: tuple[datetime, datetime | None] | None = None
    endless = False
    opened_at: datetime | None = None

    for slot in dates or []:
        if not isinstance(slot, dict):
            continue
        if slot.get("is_endless") or slot.get("is_startless"):
            # Даты такого слота ничего не значат, брать из него нечего.
            endless = True
            continue

        start = _moment(slot.get("start"))
        if start is None:
            continue
        # Пригодится, если у события нет ни одной живой даты: пусть у
        # постоянной экспозиции будет её настоящий день открытия.
        if opened_at is None or start < opened_at:
            opened_at = start

        end = _moment(slot.get("end"))
        if end is not None and (end <= start or end - start > MAX_RUN):
            end = None

        still_running = end is not None and end >= now
        not_started_yet = start >= horizon
        if not (still_running or not_started_yet):
            continue

        if best is None or start < best[0]:
            best = (start, end)

    if best is not None:
        return best[0], best[1], False
    if endless:
        return opened_at or now, None, True
    return None


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
    slot = _schedule(raw.get("dates") or [], now)
    if slot is None:
        return None
    starts_at, ends_at, is_permanent = slot

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
        "is_permanent": is_permanent,
    }


async def fetch_page(
    client: httpx.AsyncClient,
    location: str,
    page: int,
    since: datetime,
    attempts: int = 3,
    page_size: int | None = None,
) -> dict:
    """Одна страница выдачи, с повтором на временный отказ.

    Москва и Петербург выпадали из синхронизации целиком: у них выборка на
    порядок больше, и источник на ней то отвечает слишком долго, то отдаёт
    502. И то и другое — «сейчас не смог», а не «не смогу никогда», поэтому
    страница запрашивается ещё раз.

    А вот 4xx повторять нечего: несуществующий регион и кривые параметры от
    повтора не исправятся.
    """
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = await client.get(
                f"{API_ROOT}/events/",
                params={
                    "location": location,
                    "actual_since": int(since.timestamp()),
                    "fields": FIELDS,
                    "expand": EXPAND,
                    "page_size": page_size or settings.kudago_page_size,
                    "page": page,
                    # Порядок обязан быть устойчивым, иначе постраничная
                    # выборка со смещением возвращает пересекающиеся куски: у
                    # постоянных экспозиций даты одинаковые, а при равных
                    # ключах источник волен отдавать их как угодно. Из десяти
                    # страниц по Москве так приходило пятьсот записей, среди
                    # которых различных было двенадцать. По id порядок
                    # однозначен, а свой список мы всё равно сортируем сами.
                    "order_by": "id",
                    "text_format": "text",
                },
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            # 502 и 503 источник отдаёт, когда не справился с тяжёлой
            # выборкой, — это временно. 4xx означает, что запрос неверен, и
            # повтор ничего не изменит.
            if exc.response.status_code < 500:
                raise
            last = exc
            if attempt < attempts:
                logger.warning(
                    "KudaGo: %s стр. %s — %s, попытка %s из %s",
                    location, page, exc.response.status_code, attempt, attempts,
                )
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * attempt)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last = exc
            if attempt < attempts:
                logger.warning(
                    "KudaGo: %s стр. %s — %s, попытка %s из %s",
                    location, page, type(exc).__name__, attempt, attempts,
                )
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * attempt)
    raise last  # type: ignore[misc]


async def upsert(session: AsyncSession, payload: dict) -> bool:
    """Записать событие. True — если оно новое.

    Флаш сразу, а не в конце: одно и то же событие приходит на разных
    страницах выдачи — при одинаковых датах источник не гарантирует порядок,
    и на границе страниц записи повторяются. Пока добавленное лежит в сессии
    неотправленным, следующий `select` его не находит, и вставка идёт второй
    раз — с падением на уникальном индексе.
    """
    existing = await session.scalar(
        select(Event).where(Event.source == payload["source"], Event.external_id == payload["external_id"])
    )
    if existing is None:
        session.add(Event(**payload))
        await session.flush()
        return True
    for field, value in payload.items():
        setattr(existing, field, value)
    return False


async def _walk_pages(
    session: AsyncSession,
    client: httpx.AsyncClient,
    location: str,
    pages: int,
    since: datetime,
    page_size: int,
) -> tuple[int, int, int, int, bool]:
    created = updated = skipped = repeated = 0
    # Что уже видели на прошлых страницах этого обхода. Пересечения между
    # страницами возможны и при устойчивом порядке — например, если событие
    # добавили в источник между двумя запросами. Считать их обновлениями
    # нельзя: отчёт тогда показывает работу, которой не было.
    seen: set[str] = set()

    for page in range(1, pages + 1):
        try:
            data = await fetch_page(client, location, page, since, page_size=page_size)
        except httpx.HTTPError as exc:
            logger.warning("KudaGo: %s, страница %s не загрузилась: %r", location, page, exc)
            return created, updated, skipped, repeated, True

        results = data.get("results") or []
        for raw in results:
            payload = parse_event(raw, location, since)
            if payload is None:
                skipped += 1
                continue
            if payload["external_id"] in seen:
                repeated += 1
                continue
            seen.add(payload["external_id"])
            if await upsert(session, payload):
                created += 1
            else:
                updated += 1

        if not data.get("next") or not results:
            break

    return created, updated, skipped, repeated, False


async def sync_location(
    session: AsyncSession, client: httpx.AsyncClient, location: str, pages: int, since: datetime
) -> dict:
    """Забрать афишу одного города, при неудаче — запросами полегче.

    У Москвы и Петербурга выборка на порядок больше остальных, и источник
    на сотне событий за раз отдаёт 502. Меньшая страница ему по силам,
    поэтому город, не давшийся с первого раза, повторяется целиком с
    половинной страницей.

    Целиком, а не с места обрыва: номер страницы зависит от её размера, и
    продолжать с прежнего номера значило бы пропустить часть событий.

    Страниц при этом берём во столько же раз больше: иначе город, которому
    уменьшили страницу, получал бы меньше всего событий — то есть ровно
    наоборот тому, что нужно. Уменьшают её как раз самым большим городам.
    """
    page_size = max(MIN_PAGE_SIZE, settings.kudago_page_size)
    # Сколько событий хотим забрать. Дробление страниц эту цифру не меняет.
    budget = pages * page_size
    created = updated = skipped = repeated = 0
    failed = True

    while True:
        page_count = math.ceil(budget / page_size)
        created, updated, skipped, repeated, failed = await _walk_pages(
            session, client, location, page_count, since, page_size
        )
        if not failed or page_size <= MIN_PAGE_SIZE:
            break
        page_size = max(MIN_PAGE_SIZE, page_size // 2)
        logger.warning(
            "KudaGo: %s — пробую заново: по %s событий на страницу, страниц %s",
            location, page_size, math.ceil(budget / page_size),
        )

    return {
        "location": location,
        "city": city_for(location),
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "repeated": repeated,
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

    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": "Treffit/1.0"}) as client:
        for slug in locations:
            try:
                by_location.append(await sync_location(session, client, slug, pages, since))
                # Пишем после каждого города, чтобы отказ на пятом не терял
                # первые четыре.
                await session.commit()
            except Exception:
                # Один сорвавшийся город не должен уносить с собой весь
                # прогон: без отката сессия остаётся в сломанной транзакции,
                # и все следующие города падают вслед за ним — а отчёта не
                # появляется вовсе.
                logger.exception("KudaGo: %s не синхронизировался", slug)
                await session.rollback()
                by_location.append(
                    {
                        "location": slug,
                        "city": city_for(slug),
                        "created": 0,
                        "updated": 0,
                        "skipped": 0,
                        "repeated": 0,
                        "failed": True,
                    }
                )

    report = {
        "created": sum(item["created"] for item in by_location),
        "updated": sum(item["updated"] for item in by_location),
        "skipped": sum(item["skipped"] for item in by_location),
        "repeated": sum(item["repeated"] for item in by_location),
        "locations": by_location,
    }
    logger.info("KudaGo sync: %s", report)
    return report
