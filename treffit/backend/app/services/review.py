"""Решения модератора и оповещение о новых заявках.

Одна реализация на два входа: кнопки в Telegram и `/admin/*`. Иначе два
пути неизбежно разъедутся — и разъедутся именно там, где решается, увидит
ли кто-то чужое фото.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import ModerationStatus, Photo, User, Verification, VerificationStatus
from . import bot, media, push
from . import verification as verification_service

logger = logging.getLogger(__name__)


async def admin_users(session: AsyncSession) -> list[User]:
    ids = settings.admin_ids
    if not ids:
        return []
    rows = await session.execute(select(User).where(User.telegram_id.in_(ids)))
    return list(rows.scalars())


# --------------------------- решения ---------------------------


async def decide_photo(
    session: AsyncSession, photo: Photo, *, approve: bool, reason: str | None, admin_id: int | None
) -> Photo:
    photo.moderation_status = (
        ModerationStatus.approved.value if approve else ModerationStatus.rejected.value
    )
    photo.moderation_reason = reason
    photo.reviewed_by_id = admin_id
    photo.reviewed_at = datetime.now(timezone.utc)
    owner = await session.get(User, photo.user_id)
    await session.commit()

    if owner is not None:
        await push.notify_moderation(owner, approve, reason)
    return photo


async def decide_verification(
    session: AsyncSession,
    request: Verification,
    *,
    approve: bool,
    reason: str | None,
    admin_id: int | None,
) -> Verification:
    request.status = (
        VerificationStatus.approved.value if approve else VerificationStatus.rejected.value
    )
    request.reason = reason
    request.reviewed_by_id = admin_id
    request.reviewed_at = datetime.now(timezone.utc)

    owner = await session.get(User, request.user_id)
    if owner is not None:
        owner.is_verified = approve
    # Селфи своё дело сделало; хранить его дальше — лишний риск.
    if request.file_path:
        media.delete_files(request.file_path)
        request.file_path = None
    await session.commit()

    if owner is not None:
        await push.notify_verification(owner, approve, reason)
    return request


# --------------------------- оповещение ---------------------------


async def notify_photo(session: AsyncSession, photo: Photo) -> None:
    """Прислать модератору фото сразу, а не оставлять его ждать в очереди.

    Без этого «на проверке» тянется ровно столько, сколько пройдёт до
    того, как кто-то догадается заглянуть в админку.
    """
    admins = await admin_users(session)
    if not admins:
        return
    owner = await session.get(User, photo.user_id)
    try:
        path = str(media.absolute_path(photo.file_path))
    except media.PhotoError:
        return

    scores = photo.moderation_scores or {}
    worst = max(scores.items(), key=lambda item: item[1], default=None)
    detail = f"\nДетектор: {worst[0]} {worst[1]:.2f}" if worst else ""
    caption = (
        f"📷 Новое фото на модерацию\n"
        f"{owner.first_name if owner else '—'} · id {photo.user_id}"
        f"{detail}"
        f"\nПричина проверки: {photo.moderation_reason or 'не указана'}"
    )
    for admin in admins:
        await bot.send_photo(
            admin.telegram_id, path, caption, keyboard=bot.review_keyboard("photo", photo.id)
        )


async def notify_verification(session: AsyncSession, request: Verification) -> None:
    admins = await admin_users(session)
    if not admins or not request.file_path:
        return
    owner = await session.get(User, request.user_id)
    try:
        path = str(media.absolute_path(request.file_path))
    except media.PhotoError:
        return

    caption = (
        f"🪪 Заявка на верификацию\n"
        f"{owner.first_name if owner else '—'} · id {request.user_id}\n"
        f"Жест: {verification_service.describe(request.gesture)}"
    )
    for admin in admins:
        await bot.send_photo(
            admin.telegram_id, path, caption, keyboard=bot.review_keyboard("verify", request.id)
        )


# --------------------------- кнопки в Telegram ---------------------------


async def handle_callback(session: AsyncSession, telegram_id: int, data: str) -> str:
    """Обработать нажатие «Одобрить»/«Отклонить». Возвращает текст итога.

    Права проверяются здесь же: callback_data видна в клиенте, и её можно
    подделать, поэтому доверять ей нельзя.
    """
    if telegram_id not in settings.admin_ids:
        return "Недостаточно прав"

    try:
        _, kind, raw_id, decision = data.split(":")
        target_id = int(raw_id)
    except ValueError:
        return "Не понял команду"
    approve = decision == "ok"

    admin = await session.scalar(select(User).where(User.telegram_id == telegram_id))
    admin_id = admin.id if admin else None
    reason = None if approve else "Отклонено модератором"

    if kind == "photo":
        photo = await session.get(Photo, target_id)
        if photo is None:
            return "Фото не найдено"
        if photo.moderation_status != ModerationStatus.pending.value:
            return "Уже обработано"
        await decide_photo(session, photo, approve=approve, reason=reason, admin_id=admin_id)
        return "Фото одобрено" if approve else "Фото отклонено"

    if kind == "verify":
        request = await session.get(Verification, target_id)
        if request is None:
            return "Заявка не найдена"
        if request.status != VerificationStatus.submitted.value:
            return "Уже обработано"
        await decide_verification(session, request, approve=approve, reason=reason, admin_id=admin_id)
        return "Анкета подтверждена" if approve else "Верификация отклонена"

    return "Неизвестный тип заявки"
