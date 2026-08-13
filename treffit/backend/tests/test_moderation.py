"""Moderation policy and the local NudeNet detector."""

import io

import pytest
from PIL import Image, ImageDraw

from app.config import settings
from app.models import ModerationStatus
from app.services import moderation

FACE = {"FACE_FEMALE": 0.9}


@pytest.fixture(autouse=True)
def relaxed_face_rule():
    """Most policy cases are about nudity, not the face rule."""
    original = settings.moderation_require_face
    settings.moderation_require_face = False
    yield
    settings.moderation_require_face = original


def test_clean_photo_is_approved():
    assert moderation.decide({"FEET_EXPOSED": 0.9}).status == ModerationStatus.approved.value


def test_explicit_nudity_is_rejected():
    verdict = moderation.decide({"FEMALE_BREAST_EXPOSED": 0.82, **FACE})
    assert verdict.status == ModerationStatus.rejected.value
    assert "FEMALE_BREAST_EXPOSED" in verdict.reason


def test_borderline_nudity_goes_to_a_human_not_the_bin():
    """A weak signal must never cost a real user their photo silently."""
    score = (settings.moderation_reject_score + settings.moderation_review_score) / 2
    verdict = moderation.decide({"MALE_GENITALIA_EXPOSED": score})
    assert verdict.status == ModerationStatus.pending.value


def test_very_weak_signal_is_ignored():
    verdict = moderation.decide({"ANUS_EXPOSED": settings.moderation_review_score - 0.1})
    assert verdict.status == ModerationStatus.approved.value


def test_strongly_suggestive_photo_is_reviewed():
    verdict = moderation.decide({"BUTTOCKS_COVERED": 0.95, **FACE})
    assert verdict.status == ModerationStatus.pending.value


def test_scores_are_kept_for_audit():
    scores = {"FEMALE_BREAST_EXPOSED": 0.9}
    assert moderation.decide(scores).scores == scores


def test_faceless_photo_is_reviewed_when_the_rule_is_on():
    settings.moderation_require_face = True
    verdict = moderation.decide({"FEET_EXPOSED": 0.4})
    assert verdict.status == ModerationStatus.pending.value
    assert verdict.reason == "Лицо не распознано"


def test_photo_with_a_face_passes_the_face_rule():
    settings.moderation_require_face = True
    assert moderation.decide(FACE).status == ModerationStatus.approved.value


def test_disabled_moderation_defers_to_a_human(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "moderation_enabled", False)
    verdict = moderation.screen(str(tmp_path / "nothing.jpg"))
    assert verdict.status == ModerationStatus.pending.value


def test_detector_failure_never_opens_the_gate(monkeypatch):
    def boom(_path):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(moderation, "scan", boom)
    verdict = moderation.screen("/tmp/whatever.jpg")
    assert verdict.status == ModerationStatus.pending.value
    assert verdict.reason == "Автопроверка не удалась"


def test_real_detector_runs_on_a_real_image(tmp_path):
    """Smoke test of the bundled ONNX model — no network, no API key."""
    path = tmp_path / "scene.jpg"
    image = Image.new("RGB", (640, 480), (150, 160, 175))
    draw = ImageDraw.Draw(image)
    draw.ellipse((240, 140, 400, 320), fill=(210, 180, 160))
    image.save(path)

    scores = moderation.scan(str(path))
    assert isinstance(scores, dict)
    assert all(isinstance(value, float) for value in scores.values())
    # A flat synthetic image must not trip the explicit labels.
    assert not (set(scores) & moderation.EXPLICIT_LABELS)


def test_scan_reports_the_best_score_per_label(monkeypatch):
    class FakeDetector:
        def detect(self, _path):
            return [
                {"class": "FACE_MALE", "score": 0.4},
                {"class": "FACE_MALE", "score": 0.81},
                {"class": "FEET_EXPOSED", "score": 0.2},
            ]

    monkeypatch.setattr(moderation, "get_detector", lambda: FakeDetector())
    assert moderation.scan("x.jpg") == {"FACE_MALE": 0.81, "FEET_EXPOSED": 0.2}


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (400, 500), (180, 170, 160)).save(buffer, "PNG")
    return buffer.getvalue()
