from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..db import get_session
from ..deps import onboarded_user
from ..models import Block, DeckCard, Event, Swipe, SwipeAction, User
from ..schemas import CandidateOut, DeckCardOut, SwipeIn, SwipeOut
from ..serializers import candidate_out
from ..services import chats as chat_service
from ..services import matching, push
from ..ws import manager

router = APIRouter(tags=["discover"])


def _likes_allowed(user: User) -> int:
    return settings.daily_like_limit_premium if user.is_premium else settings.daily_like_limit


@router.get("/discover", response_model=list[CandidateOut])
async def discover(
    limit: int = Query(default=10, ge=1, le=30),
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> list[CandidateOut]:
    """The swipe deck — ranked candidates the user has not acted on yet."""
    candidates = await matching.find_candidates(session, user, limit)
    ids = [c.id for c in candidates]
    if not ids:
        return []

    rows = await session.execute(select(User).options(selectinload(User.photos)).where(User.id.in_(ids)))
    by_id = {u.id: u for u in rows.scalars()}

    result: list[CandidateOut] = []
    for candidate in candidates:
        full = by_id.get(candidate.id, candidate)
        pct, flags, event_id = await matching.score_pair(session, user, full)
        event = await session.get(Event, event_id) if event_id else None
        result.append(
            await candidate_out(
                session, user.id, full, compatibility_pct=pct, shared_flags=flags, event=event
            )
        )
    return result


@router.post("/discover/{target_id}/swipe", response_model=SwipeOut)
async def swipe(
    target_id: int,
    payload: SwipeIn,
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> SwipeOut:
    if target_id == user.id:
        raise HTTPException(status_code=422, detail="Нельзя свайпнуть себя")

    target = await session.scalar(
        select(User).options(selectinload(User.photos)).where(User.id == target_id)
    )
    if target is None or not target.is_active or target.is_banned:
        raise HTTPException(status_code=404, detail="Профиль не найден")

    blocked = await session.scalar(
        select(Block.id).where(
            ((Block.user_id == user.id) & (Block.blocked_id == target_id))
            | ((Block.user_id == target_id) & (Block.blocked_id == user.id))
        )
    )
    if blocked:
        raise HTTPException(status_code=403, detail="Действие недоступно")

    is_like = payload.action in (SwipeAction.like, SwipeAction.superlike)
    allowed = _likes_allowed(user)
    likes_today = await matching.daily_like_count(session, user.id)
    if is_like and likes_today >= allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Лайки на сегодня закончились",
        )

    existing = await session.scalar(
        select(Swipe).where(Swipe.actor_id == user.id, Swipe.target_id == target_id)
    )
    if existing is None:
        session.add(Swipe(actor_id=user.id, target_id=target_id, action=payload.action.value))
        if is_like:
            likes_today += 1
    elif existing.action != payload.action.value:
        # Allow upgrading pass → like, but never spend a second like slot.
        existing.action = payload.action.value
    await session.flush()

    # Any unscratched card for this person is now spent.
    stale = await session.scalar(
        select(DeckCard).where(
            DeckCard.user_id == user.id, DeckCard.candidate_id == target_id, DeckCard.scratched_at.is_(None)
        )
    )
    if stale is not None:
        await session.delete(stale)

    matched = False
    match_id = chat_id = None
    if is_like:
        reciprocal = await session.scalar(
            select(Swipe).where(
                Swipe.actor_id == target_id,
                Swipe.target_id == user.id,
                Swipe.action.in_([SwipeAction.like.value, SwipeAction.superlike.value]),
            )
        )
        if reciprocal is not None:
            match, chat = await chat_service.create_match(session, user, target, source="swipe")
            matched, match_id, chat_id = True, match.id, chat.id

    await session.commit()

    if matched:
        for uid, other in ((user.id, target), (target_id, user)):
            await manager.send(
                uid,
                {
                    "type": "match",
                    "match_id": match_id,
                    "chat_id": chat_id,
                    "user": {"id": other.id, "first_name": other.first_name},
                },
            )
        await push.notify_match(target, user)
    elif payload.action == SwipeAction.superlike:
        await manager.send(target_id, {"type": "superlike", "from_user_id": user.id})

    card = None
    if matched:
        card = await candidate_out(session, user.id, target, compatibility_pct=0)
    return SwipeOut(
        matched=matched,
        match_id=match_id,
        chat_id=chat_id,
        likes_left=max(0, allowed - likes_today),
        candidate=card,
    )


@router.get("/discover/likes", response_model=list[CandidateOut])
async def who_liked_me(
    user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> list[CandidateOut]:
    """Incoming likes not yet answered. Premium-gated, like Twinby."""
    if not user.is_premium:
        raise HTTPException(status_code=402, detail="Доступно с Treffit Premium")

    answered = select(Swipe.target_id).where(Swipe.actor_id == user.id)
    rows = await session.execute(
        select(User)
        .options(selectinload(User.photos))
        .join(Swipe, Swipe.actor_id == User.id)
        .where(
            Swipe.target_id == user.id,
            Swipe.action.in_([SwipeAction.like.value, SwipeAction.superlike.value]),
            User.id.not_in(answered),
            User.is_active.is_(True),
            User.is_banned.is_(False),
        )
        .order_by(Swipe.created_at.desc())
        .limit(50)
    )
    result = []
    for liker in rows.scalars():
        pct, flags = matching.compute_compatibility(
            user.test_answers, liker.test_answers, user.interests, liker.interests
        )
        result.append(
            await candidate_out(session, user.id, liker, compatibility_pct=pct, shared_flags=flags)
        )
    return result


# ----------------------- scratch pack (Treffit mode) -----------------------


@router.get("/deck", response_model=list[DeckCardOut])
async def read_deck(
    user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> list[DeckCardOut]:
    """The scratch pack. Unscratched cards leak nothing but a card id."""
    await matching.rebuild_deck(session, user)
    await session.commit()

    rows = await session.execute(
        select(DeckCard).where(DeckCard.user_id == user.id).order_by(DeckCard.created_at.desc())
    )
    cards = list(rows.scalars())
    out: list[DeckCardOut] = []
    for card in cards:
        if card.scratched_at is None:
            out.append(DeckCardOut(id=card.id, scratched=False, is_live=card.is_live))
            continue
        candidate = await session.scalar(
            select(User).options(selectinload(User.photos)).where(User.id == card.candidate_id)
        )
        if candidate is None or not candidate.is_active:
            continue
        event = await session.get(Event, card.event_id) if card.event_id else None
        out.append(
            DeckCardOut(
                id=card.id,
                scratched=True,
                compatibility_pct=card.compatibility_pct,
                is_live=card.is_live,
                candidate=await candidate_out(
                    session,
                    user.id,
                    candidate,
                    compatibility_pct=card.compatibility_pct,
                    shared_flags=card.shared_flags,
                    event=event,
                ),
            )
        )
    return out


@router.post("/deck/{card_id}/scratch", response_model=DeckCardOut)
async def scratch_card(
    card_id: int, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> DeckCardOut:
    """Reveal one card. The candidate's data is sent only in this response —
    scratching client-side alone reveals nothing."""
    card = await session.get(DeckCard, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Карта не найдена")
    if card.scratched_at is None:
        card.scratched_at = datetime.now(timezone.utc)
        await session.commit()

    candidate = await session.scalar(
        select(User).options(selectinload(User.photos)).where(User.id == card.candidate_id)
    )
    if candidate is None:
        raise HTTPException(status_code=404, detail="Профиль недоступен")
    event = await session.get(Event, card.event_id) if card.event_id else None
    return DeckCardOut(
        id=card.id,
        scratched=True,
        compatibility_pct=card.compatibility_pct,
        is_live=card.is_live,
        candidate=await candidate_out(
            session,
            user.id,
            candidate,
            compatibility_pct=card.compatibility_pct,
            shared_flags=card.shared_flags,
            event=event,
        ),
    )
