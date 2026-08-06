"""Пайплайн обработки: сегментация -> очистка маски -> кроп -> центрирование на белом."""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass, field, asdict
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.config import settings

# rembg тянет модель при первом обращении, поэтому сессия создаётся лениво
# и переиспользуется — иначе каждая картинка платила бы за инициализацию ONNX.
_session_lock = threading.Lock()
_sessions: dict[str, Any] = {}


def get_session(model_name: str):
    with _session_lock:
        if model_name not in _sessions:
            from rembg import new_session

            _sessions[model_name] = new_session(model_name)
        return _sessions[model_name]


def warmup(model_name: str | None = None) -> None:
    """Прогреть модель на старте, чтобы первая картинка не ждала загрузку."""
    get_session(model_name or settings.rembg_model)


@dataclass
class ProcessOptions:
    model: str = field(default_factory=lambda: settings.rembg_model)
    canvas_width: int = field(default_factory=lambda: settings.canvas_width)
    canvas_height: int = field(default_factory=lambda: settings.canvas_height)
    fill_height: float = field(default_factory=lambda: settings.fill_height)
    fill_width_max: float = field(default_factory=lambda: settings.fill_width_max)
    jpeg_quality: int = field(default_factory=lambda: settings.jpeg_quality)
    background: str = field(default_factory=lambda: settings.background)
    alpha_threshold: int = field(default_factory=lambda: settings.alpha_threshold)
    min_component_ratio: float = field(default_factory=lambda: settings.min_component_ratio)
    # Alpha matting даёт более чистый край на сложных деталях, но медленнее в разы.
    alpha_matting: bool = False

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProcessResult:
    jpeg: bytes
    cutout_png: bytes
    metrics: dict[str, Any]
    warnings: list[str]


class ProcessingError(RuntimeError):
    pass


def _to_rgb(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        flat = Image.new("RGB", image.size, (255, 255, 255))
        flat.paste(image, mask=image.split()[-1])
        return flat
    return image.convert("RGB")


def _clean_mask(alpha: np.ndarray, opts: ProcessOptions) -> tuple[np.ndarray, int]:
    """Убрать пыль и блики: бинаризация -> открытие -> отсев мелких компонент."""
    mask = (alpha > opts.alpha_threshold).astype(np.uint8)
    if mask.sum() == 0:
        return mask, 0

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        return mask, 0

    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = int(areas.max())
    keep = [i + 1 for i, area in enumerate(areas) if area >= largest * opts.min_component_ratio]
    dropped = len(areas) - len(keep)

    cleaned = np.isin(labels, keep).astype(np.uint8)
    return cleaned, dropped


def _bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def process_image(data: bytes, opts: ProcessOptions | None = None) -> ProcessResult:
    opts = opts or ProcessOptions()
    warnings: list[str] = []

    try:
        source = Image.open(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise ProcessingError(f"не удалось прочитать файл как изображение: {exc}") from exc

    rgb = _to_rgb(source)
    src_w, src_h = rgb.size

    from rembg import remove

    cut = remove(
        rgb,
        session=get_session(opts.model),
        alpha_matting=opts.alpha_matting,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=15,
        alpha_matting_erode_size=8,
    )
    if cut.mode != "RGBA":
        cut = cut.convert("RGBA")

    arr = np.array(cut)
    alpha = arr[:, :, 3]
    mask, dropped = _clean_mask(alpha, opts)

    covered = int(mask.sum())
    if covered == 0:
        raise ProcessingError(
            "деталь не найдена — модель приняла весь кадр за фон. "
            "Проверьте, что деталь в фокусе и контрастирует с подложкой."
        )

    area_fraction = covered / float(src_w * src_h)
    if area_fraction < 0.005:
        warnings.append("tiny_object")
    if area_fraction > 0.75:
        warnings.append("huge_object")
    if dropped:
        warnings.append("debris_removed")

    x0, y0, x1, y1 = _bbox(mask)
    edge_margin = 2
    touches = (
        x0 <= edge_margin
        or y0 <= edge_margin
        or x1 >= src_w - edge_margin
        or y1 >= src_h - edge_margin
    )
    if touches:
        warnings.append("touches_frame_edge")

    # Альфу берём очищенную, чтобы мусор не проступил полупрозрачными пятнами.
    arr[:, :, 3] = alpha * mask
    cropped = Image.fromarray(arr, mode="RGBA").crop((x0, y0, x1, y1))

    obj_w, obj_h = cropped.size
    scale = min(
        (opts.canvas_height * opts.fill_height) / obj_h,
        (opts.canvas_width * opts.fill_width_max) / obj_w,
    )
    new_w = max(1, round(obj_w * scale))
    new_h = max(1, round(obj_h * scale))
    resample = Image.LANCZOS if scale < 1 else Image.BICUBIC
    resized = cropped.resize((new_w, new_h), resample)

    if scale > 1.6:
        warnings.append("upscaled")

    canvas = Image.new("RGB", (opts.canvas_width, opts.canvas_height), opts.background)
    offset = ((opts.canvas_width - new_w) // 2, (opts.canvas_height - new_h) // 2)
    canvas.paste(resized, offset, resized)

    jpeg_buf = io.BytesIO()
    canvas.save(jpeg_buf, format="JPEG", quality=opts.jpeg_quality, subsampling=0, optimize=True)

    png_buf = io.BytesIO()
    resized.save(png_buf, format="PNG")

    metrics = {
        "source_size": [src_w, src_h],
        "bbox": [x0, y0, x1, y1],
        "object_size": [obj_w, obj_h],
        "placed_size": [new_w, new_h],
        "scale": round(scale, 4),
        "area_fraction": round(area_fraction, 5),
        "dropped_components": dropped,
        "touches_frame_edge": touches,
        "alpha_matting": opts.alpha_matting,
        "model": opts.model,
    }
    return ProcessResult(
        jpeg=jpeg_buf.getvalue(),
        cutout_png=png_buf.getvalue(),
        metrics=metrics,
        warnings=warnings,
    )
