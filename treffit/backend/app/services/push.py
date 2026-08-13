"""Telegram push notifications.

A Mini App cannot wake anyone by itself — the bot has to send the message.
Pushes only go to people who are *not* currently connected, and are rate
limited per chat, so a fast back-and-forth produces one ping, not twenty.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..models import Chat, User
from ..ws import manager
from . import bot

logger = logging.getLogger(__name__)

PREVIEW_LIMIT = 80


async def send(telegram_id: int, text: str) -> bool:
    return await bot.send_message(telegram_id, text, keyboard=bot.webapp_keyboard())


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _preview(body: str) -> str:
    body = body.strip().replace("\n", " ")
    if len(body) > PREVIEW_LIMIT:
        body = body[: PREVIEW_LIMIT - 1].rstrip() + "…"
    return _escape(body)


def _cooldown_passed(chat: Chat, recipient_id: int) -> bool:
    last = chat.last_push_a if recipient_id == chat.user_a_id else chat.last_push_b
    if last is None:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last >= timedelta(seconds=settings.push_cooldown_seconds)


def _stamp(chat: Chat, recipient_id: int) -> None:
    now = datetime.now(timezone.utc)
    if recipient_id == chat.user_a_id:
        chat.last_push_a = now
    else:
        chat.last_push_b = now


async def notify_new_message(chat: Chat, sender: User, recipient: User, body: str) -> bool:
    """Ping the recipient about a message, if that is warranted.

    Returns whether a push was actually sent. Mutates the chat's push
    timestamp — the caller is expected to commit.
    """
    if not settings.push_enabled or not recipient.is_active or recipient.is_banned:
        return False
    if await manager.is_online_anywhere(recipient.id):
        return False
    if not _cooldown_passed(chat, recipient.id):
        return False

    # In blind mode the preview would leak nothing about looks, but it still
    # leaks the conversation into a notification bar. Names only.
    text = (
        f"💬 <b>{_escape(sender.first_name)}</b> написал(а) вам в Treffit\n\n{_preview(body)}"
    )
    sent = await send(recipient.telegram_id, text)
    if sent:
        _stamp(chat, recipient.id)
    return sent


async def notify_match(recipient: User, other: User) -> bool:
    if not settings.push_enabled or not recipient.is_active or recipient.is_banned:
        return False
    if await manager.is_online_anywhere(recipient.id):
        return False
    return await send(
        recipient.telegram_id,
        f"✨ Взаимно! Вы и <b>{_escape(other.first_name)}</b> понравились друг другу.",
    )


async def notify_moderation(user: User, approved: bool, reason: str | None = None) -> bool:
    if not settings.push_enabled:
        return False
    if approved:
        text = "✅ Ваше фото прошло модерацию и теперь видно в Treffit."
    else:
        tail = f"\n\nПричина: {_escape(reason)}" if reason else ""
        text = f"⚠️ Фото не прошло модерацию и не будет показано.{tail}"
    return await send(user.telegram_id, text)


async def notify_verification(user: User, approved: bool, reason: str | None = None) -> bool:
    if not settings.push_enabled:
        return False
    if approved:
        text = "✅ Анкета подтверждена — теперь у вас галочка верификации."
    else:
        tail = f"\n\nПричина: {_escape(reason)}" if reason else ""
        text = f"⚠️ Не удалось подтвердить анкету. Попробуйте ещё раз.{tail}"
    return await send(user.telegram_id, text)
