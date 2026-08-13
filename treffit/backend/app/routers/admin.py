"""Moderation console.

API-only: the queues are small and FastAPI's /docs is a workable operator
UI. Access is by telegram_id from `TREFFIT_ADMIN_TELEGRAM_IDS`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_session
from ..deps import admin_user
from ..models import (
    Match,
    Message,
    ModerationStatus,
    Photo,
    Report,
    User,
    Verification,
    VerificationStatus,
)
from ..schemas import (
    AdminPhotoOut,
    AdminReportOut,
    AdminStatsOut,
    AdminVerificationOut,
    ReviewIn,
)
from ..services import kudago, media, moderation, push, verification as verification_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=AdminStatsOut)
async def stats(_: User = Depends(admin_user), session: AsyncSession = Depends(get_session)) -> AdminStatsOut:
    async def count(query) -> int:
        return int(await session.scalar(query) or 0)

    return AdminStatsOut(
        users_total=await count(select(func.count()).select_from(User)),
        users_active=await count(
            select(func.count()).select_from(User).where(User.is_active.is_(True), User.is_banned.is_(False))
        ),
        users_banned=await count(select(func.count()).select_from(User).where(User.is_banned.is_(True))),
        photos_pending=await count(
            select(func.count()).select_from(Photo).where(Photo.moderation_status == ModerationStatus.pending.value)
        ),
        verifications_pending=await count(
            select(func.count())
            .select_from(Verification)
            .where(Verification.status == VerificationStatus.submitted.value)
        ),
        reports_open=await count(select(func.count()).select_from(Report).where(Report.resolved_at.is_(None))),
        matches_total=await count(select(func.count()).select_from(Match)),
        messages_total=await count(select(func.count()).select_from(Message)),
    )


# --------------------------- photo moderation ---------------------------


@router.get("/photos", response_model=list[AdminPhotoOut])
async def photo_queue(
    photo_status: str = Query(default=ModerationStatus.pending.value, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(get_session),
) -> list[AdminPhotoOut]:
    rows = await session.execute(
        select(Photo, User)
        .join(User, User.id == Photo.user_id)
        .where(Photo.moderation_status == photo_status)
        .order_by(Photo.created_at.asc())
        .limit(limit)
    )
    return [
        AdminPhotoOut(
            id=photo.id,
            user_id=owner.id,
            user_name=owner.first_name,
            telegram_id=owner.telegram_id,
            url=f"/admin/photos/{photo.id}/file",
            moderation_status=photo.moderation_status,
            moderation_reason=photo.moderation_reason,
            moderation_scores=photo.moderation_scores or {},
            created_at=photo.created_at,
        )
        for photo, owner in rows.all()
    ]


@router.get("/photos/{photo_id}/file")
async def photo_file(
    photo_id: int, _: User = Depends(admin_user), session: AsyncSession = Depends(get_session)
) -> Response:
    """Moderators see photos regardless of reveal state — that is the job.

    Separate from /media/photos/{id} on purpose: the reveal rule there stays
    absolute, with no admin branch to get wrong.
    """
    photo = await session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    try:
        path = media.absolute_path(photo.file_path)
    except media.PhotoError as exc:
        raise HTTPException(status_code=404, detail="Файл недоступен") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл недоступен")
    return FileResponse(path, media_type=photo.mime_type, headers={"Cache-Control": "no-store"})


@router.post("/photos/{photo_id}/review", response_model=AdminPhotoOut)
async def review_photo(
    photo_id: int,
    payload: ReviewIn,
    admin: User = Depends(admin_user),
    session: AsyncSession = Depends(get_session),
) -> AdminPhotoOut:
    photo = await session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    owner = await session.get(User, photo.user_id)

    photo.moderation_status = (
        ModerationStatus.approved.value if payload.approve else ModerationStatus.rejected.value
    )
    photo.moderation_reason = payload.reason
    photo.reviewed_by_id = admin.id
    photo.reviewed_at = datetime.now(timezone.utc)
    await session.commit()

    if owner is not None:
        await push.notify_moderation(owner, payload.approve, payload.reason)

    return AdminPhotoOut(
        id=photo.id,
        user_id=photo.user_id,
        user_name=owner.first_name if owner else "—",
        telegram_id=owner.telegram_id if owner else 0,
        url=f"/admin/photos/{photo.id}/file",
        moderation_status=photo.moderation_status,
        moderation_reason=photo.moderation_reason,
        moderation_scores=photo.moderation_scores or {},
        created_at=photo.created_at,
    )


@router.post("/photos/{photo_id}/rescan", response_model=AdminPhotoOut)
async def rescan_photo(
    photo_id: int, _: User = Depends(admin_user), session: AsyncSession = Depends(get_session)
) -> AdminPhotoOut:
    """Re-run the detector, e.g. after changing thresholds."""
    photo = await session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    owner = await session.get(User, photo.user_id)

    verdict = await asyncio.to_thread(moderation.screen, str(media.absolute_path(photo.file_path)))
    photo.moderation_status = verdict.status
    photo.moderation_reason = verdict.reason
    photo.moderation_scores = verdict.scores
    await session.commit()

    return AdminPhotoOut(
        id=photo.id,
        user_id=photo.user_id,
        user_name=owner.first_name if owner else "—",
        telegram_id=owner.telegram_id if owner else 0,
        url=f"/admin/photos/{photo.id}/file",
        moderation_status=photo.moderation_status,
        moderation_reason=photo.moderation_reason,
        moderation_scores=photo.moderation_scores or {},
        created_at=photo.created_at,
    )


# --------------------------- verification ---------------------------


@router.get("/verifications", response_model=list[AdminVerificationOut])
async def verification_queue(
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(get_session),
) -> list[AdminVerificationOut]:
    rows = await session.execute(
        select(Verification, User)
        .join(User, User.id == Verification.user_id)
        .options(selectinload(User.photos))
        .where(Verification.status == VerificationStatus.submitted.value)
        .order_by(Verification.created_at.asc())
        .limit(limit)
    )
    out: list[AdminVerificationOut] = []
    for request, owner in rows.all():
        profile_photos = sorted(owner.photos, key=lambda p: p.position)
        out.append(
            AdminVerificationOut(
                id=request.id,
                user_id=owner.id,
                user_name=owner.first_name,
                gesture=request.gesture,
                instruction=verification_service.describe(request.gesture),
                selfie_url=f"/admin/verifications/{request.id}/file",
                profile_photo_url=(
                    f"/admin/photos/{profile_photos[0].id}/file" if profile_photos else None
                ),
                status=request.status,
                created_at=request.created_at,
            )
        )
    return out


@router.get("/verifications/{request_id}/file")
async def verification_file(
    request_id: int, _: User = Depends(admin_user), session: AsyncSession = Depends(get_session)
) -> Response:
    request = await session.get(Verification, request_id)
    if request is None or not request.file_path:
        raise HTTPException(status_code=404, detail="Селфи не найдено")
    try:
        path = media.absolute_path(request.file_path)
    except media.PhotoError as exc:
        raise HTTPException(status_code=404, detail="Файл недоступен") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл недоступен")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/verifications/{request_id}/review", response_model=AdminVerificationOut)
async def review_verification(
    request_id: int,
    payload: ReviewIn,
    admin: User = Depends(admin_user),
    session: AsyncSession = Depends(get_session),
) -> AdminVerificationOut:
    request = await session.get(Verification, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    owner = await session.get(User, request.user_id)

    request.status = (
        VerificationStatus.approved.value if payload.approve else VerificationStatus.rejected.value
    )
    request.reason = payload.reason
    request.reviewed_by_id = admin.id
    request.reviewed_at = datetime.now(timezone.utc)
    if owner is not None:
        owner.is_verified = payload.approve
        # The selfie has served its purpose; keeping it is a liability.
        if request.file_path:
            media.delete_files(request.file_path)
            request.file_path = None
    await session.commit()

    if owner is not None:
        await push.notify_verification(owner, payload.approve, payload.reason)

    return AdminVerificationOut(
        id=request.id,
        user_id=request.user_id,
        user_name=owner.first_name if owner else "—",
        gesture=request.gesture,
        instruction=verification_service.describe(request.gesture),
        selfie_url=None,
        profile_photo_url=None,
        status=request.status,
        created_at=request.created_at,
    )


# --------------------------- reports & bans ---------------------------


@router.get("/reports", response_model=list[AdminReportOut])
async def report_queue(
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(get_session),
) -> list[AdminReportOut]:
    rows = await session.execute(
        select(Report, User)
        .join(User, User.id == Report.target_id)
        .where(Report.resolved_at.is_(None))
        .order_by(Report.created_at.asc())
        .limit(limit)
    )
    return [
        AdminReportOut(
            id=report.id,
            reporter_id=report.reporter_id,
            target_id=report.target_id,
            target_name=target.first_name,
            target_banned=target.is_banned,
            reason=report.reason,
            details=report.details,
            created_at=report.created_at,
        )
        for report, target in rows.all()
    ]


@router.post("/reports/{report_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_report(
    report_id: int, _: User = Depends(admin_user), session: AsyncSession = Depends(get_session)
):
    report = await session.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Жалоба не найдена")
    report.resolved_at = datetime.now(timezone.utc)
    await session.commit()


@router.post("/users/{user_id}/ban", status_code=status.HTTP_204_NO_CONTENT)
async def ban_user(
    user_id: int, _: User = Depends(admin_user), session: AsyncSession = Depends(get_session)
):
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Профиль не найден")
    target.is_banned = True
    await session.commit()


@router.post("/users/{user_id}/unban", status_code=status.HTTP_204_NO_CONTENT)
async def unban_user(
    user_id: int, _: User = Depends(admin_user), session: AsyncSession = Depends(get_session)
):
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Профиль не найден")
    target.is_banned = False
    await session.commit()


# --------------------------- events ---------------------------


@router.post("/events/sync")
async def sync_events(
    location: str | None = Query(default=None),
    pages: int = Query(default=3, ge=1, le=20),
    _: User = Depends(admin_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Pull events from KudaGo on demand; cron does this on a schedule."""
    return await kudago.sync(session, location=location, pages=pages)
