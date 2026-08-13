from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..db import get_session
from ..models import User
from ..schemas import AuthOut, TelegramAuthIn
from ..serializers import me_out
from ..security import InitDataError, create_access_token, verify_init_data

router = APIRouter(prefix="/auth", tags=["auth"])


async def _get_or_create(session: AsyncSession, tg: dict) -> tuple[User, bool]:
    telegram_id = int(tg["id"])
    row = await session.execute(
        select(User).options(selectinload(User.photos)).where(User.telegram_id == telegram_id)
    )
    user = row.scalar_one_or_none()
    if user:
        # Telegram is the source of truth for these, refresh on every login.
        user.username = tg.get("username") or user.username
        user.first_name = tg.get("first_name") or user.first_name
        user.last_name = tg.get("last_name") or user.last_name
        user.language_code = tg.get("language_code") or user.language_code
        user.last_active_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(user)
        return user, False

    user = User(
        telegram_id=telegram_id,
        username=tg.get("username"),
        first_name=tg.get("first_name") or "Гость",
        last_name=tg.get("last_name"),
        language_code=tg.get("language_code"),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user, attribute_names=["photos"])
    return user, True


@router.post("/telegram", response_model=AuthOut)
async def telegram_login(payload: TelegramAuthIn, session: AsyncSession = Depends(get_session)) -> AuthOut:
    """Exchange Telegram `initData` for a session token."""
    if payload.init_data:
        try:
            data = verify_init_data(payload.init_data, settings.bot_token)
        except InitDataError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        tg_user = data["user"]
    elif settings.allow_dev_auth and payload.dev_telegram_id:
        # Only carry a name when one was given, so re-logging in as a seeded
        # profile does not rename it.
        tg_user = {"id": payload.dev_telegram_id, "first_name": payload.dev_first_name}
    else:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Нет initData")

    user, is_new = await _get_or_create(session, tg_user)
    return AuthOut(
        access_token=create_access_token(user.id),
        is_new=is_new,
        needs_onboarding=not user.is_onboarded,
        user=me_out(user),
    )
