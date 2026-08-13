"""End-to-end flow: onboarding → swipe → match → chat → reveal."""

import io

import pytest
from PIL import Image
from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.models import Photo

pytestmark = pytest.mark.asyncio

ALL_LEFT = {"1": "left", "2": "left", "3": "left", "4": "left", "5": "left", "6": "left"}


def png_bytes(color=(120, 140, 220)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (600, 800), color).save(buffer, "PNG")
    return buffer.getvalue()


async def approve_all_photos() -> None:
    """Photos land as `pending`; a moderator normally flips them."""
    async with SessionLocal() as session:
        await session.execute(update(Photo).values(moderation_status="approved"))
        await session.commit()


async def upload_photo(actor) -> dict:
    response = await actor.post(
        "/me/photos", files={"file": ("me.png", png_bytes(), "image/png")}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def make_pair(user_factory):
    her = await user_factory(1001, name="Аня", gender="female", seeking="male")
    him = await user_factory(1002, name="Игорь", gender="male", seeking="female")
    return her, him


# --------------------------- auth & onboarding ---------------------------


async def test_login_creates_user_and_flags_onboarding(client):
    response = await client.post("/auth/telegram", json={"dev_telegram_id": 500, "dev_first_name": "Лена"})
    assert response.status_code == 200
    body = response.json()
    assert body["is_new"] is True
    assert body["needs_onboarding"] is True
    assert body["user"]["first_name"] == "Лена"

    again = await client.post("/auth/telegram", json={"dev_telegram_id": 500})
    assert again.json()["is_new"] is False


async def test_login_without_init_data_is_rejected(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_dev_auth", False)
    response = await client.post("/auth/telegram", json={"dev_telegram_id": 501})
    assert response.status_code == 401


async def test_api_requires_a_token(client):
    assert (await client.get("/me")).status_code == 401
    assert (await client.get("/discover")).status_code == 401


async def test_under_18_is_refused(user_factory):
    actor = await user_factory(502, onboard=False)
    response = await actor.patch("/me", json={"birth_date": "2015-01-01", "gender": "female"})
    assert response.status_code == 422
    assert "18" in response.text


async def test_birth_date_is_frozen_after_the_first_save(user_factory):
    actor = await user_factory(503)
    response = await actor.patch("/me", json={"birth_date": "1990-01-01"})
    assert response.status_code == 409


async def test_discovery_is_blocked_until_onboarding_is_done(user_factory):
    actor = await user_factory(504, onboard=False)
    response = await actor.get("/discover")
    assert response.status_code == 428


async def test_test_answers_complete_the_profile(user_factory):
    actor = await user_factory(505, onboard=False)
    await actor.post("/me/consent", json={"pdn": True, "photo": True})
    await actor.patch("/me", json={"birth_date": "1995-03-03", "gender": "female", "seeking_gender": "male"})
    body = (await actor.post("/me/test-answers", json={"answers": ALL_LEFT})).json()
    assert body["is_onboarded"] is True
    assert body["test_answers"] == ALL_LEFT


async def test_unknown_answers_are_refused(user_factory):
    actor = await user_factory(506)
    response = await actor.post("/me/test-answers", json={"answers": {"42": "sideways"}})
    assert response.status_code == 422


# --------------------------- discovery & swipes ---------------------------


async def test_deck_respects_gender_preference(user_factory):
    her = await user_factory(600, gender="female", seeking="male")
    await user_factory(601, gender="male", seeking="female")
    await user_factory(602, gender="female", seeking="male")

    ids = [c["id"] for c in (await her.get("/discover")).json()]
    assert 601 not in ids  # telegram ids differ from user ids
    names = [c["first_name"] for c in (await her.get("/discover")).json()]
    assert len(names) == 1  # only the man who is looking for women


async def test_one_sided_like_does_not_create_a_match(user_factory):
    her, him = await make_pair(user_factory)
    response = await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    assert response.status_code == 200
    assert response.json()["matched"] is False
    assert (await her.get("/matches")).json() == []


async def test_mutual_like_creates_a_match_and_a_chat(user_factory):
    her, him = await make_pair(user_factory)
    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    result = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()

    assert result["matched"] is True
    assert result["chat_id"] is not None
    for actor in (her, him):
        matches = (await actor.get("/matches")).json()
        assert len(matches) == 1
        assert matches[0]["chat_id"] == result["chat_id"]


async def test_a_pass_never_matches(user_factory):
    her, him = await make_pair(user_factory)
    await her.post(f"/discover/{him.id}/swipe", json={"action": "pass"})
    result = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()
    assert result["matched"] is False


async def test_swiped_profiles_leave_the_deck(user_factory):
    her, him = await make_pair(user_factory)
    assert len((await her.get("/discover")).json()) == 1
    await her.post(f"/discover/{him.id}/swipe", json={"action": "pass"})
    assert (await her.get("/discover")).json() == []


async def test_cannot_swipe_yourself(user_factory):
    her = await user_factory(610)
    assert (await her.post(f"/discover/{her.id}/swipe", json={"action": "like"})).status_code == 422


async def test_daily_like_limit_is_enforced(user_factory, monkeypatch):
    monkeypatch.setattr(settings, "daily_like_limit", 1)
    her = await user_factory(620, gender="female", seeking="male")
    a = await user_factory(621, gender="male", seeking="female")
    b = await user_factory(622, gender="male", seeking="female")

    assert (await her.post(f"/discover/{a.id}/swipe", json={"action": "like"})).status_code == 200
    blocked = await her.post(f"/discover/{b.id}/swipe", json={"action": "like"})
    assert blocked.status_code == 429
    # A pass still works — the limit is on likes only.
    assert (await her.post(f"/discover/{b.id}/swipe", json={"action": "pass"})).status_code == 200


async def test_incoming_likes_are_premium_only(user_factory):
    her, him = await make_pair(user_factory)
    await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})
    assert (await her.get("/discover/likes")).status_code == 402


# --------------------------- scratch pack ---------------------------


async def test_unscratched_cards_leak_nothing(user_factory):
    her, him = await make_pair(user_factory)
    cards = (await her.get("/deck")).json()
    assert len(cards) == 1
    assert cards[0]["scratched"] is False
    assert cards[0]["candidate"] is None
    assert cards[0]["compatibility_pct"] is None


async def test_scratching_reveals_the_candidate(user_factory):
    her, him = await make_pair(user_factory)
    card_id = (await her.get("/deck")).json()[0]["id"]
    revealed = (await her.post(f"/deck/{card_id}/scratch")).json()

    assert revealed["scratched"] is True
    assert revealed["candidate"]["first_name"] == "Игорь"
    assert revealed["compatibility_pct"] == 99


async def test_cannot_scratch_someone_elses_card(user_factory):
    her, him = await make_pair(user_factory)
    card_id = (await her.get("/deck")).json()[0]["id"]
    assert (await him.post(f"/deck/{card_id}/scratch")).status_code == 404


# --------------------------- chat & reveal ---------------------------


async def matched_chat(user_factory):
    her, him = await make_pair(user_factory)
    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    chat_id = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()["chat_id"]
    return her, him, chat_id


async def test_chat_opens_with_a_system_opener(user_factory):
    her, _, chat_id = await matched_chat(user_factory)
    messages = (await her.get(f"/chats/{chat_id}/messages")).json()
    assert len(messages) == 1
    assert messages[0]["type"] == "system"


async def test_messages_reach_the_other_side(user_factory):
    her, him, chat_id = await matched_chat(user_factory)
    await her.post(f"/chats/{chat_id}/messages", json={"body": "Привет!"})

    his_view = (await him.get(f"/chats/{chat_id}/messages")).json()
    assert his_view[-1]["body"] == "Привет!"
    assert his_view[-1]["mine"] is False

    her_view = (await her.get(f"/chats/{chat_id}/messages")).json()
    assert her_view[-1]["mine"] is True


async def test_outsiders_cannot_read_a_chat(user_factory):
    _, _, chat_id = await matched_chat(user_factory)
    stranger = await user_factory(1099, gender="female", seeking="male")
    assert (await stranger.get(f"/chats/{chat_id}/messages")).status_code == 404
    assert (await stranger.post(f"/chats/{chat_id}/messages", json={"body": "хай"})).status_code == 404


async def test_reveal_unlocks_only_at_the_threshold(user_factory):
    her, _, chat_id = await matched_chat(user_factory)
    for index in range(settings.reveal_threshold - 1):
        body = (await her.post(f"/chats/{chat_id}/messages", json={"body": f"сообщение {index}"})).json()
        assert body["reveal_unlocked"] is False
        assert body["remaining_to_reveal"] == settings.reveal_threshold - index - 1

    final = (await her.post(f"/chats/{chat_id}/messages", json={"body": "третье"})).json()
    assert final["reveal_unlocked"] is True
    assert final["remaining_to_reveal"] == 0
    assert final["system_message"] is not None


async def test_each_side_earns_its_own_reveal(user_factory):
    her, him, chat_id = await matched_chat(user_factory)
    for _ in range(settings.reveal_threshold):
        await her.post(f"/chats/{chat_id}/messages", json={"body": "раз"})

    assert (await her.get(f"/chats/{chat_id}")).json()["revealed"] is True
    assert (await him.get(f"/chats/{chat_id}")).json()["revealed"] is False


async def test_photo_is_withheld_until_the_reveal_is_earned(user_factory):
    her, him, chat_id = await matched_chat(user_factory)
    await upload_photo(him)
    await approve_all_photos()

    early = await her.get(f"/chats/{chat_id}/photo")
    assert early.status_code == 403
    assert "до открытия фото" in early.text

    for _ in range(settings.reveal_threshold):
        await her.post(f"/chats/{chat_id}/messages", json={"body": "разговор"})

    unlocked = await her.get(f"/chats/{chat_id}/photo")
    assert unlocked.status_code == 200
    assert unlocked.json()["url"].startswith("/media/photos/")


async def test_photo_bytes_are_refused_before_reveal(user_factory):
    """The URL is not the only guard — the file handler re-checks."""
    her, him, chat_id = await matched_chat(user_factory)
    photo = await upload_photo(him)
    await approve_all_photos()

    forbidden = await her.get(f"/media/photos/{photo['id']}")
    assert forbidden.status_code == 403

    for _ in range(settings.reveal_threshold):
        await her.post(f"/chats/{chat_id}/messages", json={"body": "разговор"})

    allowed = await her.get(f"/media/photos/{photo['id']}")
    assert allowed.status_code == 200
    assert allowed.headers["content-type"] == "image/jpeg"


async def test_candidate_payload_never_carries_a_locked_url(user_factory):
    her, him = await make_pair(user_factory)
    await upload_photo(him)
    await approve_all_photos()

    candidate = (await her.get("/discover")).json()[0]
    assert candidate["photos_locked"] is True
    assert candidate["photos"]
    assert all(p["url"] is None for p in candidate["photos"])
    assert all(p["gradient"].startswith("linear-gradient") for p in candidate["photos"])


async def test_open_mode_shows_photos_in_the_deck(user_factory, monkeypatch):
    monkeypatch.setattr(settings, "blind_mode", False)
    her, him = await make_pair(user_factory)
    await upload_photo(him)
    await approve_all_photos()

    candidate = (await her.get("/discover")).json()[0]
    assert candidate["photos_locked"] is False
    assert candidate["photos"][0]["url"] is not None


async def test_owner_always_sees_their_own_photo(user_factory):
    her = await user_factory(700)
    photo = await upload_photo(her)
    # Still `pending` moderation, but the owner is never blocked from it.
    assert (await her.get(f"/media/photos/{photo['id']}")).status_code == 200


async def test_photo_upload_needs_consent(user_factory):
    actor = await user_factory(701, onboard=False)
    await actor.post("/me/consent", json={"pdn": True})
    response = await actor.post("/me/photos", files={"file": ("x.png", png_bytes(), "image/png")})
    assert response.status_code == 403


async def test_non_image_upload_is_refused(user_factory):
    actor = await user_factory(702)
    response = await actor.post("/me/photos", files={"file": ("x.png", b"not an image", "image/png")})
    assert response.status_code == 422


async def test_empty_message_is_refused(user_factory):
    her, _, chat_id = await matched_chat(user_factory)
    assert (await her.post(f"/chats/{chat_id}/messages", json={"body": "   "})).status_code == 422


async def test_unread_counter_tracks_and_clears(user_factory):
    her, him, chat_id = await matched_chat(user_factory)
    await her.post(f"/chats/{chat_id}/messages", json={"body": "ау"})
    await her.post(f"/chats/{chat_id}/messages", json={"body": "ты тут?"})

    his_chats = (await him.get("/chats")).json()
    assert his_chats[0]["unread"] == 2
    assert his_chats[0]["last_message"]["body"] == "ты тут?"

    await him.post(f"/chats/{chat_id}/read")
    assert (await him.get("/chats")).json()[0]["unread"] == 0


# --------------------------- safety ---------------------------


async def test_blocking_hides_both_ways_and_kills_the_match(user_factory):
    her, him, _ = await matched_chat(user_factory)
    await her.post("/safety/block", json={"user_id": him.id})

    assert (await her.get("/matches")).json() == []
    assert (await him.get("/matches")).json() == []
    assert (await her.get("/discover")).json() == []
    assert (await him.get("/discover")).json() == []


async def test_reporting_blocks_the_target_too(user_factory):
    her, him = await make_pair(user_factory)
    response = await her.post("/safety/report", json={"user_id": him.id, "reason": "spam"})
    assert response.status_code == 201
    assert (await her.get("/safety/blocks")).json() == [him.id]


async def test_enough_reports_ban_a_profile(user_factory):
    target = await user_factory(800, gender="male", seeking="female")
    for index in range(5):
        reporter = await user_factory(810 + index, gender="female", seeking="male")
        await reporter.post("/safety/report", json={"user_id": target.id, "reason": "fake"})

    assert (await target.get("/me")).status_code == 403


async def test_deactivated_profile_disappears_from_discovery(user_factory):
    her, him = await make_pair(user_factory)
    await him.delete("/me")
    assert (await her.get("/discover")).json() == []


# --------------------------- meta ---------------------------


async def test_config_exposes_the_rules_the_client_needs(client):
    body = (await client.get("/config")).json()
    assert body["reveal_threshold"] == settings.reveal_threshold
    assert body["min_age"] == 18
    assert len(body["test_cards"]) == 6
    assert body["test_cards"][0]["left"] == "Вечеринка"


async def test_config_reports_whether_dev_login_is_offered(client, monkeypatch):
    """The client must not offer a dev sign-in on production: there an empty
    initData is a failure, not an invitation to pick a demo profile."""
    monkeypatch.setattr(settings, "allow_dev_auth", False)
    assert (await client.get("/config")).json()["dev_auth_allowed"] is False

    monkeypatch.setattr(settings, "allow_dev_auth", True)
    assert (await client.get("/config")).json()["dev_auth_allowed"] is True


async def test_health(client):
    assert (await client.get("/health")).json() == {"status": "ok"}
