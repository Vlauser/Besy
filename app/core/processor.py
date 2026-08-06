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
    # Ядро детали: выше этого значения альфа считается уверенно деталью.
    alpha_core_threshold: int = field(default_factory=lambda: settings.alpha_core_threshold)
    # Кривая жёсткости: ниже low -> прозрачно, выше high -> непрозрачно.
    alpha_soft_low: int = field(default_factory=lambda: settings.alpha_soft_low)
    alpha_soft_high: int = field(default_factory=lambda: settings.alpha_soft_high)
    # Ширина полосы вокруг ядра, где ещё разрешена полупрозрачность (сглаживание).
    edge_band_px: int = field(default_factory=lambda: settings.edge_band_px)
    # Alpha matting даёт более чистый край на сложных деталях, но медленнее в разы.
    alpha_matting: bool = False

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProcessResult:
    jpeg: bytes
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


def _drop_specks(mask: np.ndarray, opts: ProcessOptions) -> tuple[np.ndarray, int]:
    """Отсеять пыль и блики: открытие + удаление мелких связных компонент."""
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
    return np.isin(labels, keep).astype(np.uint8), dropped


def _build_alpha(alpha: np.ndarray, opts: ProcessOptions) -> tuple[np.ndarray, np.ndarray, dict]:
    """Собрать жёсткую альфу без тени.

    Сегментатор отдаёт мягкую тень не как фон, а как полупрозрачные пиксели
    (альфа ~20-90). Простой низкий порог пропустил бы их, и на белом холсте они
    легли бы серой дымкой. Поэтому:

    1. ядро — то, что уверенно деталь (альфа >= core_threshold);
    2. полупрозрачность разрешена только в узкой полосе вокруг ядра, чтобы
       сохранить сглаживание края, но отрезать широкие градиенты тени;
    3. альфа перекладывается по кривой: ниже soft_low -> 0, выше soft_high -> 255.

    Возвращает (альфа, бинарная маска, метрики).
    """
    core = (alpha >= opts.alpha_core_threshold).astype(np.uint8)
    weak_core = False
    if core.sum() == 0:
        # Деталь целиком полупрозрачная для модели — редкий случай (стекло,
        # сильная засветка). Откатываемся на низкий порог и помечаем результат.
        core = (alpha > opts.alpha_threshold).astype(np.uint8)
        weak_core = True

    core, dropped = _drop_specks(core, opts)
    if core.sum() == 0:
        return np.zeros_like(alpha), core, {"dropped_components": dropped}

    band_px = max(1, int(opts.edge_band_px))
    band_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (band_px * 2 + 1, band_px * 2 + 1)
    )
    band = cv2.dilate(core, band_kernel)

    lo = float(opts.alpha_soft_low)
    hi = float(max(opts.alpha_soft_high, opts.alpha_soft_low + 1))
    ramp = np.clip((alpha.astype(np.float32) - lo) / (hi - lo), 0.0, 1.0)
    hardened = (ramp * 255.0).astype(np.uint8) * band

    # Сколько полупрозрачного было отброшено — это и есть отрезанная тень.
    soft_before = int(((alpha > opts.alpha_threshold) & (alpha < opts.alpha_core_threshold)).sum())
    soft_kept = int(((hardened > 0) & (hardened < 255)).sum())

    metrics = {
        "dropped_components": dropped,
        "soft_alpha_trimmed": max(0, soft_before - soft_kept),
        "weak_core": weak_core,
    }
    return hardened, (hardened > 0).astype(np.uint8), metrics


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
    hardened, mask, alpha_metrics = _build_alpha(arr[:, :, 3], opts)

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
    if alpha_metrics["dropped_components"]:
        warnings.append("debris_removed")
    if alpha_metrics["weak_core"]:
        warnings.append("weak_segmentation")
    # Заметная доля полупрозрачных пикселей отброшена — это была тень.
    if alpha_metrics["soft_alpha_trimmed"] > covered * 0.05:
        warnings.append("shadow_trimmed")

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

    arr[:, :, 3] = hardened
    cropped = Image.fromarray(arr, mode="RGBA").crop((x0, y0, x1, y1))

    # Композит на фон делаем ДО масштабирования. Иначе resize на RGBA смешал бы
    # цвет прозрачных пикселей (а там лежит цвет тени) с краем детали и дал бы
    # серую кайму — Pillow ресемплит цвет без учёта альфы.
    flat = Image.new("RGB", cropped.size, opts.background)
    flat.paste(cropped, (0, 0), cropped)

    obj_w, obj_h = cropped.size
    scale = min(
        (opts.canvas_height * opts.fill_height) / obj_h,
        (opts.canvas_width * opts.fill_width_max) / obj_w,
    )
    new_w = max(1, round(obj_w * scale))
    new_h = max(1, round(obj_h * scale))
    resample = Image.LANCZOS if scale < 1 else Image.BICUBIC
    resized = flat.resize((new_w, new_h), resample)

    if scale > 1.6:
        warnings.append("upscaled")

    canvas = Image.new("RGB", (opts.canvas_width, opts.canvas_height), opts.background)
    offset = ((opts.canvas_width - new_w) // 2, (opts.canvas_height - new_h) // 2)
    canvas.paste(resized, offset)

    jpeg_buf = io.BytesIO()
    canvas.save(jpeg_buf, format="JPEG", quality=opts.jpeg_quality, subsampling=0, optimize=True)

    metrics = {
        "source_size": [src_w, src_h],
        "bbox": [x0, y0, x1, y1],
        "object_size": [obj_w, obj_h],
        "placed_size": [new_w, new_h],
        "scale": round(scale, 4),
        "area_fraction": round(area_fraction, 5),
        "touches_frame_edge": touches,
        "alpha_matting": opts.alpha_matting,
        "model": opts.model,
        **alpha_metrics,
    }
    return ProcessResult(
        jpeg=jpeg_buf.getvalue(),
        metrics=metrics,
        warnings=warnings,
    )
