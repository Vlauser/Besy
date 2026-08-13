"""Photo moderation.

Runs NudeNet locally — no external service, no per-check cost, nothing
leaves the server. The model ships inside the `nudenet` wheel, so there is
no download at runtime and no network dependency in production.

The detector decides only the obvious cases. Anything borderline is left
`pending` for a human in the admin queue: a false reject on a dating photo
costs a real user their profile, so the automation is deliberately timid.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

from ..config import settings
from ..models import ModerationStatus

logger = logging.getLogger(__name__)

# NudeNet v3 label vocabulary, grouped by what we do about it.
EXPLICIT_LABELS = {
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "ANUS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "BUTTOCKS_EXPOSED",
}
SUGGESTIVE_LABELS = {
    "FEMALE_GENITALIA_COVERED",
    "ANUS_COVERED",
    "BUTTOCKS_COVERED",
    "FEMALE_BREAST_COVERED",
    "MALE_BREAST_EXPOSED",
    "BELLY_EXPOSED",
    "ARMPITS_EXPOSED",
}
FACE_LABELS = {"FACE_FEMALE", "FACE_MALE"}

_detector = None
_detector_lock = threading.Lock()


def get_detector():
    """Load the model once, lazily. Import is deferred so the rest of the
    app (and the test suite) does not pay for onnxruntime at startup."""
    global _detector
    if _detector is None:
        with _detector_lock:
            if _detector is None:
                from nudenet import NudeDetector

                _detector = NudeDetector()
    return _detector


@dataclass
class Verdict:
    status: str
    reason: str | None = None
    scores: dict = field(default_factory=dict)


def decide(scores: dict[str, float]) -> Verdict:
    """Turn detector scores into a moderation status.

    Pure function, so the policy is testable without running the model.
    """
    explicit = {label: score for label, score in scores.items() if label in EXPLICIT_LABELS}
    worst_explicit = max(explicit.values(), default=0.0)

    if worst_explicit >= settings.moderation_reject_score:
        label = max(explicit, key=explicit.get)
        return Verdict(ModerationStatus.rejected.value, f"Обнажение на фото ({label})", scores)

    if worst_explicit >= settings.moderation_review_score:
        return Verdict(ModerationStatus.pending.value, "Требуется проверка модератором", scores)

    suggestive = max(
        (score for label, score in scores.items() if label in SUGGESTIVE_LABELS), default=0.0
    )
    if suggestive >= settings.moderation_reject_score:
        return Verdict(ModerationStatus.pending.value, "Откровенное фото, нужна проверка", scores)

    if settings.moderation_require_face:
        face = max((score for label, score in scores.items() if label in FACE_LABELS), default=0.0)
        if face < settings.moderation_review_score:
            return Verdict(ModerationStatus.pending.value, "Лицо не распознано", scores)

    return Verdict(ModerationStatus.approved.value, None, scores)


def scan(path: str) -> dict[str, float]:
    """Best score per label for one image file."""
    detections = get_detector().detect(path)
    scores: dict[str, float] = {}
    for detection in detections:
        label = detection.get("class")
        score = float(detection.get("score", 0.0))
        if label and score > scores.get(label, 0.0):
            scores[label] = round(score, 4)
    return scores


def screen(path: str) -> Verdict:
    """Moderate one stored photo.

    Any failure inside the model falls back to human review rather than
    letting an unchecked photo through.
    """
    if not settings.moderation_enabled:
        return Verdict(ModerationStatus.pending.value, "Автомодерация выключена", {})
    try:
        return decide(scan(path))
    except Exception:  # noqa: BLE001 - a broken model must not open the gate
        logger.exception("Не удалось проверить фото %s", path)
        return Verdict(ModerationStatus.pending.value, "Автопроверка не удалась", {})
