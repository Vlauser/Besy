"""Отмена последнего свайпа.

Место, где легко сделать хуже, чем было: отмена не должна разбирать
случившуюся пару, возвращать чужую анкету или дарить лишний лайк.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def pair(user_factory, base=3000):
    her = await user_factory(base, name="Аня", gender="female", seeking="male")
    him = await user_factory(base + 1, name="Игорь", gender="male", seeking="female")
    return her, him


# Колода намеренно возвращает ранее пропущенных, поэтому «пусто после
# свайпа» бывает только у лайка: лайкнутые обратно не приходят никогда.
# На нём и проверяем, что анкета действительно ушла и вернулась.
async def test_undo_returns_the_person_to_the_deck(user_factory):
    her, him = await pair(user_factory)
    assert [c["id"] for c in (await her.get("/discover")).json()] == [him.id]

    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    assert (await her.get("/discover")).json() == []

    undone = await her.post("/discover/undo")
    assert undone.status_code == 200, undone.text
    assert undone.json()["candidate"]["id"] == him.id
    assert [c["id"] for c in (await her.get("/discover")).json()] == [him.id]


async def test_undo_gives_the_like_back(user_factory):
    her, him = await pair(user_factory)
    spent = (await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})).json()
    restored = (await her.post("/discover/undo")).json()
    assert restored["likes_left"] == spent["likes_left"] + 1


async def test_a_match_cannot_be_undone(user_factory):
    """Чат уже открыт у обоих — отматывать это за двоих нельзя."""
    her, him = await pair(user_factory)
    await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})
    result = (await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})).json()
    assert result["matched"] is True

    refused = await her.post("/discover/undo")
    assert refused.status_code == 409
    # И чат на месте.
    assert len((await her.get("/chats")).json()) == 1


async def test_undo_touches_only_the_last_swipe(user_factory):
    her = await user_factory(3100, name="Аня", gender="female", seeking="male")
    first = await user_factory(3101, name="Пётр", gender="male", seeking="female")
    second = await user_factory(3102, name="Олег", gender="male", seeking="female")

    await her.post(f"/discover/{first.id}/swipe", json={"action": "like"})
    await her.post(f"/discover/{second.id}/swipe", json={"action": "like"})

    returned = (await her.post("/discover/undo")).json()["candidate"]["id"]
    assert returned == second.id
    deck = [c["id"] for c in (await her.get("/discover")).json()]
    assert deck == [second.id], "первый лайк отменяться не должен"


async def test_undo_without_a_swipe_is_a_clear_refusal(user_factory):
    her, _ = await pair(user_factory, base=3200)
    response = await her.post("/discover/undo")
    assert response.status_code == 404
    assert "Отменять нечего" in response.json()["detail"]


async def test_someone_elses_swipe_is_not_undoable(user_factory):
    """Отмена берёт последний свайп зрителя, а не последний вообще."""
    her, him = await pair(user_factory, base=3300)
    # Порядок здесь и есть проверка: её свайп раньше, его — позже. Если
    # отмена берёт «последний свайп» вообще, а не последний свой, она
    # снимет чужой, и обе проверки ниже разойдутся.
    await her.post(f"/discover/{him.id}/swipe", json={"action": "pass"})
    await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})
    # Ноль, потому что счётчик показывает только неотвеченные лайки, а она
    # ему уже ответила пропуском.
    assert (await her.get("/discover/likes/count")).json()["count"] == 0

    returned = (await her.post("/discover/undo")).json()["candidate"]["id"]
    assert returned == him.id, "вернулась чужая анкета — отмена взяла не свой свайп"
    # Единица здесь говорит сразу о двух вещах: её пропуск снят, а его лайк
    # цел. Снеси отмена чужой свайп — счётчик остался бы нулём.
    assert (await her.get("/discover/likes/count")).json()["count"] == 1
