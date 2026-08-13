"""Telegram Bot API client.

One place that talks to api.telegram.org, so the token, timeouts and error
handling are not duplicated across push notifications, payments and setup.
"""

from __future__ import annotations

import json
import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

API_ROOT = "https://api.telegram.org"
TIMEOUT = 10


class BotError(RuntimeError):
    pass


async def call(method: str, payload: dict | None = None, *, raise_on_error: bool = False) -> dict | None:
    """Invoke a Bot API method.

    Returns the `result` field, or None when the call failed. Most callers
    treat failure as "not important enough to break the request" — a user
    who blocked the bot is normal, not an incident — so errors are logged
    rather than raised unless `raise_on_error` is set.
    """
    if not settings.bot_token:
        logger.debug("Bot API вызван без токена: %s", method)
        return None

    url = f"{API_ROOT}/bot{settings.bot_token}/{method}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(url, json=payload or {})
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        if raise_on_error:
            raise BotError(f"{method}: {exc}") from exc
        logger.exception("Не удалось вызвать %s", method)
        return None

    if not data.get("ok"):
        description = data.get("description")
        if raise_on_error:
            raise BotError(f"{method}: {description}")
        logger.info("Telegram отклонил %s: %s", method, description)
        return None
    return data.get("result")


async def send_photo(chat_id: int, path: str, caption: str, *, keyboard: dict | None = None) -> bool:
    """Отправить файл с диска. Отдельно от `call`, потому что здесь
    multipart, а не JSON."""
    if not settings.bot_token:
        return False
    url = f"{API_ROOT}/bot{settings.bot_token}/sendPhoto"
    data = {"chat_id": str(chat_id), "caption": caption, "parse_mode": "HTML"}
    if keyboard:
        data["reply_markup"] = json.dumps(keyboard)
    try:
        with open(path, "rb") as handle:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(url, data=data, files={"photo": handle})
        return bool(response.json().get("ok"))
    except (httpx.HTTPError, OSError, ValueError):
        logger.exception("Не удалось отправить фото модератору")
        return False


async def answer_callback(query_id: str, text: str = "") -> bool:
    """Без ответа кнопка в клиенте крутится до таймаута."""
    return await call("answerCallbackQuery", {"callback_query_id": query_id, "text": text}) is not None


async def edit_caption(chat_id: int, message_id: int, caption: str) -> bool:
    """Заменить подпись и убрать кнопки — чтобы решение нельзя было
    нажать дважды и было видно, чем закончилось."""
    return await call(
        "editMessageCaption",
        {"chat_id": chat_id, "message_id": message_id, "caption": caption, "parse_mode": "HTML"},
    ) is not None


def review_keyboard(kind: str, target_id: int) -> dict:
    return {
        "inline_keyboard": [
            [
                {"text": "✅ Одобрить", "callback_data": f"mod:{kind}:{target_id}:ok"},
                {"text": "⛔️ Отклонить", "callback_data": f"mod:{kind}:{target_id}:no"},
            ]
        ]
    }


def webapp_keyboard(text: str = "Открыть Treffit") -> dict | None:
    """Inline button that launches the Mini App, if its URL is configured."""
    if not settings.mini_app_url:
        return None
    return {"inline_keyboard": [[{"text": text, "web_app": {"url": settings.mini_app_url}}]]}


async def send_message(chat_id: int, text: str, *, keyboard: dict | None = None) -> bool:
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if keyboard:
        payload["reply_markup"] = keyboard
    return await call("sendMessage", payload) is not None


async def answer_pre_checkout(query_id: str, *, ok: bool = True, error: str | None = None) -> bool:
    """Telegram cancels a payment unless this is answered within ~10s."""
    payload: dict = {"pre_checkout_query_id": query_id, "ok": ok}
    if not ok:
        payload["error_message"] = error or "Платёж недоступен, попробуйте позже"
    return await call("answerPreCheckoutQuery", payload) is not None


# ---------------- one-off setup (scripts/setup_bot.py) ----------------


async def get_me() -> dict | None:
    return await call("getMe", raise_on_error=True)


async def set_webhook(url: str, secret: str) -> dict | None:
    return await call(
        "setWebhook",
        {
            "url": url,
            "secret_token": secret,
            # Everything the app actually handles. Narrowing this keeps
            # unrelated traffic (channel posts, edits) off the endpoint.
            "allowed_updates": ["message", "pre_checkout_query", "callback_query"],
            "drop_pending_updates": True,
        },
        raise_on_error=True,
    )


async def delete_webhook() -> dict | None:
    return await call("deleteWebhook", {"drop_pending_updates": True}, raise_on_error=True)


async def set_my_commands(commands: list[tuple[str, str]]) -> dict | None:
    return await call(
        "setMyCommands",
        {"commands": [{"command": name, "description": text} for name, text in commands]},
        raise_on_error=True,
    )


async def set_chat_menu_button() -> dict | None:
    """Turn the bot's ☰ button into a Mini App launcher."""
    if not settings.mini_app_url:
        return None
    return await call(
        "setChatMenuButton",
        {"menu_button": {"type": "web_app", "text": "Treffit", "web_app": {"url": settings.mini_app_url}}},
        raise_on_error=True,
    )
