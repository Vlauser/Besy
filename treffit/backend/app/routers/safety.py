from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user
from ..models import Block, Match, Report, User
from ..schemas import BlockIn, ReportIn

router = APIRouter(prefix="/safety", tags=["safety"])

REPORT_REASONS = {"spam", "fake", "harassment", "nudity", "underage", "scam", "other"}
# Enough independent reports that leaving the profile up is the bigger risk.
AUTO_BAN_THRESHOLD = 5


async def _deactivate_matches(session: AsyncSession, a_id: int, b_id: int) -> None:
    low, high = (a_id, b_id) if a_id < b_id else (b_id, a_id)
    match = await session.scalar(select(Match).where(Match.user_a_id == low, Match.user_b_id == high))
    if match is not None:
        match.is_active = False


@router.post("/block", status_code=status.HTTP_204_NO_CONTENT)
async def block_user(
    payload: BlockIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    """Block hides both people from each other and closes any shared match."""
    if payload.user_id == user.id:
        raise HTTPException(status_code=422, detail="Нельзя заблокировать себя")
    target = await session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Профиль не найден")

    existing = await session.scalar(
        select(Block).where(Block.user_id == user.id, Block.blocked_id == payload.user_id)
    )
    if existing is None:
        session.add(Block(user_id=user.id, blocked_id=payload.user_id))
    await _deactivate_matches(session, user.id, payload.user_id)
    await session.commit()


@router.delete("/block/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unblock_user(
    user_id: int, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    existing = await session.scalar(
        select(Block).where(Block.user_id == user.id, Block.blocked_id == user_id)
    )
    if existing is not None:
        await session.delete(existing)
        await session.commit()


@router.get("/blocks", response_model=list[int])
async def list_blocks(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[int]:
    rows = await session.execute(select(Block.blocked_id).where(Block.user_id == user.id))
    return list(rows.scalars())


@router.post("/report", status_code=status.HTTP_201_CREATED)
async def report_user(
    payload: ReportIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> dict:
    if payload.user_id == user.id:
        raise HTTPException(status_code=422, detail="Нельзя пожаловаться на себя")
    target = await session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Профиль не найден")
    reason = payload.reason if payload.reason in REPORT_REASONS else "other"

    session.add(
        Report(reporter_id=user.id, target_id=payload.user_id, reason=reason, details=payload.details)
    )
    # Reporting implies not wanting to see them again.
    existing_block = await session.scalar(
        select(Block).where(Block.user_id == user.id, Block.blocked_id == payload.user_id)
    )
    if existing_block is None:
        session.add(Block(user_id=user.id, blocked_id=payload.user_id))
    await _deactivate_matches(session, user.id, payload.user_id)
    await session.flush()

    distinct_reporters = await session.execute(
        select(Report.reporter_id).where(Report.target_id == payload.user_id, Report.resolved_at.is_(None))
    )
    if len({*distinct_reporters.scalars()}) >= AUTO_BAN_THRESHOLD:
        target.is_banned = True

    await session.commit()
    return {"ok": True, "auto_banned": target.is_banned}


@router.get("/reports/mine", response_model=list[dict])
async def my_reports(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[dict]:
    rows = await session.execute(
        select(Report)
        .where(or_(Report.reporter_id == user.id))
        .order_by(Report.created_at.desc())
        .limit(50)
    )
    return [
        {
            "id": r.id,
            "target_id": r.target_id,
            "reason": r.reason,
            "created_at": r.created_at,
            "resolved": r.resolved_at is not None,
        }
        for r in rows.scalars()
    ]
