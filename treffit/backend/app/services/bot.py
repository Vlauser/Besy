"""Telegram Bot API client.

One place that talks to api.telegram.org, so the token, timeouts and error
handling are not duplicated across push notifications, payments and setup.
"""

from __future__ import annotations

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
            "allowed_updates": ["message", "pre_checkout_query"],
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
