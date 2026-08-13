"""Photo storage: normalisation, thumbnails, placeholder gradients."""

from __future__ import annotations

import io
import secrets
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from ..config import settings

MAX_EDGE = 1280
THUMB_EDGE = 320
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF"}


class PhotoError(ValueError):
    pass


def _root() -> Path:
    root = Path(settings.media_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _fit(image: Image.Image, edge: int) -> Image.Image:
    copy = image.copy()
    copy.thumbnail((edge, edge), Image.LANCZOS)
    return copy


def dominant_gradient(image: Image.Image) -> str:
    """A two-stop CSS gradient sampled from the image.

    Shown *instead of* the photo before reveal: it hints at the colours
    without leaking a recognisable face, and unlike a CSS blur it cannot be
    undone client-side because the real pixels never leave the server.
    """
    small = image.convert("RGB").resize((2, 2), Image.LANCZOS)
    (r1, g1, b1) = small.getpixel((0, 0))
    (r2, g2, b2) = small.getpixel((1, 1))
    # Pull towards the product's blue so placeholders stay on-brand.
    def mix(c: int, target: int) -> int:
        return int(c * 0.45 + target * 0.55)

    top = f"#{mix(r1, 0xB9):02X}{mix(g1, 0xC6):02X}{mix(b1, 0xFF):02X}"
    bottom = f"#{mix(r2, 0x3D):02X}{mix(g2, 0x6B):02X}{mix(b2, 0xFF):02X}"
    return f"linear-gradient(135deg,{top},{bottom})"


def store_photo(raw: bytes, user_id: int) -> dict:
    """Validate, normalise and write a photo. Returns metadata for the DB row."""
    if len(raw) > settings.max_photo_bytes:
        raise PhotoError("Файл слишком большой")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise PhotoError("Не удалось прочитать изображение") from exc
    if image.format not in ALLOWED_FORMATS:
        raise PhotoError(f"Формат {image.format or 'unknown'} не поддерживается")

    image = image.convert("RGB")
    gradient = dominant_gradient(image)
    full = _fit(image, MAX_EDGE)
    thumb = _fit(image, THUMB_EDGE)

    folder = _root() / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    stem = secrets.token_urlsafe(12)
    full_path = folder / f"{stem}.jpg"
    thumb_path = folder / f"{stem}_thumb.jpg"
    # Strip EXIF by re-encoding: geotags in a dating photo are a real leak.
    full.save(full_path, "JPEG", quality=88, optimize=True)
    thumb.save(thumb_path, "JPEG", quality=82, optimize=True)

    root = _root()
    return {
        "file_path": str(full_path.relative_to(root)),
        "thumb_path": str(thumb_path.relative_to(root)),
        "mime_type": "image/jpeg",
        "width": full.width,
        "height": full.height,
        "blur_gradient": gradient,
    }


def absolute_path(relative: str) -> Path:
    """Resolve a stored relative path, refusing anything outside media root."""
    root = _root().resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise PhotoError("Некорректный путь к файлу")
    return path


def delete_files(*relatives: str | None) -> None:
    for rel in relatives:
        if not rel:
            continue
        try:
            absolute_path(rel).unlink(missing_ok=True)
        except PhotoError:
            continue


def screen_photo(raw: bytes) -> tuple[str, str | None]:
    """Placeholder NSFW gate.

    Returns (status, reason). Real deployments should call a moderation
    provider here; until one is wired in, photos land as `pending` and an
    operator approves them. `moderation.auto_approve` flips this for dev.
    """
    if settings.debug:
        return "approved", None
    return "pending", None
