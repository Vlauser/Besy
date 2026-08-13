"""Response builders that centralise the photo-visibility rule.

Every payload containing another user's photos goes through here, so there
is exactly one place deciding whether a URL is emitted.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .config import settings
from .models import Chat, Event, Photo, User
from .schemas import CandidateOut, ChatOut, EventOut, MeOut, MessageOut, PhotoOut
from .services import chats as chat_service
from .ws import manager


def photo_url(photo_id: int) -> str:
    return f"/media/photos/{photo_id}"


def photo_out(photo: Photo, *, unlocked: bool) -> PhotoOut:
    return PhotoOut(
        id=photo.id,
        position=photo.position,
        gradient=photo.blur_gradient,
        url=photo_url(photo.id) if unlocked else None,
        locked=not unlocked,
        moderation_status=photo.moderation_status,
        # Only meaningful to the owner; other viewers get it on locked
        # photos too, but it says nothing about the person.
        moderation_reason=photo.moderation_reason,
    )


def visible_photos(user: User) -> list[Photo]:
    """Photos that may be surfaced at all — rejected ones never are."""
    return [p for p in sorted(user.photos, key=lambda p: p.position) if p.moderation_status != "rejected"]


async def can_view_photos(session: AsyncSession, viewer_id: int, owner_id: int) -> bool:
    """The single source of truth for "may viewer see owner's photos?".

    Outside blind mode every onboarded profile is open. Inside blind mode a
    viewer must share a chat with the owner *and* have crossed their own
    reveal threshold in it.
    """
    if viewer_id == owner_id:
        return True
    if not settings.blind_mode:
        return True
    low, high = chat_service.ordered(viewer_id, owner_id)
    row = await session.execute(select(Chat).where(Chat.user_a_id == low, Chat.user_b_id == high))
    chat = row.scalar_one_or_none()
    return bool(chat and chat.has_revealed(viewer_id))


def me_out(user: User) -> MeOut:
    """Own profile — photos are always unlocked to their owner."""
    return MeOut(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        birth_date=user.birth_date,
        age=user.age,
        gender=user.gender,
        seeking_gender=user.seeking_gender,
        seeking_age_min=user.seeking_age_min,
        seeking_age_max=user.seeking_age_max,
        city=user.city,
        bio=user.bio,
        interests=list(user.interests or []),
        test_answers=dict(user.test_answers or {}),
        test_completed_at=user.test_completed_at,
        consent_pdn_at=user.consent_pdn_at,
        consent_photo_at=user.consent_photo_at,
        is_premium=user.is_premium,
        is_verified=user.is_verified,
        is_onboarded=user.is_onboarded,
        photos=[photo_out(p, unlocked=True) for p in visible_photos(user)],
    )


def event_out(event: Event | None, *, attending: bool = False) -> EventOut | None:
    if event is None:
        return None
    return EventOut(
        id=event.id,
        title=event.title,
        venue=event.venue,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        city=event.city,
        lat=event.lat,
        lng=event.lng,
        image_url=event.image_url,
        site_url=event.site_url,
        attending=attending,
    )


async def candidate_out(
    session: AsyncSession,
    viewer_id: int,
    user: User,
    *,
    compatibility_pct: int,
    shared_flags: list[str] | None = None,
    event: Event | None = None,
    unlocked: bool | None = None,
) -> CandidateOut:
    if unlocked is None:
        unlocked = await can_view_photos(session, viewer_id, user.id)
    photos = visible_photos(user)
    return CandidateOut(
        id=user.id,
        first_name=user.first_name,
        age=user.age,
        city=user.city,
        bio=user.bio,
        interests=list(user.interests or []),
        compatibility_pct=compatibility_pct,
        shared_flags=list(shared_flags or []),
        event=event_out(event),
        is_verified=user.is_verified,
        is_online=await manager.is_online_anywhere(user.id),
        photos=[photo_out(p, unlocked=unlocked) for p in photos],
        photos_locked=not unlocked,
    )


def message_out(message, viewer_id: int) -> MessageOut:
    return MessageOut(
        id=message.id,
        chat_id=message.chat_id,
        sender_id=message.sender_id,
        type=message.type,
        body=message.body,
        sent_at=message.sent_at,
        read_at=message.read_at,
        mine=message.sender_id == viewer_id,
    )


async def load_user_with_photos(session: AsyncSession, user_id: int) -> User | None:
    row = await session.execute(select(User).options(selectinload(User.photos)).where(User.id == user_id))
    return row.scalar_one_or_none()


async def chat_out(session: AsyncSession, chat: Chat, viewer: User, last_message=None) -> ChatOut:
    other = await load_user_with_photos(session, chat.other_id(viewer.id))
    match = chat.match
    event = None
    if match and match.event_id:
        event = await session.get(Event, match.event_id)
    other_card = await candidate_out(
        session,
        viewer.id,
        other,
        compatibility_pct=match.compatibility_pct if match else 0,
        shared_flags=match.shared_flags if match else [],
        event=event,
        unlocked=chat.has_revealed(viewer.id) or not settings.blind_mode,
    )
    return ChatOut(
        id=chat.id,
        match_id=chat.match_id,
        other=other_card,
        revealed=chat.has_revealed(viewer.id) or not settings.blind_mode,
        remaining_to_reveal=chat_service.remaining_to_reveal(chat, viewer.id),
        sent_count=chat.sent_count(viewer.id),
        unread=chat.unread_a if viewer.id == chat.user_a_id else chat.unread_b,
        last_message=message_out(last_message, viewer.id) if last_message else None,
        last_message_at=chat.last_message_at,
        started_at=chat.started_at,
    )
