"""Сообщение как полноценный объект: фото, ответ, правка, удаление."""

import io

import pytest
from PIL import Image

pytestmark = pytest.mark.asyncio


def png_bytes(color=(80, 150, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (700, 500), color).save(buffer, "PNG")
    return buffer.getvalue()


async def matched_pair(user_factory):
    her = await user_factory(3001, name="Аня", gender="female", seeking="male")
    him = await user_factory(3002, name="Игорь", gender="male", seeking="female")
    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    result = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()
    return her, him, result["chat_id"]


# --------------------------- ответы ---------------------------


async def test_a_reply_carries_a_quote(user_factory):
    her, him, chat = await matched_pair(user_factory)
    first = (await her.post(f"/chats/{chat}/messages", json={"body": "Привет!"})).json()["message"]

    answer = (
        await him.post(f"/chats/{chat}/messages", json={"body": "Привет", "reply_to_id": first["id"]})
    ).json()["message"]

    assert answer["reply_to"]["id"] == first["id"]
    assert answer["reply_to"]["preview"] == "Привет!"
    assert answer["reply_to"]["mine"] is False  # цитата чужая


async def test_a_long_quote_is_trimmed(user_factory):
    her, him, chat = await matched_pair(user_factory)
    long_text = "а" * 300
    first = (await her.post(f"/chats/{chat}/messages", json={"body": long_text})).json()["message"]
    answer = (
        await him.post(f"/chats/{chat}/messages", json={"body": "ок", "reply_to_id": first["id"]})
    ).json()["message"]
    assert len(answer["reply_to"]["preview"]) < 100
    assert answer["reply_to"]["preview"].endswith("…")


async def test_you_cannot_quote_another_chat(user_factory):
    """Иначе по одному id утекала бы чужая переписка."""
    her, him, chat = await matched_pair(user_factory)
    outsider = await user_factory(3003, name="Лена", gender="female", seeking="male")
    other_him = await user_factory(3004, name="Пётр", gender="male", seeking="female")
    await outsider.post(f"/discover/{other_him.id}/swipe", json={"action": "like"})
    foreign_chat = (
        await other_him.post(f"/discover/{outsider.id}/swipe", json={"action": "like"})
    ).json()["chat_id"]
    foreign = (
        await outsider.post(f"/chats/{foreign_chat}/messages", json={"body": "секрет"})
    ).json()["message"]

    response = await her.post(
        f"/chats/{chat}/messages", json={"body": "подсмотрю", "reply_to_id": foreign["id"]}
    )
    assert response.status_code == 422


# --------------------------- правка ---------------------------


async def test_editing_marks_the_message(user_factory):
    her, him, chat = await matched_pair(user_factory)
    sent = (await her.post(f"/chats/{chat}/messages", json={"body": "превет"})).json()["message"]

    fixed = (await her.patch(f"/chats/{chat}/messages/{sent['id']}", json={"body": "привет"})).json()
    assert fixed["body"] == "привет"
    assert fixed["edited"] is True

    seen = (await him.get(f"/chats/{chat}/messages")).json()
    assert [m["body"] for m in seen if m["type"] == "text"] == ["привет"]


async def test_you_cannot_edit_someone_else_s_message(user_factory):
    her, him, chat = await matched_pair(user_factory)
    sent = (await her.post(f"/chats/{chat}/messages", json={"body": "моё"})).json()["message"]
    assert (await him.patch(f"/chats/{chat}/messages/{sent['id']}", json={"body": "чужое"})).status_code == 404


# --------------------------- удаление ---------------------------


async def test_deleting_hides_the_text_from_both(user_factory):
    her, him, chat = await matched_pair(user_factory)
    sent = (await her.post(f"/chats/{chat}/messages", json={"body": "лишнее"})).json()["message"]

    gone = (await her.delete(f"/chats/{chat}/messages/{sent['id']}")).json()
    assert gone["deleted"] is True
    assert gone["body"] == ""

    for actor in (her, him):
        seen = (await actor.get(f"/chats/{chat}/messages")).json()
        target = next(m for m in seen if m["id"] == sent["id"])
        assert target["deleted"] is True
        assert target["body"] == ""  # тело не должно доехать даже в поле


async def test_a_reply_survives_the_deletion_of_its_quote(user_factory):
    """Дыра в переписке читалась бы хуже, чем честное «удалено»."""
    her, him, chat = await matched_pair(user_factory)
    first = (await her.post(f"/chats/{chat}/messages", json={"body": "вопрос"})).json()["message"]
    answer = (
        await him.post(f"/chats/{chat}/messages", json={"body": "ответ", "reply_to_id": first["id"]})
    ).json()["message"]

    await her.delete(f"/chats/{chat}/messages/{first['id']}")

    seen = (await him.get(f"/chats/{chat}/messages")).json()
    kept = next(m for m in seen if m["id"] == answer["id"])
    assert kept["reply_to"]["preview"] == "сообщение удалено"


async def test_deleting_twice_is_harmless(user_factory):
    her, him, chat = await matched_pair(user_factory)
    sent = (await her.post(f"/chats/{chat}/messages", json={"body": "раз"})).json()["message"]
    assert (await her.delete(f"/chats/{chat}/messages/{sent['id']}")).status_code == 200
    assert (await her.delete(f"/chats/{chat}/messages/{sent['id']}")).status_code == 200


async def test_an_edited_message_cannot_be_edited_after_deletion(user_factory):
    her, him, chat = await matched_pair(user_factory)
    sent = (await her.post(f"/chats/{chat}/messages", json={"body": "текст"})).json()["message"]
    await her.delete(f"/chats/{chat}/messages/{sent['id']}")
    assert (await her.patch(f"/chats/{chat}/messages/{sent['id']}", json={"body": "снова"})).status_code == 409


# --------------------------- фотографии ---------------------------


async def test_a_photo_message_is_sent_and_served(user_factory):
    her, him, chat = await matched_pair(user_factory)
    sent = (
        await her.post(
            f"/chats/{chat}/photo-messages",
            files={"file": ("shot.png", png_bytes(), "image/png")},
            data={"caption": "вот"},
        )
    ).json()["message"]

    assert sent["type"] == "photo"
    assert sent["body"] == "вот"
    assert sent["photo_url"] == f"/media/messages/{sent['id']}"

    served = await him.get(sent["photo_url"])
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"


async def test_a_photo_needs_no_caption(user_factory):
    her, him, chat = await matched_pair(user_factory)
    response = await her.post(
        f"/chats/{chat}/photo-messages", files={"file": ("shot.png", png_bytes(), "image/png")}
    )
    assert response.status_code == 201
    assert response.json()["message"]["body"] == ""


async def test_only_the_two_of_them_see_the_photo(user_factory):
    """Самое строгое правило в приложении: это личная переписка."""
    her, him, chat = await matched_pair(user_factory)
    stranger = await user_factory(3005, name="Чужак", gender="male", seeking="female")
    sent = (
        await her.post(
            f"/chats/{chat}/photo-messages", files={"file": ("shot.png", png_bytes(), "image/png")}
        )
    ).json()["message"]

    assert (await stranger.get(sent["photo_url"])).status_code == 404


async def test_a_deleted_photo_stops_being_served(user_factory):
    her, him, chat = await matched_pair(user_factory)
    sent = (
        await her.post(
            f"/chats/{chat}/photo-messages", files={"file": ("shot.png", png_bytes(), "image/png")}
        )
    ).json()["message"]
    url = sent["photo_url"]
    await her.delete(f"/chats/{chat}/messages/{sent['id']}")
    assert (await him.get(url)).status_code == 404


async def test_a_quote_of_your_own_message_says_you(user_factory):
    """«Собеседник» на своей же реплике читается как чужая."""
    her, him, chat = await matched_pair(user_factory)
    first = (await her.post(f"/chats/{chat}/messages", json={"body": "мысль"})).json()["message"]
    answer = (
        await her.post(f"/chats/{chat}/messages", json={"body": "и ещё", "reply_to_id": first["id"]})
    ).json()["message"]
    assert answer["reply_to"]["author"] == "Вы"

    # А тому же сообщению у собеседника — имя автора.
    seen = (await him.get(f"/chats/{chat}/messages")).json()
    quoted = next(m for m in seen if m["id"] == answer["id"])
    assert quoted["reply_to"]["author"] == "Аня"


async def test_the_chat_list_survives_a_reply(user_factory):
    """Список чатов достаёт сообщение ради превью, без цитаты.

    Обращение к незагруженной связи в этот момент — ленивая подгрузка в
    асинхронном коде, то есть 500 на весь список. Проверяем именно её.
    """
    her, him, chat = await matched_pair(user_factory)
    first = (await her.post(f"/chats/{chat}/messages", json={"body": "раз"})).json()["message"]
    await him.post(f"/chats/{chat}/messages", json={"body": "два", "reply_to_id": first["id"]})

    for actor in (her, him):
        response = await actor.get("/chats")
        assert response.status_code == 200, response.text
        assert len(response.json()) == 1
