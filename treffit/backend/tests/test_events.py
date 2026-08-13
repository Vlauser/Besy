"""Что попадает в афишу и надолго ли отметка «я на месте».

Оба вопроса про длительные события: КудаGo по actual_since отдаёт то, что
идёт прямо сейчас, — в основном выставки, начавшиеся раньше.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models import Event

pytestmark = pytest.mark.asyncio

# Ельцин Центр — координаты нужны для Live.
VENUE = (56.8447, 60.5878)


async def add_event(title: str, starts_in: timedelta, ends_in: timedelta | None) -> int:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        event = Event(
            external_id=title,
            title=title,
            venue="Ельцин Центр",
            starts_at=now + starts_in,
            ends_at=now + ends_in if ends_in is not None else None,
            lat=VENUE[0],
            lng=VENUE[1],
            city="Екатеринбург",
            source="test",
        )
        session.add(event)
        await session.commit()
        return event.id


async def titles(actor) -> list[str]:
    response = await actor.get("/events")
    assert response.status_code == 200, response.text
    return [item["title"] for item in response.json()]


async def test_running_exhibition_stays_in_the_list(user_factory):
    """Открылась месяц назад, идёт ещё месяц — на неё можно пойти сегодня."""
    actor = await user_factory(700100)
    await add_event("Выставка", starts_in=timedelta(days=-30), ends_in=timedelta(days=30))
    assert "Выставка" in await titles(actor)


async def test_finished_event_disappears(user_factory):
    actor = await user_factory(700101)
    await add_event("Вчерашний концерт", starts_in=timedelta(days=-2), ends_in=timedelta(days=-1))
    assert "Вчерашний концерт" not in await titles(actor)


async def test_event_without_end_drops_out_the_same_day(user_factory):
    """Без конца ориентируемся на начало: концерт вчера — уже не афиша."""
    actor = await user_factory(700102)
    await add_event("Позавчерашний", starts_in=timedelta(days=-2), ends_in=None)
    await add_event("Начался час назад", starts_in=timedelta(hours=-1), ends_in=None)
    listed = await titles(actor)
    assert "Позавчерашний" not in listed
    assert "Начался час назад" in listed


async def test_upcoming_event_is_listed(user_factory):
    actor = await user_factory(700103)
    await add_event("Завтрашний", starts_in=timedelta(days=1), ends_in=None)
    assert "Завтрашний" in await titles(actor)


async def test_other_city_is_not_listed(user_factory):
    actor = await user_factory(700104, city="Казань")
    await add_event("Екатеринбургское", starts_in=timedelta(days=1), ends_in=None)
    assert await titles(actor) == []


async def test_live_checkin_expires_with_the_visit_not_the_exhibition(user_factory):
    """Отметка на двухмесячной выставке не должна висеть два месяца.

    Иначе человек остаётся в списке соседей, давно уйдя домой.
    """
    actor = await user_factory(700105)
    event_id = await add_event("Долгая выставка", starts_in=timedelta(days=-10), ends_in=timedelta(days=50))

    response = await actor.post(
        "/live/checkin", json={"event_id": event_id, "lat": VENUE[0], "lng": VENUE[1]}
    )
    assert response.status_code == 200, response.text

    expires_at = datetime.fromisoformat(response.json()["expires_at"])
    now = datetime.now(timezone.utc)
    limit = now + timedelta(hours=settings.live_window_hours)
    assert expires_at <= limit + timedelta(minutes=1)
    assert expires_at > now


async def test_live_checkin_needs_you_to_be_there(user_factory):
    actor = await user_factory(700106)
    event_id = await add_event("Концерт", starts_in=timedelta(minutes=30), ends_in=timedelta(hours=3))
    # Москва — заведомо дальше радиуса.
    response = await actor.post(
        "/live/checkin", json={"event_id": event_id, "lat": 55.7558, "lng": 37.6173}
    )
    assert response.status_code == 409
