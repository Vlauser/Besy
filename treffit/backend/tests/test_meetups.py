"""События от пользователей: лента, отклик, согласие автора."""

import io
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image

from app.config import settings

pytestmark = pytest.mark.asyncio


def png_bytes(color=(90, 160, 210)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (800, 600), color).save(buffer, "PNG")
    return buffer.getvalue()


def when(hours: int = 24) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


async def create(actor, *, topic="Настолки вечером", city="Екатеринбург", hours=24, image=False, **extra):
    data = {
        "city": city,
        "address": "ул. Вайнера, 11",
        "starts_at": when(hours),
        "topic": topic,
        **extra,
    }
    files = {"image": ("cover.png", png_bytes(), "image/png")} if image else None
    return await actor.post("/meetups", data=data, files=files)


# --------------------------- создание ---------------------------


async def test_a_meetup_appears_for_others_in_the_same_city(user_factory):
    author = await user_factory(2001, name="Аня", city="Екатеринбург")
    other = await user_factory(2002, name="Игорь", gender="male", seeking="female", city="Екатеринбург")

    created = await create(author, description="Ищу компанию на вечер")
    assert created.status_code == 201, created.text
    assert created.json()["mine"] is True

    feed = (await other.get("/meetups")).json()
    assert [m["topic"] for m in feed] == ["Настолки вечером"]
    assert feed[0]["author"]["first_name"] == "Аня"
    assert feed[0]["mine"] is False


async def test_your_own_meetup_never_shows_in_your_feed(user_factory):
    author = await user_factory(2003, city="Екатеринбург")
    await create(author)
    assert (await author.get("/meetups")).json() == []


async def test_another_city_does_not_show(user_factory):
    author = await user_factory(2004, city="Казань")
    other = await user_factory(2005, gender="male", seeking="female", city="Екатеринбург")
    await create(author, city="Казань")
    assert (await other.get("/meetups")).json() == []


async def test_a_past_meetup_is_refused(user_factory):
    author = await user_factory(2006, city="Екатеринбург")
    response = await create(author, hours=-5)
    assert response.status_code == 422
    assert "прошлом" in response.text


async def test_an_unknown_city_is_refused(user_factory):
    author = await user_factory(2007, city="Екатеринбург")
    response = await create(author, city="12345")
    assert response.status_code == 422


async def test_a_typed_city_is_normalised(user_factory):
    """«мск» и «Москва» обязаны стать одним городом, иначе лента разъедется."""
    author = await user_factory(2008, city="Москва")
    body = (await create(author, city="мск")).json()
    assert body["city"] == "Москва"


async def test_the_number_of_open_meetups_is_capped(user_factory, monkeypatch):
    monkeypatch.setattr(settings, "max_open_meetups", 2)
    author = await user_factory(2009, city="Екатеринбург")
    assert (await create(author, topic="Первое")).status_code == 201
    assert (await create(author, topic="Второе")).status_code == 201
    third = await create(author, topic="Третье")
    assert third.status_code == 409


async def test_a_cover_image_is_stored_and_served(user_factory):
    author = await user_factory(2010, city="Екатеринбург")
    other = await user_factory(2011, gender="male", seeking="female", city="Екатеринбург")
    created = (await create(author, image=True)).json()

    feed = (await other.get("/meetups")).json()
    assert feed[0]["image_url"] == f"/media/meetups/{created['id']}"
    served = await other.get(feed[0]["image_url"])
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"


# --------------------------- отклики ---------------------------


async def test_a_pass_removes_the_card_from_the_feed(user_factory):
    author = await user_factory(2020, city="Екатеринбург")
    other = await user_factory(2021, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()

    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "pass"})
    assert (await other.get("/meetups")).json() == []


async def test_interest_reaches_the_author_but_opens_no_chat(user_factory):
    """Отклик — ещё не знакомство: переписку открывает автор."""
    author = await user_factory(2022, city="Екатеринбург")
    other = await user_factory(2023, name="Игорь", gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()

    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})

    responders = (await author.get(f"/meetups/{meetup['id']}/responses")).json()
    assert [r["first_name"] for r in responders] == ["Игорь"]
    assert responders[0]["accepted"] is False
    assert responders[0]["chat_id"] is None
    assert (await other.get("/chats")).json() == []
    assert (await author.get("/chats")).json() == []


async def test_the_author_sees_the_response_count(user_factory):
    author = await user_factory(2024, city="Екатеринбург")
    one = await user_factory(2025, gender="male", seeking="female", city="Екатеринбург")
    two = await user_factory(2026, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()

    await one.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})
    await two.post(f"/meetups/{meetup['id']}/respond", json={"action": "pass"})

    mine = (await author.get("/meetups/mine")).json()
    assert len(mine) == 1
    assert mine[0]["responses"] == 1  # «мимо» — не отклик


async def test_only_the_author_sees_who_responded(user_factory):
    author = await user_factory(2027, city="Екатеринбург")
    other = await user_factory(2028, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})

    assert (await other.get(f"/meetups/{meetup['id']}/responses")).status_code == 404


async def test_you_cannot_respond_to_your_own_meetup(user_factory):
    author = await user_factory(2029, city="Екатеринбург")
    meetup = (await create(author)).json()
    response = await author.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})
    assert response.status_code == 422


# --------------------------- согласие автора ---------------------------


async def test_accepting_opens_a_chat_for_both(user_factory):
    author = await user_factory(2030, city="Екатеринбург")
    other = await user_factory(2031, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})

    accepted = await author.post(f"/meetups/{meetup['id']}/responses/{other.id}/accept")
    assert accepted.status_code == 200
    chat_id = accepted.json()["chat_id"]

    for actor in (author, other):
        chats = (await actor.get("/chats")).json()
        assert [c["id"] for c in chats] == [chat_id]


async def test_only_the_author_can_accept(user_factory):
    author = await user_factory(2032, city="Екатеринбург")
    other = await user_factory(2033, gender="male", seeking="female", city="Екатеринбург")
    third = await user_factory(2034, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})

    assert (
        await third.post(f"/meetups/{meetup['id']}/responses/{other.id}/accept")
    ).status_code == 404


async def test_accepting_twice_keeps_one_chat(user_factory):
    """Повторное согласие не должно плодить вторую переписку."""
    author = await user_factory(2035, city="Екатеринбург")
    other = await user_factory(2036, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})

    first = (await author.post(f"/meetups/{meetup['id']}/responses/{other.id}/accept")).json()
    second = (await author.post(f"/meetups/{meetup['id']}/responses/{other.id}/accept")).json()
    assert first["chat_id"] == second["chat_id"]
    assert len((await author.get("/chats")).json()) == 1


async def test_accepting_someone_who_did_not_respond_is_refused(user_factory):
    author = await user_factory(2037, city="Екатеринбург")
    stranger = await user_factory(2038, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    response = await author.post(f"/meetups/{meetup['id']}/responses/{stranger.id}/accept")
    assert response.status_code == 404


# --------------------------- снятие ---------------------------


async def test_cancelling_hides_the_meetup(user_factory):
    author = await user_factory(2040, city="Екатеринбург")
    other = await user_factory(2041, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()

    assert (await author.delete(f"/meetups/{meetup['id']}")).status_code == 204
    assert (await other.get("/meetups")).json() == []
    assert (await author.get("/meetups/mine")).json() == []


async def test_a_stranger_cannot_cancel_your_meetup(user_factory):
    author = await user_factory(2042, city="Екатеринбург")
    other = await user_factory(2043, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    assert (await other.delete(f"/meetups/{meetup['id']}")).status_code == 404


async def test_blocked_people_do_not_see_each_other_s_meetups(user_factory):
    author = await user_factory(2044, city="Екатеринбург")
    other = await user_factory(2045, gender="male", seeking="female", city="Екатеринбург")
    await create(author)
    blocked = await other.post("/safety/block", json={"user_id": author.id})
    assert blocked.status_code == 204, blocked.text
    assert (await other.get("/meetups")).json() == []


# --------------------------- «Я иду» ---------------------------


async def test_a_responded_meetup_stays_visible(user_factory):
    """Отклик означает «иду», а не «забудь».

    Из ленты карточка уходит — решение принято. Но событие человеку
    по-прежнему нужно: когда и где. Раньше оно исчезало насовсем.
    """
    author = await user_factory(2050, city="Екатеринбург")
    other = await user_factory(2051, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author, topic="Настолки")).json()

    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})

    assert (await other.get("/meetups")).json() == []  # из ленты ушло
    going = (await other.get("/meetups/going")).json()
    assert [m["topic"] for m in going] == ["Настолки"]
    assert going[0]["response_status"] == "pending"
    assert going[0]["chat_id"] is None


async def test_going_shows_the_chat_once_the_author_agrees(user_factory):
    author = await user_factory(2052, city="Екатеринбург")
    other = await user_factory(2053, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})
    accepted = (await author.post(f"/meetups/{meetup['id']}/responses/{other.id}/accept")).json()

    going = (await other.get("/meetups/going")).json()
    assert going[0]["response_status"] == "accepted"
    assert going[0]["chat_id"] == accepted["chat_id"]


async def test_a_pass_does_not_land_in_going(user_factory):
    author = await user_factory(2054, city="Екатеринбург")
    other = await user_factory(2055, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "pass"})
    assert (await other.get("/meetups/going")).json() == []


async def test_a_cancelled_meetup_leaves_going(user_factory):
    """Снятое автором событие висеть в планах не должно."""
    author = await user_factory(2056, city="Екатеринбург")
    other = await user_factory(2057, gender="male", seeking="female", city="Екатеринбург")
    meetup = (await create(author)).json()
    await other.post(f"/meetups/{meetup['id']}/respond", json={"action": "interested"})
    await author.delete(f"/meetups/{meetup['id']}")
    assert (await other.get("/meetups/going")).json() == []
