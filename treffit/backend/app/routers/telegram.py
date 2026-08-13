"""Single Telegram webhook for everything the bot receives.

Telegram delivers all update types to one URL, so there is one endpoint
here that dispatches them: bot commands, the pre-checkout handshake and
successful payments.
"""

from __future__ import annotations

import logging
import secrets as secrets_module
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..models import Purchase, User
from ..services import bot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])

COMMANDS = [
    ("start", "Открыть Treffit"),
    ("app", "Открыть Treffit"),
    ("help", "Как это работает"),
]

WELCOME = (
    "Привет! Это <b>Treffit</b> — знакомства, где сначала разговор, а потом фото.\n\n"
    "Пройдите короткий тест из шести вопросов, листайте колоду, а фото "
    "собеседника откроется, когда вы напишете ему три сообщения."
)

HELP = (
    "<b>Как устроен Treffit</b>\n\n"
    "• <b>Колода</b> — свайп вправо, если нравится, влево — мимо.\n"
    "• <b>Пачка</b> — скретч-карты: потрите, чтобы узнать, кто там.\n"
    "• <b>Чат</b> открывается при взаимной симпатии.\n"
    "• <b>Фото</b> появляется после трёх ваших сообщений — у каждого свой счётчик.\n\n"
    "Жалобы и блокировка — значок щита в правом верхнем углу чата."
)

NO_APP_URL = (
    "Mini App пока не настроен: администратору нужно задать TREFFIT_MINI_APP_URL."
)


def verify_secret(header_value: str | None) -> None:
    """Telegram signs nothing here.

    The shared secret from `setWebhook(secret_token=...)` is the only thing
    separating a real update from anyone who guessed the URL.
    """
    expected = settings.secret_key
    if not header_value or not secrets_module.compare_digest(header_value, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad secret token")


def grant(user: User, product: str) -> None:
    if product == "premium_1m":
        user.is_premium = True
    # boost / likes_pack are consumed by the discovery layer; the purchase
    # row is the record and no profile flag changes.


async def handle_command(text: str, chat_id: int) -> str:
    command = text.split()[0].split("@")[0].lower()
    keyboard = bot.webapp_keyboard()

    if command in ("/start", "/app"):
        await bot.send_message(chat_id, WELCOME if keyboard else NO_APP_URL, keyboard=keyboard)
        return command
    if command == "/help":
        await bot.send_message(chat_id, HELP, keyboard=keyboard)
        return command

    await bot.send_message(chat_id, "Не знаю такой команды. Наберите /help.", keyboard=keyboard)
    return "unknown"


async def handle_successful_payment(payment: dict, session: AsyncSession) -> dict:
    invoice_payload = payment.get("invoice_payload")
    purchase = await session.scalar(select(Purchase).where(Purchase.payload == invoice_payload))
    if purchase is None:
        logger.warning("Оплата с неизвестным payload: %s", invoice_payload)
        return {"ok": True, "unknown_payload": True}
    if purchase.status == "paid":
        # Telegram retries until it gets a 200; granting twice would be a bug.
        return {"ok": True, "duplicate": True}

    purchase.status = "paid"
    purchase.paid_at = datetime.now(timezone.utc)
    purchase.telegram_charge_id = payment.get("telegram_payment_charge_id")

    buyer = await session.get(User, purchase.user_id)
    if buyer is not None:
        grant(buyer, purchase.product)
    await session.commit()

    if buyer is not None:
        await bot.send_message(buyer.telegram_id, "✅ Оплата прошла, покупка активирована.")
    return {"ok": True, "granted": purchase.product}


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    verify_secret(x_telegram_bot_api_secret_token)

    try:
        update = await request.json()
    except ValueError:
        return {"ok": True, "ignored": "malformed"}
    if not isinstance(update, dict):
        return {"ok": True, "ignored": "malformed"}

    # Answering this is not optional: Telegram cancels the payment if the
    # bot stays silent for ~10 seconds.
    pre_checkout = update.get("pre_checkout_query")
    if pre_checkout:
        payload = pre_checkout.get("invoice_payload")
        purchase = await session.scalar(select(Purchase).where(Purchase.payload == payload))
        if purchase is None or purchase.status == "paid":
            await bot.answer_pre_checkout(
                pre_checkout["id"], ok=False, error="Счёт устарел, откройте покупку заново"
            )
            return {"ok": True, "pre_checkout": "rejected"}
        await bot.answer_pre_checkout(pre_checkout["id"])
        return {"ok": True, "pre_checkout": "accepted"}

    message = update.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")

    if message.get("successful_payment"):
        return await handle_successful_payment(message["successful_payment"], session)

    text = (message.get("text") or "").strip()
    if chat_id and text.startswith("/"):
        return {"ok": True, "command": await handle_command(text, chat_id)}

    if chat_id and text:
        # Conversations happen in the Mini App, not in the bot chat.
        await bot.send_message(
            chat_id,
            "Переписка живёт внутри приложения — откройте Treffit.",
            keyboard=bot.webapp_keyboard(),
        )
        return {"ok": True, "redirected": True}

    return {"ok": True, "ignored": True}
