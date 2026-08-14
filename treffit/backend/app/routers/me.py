from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import current_user
from ..models import DeckCard, ModerationStatus, Photo, User
from ..schemas import ConsentIn, MeOut, MeUpdate, PhotoOut, TestAnswersIn
from ..serializers import me_out, photo_out
from ..services import media, moderation, review
from ..services.matching import normalize_answers, rebuild_deck

router = APIRouter(prefix="/me", tags=["me"])


def _finish_onboarding_if_ready(user: User) -> None:
    # Город здесь наравне с полом и датой: без него подбор не знает, где
    # искать, а раньше он просто молча подставлялся.
    if (
        user.onboarded_at is None
        and user.birth_date
        and user.gender
        and user.city
        and user.consent_pdn_at
        and user.test_completed_at
    ):
        user.onboarded_at = datetime.now(timezone.utc)


@router.get("", response_model=MeOut)
async def read_me(user: User = Depends(current_user)) -> MeOut:
    return me_out(user)


@router.patch("", response_model=MeOut)
async def update_me(
    payload: MeUpdate, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> MeOut:
    data = payload.model_dump(exclude_unset=True)

    age_min = data.get("seeking_age_min", user.seeking_age_min)
    age_max = data.get("seeking_age_max", user.seeking_age_max)
    if age_min > age_max:
        raise HTTPException(status_code=422, detail="Минимальный возраст больше максимального")

    # birth_date is identity, not a preference: allow it once, then freeze it
    # so nobody swipes as an adult and edits down afterwards.
    if "birth_date" in data and user.birth_date and data["birth_date"] != user.birth_date:
        raise HTTPException(status_code=409, detail="Дату рождения нельзя изменить, напишите в поддержку")

    for field, value in data.items():
        setattr(user, field, value.value if hasattr(value, "value") else value)

    _finish_onboarding_if_ready(user)
    await session.commit()
    await session.refresh(user, attribute_names=["photos"])
    return me_out(user)


@router.post("/consent", response_model=MeOut)
async def set_consent(
    payload: ConsentIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> MeOut:
    """152-ФЗ requires separate, explicit consent — never bundled."""
    now = datetime.now(timezone.utc)
    if payload.pdn:
        user.consent_pdn_at = now
    if payload.photo:
        user.consent_photo_at = now
    _finish_onboarding_if_ready(user)
    await session.commit()
    await session.refresh(user, attribute_names=["photos"])
    return me_out(user)


@router.get("/test-answers")
async def read_test_answers(user: User = Depends(current_user)) -> dict:
    return {"answers": user.test_answers or {}, "completed_at": user.test_completed_at}


@router.post("/test-answers", response_model=MeOut)
async def save_test_answers(
    payload: TestAnswersIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> MeOut:
    answers = normalize_answers(payload.answers)
    if not answers:
        raise HTTPException(status_code=422, detail="Ни один ответ не распознан")

    user.test_answers = answers
    user.test_completed_at = datetime.now(timezone.utc)
    _finish_onboarding_if_ready(user)

    # Scores are cached on the cards, so answers changing invalidates the
    # whole unscratched pack.
    stale = await session.execute(
        select(DeckCard).where(DeckCard.user_id == user.id, DeckCard.scratched_at.is_(None))
    )
    for card in stale.scalars():
        await session.delete(card)
    await session.flush()
    if user.is_onboarded:
        await rebuild_deck(session, user)

    await session.commit()
    await session.refresh(user, attribute_names=["photos"])
    return me_out(user)


@router.post("/photos", response_model=PhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PhotoOut:
    if not user.consent_photo_at:
        raise HTTPException(status_code=403, detail="Нужно согласие на обработку фото")
    if len(user.photos) >= settings.max_photos:
        raise HTTPException(status_code=409, detail=f"Максимум {settings.max_photos} фото")

    raw = await file.read()
    try:
        stored = media.store_photo(raw, user.id)
    except media.PhotoError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Inference is CPU-bound; keep it off the event loop.
    verdict = await asyncio.to_thread(moderation.screen, str(media.absolute_path(stored["file_path"])))
    position = max((p.position for p in user.photos), default=-1) + 1
    photo = Photo(
        user_id=user.id,
        position=position,
        moderation_status=verdict.status,
        moderation_reason=verdict.reason,
        moderation_scores=verdict.scores,
        **stored,
    )
    session.add(photo)
    await session.commit()
    await session.refresh(photo)

    if photo.moderation_status == ModerationStatus.pending.value:
        await review.notify_photo(session, photo)
    return photo_out(photo, unlocked=True)


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(
    photo_id: int, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    photo = await session.get(Photo, photo_id)
    if photo is None or photo.user_id != user.id:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    media.delete_files(photo.file_path, photo.thumb_path)
    await session.delete(photo)
    await session.commit()


@router.post("/photos/{photo_id}/primary", response_model=list[PhotoOut])
async def make_primary(
    photo_id: int, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[PhotoOut]:
    photos = sorted(user.photos, key=lambda p: p.position)
    target = next((p for p in photos if p.id == photo_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    if target.moderation_status == ModerationStatus.rejected.value:
        raise HTTPException(status_code=409, detail="Фото отклонено модерацией")

    reordered = [target] + [p for p in photos if p.id != photo_id]
    # Park positions out of range first: (user_id, position) is unique, so
    # renumbering in place would collide mid-loop.
    for offset, photo in enumerate(reordered):
        photo.position = 1000 + offset
    await session.flush()
    for index, photo in enumerate(reordered):
        photo.position = index
    await session.commit()
    return [photo_out(p, unlocked=True) for p in reordered]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    """Soft delete: hides the profile everywhere but keeps chat history for
    the other side, who did nothing wrong."""
    user.is_active = False
    await session.commit()
