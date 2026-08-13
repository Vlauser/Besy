"""KudaGo parsing, plus a sync run against a local stub HTTP server."""

import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.models import Event
from app.services import kudago

NOW = datetime(2026, 8, 13, 12, 0, tzinfo=timezone.utc)


def ts(dt: datetime) -> int:
    return int(dt.timestamp())


def raw_event(**overrides) -> dict:
    payload = {
        "id": 4242,
        "title": "джаз-вечер в tele-club",
        "short_title": "Джаз-вечер",
        "place": {"title": "Tele-Club", "coords": {"lat": 56.836, "lon": 60.61}},
        "dates": [{"start": ts(NOW + timedelta(hours=5)), "end": ts(NOW + timedelta(hours=9))}],
    }
    payload.update(overrides)
    return payload


def test_parses_a_normal_event():
    parsed = kudago.parse_event(raw_event(), "ekb", NOW)
    assert parsed["external_id"] == "4242"
    assert parsed["title"] == "Джаз-вечер"
    assert parsed["venue"] == "Tele-Club"
    assert parsed["city"] == "Екатеринбург"
    assert parsed["lat"] == 56.836 and parsed["lng"] == 60.61
    assert parsed["starts_at"] == NOW + timedelta(hours=5)
    assert parsed["ends_at"] == NOW + timedelta(hours=9)


def test_falls_back_to_the_long_title():
    parsed = kudago.parse_event(raw_event(short_title=None), "ekb", NOW)
    assert parsed["title"] == "джаз-вечер в tele-club"


def test_event_far_in_the_past_is_skipped():
    old = raw_event(dates=[{"start": ts(NOW - timedelta(days=3))}])
    assert kudago.parse_event(old, "ekb", NOW) is None


def test_event_that_started_an_hour_ago_is_kept():
    """People check in during an event, not only before it."""
    running = raw_event(dates=[{"start": ts(NOW - timedelta(hours=1))}])
    assert kudago.parse_event(running, "ekb", NOW) is not None


def test_earliest_upcoming_slot_wins():
    parsed = kudago.parse_event(
        raw_event(
            dates=[
                {"start": ts(NOW + timedelta(days=4))},
                {"start": ts(NOW + timedelta(hours=2))},
                {"start": ts(NOW + timedelta(days=1))},
            ]
        ),
        "ekb",
        NOW,
    )
    assert parsed["starts_at"] == NOW + timedelta(hours=2)


def test_open_ended_schedule_drops_the_end():
    """KudaGo uses far-future sentinels for permanent exhibitions; keeping
    them would leave the Live window open forever."""
    parsed = kudago.parse_event(
        raw_event(
            dates=[{"start": ts(NOW + timedelta(hours=3)), "end": ts(NOW + timedelta(days=400))}]
        ),
        "ekb",
        NOW,
    )
    assert parsed["ends_at"] is None


def test_garbage_timestamps_are_ignored():
    for dates in ([{"start": 0}], [{"start": -5}], [{"start": "soon"}], [], None):
        assert kudago.parse_event(raw_event(dates=dates), "ekb", NOW) is None


def test_event_without_a_title_is_skipped():
    assert kudago.parse_event(raw_event(title=None, short_title="  "), "ekb", NOW) is None


def test_missing_place_is_tolerated():
    parsed = kudago.parse_event(raw_event(place={}), "ekb", NOW)
    assert parsed["venue"] is None
    assert parsed["lat"] is None


def test_unknown_location_keeps_its_slug():
    assert kudago.city_for("ekb") == "Екатеринбург"
    assert kudago.city_for("atlantis") == "atlantis"


def test_long_title_is_truncated_to_the_column():
    parsed = kudago.parse_event(raw_event(short_title="я" * 400), "ekb", NOW)
    assert len(parsed["title"]) == 255


# --------------------------- real HTTP + real upsert ---------------------------


def stub_payload(now: datetime) -> dict:
    return {
        "count": 2,
        "next": None,
        "results": [
            raw_event(id=1, short_title="Джаз", dates=[{"start": ts(now + timedelta(hours=4))}]),
            raw_event(
                id=2,
                short_title="Выставка",
                place={"title": "Ельцин Центр", "coords": {"lat": 56.8447, "lon": 60.5878}},
                dates=[{"start": ts(now + timedelta(days=1))}],
            ),
        ],
    }


class StubHandler(BaseHTTPRequestHandler):
    payload: dict = {}

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
        body = json.dumps(self.payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def kudago_stub():
    """A real HTTP server, so the client, params and parsing are all exercised."""
    StubHandler.payload = stub_payload(datetime.now(timezone.utc))
    server = HTTPServer(("127.0.0.1", 0), StubHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


@pytest.mark.asyncio
async def test_sync_stores_events_and_is_idempotent(kudago_stub, monkeypatch):
    monkeypatch.setattr(kudago, "API_ROOT", kudago_stub)

    async with SessionLocal() as session:
        first = await kudago.sync(session, location="ekb", pages=1)
        assert first["created"] == 2
        assert first["updated"] == 0

        stored = (await session.execute(select(Event).order_by(Event.external_id))).scalars().all()
        assert [event.title for event in stored] == ["Джаз", "Выставка"]
        assert stored[1].venue == "Ельцин Центр"
        assert stored[1].city == "Екатеринбург"

    # Re-running must update in place, never duplicate.
    async with SessionLocal() as session:
        second = await kudago.sync(session, location="ekb", pages=1)
        assert second["created"] == 0
        assert second["updated"] == 2
        total = (await session.execute(select(Event))).scalars().all()
        assert len(total) == 2


@pytest.mark.asyncio
async def test_sync_survives_an_unreachable_api(monkeypatch):
    """A KudaGo outage must not break the request or the database."""
    monkeypatch.setattr(kudago, "API_ROOT", "http://127.0.0.1:9")  # discard port
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    async with SessionLocal() as session:
        report = await kudago.sync(session, location="ekb", pages=1)
    assert report["created"] == 0 and report["updated"] == 0 and report["skipped"] == 0
    assert report["locations"][0]["failed"] is True


# --------------------------- афиши ---------------------------


def test_prefers_a_thumbnail_over_the_original():
    """Оригинал бывает в несколько мегабайт — на телефоне это лишний трафик."""
    parsed = kudago.parse_event(
        raw_event(
            images=[
                {
                    "image": "https://kudago.com/media/images/event/big.jpg",
                    "thumbnails": {
                        "144x96": "https://kudago.com/media/thumbs/small.jpg",
                        "640x384": "https://kudago.com/media/thumbs/large.jpg",
                    },
                }
            ]
        ),
        "ekb",
        NOW,
    )
    assert parsed["image_url"] == "https://kudago.com/media/thumbs/large.jpg"


def test_falls_back_to_the_original_without_thumbnails():
    parsed = kudago.parse_event(
        raw_event(images=[{"image": "https://kudago.com/media/images/event/big.jpg"}]), "ekb", NOW
    )
    assert parsed["image_url"] == "https://kudago.com/media/images/event/big.jpg"


def test_event_without_pictures_is_still_usable():
    for images in (None, [], [{}], [{"image": None}], "не список"):
        parsed = kudago.parse_event(raw_event(images=images), "ekb", NOW)
        assert parsed is not None, images
        assert parsed["image_url"] is None, images


def test_skips_junk_and_takes_the_first_real_picture():
    parsed = kudago.parse_event(
        raw_event(
            images=[
                {"image": "/media/relative.jpg"},  # не абсолютная ссылка
                {"thumbnails": {"640x384": "https://kudago.com/ok.jpg"}},
            ]
        ),
        "ekb",
        NOW,
    )
    assert parsed["image_url"] == "https://kudago.com/ok.jpg"


def test_keeps_the_source_page_link():
    parsed = kudago.parse_event(raw_event(site_url="https://kudago.com/ekb/event/jazz/"), "ekb", NOW)
    assert parsed["site_url"] == "https://kudago.com/ekb/event/jazz/"
    assert kudago.parse_event(raw_event(), "ekb", NOW)["site_url"] is None


# --------------------------- длительные события ---------------------------
#
# КудаGo по actual_since отдаёт то, что актуально сейчас, — а это в основном
# выставки, начавшиеся раньше и идущие ещё месяц. Раньше они отсеивались все
# до единой, и афиша приходила пустой.


def test_keeps_an_exhibition_that_started_before_today():
    parsed = kudago.parse_event(
        raw_event(
            dates=[{"start": ts(NOW - timedelta(days=12)), "end": ts(NOW + timedelta(days=40))}]
        ),
        "ekb",
        NOW,
    )
    assert parsed is not None
    assert parsed["starts_at"] == NOW - timedelta(days=12)
    assert parsed["ends_at"] == NOW + timedelta(days=40)


def test_drops_it_once_it_has_closed():
    ended = raw_event(
        dates=[{"start": ts(NOW - timedelta(days=40)), "end": ts(NOW - timedelta(days=1))}]
    )
    assert kudago.parse_event(ended, "ekb", NOW) is None


def test_open_ended_run_loses_its_end():
    """Постоянная экспозиция размечена концом в далёком будущем.

    Хранить такой конец нельзя: по нему считается окно Live.
    """
    forever = raw_event(
        dates=[{"start": ts(NOW + timedelta(hours=2)), "end": 253370754000}]
    )
    parsed = kudago.parse_event(forever, "ekb", NOW)
    assert parsed is not None
    assert parsed["ends_at"] is None


def test_sentinel_start_is_not_a_date():
    assert kudago.parse_event(raw_event(dates=[{"start": -62135433000}]), "ekb", NOW) is None


def test_picks_the_earliest_suitable_slot():
    parsed = kudago.parse_event(
        raw_event(
            dates=[
                {"start": ts(NOW + timedelta(days=9))},
                {"start": ts(NOW + timedelta(days=2))},
                {"start": ts(NOW - timedelta(days=30))},  # прошедший — мимо
            ]
        ),
        "ekb",
        NOW,
    )
    assert parsed["starts_at"] == NOW + timedelta(days=2)


def test_end_before_start_is_ignored():
    parsed = kudago.parse_event(
        raw_event(
            dates=[{"start": ts(NOW + timedelta(hours=3)), "end": ts(NOW - timedelta(hours=3))}]
        ),
        "ekb",
        NOW,
    )
    assert parsed is not None and parsed["ends_at"] is None


def test_garbage_slots_do_not_crash_the_parser():
    for dates in ([None], ["строка"], [{"start": "не число"}], [{}]):
        assert kudago.parse_event(raw_event(dates=dates), "ekb", NOW) is None


# --------------------------- медленный источник ---------------------------


async def test_retries_a_timeout_and_succeeds(monkeypatch):
    """Москва и Питер отвечают медленно; один таймаут не должен ронять город."""
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    calls = {"n": 0}

    async def flaky(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ReadTimeout("слишком долго")
        return httpx.Response(
            200,
            json={"count": 0, "next": None, "results": []},
            request=httpx.Request("GET", "http://x"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", flaky)
    async with httpx.AsyncClient() as client:
        data = await kudago.fetch_page(client, "msk", 1, NOW)

    assert calls["n"] == 2
    assert data["results"] == []


async def test_gives_up_after_the_last_attempt(monkeypatch):
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)

    async def always_slow(self, *args, **kwargs):
        raise httpx.ReadTimeout("слишком долго")

    monkeypatch.setattr(httpx.AsyncClient, "get", always_slow)
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.ReadTimeout):
            await kudago.fetch_page(client, "msk", 1, NOW, attempts=2)


# --------------------------- постоянные экспозиции ---------------------------
#
# Именно они оставляли целые города с пустой афишей: у музейной выставки два
# слота — протухшая дата открытия и служебный «идёт бессрочно», и оба
# выглядели прошедшими. Данные ниже сняты с настоящего ответа КудаGo.


PERMANENT_DATES = [
    {
        "start_date": "2013-04-23",
        "start_time": "11:00:00",
        "start": 1366693200,
        "end": 1366693200,
        "is_endless": False,
        "is_startless": False,
    },
    {
        "start_date": None,
        "start": -62135433000,
        "end": 253370754000,
        "is_endless": True,
        "is_startless": True,
        "use_place_schedule": True,
    },
]


def test_permanent_exhibition_is_not_dropped():
    """«Кабинет редкостей» в музее природы работает и сегодня."""
    parsed = kudago.parse_event(
        raw_event(title="выставка «Кабинет редкостей»", short_title=None, dates=PERMANENT_DATES),
        "ekb",
        NOW,
    )
    assert parsed is not None
    assert parsed["is_permanent"] is True
    # Конца нет: по нему считалось бы окно Live, а его тут попросту не бывает.
    assert parsed["ends_at"] is None
    # Начало — настоящий день открытия, для порядка в списке, а не для показа.
    assert parsed["starts_at"] == datetime(2013, 4, 23, 5, 0, tzinfo=timezone.utc)


def test_a_dated_event_is_never_called_permanent():
    parsed = kudago.parse_event(raw_event(), "ekb", NOW)
    assert parsed["is_permanent"] is False


def test_a_real_date_wins_over_the_endless_slot():
    """Если у выставки есть и живая дата, и бессрочный слот — берём дату."""
    parsed = kudago.parse_event(
        raw_event(
            dates=[
                {"start": ts(NOW + timedelta(days=3)), "end": ts(NOW + timedelta(days=4))},
                {"start": -62135433000, "end": 253370754000, "is_endless": True},
            ]
        ),
        "ekb",
        NOW,
    )
    assert parsed["is_permanent"] is False
    assert parsed["starts_at"] == NOW + timedelta(days=3)


def test_endless_without_any_real_date_still_works():
    parsed = kudago.parse_event(
        raw_event(dates=[{"start": -62135433000, "end": 253370754000, "is_endless": True}]),
        "ekb",
        NOW,
    )
    assert parsed is not None and parsed["is_permanent"] is True


# --------------------------- источник не справился ---------------------------
#
# Москва и Петербург отдавали 502: у них выборка на порядок больше, и сотню
# событий за раз источник не вытягивал.


async def test_server_error_is_retried(monkeypatch):
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    calls = {"n": 0}

    async def flaky(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(502, text="Bad Gateway", request=httpx.Request("GET", "http://x"))
        return httpx.Response(
            200,
            json={"count": 0, "next": None, "results": []},
            request=httpx.Request("GET", "http://x"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", flaky)
    async with httpx.AsyncClient() as client:
        await kudago.fetch_page(client, "msk", 1, NOW)
    assert calls["n"] == 2


async def test_client_error_is_not_retried(monkeypatch):
    """404 от повтора не исправится — в отличие от 502."""
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    calls = {"n": 0}

    async def gone(self, *args, **kwargs):
        calls["n"] += 1
        return httpx.Response(404, json={}, request=httpx.Request("GET", "http://x"))

    monkeypatch.setattr(httpx.AsyncClient, "get", gone)
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await kudago.fetch_page(client, "нетакого", 1, NOW)
    assert calls["n"] == 1


async def test_a_heavy_city_is_retried_with_smaller_pages(monkeypatch):
    """Не справился с сотней — просим по пятьдесят, а не бросаем город."""
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(settings, "kudago_page_size", 100)
    seen: list[int] = []

    async def picky(self, *args, **kwargs):
        size = int(kwargs["params"]["page_size"])
        seen.append(size)
        if size > 50:
            return httpx.Response(502, text="", request=httpx.Request("GET", "http://x"))
        return httpx.Response(
            200,
            json={"count": 1, "next": None, "results": [raw_event()]},
            request=httpx.Request("GET", "http://x"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", picky)
    async with SessionLocal() as session:
        async with httpx.AsyncClient() as client:
            report = await kudago.sync_location(session, client, "msk", 1, NOW)
        await session.commit()

    assert seen[0] == 100 and 50 in seen
    assert report["failed"] is False
    assert report["created"] == 1


async def test_it_stops_shrinking_at_the_floor(monkeypatch):
    """Если не помогает и меньшая страница — сдаёмся, а не дробим до нуля."""
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(settings, "kudago_page_size", 100)

    async def always_502(self, *args, **kwargs):
        return httpx.Response(502, text="", request=httpx.Request("GET", "http://x"))

    monkeypatch.setattr(httpx.AsyncClient, "get", always_502)
    async with SessionLocal() as session:
        async with httpx.AsyncClient() as client:
            report = await kudago.sync_location(session, client, "msk", 1, NOW)

    assert report["failed"] is True


# --------------------------- повторы в выдаче ---------------------------


async def test_the_same_event_on_two_pages_does_not_break_the_run():
    """При одинаковых датах источник не держит порядок между страницами.

    Одно и то же событие приходит дважды. Пока добавленное лежит в сессии
    неотправленным, повторная вставка падает на уникальном индексе — и
    уносит с собой весь прогон.
    """
    payload = kudago.parse_event(raw_event(), "ekb", NOW)
    async with SessionLocal() as session:
        assert await kudago.upsert(session, payload) is True
        assert await kudago.upsert(session, payload) is False
        await session.commit()

        count = await session.scalar(
            select(func.count()).select_from(Event).where(Event.external_id == payload["external_id"])
        )
    assert count == 1


async def test_a_broken_city_does_not_take_the_others_with_it(monkeypatch):
    """Иначе сорвавшаяся Москва оставляет без афиши всех, кто после неё."""
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(settings, "kudago_locations", "msk,ekb")

    async def broken_for_moscow(session, client, location, pages, since):
        if location == "msk":
            raise RuntimeError("что-то пошло не так")
        return {
            "location": location,
            "city": kudago.city_for(location),
            "created": 3,
            "updated": 0,
            "skipped": 0,
            "failed": False,
        }

    monkeypatch.setattr(kudago, "sync_location", broken_for_moscow)
    async with SessionLocal() as session:
        report = await kudago.sync(session, pages=1)

    by_city = {item["city"]: item for item in report["locations"]}
    assert by_city["Москва"]["failed"] is True
    assert by_city["Екатеринбург"]["created"] == 3
    assert report["created"] == 3


async def test_smaller_pages_do_not_mean_fewer_events(monkeypatch):
    """Страницу уменьшают самым большим городам.

    Если оставить прежнее число страниц, они получат меньше всех событий —
    ровно наоборот тому, что нужно.
    """
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(settings, "kudago_page_size", 100)
    asked: list[tuple[int, int]] = []

    async def picky(self, *args, **kwargs):
        size = int(kwargs["params"]["page_size"])
        page = int(kwargs["params"]["page"])
        asked.append((page, size))
        if size > 50:
            return httpx.Response(502, text="", request=httpx.Request("GET", "http://x"))
        return httpx.Response(
            200,
            json={
                "count": 99,
                "next": "дальше есть",
                # Своё событие на каждой странице, иначе обход остановится.
                "results": [raw_event(id=1000 + page)],
            },
            request=httpx.Request("GET", "http://x"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", picky)
    async with SessionLocal() as session:
        async with httpx.AsyncClient() as client:
            await kudago.sync_location(session, client, "msk", 4, NOW)
        await session.commit()

    # Просили 4 страницы по 100; после отказа — 8 страниц по 50.
    big = [page for page, size in asked if size == 100]
    small = [page for page, size in asked if size == 50]
    assert max(big) == 1  # сорвалось на первой же
    assert max(small) == 8
