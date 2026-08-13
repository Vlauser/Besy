from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user
from ..models import User, VerificationStatus
from ..schemas import VerificationOut
from ..services import media, review, verification

router = APIRouter(prefix="/me/verification", tags=["verification"])


def _out(request, user: User) -> VerificationOut:
    if request is None:
        return VerificationOut(status="none", is_verified=user.is_verified)
    return VerificationOut(
        status=request.status,
        gesture=request.gesture,
        instruction=verification.describe(request.gesture),
        reason=request.reason,
        expires_at=request.expires_at,
        is_verified=user.is_verified,
    )


@router.get("", response_model=VerificationOut)
async def read_verification(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> VerificationOut:
    return _out(await verification.active_request(session, user.id), user)


@router.post("/start", response_model=VerificationOut)
async def start_verification(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> VerificationOut:
    """Assign a random gesture to hold in the selfie."""
    if user.is_verified:
        raise HTTPException(status_code=409, detail="Анкета уже подтверждена")
    request = await verification.start(session, user.id)
    await session.commit()
    return _out(request, user)


@router.post("/photo", response_model=VerificationOut)
async def submit_verification(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> VerificationOut:
    if not user.consent_photo_at:
        raise HTTPException(status_code=403, detail="Нужно согласие на обработку фото")

    request = await verification.active_request(session, user.id)
    if request is None:
        raise HTTPException(status_code=409, detail="Сначала запросите жест")
    if request.status == VerificationStatus.submitted.value:
        raise HTTPException(status_code=409, detail="Селфи уже на проверке")

    try:
        stored = media.store_photo(await file.read(), f"verify-{user.id}")
    except media.PhotoError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await verification.submit(session, request, stored["file_path"])
    await session.commit()
    await review.notify_verification(session, request)
    return _out(request, user)
