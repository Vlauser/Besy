"""The bot webhook: auth, commands and the payment handshake."""

import pytest
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Purchase
from app.services import bot

pytestmark = pytest.mark.asyncio

SECRET_HEADER = {"X-Telegram-Bot-Api-Secret-Token": "test-secret-key"}


@pytest.fixture(autouse=True)
def captured_calls(monkeypatch):
    """Record Bot API calls instead of reaching api.telegram.org."""
    calls = []

    async def fake_call(method, payload=None, *, raise_on_error=False):
        calls.append((method, payload or {}))
        # createInvoiceLink returns a URL string, not an object.
        if method == "createInvoiceLink":
            return "https://t.me/invoice/test"
        return {"ok": True}

    monkeypatch.setattr(bot, "call", fake_call)
    monkeypatch.setattr(settings, "mini_app_url", "https://t.me/treffit_bot/app")
    return calls


def sent_texts(calls):
    return [payload.get("text", "") for method, payload in calls if method == "sendMessage"]


# --------------------------- authentication ---------------------------


async def test_webhook_without_the_secret_is_rejected(client):
    response = await client.post("/telegram/webhook", json={"update_id": 1})
    assert response.status_code == 401


async def test_webhook_with_a_wrong_secret_is_rejected(client):
    response = await client.post(
        "/telegram/webhook",
        json={"update_id": 1},
        headers={"X-Telegram-Bot-Api-Secret-Token": "guessed"},
    )
    assert response.status_code == 401


async def test_malformed_body_is_shrugged_off(client):
    """A 500 here would make Telegram retry the same junk forever."""
    response = await client.post(
        "/telegram/webhook",
        content=b"not json",
        headers={**SECRET_HEADER, "Content-Type": "application/json"},
    )
    assert response.status_code == 200


# --------------------------- commands ---------------------------


def message_update(text: str, chat_id: int = 900) -> dict:
    return {
        "update_id": 1,
        "message": {"message_id": 1, "chat": {"id": chat_id, "type": "private"}, "text": text},
    }


async def test_start_replies_with_the_mini_app_button(client, captured_calls):
    response = await client.post("/telegram/webhook", json=message_update("/start"), headers=SECRET_HEADER)
    assert response.json()["command"] == "/start"

    method, payload = captured_calls[0]
    assert method == "sendMessage"
    assert "Treffit" in payload["text"]
    button = payload["reply_markup"]["inline_keyboard"][0][0]
    assert button["web_app"]["url"] == "https://t.me/treffit_bot/app"


async def test_start_with_a_bot_suffix_still_works(client, captured_calls):
    """Group chats deliver /start@treffit_bot."""
    response = await client.post(
        "/telegram/webhook", json=message_update("/start@treffit_bot"), headers=SECRET_HEADER
    )
    assert response.json()["command"] == "/start"


async def test_help_explains_the_mechanic(client, captured_calls):
    await client.post("/telegram/webhook", json=message_update("/help"), headers=SECRET_HEADER)
    assert any("три" in text for text in sent_texts(captured_calls))


async def test_unknown_command_points_at_help(client, captured_calls):
    body = (await client.post("/telegram/webhook", json=message_update("/dance"), headers=SECRET_HEADER)).json()
    assert body["command"] == "unknown"
    assert any("/help" in text for text in sent_texts(captured_calls))


async def test_plain_text_is_redirected_into_the_app(client, captured_calls):
    body = (await client.post("/telegram/webhook", json=message_update("привет"), headers=SECRET_HEADER)).json()
    assert body["redirected"] is True
    assert any("приложения" in text for text in sent_texts(captured_calls))


async def test_start_without_a_configured_app_url_says_so(client, captured_calls, monkeypatch):
    monkeypatch.setattr(settings, "mini_app_url", "")
    await client.post("/telegram/webhook", json=message_update("/start"), headers=SECRET_HEADER)
    assert any("TREFFIT_MINI_APP_URL" in text for text in sent_texts(captured_calls))


async def test_updates_without_a_message_are_ignored(client):
    body = (await client.post("/telegram/webhook", json={"update_id": 7}, headers=SECRET_HEADER)).json()
    assert body == {"ok": True, "ignored": True}


# --------------------------- payments ---------------------------


async def make_invoice(actor, product="premium_1m") -> str:
    response = await actor.post("/payments/invoice", json={"product": product})
    assert response.status_code == 200, response.text
    return response.json()["payload"]


def pre_checkout_update(payload: str) -> dict:
    return {
        "update_id": 2,
        "pre_checkout_query": {
            "id": "pcq-1",
            "from": {"id": 900},
            "currency": "XTR",
            "total_amount": 299,
            "invoice_payload": payload,
        },
    }


def payment_update(payload: str, chat_id: int = 900) -> dict:
    return {
        "update_id": 3,
        "message": {
            "message_id": 2,
            "chat": {"id": chat_id, "type": "private"},
            "successful_payment": {
                "currency": "XTR",
                "total_amount": 299,
                "invoice_payload": payload,
                "telegram_payment_charge_id": "charge-1",
            },
        },
    }


async def test_pre_checkout_is_answered(client, user_factory, captured_calls):
    """Telegram cancels the payment if this goes unanswered."""
    actor = await user_factory(910001)
    payload = await make_invoice(actor)

    body = (await client.post("/telegram/webhook", json=pre_checkout_update(payload), headers=SECRET_HEADER)).json()
    assert body["pre_checkout"] == "accepted"

    method, sent = captured_calls[-1]
    assert method == "answerPreCheckoutQuery"
    assert sent["ok"] is True


async def test_pre_checkout_for_an_unknown_invoice_is_declined(client, captured_calls):
    body = (await client.post("/telegram/webhook", json=pre_checkout_update("nope"), headers=SECRET_HEADER)).json()
    assert body["pre_checkout"] == "rejected"
    method, sent = captured_calls[-1]
    assert method == "answerPreCheckoutQuery"
    assert sent["ok"] is False


async def test_successful_payment_grants_premium(client, user_factory):
    actor = await user_factory(910002)
    payload = await make_invoice(actor)
    assert (await actor.get("/me")).json()["is_premium"] is False

    body = (await client.post("/telegram/webhook", json=payment_update(payload), headers=SECRET_HEADER)).json()
    assert body["granted"] == "premium_1m"
    assert (await actor.get("/me")).json()["is_premium"] is True

    async with SessionLocal() as session:
        purchase = await session.scalar(select(Purchase).where(Purchase.payload == payload))
        assert purchase.status == "paid"
        assert purchase.telegram_charge_id == "charge-1"


async def test_a_redelivered_payment_is_not_granted_twice(client, user_factory):
    """Telegram retries until it gets a 200."""
    actor = await user_factory(910003)
    payload = await make_invoice(actor)

    first = (await client.post("/telegram/webhook", json=payment_update(payload), headers=SECRET_HEADER)).json()
    second = (await client.post("/telegram/webhook", json=payment_update(payload), headers=SECRET_HEADER)).json()
    assert first["granted"] == "premium_1m"
    assert second["duplicate"] is True


async def test_pre_checkout_after_payment_is_declined(client, user_factory):
    actor = await user_factory(910004)
    payload = await make_invoice(actor)
    await client.post("/telegram/webhook", json=payment_update(payload), headers=SECRET_HEADER)

    body = (await client.post("/telegram/webhook", json=pre_checkout_update(payload), headers=SECRET_HEADER)).json()
    assert body["pre_checkout"] == "rejected"


async def test_payment_with_an_unknown_payload_is_acknowledged(client):
    body = (await client.post("/telegram/webhook", json=payment_update("ghost"), headers=SECRET_HEADER)).json()
    assert body["unknown_payload"] is True
