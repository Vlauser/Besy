from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..db import get_session
from ..deps import onboarded_user
from ..models import Chat, Event, Match, Message, User
from ..schemas import (
    ChatOut,
    MatchOut,
    MessageIn,
    MessageOut,
    PhotoRevealOut,
    SendMessageOut,
)
from ..serializers import (
    candidate_out,
    chat_out,
    event_out,
    load_user_with_photos,
    message_out,
    photo_url,
    visible_photos,
)
from ..services import chats as chat_service
from ..ws import manager

router = APIRouter(tags=["chats"])


async def _load_chat(session: AsyncSession, chat_id: int, user: User) -> Chat:
    chat = await session.scalar(
        select(Chat).options(selectinload(Chat.match)).where(Chat.id == chat_id)
    )
    if chat is None or not chat.is_member(user.id):
        raise HTTPException(status_code=404, detail="Чат не найден")
    return chat


@router.get("/matches", response_model=list[MatchOut])
async def list_matches(
    user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> list[MatchOut]:
    rows = await session.execute(
        select(Match)
        .options(selectinload(Match.chat))
        .where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id),
            Match.is_active.is_(True),
        )
        .order_by(desc(Match.created_at))
    )
    out: list[MatchOut] = []
    for match in rows.scalars():
        other_id = match.user_b_id if match.user_a_id == user.id else match.user_a_id
        other = await load_user_with_photos(session, other_id)
        if other is None or not other.is_active:
            continue
        event = await session.get(Event, match.event_id) if match.event_id else None
        out.append(
            MatchOut(
                id=match.id,
                chat_id=match.chat.id if match.chat else None,
                compatibility_pct=match.compatibility_pct,
                shared_flags=list(match.shared_flags or []),
                event=event_out(event),
                created_at=match.created_at,
                other=await candidate_out(
                    session,
                    user.id,
                    other,
                    compatibility_pct=match.compatibility_pct,
                    shared_flags=match.shared_flags,
                    event=event,
                ),
            )
        )
    return out


@router.get("/chats", response_model=list[ChatOut])
async def list_chats(
    user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> list[ChatOut]:
    rows = await session.execute(
        select(Chat)
        .options(selectinload(Chat.match))
        .where(or_(Chat.user_a_id == user.id, Chat.user_b_id == user.id))
        .order_by(Chat.last_message_at.desc().nulls_last(), Chat.started_at.desc())
    )
    out: list[ChatOut] = []
    for chat in rows.scalars():
        last = await session.scalar(
            select(Message).where(Message.chat_id == chat.id).order_by(desc(Message.id)).limit(1)
        )
        out.append(await chat_out(session, chat, user, last_message=last))
    return out


@router.get("/chats/{chat_id}", response_model=ChatOut)
async def read_chat(
    chat_id: int, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> ChatOut:
    chat = await _load_chat(session, chat_id, user)
    last = await session.scalar(
        select(Message).where(Message.chat_id == chat.id).order_by(desc(Message.id)).limit(1)
    )
    return await chat_out(session, chat, user, last_message=last)


@router.get("/chats/{chat_id}/messages", response_model=list[MessageOut])
async def read_messages(
    chat_id: int,
    before_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:
    chat = await _load_chat(session, chat_id, user)
    q = select(Message).where(Message.chat_id == chat.id)
    if before_id:
        q = q.where(Message.id < before_id)
    rows = await session.execute(q.order_by(desc(Message.id)).limit(limit))
    messages = list(rows.scalars())[::-1]
    return [message_out(m, user.id) for m in messages]


@router.post("/chats/{chat_id}/messages", response_model=SendMessageOut, status_code=status.HTTP_201_CREATED)
async def send_message(
    chat_id: int,
    payload: MessageIn,
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> SendMessageOut:
    chat = await _load_chat(session, chat_id, user)
    other_id = chat.other_id(user.id)
    other = await session.get(User, other_id)
    if other is None or not other.is_active or other.is_banned:
        raise HTTPException(status_code=410, detail="Собеседник недоступен")

    try:
        message, reveal_unlocked, system_message = await chat_service.post_message(
            session, chat, user, payload.body
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await session.commit()

    await manager.send(other_id, {"type": "message", "chat_id": chat.id, "message": message_out(message, other_id).model_dump(mode="json")})
    if system_message is not None:
        payload_sys = message_out(system_message, other_id).model_dump(mode="json")
        await manager.send(other_id, {"type": "message", "chat_id": chat.id, "message": payload_sys})
    if reveal_unlocked:
        await manager.send(user.id, {"type": "reveal", "chat_id": chat.id})

    return SendMessageOut(
        message=message_out(message, user.id),
        reveal_unlocked=reveal_unlocked,
        remaining_to_reveal=chat_service.remaining_to_reveal(chat, user.id),
        system_message=message_out(system_message, user.id) if system_message else None,
    )


@router.post("/chats/{chat_id}/read", response_model=ChatOut)
async def mark_chat_read(
    chat_id: int, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> ChatOut:
    chat = await _load_chat(session, chat_id, user)
    await chat_service.mark_read(session, chat, user.id)
    await session.commit()
    await manager.send(chat.other_id(user.id), {"type": "read", "chat_id": chat.id, "by": user.id})
    return await chat_out(session, chat, user)


@router.get("/chats/{chat_id}/photo", response_model=PhotoRevealOut)
async def chat_photo(
    chat_id: int, user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> PhotoRevealOut:
    """The other person's photo — 403 until this user has earned the reveal.

    The URL itself is withheld, not just blurred: nothing usable exists in
    the client before the threshold is crossed.
    """
    chat = await _load_chat(session, chat_id, user)
    if settings.blind_mode and not chat.has_revealed(user.id):
        remaining = chat_service.remaining_to_reveal(chat, user.id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Ещё {remaining} сообщ. до открытия фото",
        )

    other = await load_user_with_photos(session, chat.other_id(user.id))
    photos = visible_photos(other) if other else []
    approved = [p for p in photos if p.moderation_status == "approved"] or photos
    if not approved:
        raise HTTPException(status_code=404, detail="У собеседника пока нет фото")
    photo = approved[0]
    return PhotoRevealOut(url=photo_url(photo.id), gradient=photo.blur_gradient)
