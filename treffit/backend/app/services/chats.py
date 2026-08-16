"""Match creation, messaging and the server-side reveal rule."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Chat, Match, Message, MessageType, User
from . import matching

MAX_MESSAGE_LENGTH = 2000


def ordered(a_id: int, b_id: int) -> tuple[int, int]:
    return (a_id, b_id) if a_id < b_id else (b_id, a_id)


async def find_match(session: AsyncSession, a_id: int, b_id: int) -> Match | None:
    low, high = ordered(a_id, b_id)
    row = await session.execute(select(Match).where(Match.user_a_id == low, Match.user_b_id == high))
    return row.scalar_one_or_none()


async def get_chat_for_match(session: AsyncSession, match_id: int) -> Chat | None:
    row = await session.execute(select(Chat).where(Chat.match_id == match_id))
    return row.scalar_one_or_none()


async def create_match(session: AsyncSession, a: User, b: User, source: str = "swipe") -> tuple[Match, Chat]:
    """Create the mutual match and its chat, or return the existing pair."""
    existing = await find_match(session, a.id, b.id)
    if existing:
        chat = await get_chat_for_match(session, existing.id)
        if chat:
            return existing, chat

    low, high = ordered(a.id, b.id)
    pct, flags, event_id = await matching.score_pair(session, a, b)
    match = existing or Match(
        user_a_id=low, user_b_id=high, compatibility_pct=pct, shared_flags=flags, event_id=event_id, source=source
    )
    session.add(match)
    await session.flush()

    # Outside blind mode photos are open from the first message, so the
    # reveal flags start true and the scratch step never appears.
    open_from_start = not settings.blind_mode
    chat = Chat(
        match_id=match.id,
        user_a_id=low,
        user_b_id=high,
        revealed_a=open_from_start,
        revealed_b=open_from_start,
    )
    session.add(chat)
    await session.flush()

    opener = _opener_text(match.shared_flags)
    session.add(Message(chat_id=chat.id, sender_id=None, type=MessageType.system.value, body=opener))
    await session.flush()
    return match, chat


def _opener_text(flags: list[str]) -> str:
    if flags:
        return f"Вы совпали. Есть о чём начать: {flags[0].lower()}."
    return "Вы совпали. Напишите первым — три сообщения открывают фото."


def remaining_to_reveal(chat: Chat, user_id: int) -> int:
    if not settings.blind_mode or chat.has_revealed(user_id):
        return 0
    return max(0, settings.reveal_threshold - chat.sent_count(user_id))


async def post_message(
    session: AsyncSession,
    chat: Chat,
    sender: User,
    body: str,
    *,
    reply_to_id: int | None = None,
    photo: dict | None = None,
) -> tuple[Message, bool, Message | None]:
    """Append a message and apply the reveal rule.

    Returns (message, reveal_unlocked, system_message). The counter and the
    threshold both live here — the client is never trusted to say a user has
    earned the reveal.
    """
    text = (body or "").strip()
    # У фотографии подпись необязательна — у текста тело и есть сообщение.
    if not text and photo is None:
        raise ValueError("Сообщение пустое")
    if len(text) > MAX_MESSAGE_LENGTH:
        raise ValueError("Сообщение слишком длинное")

    quoted: Message | None = None
    if reply_to_id is not None:
        # Отвечать можно только на сообщение из этого же чата: иначе по id
        # утекала бы чужая переписка.
        quoted = await session.get(Message, reply_to_id)
        if quoted is None or quoted.chat_id != chat.id:
            raise ValueError("Сообщение, на которое вы отвечаете, не найдено")

    now = datetime.now(timezone.utc)
    message = Message(
        chat_id=chat.id,
        sender_id=sender.id,
        type=MessageType.photo.value if photo else MessageType.text.value,
        body=text,
        reply_to_id=reply_to_id,
        file_path=(photo or {}).get("file_path"),
        thumb_path=(photo or {}).get("thumb_path"),
        blur_gradient=(photo or {}).get("blur_gradient"),
    )
    # Связь присваиваем сразу: иначе сериализатор полезет за цитатой уже
    # после коммита, а это ленивая подгрузка в асинхронном коде — то есть
    # MissingGreenlet вместо ответа.
    message.reply_to = quoted
    session.add(message)

    is_a = sender.id == chat.user_a_id
    if is_a:
        chat.msg_count_a += 1
        chat.unread_b += 1
    else:
        chat.msg_count_b += 1
        chat.unread_a += 1
    chat.last_message_at = now

    reveal_unlocked = False
    system_message: Message | None = None
    if settings.blind_mode:
        sent = chat.msg_count_a if is_a else chat.msg_count_b
        already = chat.revealed_a if is_a else chat.revealed_b
        if not already and sent >= settings.reveal_threshold:
            if is_a:
                chat.revealed_a = True
            else:
                chat.revealed_b = True
            reveal_unlocked = True
            system_message = Message(
                chat_id=chat.id,
                sender_id=None,
                type=MessageType.system.value,
                body=f"{sender.first_name} открыл(а) фото собеседника ✨",
            )
            session.add(system_message)

    await session.flush()
    return message, reveal_unlocked, system_message


async def mark_read(session: AsyncSession, chat: Chat, user_id: int) -> int:
    """Zero the reader's unread counter and stamp the other side's messages."""
    now = datetime.now(timezone.utc)
    rows = await session.execute(
        select(Message).where(
            Message.chat_id == chat.id, Message.sender_id != user_id, Message.read_at.is_(None)
        )
    )
    count = 0
    for message in rows.scalars():
        message.read_at = now
        count += 1
    if user_id == chat.user_a_id:
        chat.unread_a = 0
    else:
        chat.unread_b = 0
    await session.flush()
    return count
