"""Profile verification: a selfie repeating a randomly assigned gesture.

The point is liveness, not identity. A stolen photo set cannot produce a
selfie holding today's random gesture, which is what makes the checkmark
mean something. The selfie itself is never shown to other users.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..timeutil import as_utc
from ..models import Verification, VerificationStatus

# Kept deliberately simple and describable in one line each.
GESTURES = [
    ("peace", "Знак «мир» (два пальца) у левого виска"),
    ("thumb_up", "Большой палец вверх у правой щеки"),
    ("palm", "Раскрытая ладонь рядом с лицом"),
    ("ok", "Жест «ОК» у подбородка"),
    ("three", "Три пальца поднято у правого виска"),
    ("fist", "Кулак у левой щеки"),
]
GESTURE_TEXT = dict(GESTURES)

REQUEST_TTL = timedelta(minutes=30)


def pick_gesture() -> str:
    return secrets.choice(GESTURES)[0]


def describe(gesture: str) -> str:
    return GESTURE_TEXT.get(gesture, gesture)


async def active_request(session: AsyncSession, user_id: int) -> Verification | None:
    """The user's current unfinished attempt, if it has not expired."""
    now = datetime.now(timezone.utc)
    row = await session.execute(
        select(Verification)
        .where(
            Verification.user_id == user_id,
            Verification.status.in_(
                [VerificationStatus.requested.value, VerificationStatus.submitted.value]
            ),
        )
        .order_by(Verification.created_at.desc())
        .limit(1)
    )
    request = row.scalar_one_or_none()
    if request is None:
        return None
    expires_at = as_utc(request.expires_at)
    if request.status == VerificationStatus.requested.value and expires_at < now:
        return None
    return request


async def start(session: AsyncSession, user_id: int) -> Verification:
    """Issue a gesture to perform, reusing an attempt that is still open."""
    existing = await active_request(session, user_id)
    if existing is not None:
        return existing

    request = Verification(
        user_id=user_id,
        gesture=pick_gesture(),
        status=VerificationStatus.requested.value,
        expires_at=datetime.now(timezone.utc) + REQUEST_TTL,
    )
    session.add(request)
    await session.flush()
    return request


async def submit(session: AsyncSession, request: Verification, file_path: str) -> Verification:
    request.file_path = file_path
    request.status = VerificationStatus.submitted.value
    await session.flush()
    return request
