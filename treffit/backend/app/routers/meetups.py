"""События, которые заводят сами пользователи.

Афишное мероприятие (`Event`) существует само по себе: концерт идёт,
независимо от того, знает ли о нём кто-нибудь в приложении. Событие
отсюда — наоборот, приглашение конкретного человека: «иду на это, ищу
компанию». Поэтому колода здесь такая же, как с анкетами, а отклик
работает как лайк: автор видит откликнувшихся и сам решает, кому открыть
переписку.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..db import get_session
from ..deps import onboarded_user
from ..models import (
    Block,
    Meetup,
    MeetupResponse,
    ModerationStatus,
    User,
)
from ..schemas import MeetupIn, MeetupOut, MeetupResponderOut, MeetupResponseIn, MeetupAuthorOut
from ..services import chats as chat_service
from ..services import media, moderation, push
from ..ws import manager

router = APIRouter(prefix="/meetups", tags=["meetups"])


def _first_error(exc: ValidationError) -> str:
    """Первое человекочитаемое сообщение из ошибки схемы."""
    for error in exc.errors():
        message = str(error.get("msg", "")).removeprefix("Value error, ")
        if message:
            return message
    return "Проверьте поля события"


def _author_out(user: User) -> MeetupAuthorOut:
    photo = next((p for p in (user.photos or []) if p.moderation_status == ModerationStatus.approved.value), None)
    return MeetupAuthorOut(
        id=user.id,
        first_name=user.first_name,
        age=user.age,
        is_verified=user.is_verified,
        photo_url=f"/media/photos/{photo.id}" if photo else None,
        gradient=photo.blur_gradient if photo else "linear-gradient(135deg,#B9C6FF,#6E85E8)",
    )


def _meetup_out(meetup: Meetup, *, mine: bool = False, responses: int | None = None) -> MeetupOut:
    # Прячем только то, что модерация отклонила. Прятать «на проверке» было
    # бы правильно, будь у обложек очередь модератора, — её нет, и такая
    # картинка не показалась бы уже никогда. Автомодерация здесь
    # единственный фильтр, а на остальное есть жалобы.
    shown = meetup.moderation_status != ModerationStatus.rejected.value
    return MeetupOut(
        id=meetup.id,
        city=meetup.city,
        address=meetup.address,
        starts_at=meetup.starts_at,
        topic=meetup.topic,
        description=meetup.description,
        image_url=f"/media/meetups/{meetup.id}" if meetup.file_path and shown else None,
        gradient=meetup.blur_gradient,
        author=_author_out(meetup.author),
        responses=responses,
        mine=mine,
    )


def _live(now: datetime):
    """Событие видно, пока оно не началось. Прошедшее приглашение — мусор."""
    return and_(Meetup.is_active.is_(True), Meetup.starts_at >= now)


@router.get("", response_model=list[MeetupOut])
async def feed(
    limit: int = Query(default=10, ge=1, le=30),
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> list[MeetupOut]:
    """Колода чужих событий в своём городе.

    Порядок — по времени начала: то, что сегодня вечером, нужнее того, что
    через месяц.
    """
    now = datetime.now(timezone.utc)
    answered = select(MeetupResponse.meetup_id).where(MeetupResponse.user_id == user.id)
    blocked_by_me = select(Block.blocked_id).where(Block.user_id == user.id)
    blocked_me = select(Block.user_id).where(Block.blocked_id == user.id)

    rows = await session.execute(
        select(Meetup)
        .options(selectinload(Meetup.author).selectinload(User.photos))
        .where(
            _live(now),
            Meetup.city == user.city,
            Meetup.author_id != user.id,
            not_(Meetup.id.in_(answered)),
            not_(Meetup.author_id.in_(blocked_by_me)),
            not_(Meetup.author_id.in_(blocked_me)),
        )
        .order_by(Meetup.starts_at.asc())
        .limit(limit)
    )
    return [_meetup_out(m) for m in rows.scalars()]


@router.get("/mine", response_model=list[MeetupOut])
async def mine(
    user: User = Depends(onboarded_user), session: AsyncSession = Depends(get_session)
) -> list[MeetupOut]:
    """Свои события вместе с числом откликов.

    Прошедшие тоже показываем: автор должен видеть, что он заводил, и
    успеть ответить тем, кто откликнулся.
    """
    rows = await session.execute(
        select(Meetup)
        .options(selectinload(Meetup.author).selectinload(User.photos))
        .where(Meetup.author_id == user.id, Meetup.is_active.is_(True))
        .order_by(Meetup.starts_at.desc())
    )
    meetups = list(rows.scalars())
    counts = dict(
        (
            await session.execute(
                select(MeetupResponse.meetup_id, func.count())
                .where(
                    MeetupResponse.meetup_id.in_([m.id for m in meetups] or [0]),
                    MeetupResponse.action == "interested",
                )
                .group_by(MeetupResponse.meetup_id)
            )
        ).all()
    )
    return [_meetup_out(m, mine=True, responses=counts.get(m.id, 0)) for m in meetups]


@router.post("", response_model=MeetupOut, status_code=status.HTTP_201_CREATED)
async def create(
    city: str = Form(...),
    address: str = Form(...),
    starts_at: datetime = Form(...),
    topic: str = Form(...),
    description: str | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> MeetupOut:
    """Завести своё событие. Картинка необязательна.

    Форма приходит одним запросом вместе с файлом: разбивать на «создать»
    и «загрузить картинку» значит оставлять в базе события-обрубки, если
    второй запрос не дойдёт.
    """
    # Поля проверяет та же схема, что и в остальном API, — правила про
    # город и время в одном месте, а не продублированы в форме.
    try:
        payload = MeetupIn(
            city=city, address=address, starts_at=starts_at, topic=topic, description=description
        )
    except ValidationError as exc:
        # Схему мы вызываем сами, а не через тело запроса, поэтому FastAPI
        # её ошибку уже не перехватит — иначе кривая форма отдавала бы 500.
        raise HTTPException(status_code=422, detail=_first_error(exc)) from exc

    open_meetups = await session.scalar(
        select(func.count())
        .select_from(Meetup)
        .where(
            Meetup.author_id == user.id,
            Meetup.is_active.is_(True),
            Meetup.starts_at >= datetime.now(timezone.utc),
        )
    )
    if int(open_meetups or 0) >= settings.max_open_meetups:
        raise HTTPException(
            status_code=409,
            detail=f"Больше {settings.max_open_meetups} событий одновременно не завести",
        )

    meetup = Meetup(
        author_id=user.id,
        city=payload.city,
        address=payload.address,
        starts_at=payload.starts_at,
        topic=payload.topic,
        description=payload.description,
    )

    if image is not None and image.filename:
        raw = await image.read()
        try:
            stored = media.store_photo(raw, user.id)
        except media.PhotoError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        verdict = await asyncio.to_thread(
            moderation.screen, str(media.absolute_path(stored["file_path"]))
        )
        meetup.file_path = stored["file_path"]
        meetup.thumb_path = stored["thumb_path"]
        meetup.blur_gradient = stored["blur_gradient"]
        meetup.moderation_status = verdict.status
        meetup.moderation_reason = verdict.reason

    session.add(meetup)
    await session.commit()
    await session.refresh(meetup, ["author"])
    return _meetup_out(meetup, mine=True, responses=0)


@router.delete("/{meetup_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel(
    meetup_id: int,
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
):
    """Снять своё событие. Уже открытые переписки остаются."""
    meetup = await session.get(Meetup, meetup_id)
    if meetup is None or meetup.author_id != user.id or not meetup.is_active:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    meetup.is_active = False
    await session.commit()


@router.post("/{meetup_id}/respond", status_code=status.HTTP_204_NO_CONTENT)
async def respond(
    meetup_id: int,
    payload: MeetupResponseIn,
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
):
    """Откликнуться или пропустить.

    Отклик — не знакомство: он попадает автору в список, а переписку
    открывает автор. Так согласие остаётся обоюдным, как и с лайками.
    """
    now = datetime.now(timezone.utc)
    meetup = await session.scalar(
        select(Meetup).options(selectinload(Meetup.author)).where(Meetup.id == meetup_id, _live(now))
    )
    if meetup is None:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    if meetup.author_id == user.id:
        raise HTTPException(status_code=422, detail="Это ваше событие")

    blocked = await session.scalar(
        select(Block.id).where(
            or_(
                and_(Block.user_id == user.id, Block.blocked_id == meetup.author_id),
                and_(Block.user_id == meetup.author_id, Block.blocked_id == user.id),
            )
        )
    )
    if blocked:
        raise HTTPException(status_code=403, detail="Действие недоступно")

    existing = await session.scalar(
        select(MeetupResponse).where(
            MeetupResponse.meetup_id == meetup_id, MeetupResponse.user_id == user.id
        )
    )
    if existing is None:
        session.add(
            MeetupResponse(meetup_id=meetup_id, user_id=user.id, action=payload.action)
        )
    else:
        existing.action = payload.action
    await session.commit()

    if payload.action == "interested":
        await manager.send(
            meetup.author_id,
            {"type": "meetup_response", "meetup_id": meetup_id, "from_user_id": user.id},
        )
        await push.notify_meetup_response(meetup.author, user, meetup.topic)


@router.get("/{meetup_id}/responses", response_model=list[MeetupResponderOut])
async def responses(
    meetup_id: int,
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> list[MeetupResponderOut]:
    """Кто откликнулся. Видит только автор."""
    meetup = await session.get(Meetup, meetup_id)
    if meetup is None or meetup.author_id != user.id:
        raise HTTPException(status_code=404, detail="Событие не найдено")

    rows = await session.execute(
        select(MeetupResponse)
        .options(selectinload(MeetupResponse.responder).selectinload(User.photos))
        .where(MeetupResponse.meetup_id == meetup_id, MeetupResponse.action == "interested")
        .order_by(MeetupResponse.created_at.asc())
    )
    out: list[MeetupResponderOut] = []
    for response in rows.scalars():
        responder = response.responder
        author = _author_out(responder)
        match = await chat_service.find_match(session, user.id, responder.id)
        chat = await chat_service.get_chat_for_match(session, match.id) if match else None
        out.append(
            MeetupResponderOut(
                user_id=responder.id,
                first_name=author.first_name,
                age=author.age,
                is_verified=author.is_verified,
                photo_url=author.photo_url,
                gradient=author.gradient,
                accepted=response.accepted_at is not None,
                chat_id=chat.id if chat else None,
            )
        )
    return out


@router.post("/{meetup_id}/responses/{user_id}/accept")
async def accept(
    meetup_id: int,
    user_id: int,
    user: User = Depends(onboarded_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Открыть переписку с откликнувшимся. Только автор события."""
    meetup = await session.get(Meetup, meetup_id)
    if meetup is None or meetup.author_id != user.id:
        raise HTTPException(status_code=404, detail="Событие не найдено")

    response = await session.scalar(
        select(MeetupResponse).where(
            MeetupResponse.meetup_id == meetup_id,
            MeetupResponse.user_id == user_id,
            MeetupResponse.action == "interested",
        )
    )
    if response is None:
        raise HTTPException(status_code=404, detail="Отклика нет")

    responder = await session.scalar(
        select(User).options(selectinload(User.photos)).where(User.id == user_id)
    )
    if responder is None or not responder.is_active or responder.is_banned:
        raise HTTPException(status_code=404, detail="Профиль не найден")

    match, chat = await chat_service.create_match(session, user, responder, source="meetup")
    response.accepted_at = datetime.now(timezone.utc)
    await session.commit()

    for uid, other in ((user.id, responder), (user_id, user)):
        await manager.send(
            uid,
            {
                "type": "match",
                "match_id": match.id,
                "chat_id": chat.id,
                "user": {"id": other.id, "first_name": other.first_name},
            },
        )
    await push.notify_match(responder, user)
    return {"chat_id": chat.id, "match_id": match.id}
