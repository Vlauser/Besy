"""Операции из командной строки: разобраться в состоянии и выдать доступ.

    python -m scripts.admin status              что настроено и что в очередях
    python -m scripts.admin photos [N]          последние фото и их модерация
    python -m scripts.admin premium <tg_id>     выдать Premium
    python -m scripts.admin premium <tg_id> off снять Premium
    python -m scripts.admin verify <tg_id>      подтвердить анкету
    python -m scripts.admin queue               открытые заявки на верификацию

Запускать от пользователя сервиса, с переменными из .env:

    sudo -u treffit env $(grep -v '^#' .env | grep -v '^$' | xargs -d '\\n') \\
        .venv/bin/python -m scripts.admin status
"""

import asyncio
import sys

from sqlalchemy import desc, func, select

from app.config import settings
from app.db import SessionLocal
from app.models import ModerationStatus, Photo, User, Verification, VerificationStatus
from app.services import review, verification as verification_service


async def cmd_status() -> None:
    async with SessionLocal() as session:
        admin_ids = settings.admin_ids
        print(f"Модераторы в .env: {sorted(admin_ids) or 'НЕ ЗАДАНЫ'}")
        if admin_ids:
            rows = await session.execute(select(User).where(User.telegram_id.in_(admin_ids)))
            known = {u.telegram_id: u for u in rows.scalars()}
            for tg_id in sorted(admin_ids):
                user = known.get(tg_id)
                # Бот не может написать тому, кто ни разу не открывал приложение.
                mark = f"@{user.username or user.first_name}" if user else "нет такого пользователя"
                print(f"  {tg_id}: {mark}")

        print(f"\nАвтомодерация: {'включена' if settings.moderation_enabled else 'ВЫКЛЮЧЕНА'}")
        print(f"Требовать лицо на фото: {settings.moderation_require_face}")
        print(f"Уведомления: {'включены' if settings.push_enabled else 'ВЫКЛЮЧЕНЫ'}")
        print(f"Токен бота: {'задан' if settings.bot_token else 'НЕ ЗАДАН'}")

        async def count(model, *where):
            query = select(func.count()).select_from(model)
            return int(await session.scalar(query.where(*where) if where else query) or 0)

        print(
            f"\nПользователей: {await count(User)}"
            f"\nФото всего: {await count(Photo)}"
            f"  ждут модератора: {await count(Photo, Photo.moderation_status == ModerationStatus.pending.value)}"
            f"\nЗаявок на верификацию: "
            f"{await count(Verification, Verification.status == VerificationStatus.submitted.value)}"
        )


async def cmd_photos(limit: int) -> None:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(Photo, User).join(User, User.id == Photo.user_id).order_by(desc(Photo.id)).limit(limit)
        )
        items = rows.all()
        if not items:
            print("Фотографий пока нет.")
            return
        for photo, owner in items:
            scores = photo.moderation_scores or {}
            worst = max(scores.items(), key=lambda item: item[1], default=None)
            detail = f" · детектор: {worst[0]} {worst[1]:.2f}" if worst else ""
            print(
                f"#{photo.id} {owner.first_name} (tg {owner.telegram_id}) — "
                f"{photo.moderation_status}{detail}"
            )
            if photo.moderation_reason:
                print(f"      причина: {photo.moderation_reason}")


async def _find(session, telegram_id: int) -> User:
    user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
    if user is None:
        sys.exit(f"Пользователь с telegram_id {telegram_id} не найден — пусть сначала откроет приложение")
    return user


async def cmd_premium(telegram_id: int, enable: bool) -> None:
    async with SessionLocal() as session:
        user = await _find(session, telegram_id)
        user.is_premium = enable
        await session.commit()
        print(f"{user.first_name} (tg {telegram_id}): Premium {'выдан' if enable else 'снят'}")


async def cmd_queue() -> None:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(Verification, User)
            .join(User, User.id == Verification.user_id)
            .where(Verification.status == VerificationStatus.submitted.value)
            .order_by(Verification.created_at)
        )
        items = rows.all()
        if not items:
            print("Открытых заявок нет.")
            return
        for request, owner in items:
            print(
                f"#{request.id} {owner.first_name} (tg {owner.telegram_id}) — "
                f"жест: {verification_service.describe(request.gesture)}"
            )
        print("\nПодтвердить:  python -m scripts.admin verify <tg_id>")


async def cmd_verify(telegram_id: int) -> None:
    """Закрыть заявку, а не просто поставить флаг.

    Иначе она навсегда остаётся в очереди, а селфи — на диске, хотя
    смысла хранить его после проверки нет.
    """
    async with SessionLocal() as session:
        user = await _find(session, telegram_id)
        request = await session.scalar(
            select(Verification)
            .where(
                Verification.user_id == user.id,
                Verification.status == VerificationStatus.submitted.value,
            )
            .order_by(desc(Verification.created_at))
            .limit(1)
        )
        if request is not None:
            await review.decide_verification(
                session, request, approve=True, reason=None, admin_id=None
            )
            print(f"{user.first_name} (tg {telegram_id}): заявка #{request.id} закрыта, селфи удалено")
        else:
            user.is_verified = True
            await session.commit()
            print(f"{user.first_name} (tg {telegram_id}): галочка поставлена (заявки не было)")


async def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    command = args[0]

    if command == "status":
        await cmd_status()
    elif command == "photos":
        await cmd_photos(int(args[1]) if len(args) > 1 else 10)
    elif command == "premium":
        if len(args) < 2:
            sys.exit("Укажите telegram_id")
        await cmd_premium(int(args[1]), enable=(len(args) < 3 or args[2] != "off"))
    elif command == "queue":
        await cmd_queue()
    elif command == "verify":
        if len(args) < 2:
            sys.exit("Укажите telegram_id")
        await cmd_verify(int(args[1]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    asyncio.run(main())
