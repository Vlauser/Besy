"""KudaGo parsing, plus a sync run against a local stub HTTP server."""

import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from sqlalchemy import select

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


async def test_a_bad_response_is_not_retried(monkeypatch):
    """404 повторять незачем — ответ от этого не изменится."""
    monkeypatch.setattr(kudago, "RETRY_BACKOFF_SECONDS", 0)
    calls = {"n": 0}

    async def not_found(self, *args, **kwargs):
        calls["n"] += 1
        return httpx.Response(404, json={}, request=httpx.Request("GET", "http://x"))

    monkeypatch.setattr(httpx.AsyncClient, "get", not_found)
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await kudago.fetch_page(client, "нетакого", 1, NOW)
    assert calls["n"] == 1
