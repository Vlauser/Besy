"""Входящие лайки и разделение матчей на новые и начатые.

Обе вещи до этого существовали только на бэкенде: эндпоинты были, экранов
не было, и «Кто вас лайкнул» продавался в баннере Premium, не существуя в
интерфейсе.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def test_like_count_is_open_without_premium(user_factory):
    """Число видно всем, список — нет.

    Иначе баннер Premium зовёт вслепую: человек не знает, что покупает.
    """
    her = await user_factory(910001, gender="female", seeking="male")
    him = await user_factory(910002, gender="male", seeking="female")

    assert (await her.get("/discover/likes/count")).json()["count"] == 0
    await him.post(f"/discover/{her.user['id']}/swipe", json={"action": "like"})

    assert (await her.get("/discover/likes/count")).json()["count"] == 1
    # А имена по-прежнему за деньги.
    assert (await her.get("/discover/likes")).status_code == 402


async def test_answered_likes_leave_the_count(user_factory):
    """Ответила — вопрос закрыт, и висеть в счётчике ему незачем."""
    her = await user_factory(910011, gender="female", seeking="male")
    him = await user_factory(910012, gender="male", seeking="female")

    await him.post(f"/discover/{her.user['id']}/swipe", json={"action": "like"})
    assert (await her.get("/discover/likes/count")).json()["count"] == 1

    await her.post(f"/discover/{him.user['id']}/swipe", json={"action": "pass"})
    assert (await her.get("/discover/likes/count")).json()["count"] == 0


async def test_a_pass_is_not_a_like(user_factory):
    her = await user_factory(910021, gender="female", seeking="male")
    him = await user_factory(910022, gender="male", seeking="female")
    await him.post(f"/discover/{her.user['id']}/swipe", json={"action": "pass"})
    assert (await her.get("/discover/likes/count")).json()["count"] == 0


async def test_premium_sees_who_liked(user_factory):
    her = await user_factory(910031, gender="female", seeking="male", name="Лена")
    him = await user_factory(910032, gender="male", seeking="female", name="Пётр")
    await him.post(f"/discover/{her.user['id']}/swipe", json={"action": "like"})

    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models import User

    async with SessionLocal() as session:
        await session.execute(update(User).where(User.id == her.user["id"]).values(is_premium=True))
        await session.commit()

    listed = await her.get("/discover/likes")
    assert listed.status_code == 200
    assert [item["first_name"] for item in listed.json()] == ["Пётр"]


# --------------------------- новые матчи ---------------------------


async def test_a_fresh_match_is_marked_as_having_no_conversation(user_factory):
    """Чат заводится вместе с матчем и сразу получает системное сообщение.

    Поэтому «переписки ещё не было» по последнему сообщению не определить —
    нужен отдельный признак, иначе новый матч выглядит как начатый разговор.
    """
    her = await user_factory(910041, gender="female", seeking="male")
    him = await user_factory(910042, gender="male", seeking="female")

    await her.post(f"/discover/{him.user['id']}/swipe", json={"action": "like"})
    await him.post(f"/discover/{her.user['id']}/swipe", json={"action": "like"})

    chats = (await her.get("/chats")).json()
    assert len(chats) == 1
    assert chats[0]["has_conversation"] is False
    # Системная «вы совпали» уже лежит, и по ней бы не отличить.
    assert chats[0]["last_message"]["type"] == "system"


async def test_one_message_turns_it_into_a_conversation(user_factory):
    her = await user_factory(910051, gender="female", seeking="male")
    him = await user_factory(910052, gender="male", seeking="female")

    await her.post(f"/discover/{him.user['id']}/swipe", json={"action": "like"})
    await him.post(f"/discover/{her.user['id']}/swipe", json={"action": "like"})

    chat_id = (await her.get("/chats")).json()[0]["id"]
    await her.post(f"/chats/{chat_id}/messages", json={"body": "привет"})

    # Видно обоим: разговор начат, даже если ответа ещё нет.
    assert (await her.get("/chats")).json()[0]["has_conversation"] is True
    assert (await him.get("/chats")).json()[0]["has_conversation"] is True
