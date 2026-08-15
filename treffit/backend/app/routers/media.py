from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import CREDENTIALS_ERROR, current_user, load_user
from ..models import Meetup, ModerationStatus, Photo, User
from ..security import decode_access_token
from ..serializers import can_view_photos
from ..services import media

router = APIRouter(prefix="/media", tags=["media"])


async def _viewer(authorization: str | None, token: str | None, session: AsyncSession) -> User:
    """Resolve the viewer from the Authorization header or a `?token=` query.

    `<img src>` cannot carry an Authorization header, so the token may ride
    in the query string for this route only.
    """
    raw = token
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization.split(" ", 1)[1].strip()
    if not raw:
        raise CREDENTIALS_ERROR
    try:
        user_id = decode_access_token(raw)
    except jwt.PyJWTError as exc:
        raise CREDENTIALS_ERROR from exc
    user = await load_user(session, user_id)
    if user is None or not user.is_active or user.is_banned:
        raise CREDENTIALS_ERROR
    return user


@router.get("/photos/{photo_id}")
async def get_photo(
    photo_id: int,
    token: str | None = Query(default=None),
    thumb: bool = Query(default=False),
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Serve a photo file, enforcing the same reveal rule as the API.

    There is no static mount for the media directory anywhere in the app:
    this handler is the only way bytes leave the server.
    """
    photo = await session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")

    viewer = await _viewer(authorization, token, session)
    if viewer.id != photo.user_id:
        if photo.moderation_status != ModerationStatus.approved.value:
            raise HTTPException(status_code=404, detail="Фото не найдено")
        if not await can_view_photos(session, viewer.id, photo.user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Фото ещё не открыто")

    relative = photo.thumb_path if (thumb and photo.thumb_path) else photo.file_path
    try:
        path = media.absolute_path(relative)
    except media.PhotoError as exc:
        raise HTTPException(status_code=404, detail="Файл недоступен") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл недоступен")

    return FileResponse(
        path,
        media_type=photo.mime_type,
        # Private: a shared cache must never hand this to another viewer.
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/meetups/{meetup_id}")
async def get_meetup_image(
    meetup_id: int,
    token: str | None = Query(default=None),
    thumb: bool = Query(default=False),
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Обложка события.

    Правило проще, чем у анкетных фото: событие — публичное приглашение, и
    скрывать его картинку от тех, кто видит саму карточку, незачем. Но
    непроверенную модератором обложку не отдаём никому, кроме автора, —
    ровно как с фотографиями.
    """
    meetup = await session.get(Meetup, meetup_id)
    if meetup is None or not meetup.file_path:
        raise HTTPException(status_code=404, detail="Картинка не найдена")

    viewer = await _viewer(authorization, token, session)
    # То же правило, что и в карточке: прячем только отклонённое. Иначе
    # ссылка в ленте вела бы на 404.
    if viewer.id != meetup.author_id and meetup.moderation_status == ModerationStatus.rejected.value:
        raise HTTPException(status_code=404, detail="Картинка не найдена")

    relative = meetup.thumb_path if (thumb and meetup.thumb_path) else meetup.file_path
    try:
        path = media.absolute_path(relative)
    except media.PhotoError as exc:
        raise HTTPException(status_code=404, detail="Файл недоступен") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл недоступен")

    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/photos/{photo_id}/meta")
async def photo_meta(
    photo_id: int, viewer: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> dict:
    photo = await session.get(Photo, photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    unlocked = await can_view_photos(session, viewer.id, photo.user_id)
    return {
        "id": photo.id,
        "gradient": photo.blur_gradient,
        "locked": not unlocked,
        "width": photo.width,
        "height": photo.height,
    }
