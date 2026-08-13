"""Admin console, verification flow and push notifications."""

import io

import pytest
from PIL import Image
from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.models import Photo, User, Verification
from app.services import push
from app.ws import manager

pytestmark = pytest.mark.asyncio

ADMIN_TG = 555001


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (400, 500), (170, 160, 200)).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def admin_configured(monkeypatch):
    monkeypatch.setattr(settings, "admin_telegram_ids", str(ADMIN_TG))
    # Keep the ONNX model out of unit tests; policy has its own suite.
    monkeypatch.setattr(settings, "moderation_enabled", False)
    yield


@pytest.fixture(autouse=True)
def no_outbound_telegram(monkeypatch):
    """Never touch api.telegram.org from tests; record calls instead."""
    sent = []

    async def fake_call(method, payload):
        sent.append((method, payload))
        return True

    monkeypatch.setattr(push, "_call", fake_call)
    return sent


async def upload_photo(actor):
    response = await actor.post("/me/photos", files={"file": ("p.png", png_bytes(), "image/png")})
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------- access control ---------------------------


async def test_admin_endpoints_reject_ordinary_users(user_factory):
    actor = await user_factory(700100)
    for path in ("/admin/stats", "/admin/photos", "/admin/verifications", "/admin/reports"):
        assert (await actor.get(path)).status_code == 403, path


async def test_admin_endpoints_reject_anonymous(client):
    assert (await client.get("/admin/stats")).status_code == 401


async def test_admin_listed_in_settings_gets_in(user_factory):
    admin = await user_factory(ADMIN_TG, name="Модератор")
    assert (await admin.get("/admin/stats")).status_code == 200


# --------------------------- photo moderation ---------------------------


async def test_uploaded_photo_lands_in_the_queue(user_factory):
    admin = await user_factory(ADMIN_TG)
    author = await user_factory(700101, name="Соня")
    photo = await upload_photo(author)

    queue = (await admin.get("/admin/photos")).json()
    assert [item["id"] for item in queue] == [photo["id"]]
    assert queue[0]["user_name"] == "Соня"


async def test_approving_a_photo_makes_it_visible_and_pings_the_owner(user_factory, no_outbound_telegram):
    admin = await user_factory(ADMIN_TG)
    author = await user_factory(700102, gender="male", seeking="female")
    viewer = await user_factory(700103, gender="female", seeking="male")
    photo = await upload_photo(author)

    # Pending photos are not served to anyone but their owner.
    assert (await viewer.get(f"/media/photos/{photo['id']}")).status_code == 404

    reviewed = await admin.post(f"/admin/photos/{photo['id']}/review", json={"approve": True})
    assert reviewed.status_code == 200
    assert reviewed.json()["moderation_status"] == "approved"
    assert any("прошло модерацию" in payload["text"] for _, payload in no_outbound_telegram)

    # Still blind-mode locked for a stranger, but no longer a 404.
    assert (await viewer.get(f"/media/photos/{photo['id']}")).status_code == 403


async def test_rejected_photo_disappears_from_the_profile(user_factory):
    admin = await user_factory(ADMIN_TG)
    author = await user_factory(700104)
    photo = await upload_photo(author)

    await admin.post(f"/admin/photos/{photo['id']}/review", json={"approve": False, "reason": "Обнажение"})
    assert (await author.get("/me")).json()["photos"] == []


async def test_admin_can_view_the_file_it_is_judging(user_factory):
    admin = await user_factory(ADMIN_TG)
    author = await user_factory(700105)
    photo = await upload_photo(author)

    response = await admin.get(f"/admin/photos/{photo['id']}/file")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"


async def test_queue_can_be_filtered_by_status(user_factory):
    admin = await user_factory(ADMIN_TG)
    author = await user_factory(700106)
    photo = await upload_photo(author)
    await admin.post(f"/admin/photos/{photo['id']}/review", json={"approve": True})

    assert (await admin.get("/admin/photos")).json() == []
    assert len((await admin.get("/admin/photos?status=approved")).json()) == 1


# --------------------------- verification ---------------------------


async def test_verification_starts_with_a_gesture(user_factory):
    actor = await user_factory(700200)
    body = (await actor.post("/me/verification/start")).json()
    assert body["status"] == "requested"
    assert body["gesture"]
    assert body["instruction"]
    assert body["is_verified"] is False


async def test_restarting_keeps_the_same_gesture(user_factory):
    """Otherwise you could reroll until you get an easy one."""
    actor = await user_factory(700201)
    first = (await actor.post("/me/verification/start")).json()
    second = (await actor.post("/me/verification/start")).json()
    assert first["gesture"] == second["gesture"]


async def test_selfie_requires_a_started_request(user_factory):
    actor = await user_factory(700202)
    response = await actor.post(
        "/me/verification/photo", files={"file": ("s.png", png_bytes(), "image/png")}
    )
    assert response.status_code == 409


async def test_full_verification_flow_sets_the_checkmark(user_factory, no_outbound_telegram):
    admin = await user_factory(ADMIN_TG)
    actor = await user_factory(700203, name="Лера")
    await actor.post("/me/verification/start")
    submitted = await actor.post(
        "/me/verification/photo", files={"file": ("s.png", png_bytes(), "image/png")}
    )
    assert submitted.json()["status"] == "submitted"

    queue = (await admin.get("/admin/verifications")).json()
    assert len(queue) == 1
    assert queue[0]["user_name"] == "Лера"
    assert queue[0]["selfie_url"]

    assert (await admin.get(queue[0]["selfie_url"])).status_code == 200

    reviewed = await admin.post(f"/admin/verifications/{queue[0]['id']}/review", json={"approve": True})
    assert reviewed.status_code == 200
    assert (await actor.get("/me")).json()["is_verified"] is True
    assert any("подтверждена" in payload["text"] for _, payload in no_outbound_telegram)


async def test_selfie_is_deleted_once_reviewed(user_factory):
    """It was only ever needed to prove liveness — keeping it is a liability."""
    admin = await user_factory(ADMIN_TG)
    actor = await user_factory(700204)
    await actor.post("/me/verification/start")
    await actor.post("/me/verification/photo", files={"file": ("s.png", png_bytes(), "image/png")})

    request_id = (await admin.get("/admin/verifications")).json()[0]["id"]
    await admin.post(f"/admin/verifications/{request_id}/review", json={"approve": True})

    async with SessionLocal() as session:
        stored = await session.get(Verification, request_id)
        assert stored.file_path is None
    assert (await admin.get(f"/admin/verifications/{request_id}/file")).status_code == 404


async def test_rejected_verification_leaves_no_checkmark(user_factory):
    admin = await user_factory(ADMIN_TG)
    actor = await user_factory(700205)
    await actor.post("/me/verification/start")
    await actor.post("/me/verification/photo", files={"file": ("s.png", png_bytes(), "image/png")})
    request_id = (await admin.get("/admin/verifications")).json()[0]["id"]

    await admin.post(
        f"/admin/verifications/{request_id}/review", json={"approve": False, "reason": "Жест не совпал"}
    )
    assert (await actor.get("/me")).json()["is_verified"] is False


async def test_verified_user_cannot_start_again(user_factory):
    admin = await user_factory(ADMIN_TG)
    actor = await user_factory(700206)
    await actor.post("/me/verification/start")
    await actor.post("/me/verification/photo", files={"file": ("s.png", png_bytes(), "image/png")})
    request_id = (await admin.get("/admin/verifications")).json()[0]["id"]
    await admin.post(f"/admin/verifications/{request_id}/review", json={"approve": True})

    assert (await actor.post("/me/verification/start")).status_code == 409


# --------------------------- reports & bans ---------------------------


async def test_reports_reach_the_queue_and_can_be_resolved(user_factory):
    admin = await user_factory(ADMIN_TG)
    reporter = await user_factory(700300, gender="female", seeking="male")
    target = await user_factory(700301, gender="male", seeking="female")

    await reporter.post("/safety/report", json={"user_id": target.id, "reason": "spam"})
    queue = (await admin.get("/admin/reports")).json()
    assert len(queue) == 1
    assert queue[0]["target_id"] == target.id

    assert (await admin.post(f"/admin/reports/{queue[0]['id']}/resolve")).status_code == 204
    assert (await admin.get("/admin/reports")).json() == []


async def test_ban_and_unban(user_factory):
    admin = await user_factory(ADMIN_TG)
    target = await user_factory(700302)

    assert (await admin.post(f"/admin/users/{target.id}/ban")).status_code == 204
    assert (await target.get("/me")).status_code == 403

    assert (await admin.post(f"/admin/users/{target.id}/unban")).status_code == 204
    assert (await target.get("/me")).status_code == 200


async def test_stats_count_what_moderators_need(user_factory):
    admin = await user_factory(ADMIN_TG)
    author = await user_factory(700400)
    await upload_photo(author)

    body = (await admin.get("/admin/stats")).json()
    assert body["users_total"] >= 2
    assert body["photos_pending"] == 1
    assert body["users_banned"] == 0


# --------------------------- push notifications ---------------------------


async def test_offline_recipient_gets_a_push(user_factory, no_outbound_telegram):
    her = await user_factory(700500, gender="female", seeking="male")
    him = await user_factory(700501, gender="male", seeking="female")
    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    chat_id = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()["chat_id"]

    no_outbound_telegram.clear()
    await her.post(f"/chats/{chat_id}/messages", json={"body": "Привет!"})

    assert len(no_outbound_telegram) == 1
    method, payload = no_outbound_telegram[0]
    assert method == "sendMessage"
    assert "Привет!" in payload["text"]


async def test_a_burst_of_messages_is_one_push(user_factory, no_outbound_telegram):
    her = await user_factory(700502, gender="female", seeking="male")
    him = await user_factory(700503, gender="male", seeking="female")
    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    chat_id = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()["chat_id"]

    no_outbound_telegram.clear()
    for text in ("раз", "два", "три"):
        await her.post(f"/chats/{chat_id}/messages", json={"body": text})

    assert len(no_outbound_telegram) == 1


async def test_online_recipient_is_not_pushed(user_factory, no_outbound_telegram, monkeypatch):
    her = await user_factory(700504, gender="female", seeking="male")
    him = await user_factory(700505, gender="male", seeking="female")
    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    chat_id = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()["chat_id"]

    async def always_online(_user_id):
        return True

    monkeypatch.setattr(manager, "is_online_anywhere", always_online)
    no_outbound_telegram.clear()
    await her.post(f"/chats/{chat_id}/messages", json={"body": "ты тут?"})
    assert no_outbound_telegram == []


async def test_push_is_disabled_by_settings(user_factory, no_outbound_telegram, monkeypatch):
    monkeypatch.setattr(settings, "push_enabled", False)
    her = await user_factory(700506, gender="female", seeking="male")
    him = await user_factory(700507, gender="male", seeking="female")
    await her.post(f"/discover/{him.id}/swipe", json={"action": "like"})
    chat_id = (await him.post(f"/discover/{her.id}/swipe", json={"action": "like"})).json()["chat_id"]

    no_outbound_telegram.clear()
    await her.post(f"/chats/{chat_id}/messages", json={"body": "эй"})
    assert no_outbound_telegram == []


async def test_long_message_preview_is_trimmed():
    assert push._preview("a" * 500).endswith("…")
    assert len(push._preview("a" * 500)) <= push.PREVIEW_LIMIT


async def test_preview_escapes_html():
    assert "<b>" not in push._preview("<b>жирный</b>")
