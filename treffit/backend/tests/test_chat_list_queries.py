"""Список чатов не должен дорожать с каждым новым чатом.

Раньше на каждую строку приходилось по отдельному запросу за последним
сообщением, за собеседником с фотографиями, иногда за событием — плюс
обращение к хабу за присутствием. Пара десятков чатов превращалась в
сотню обращений подряд, и экран открывался ровно настолько же дольше.

Проверяем не «сколько именно», а форму зависимости: число запросов при
шести чатах должно совпадать с числом при двух. Такой тест переживает
безобидные правки и падает ровно тогда, когда внутрь цикла возвращается
запрос.
"""

import pytest
from sqlalchemy import event

from app.db import engine

pytestmark = pytest.mark.asyncio


class Counter:
    """Считает SQL, ушедший в базу за время блока."""

    def __init__(self) -> None:
        self.statements: list[str] = []

    def __enter__(self):
        sync_engine = engine.sync_engine

        def before(conn, cursor, statement, parameters, context, executemany):
            self.statements.append(statement)

        self._before = before
        event.listen(sync_engine, "before_cursor_execute", before)
        return self

    def __exit__(self, *exc):
        event.remove(engine.sync_engine, "before_cursor_execute", self._before)
        return False

    def __len__(self) -> int:
        return len(self.statements)


async def matched_chats(user_factory, viewer_tg: int, partners: int) -> None:
    """Свести зрителя с несколькими людьми, чтобы завелись чаты."""
    viewer = await user_factory(viewer_tg, name="Зритель", gender="female", seeking="male")
    for index in range(partners):
        partner = await user_factory(
            viewer_tg + 1 + index,
            name=f"Партнёр{index}",
            gender="male",
            seeking="female",
        )
        await partner.post(f"/discover/{viewer.id}/swipe", json={"action": "like"})
        result = (await viewer.post(f"/discover/{partner.id}/swipe", json={"action": "like"})).json()
        assert result["matched"] is True, result
        # Сообщение, чтобы у чата было что показывать в превью.
        await partner.post(
            f"/chats/{result['chat_id']}/messages", json={"body": f"привет {index}"}
        )
    return viewer


async def test_chat_list_cost_does_not_grow_with_the_number_of_chats(user_factory):
    small = await matched_chats(user_factory, 5000, partners=2)
    with Counter() as few:
        response = await small.get("/chats")
    assert response.status_code == 200
    assert len(response.json()) == 2

    big = await matched_chats(user_factory, 6000, partners=6)
    with Counter() as many:
        response = await big.get("/chats")
    assert response.status_code == 200
    assert len(response.json()) == 6

    assert len(many) == len(few), (
        f"шесть чатов стоят {len(many)} запросов против {len(few)} на двух — "
        "значит, запрос снова уехал внутрь цикла:\n"
        + "\n".join(many.statements)
    )


async def test_chat_list_still_carries_partner_photos_and_preview(user_factory):
    viewer = await matched_chats(user_factory, 7000, partners=2)
    chats = (await viewer.get("/chats")).json()
    assert len(chats) == 2
    for chat in chats:
        assert chat["other"]["first_name"].startswith("Партнёр")
        assert chat["last_message"]["body"].startswith("привет")
        assert chat["other"]["is_online"] is False


async def test_unread_count_reflects_only_chats_waiting_for_an_answer(user_factory):
    viewer = await matched_chats(user_factory, 8000, partners=3)
    # В каждом из трёх чатов лежит по сообщению от партнёра.
    assert (await viewer.get("/chats/unread-count")).json() == {"count": 3}

    chats = (await viewer.get("/chats")).json()
    await viewer.post(f"/chats/{chats[0]['id']}/read")
    assert (await viewer.get("/chats/unread-count")).json() == {"count": 2}


async def test_unread_count_is_not_swallowed_by_the_chat_route(user_factory):
    """«unread-count» не должен уехать в обработчик /chats/{chat_id}."""
    viewer = await matched_chats(user_factory, 9000, partners=1)
    response = await viewer.get("/chats/unread-count")
    assert response.status_code == 200, response.text
    assert set(response.json()) == {"count"}
