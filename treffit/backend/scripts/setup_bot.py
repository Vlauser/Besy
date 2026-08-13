"""Register the bot's webhook, commands and menu button.

    python -m scripts.setup_bot            # apply
    python -m scripts.setup_bot --status   # show current state
    python -m scripts.setup_bot --delete   # unregister the webhook

Requires TREFFIT_BOT_TOKEN, TREFFIT_SECRET_KEY and TREFFIT_PUBLIC_URL (the
https origin where this API is reachable). Run it once after each deploy
that changes the URL.
"""

import asyncio
import os
import sys

from app.config import settings
from app.routers.telegram import COMMANDS
from app.services import bot

WEBHOOK_PATH = "/telegram/webhook"


def public_url() -> str:
    url = os.environ.get("TREFFIT_PUBLIC_URL", "").rstrip("/")
    if not url:
        sys.exit("Задайте TREFFIT_PUBLIC_URL, например https://treffit.example.com/api")
    if not url.startswith("https://"):
        sys.exit("Telegram принимает вебхуки только по https")
    return url


async def show_status() -> None:
    info = await bot.call("getWebhookInfo", raise_on_error=True)
    me = await bot.get_me()
    print(f"Бот: @{me.get('username')} ({me.get('id')})")
    print(f"Вебхук: {info.get('url') or '(не задан)'}")
    print(f"В очереди обновлений: {info.get('pending_update_count', 0)}")
    if info.get("last_error_message"):
        print(f"Последняя ошибка: {info['last_error_message']}")


async def apply() -> None:
    # Validate configuration before spending a network round trip on it.
    url = public_url() + WEBHOOK_PATH

    me = await bot.get_me()
    print(f"Бот: @{me.get('username')}")

    await bot.set_webhook(url, settings.secret_key)
    print(f"Вебхук → {url}")

    await bot.set_my_commands(COMMANDS)
    print("Команды: " + ", ".join(f"/{name}" for name, _ in COMMANDS))

    try:
        if await bot.set_chat_menu_button() is None:
            print("Кнопка меню пропущена: не задан TREFFIT_MINI_APP_URL")
        else:
            print(f"Кнопка меню → {settings.mini_app_url}")
    except bot.BotError as exc:
        # Вебхук и команды уже зарегистрированы — бот рабочий и без кнопки.
        print(f"Кнопку меню поставить не удалось: {exc}")
        if "BUTTON_URL_INVALID" in str(exc):
            print(
                "  TREFFIT_MINI_APP_URL должен быть адресом сайта "
                "(https://ваш.домен), а не ссылкой t.me/бот/app"
            )


async def main() -> None:
    if not settings.bot_token:
        sys.exit("Задайте TREFFIT_BOT_TOKEN")

    try:
        if "--status" in sys.argv:
            await show_status()
        elif "--delete" in sys.argv:
            await bot.delete_webhook()
            print("Вебхук удалён")
        else:
            await apply()
    except bot.BotError as exc:
        sys.exit(f"Telegram отказал: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
