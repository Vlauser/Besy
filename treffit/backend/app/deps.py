from __future__ import annotations

from datetime import datetime, timezone

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .db import get_session
from .models import User
from .security import decode_access_token

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Требуется авторизация",
    headers={"WWW-Authenticate": "Bearer"},
)


def bearer_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise CREDENTIALS_ERROR
    return authorization.split(" ", 1)[1].strip()


async def load_user(session: AsyncSession, user_id: int) -> User | None:
    row = await session.execute(
        select(User).options(selectinload(User.photos)).where(User.id == user_id)
    )
    return row.scalar_one_or_none()


async def current_user(
    token: str = Depends(bearer_token), session: AsyncSession = Depends(get_session)
) -> User:
    try:
        user_id = decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise CREDENTIALS_ERROR from exc

    user = await load_user(session, user_id)
    if user is None or not user.is_active:
        raise CREDENTIALS_ERROR
    if user.is_banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Профиль заблокирован")

    user.last_active_at = datetime.now(timezone.utc)
    await session.commit()
    return user


async def onboarded_user(user: User = Depends(current_user)) -> User:
    """Guards everything social: no browsing before consent, age and test."""
    if not user.is_onboarded:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="Сначала заполните профиль и пройдите тест",
        )
    return user
