"""Контроль качества и OCR маркировки через Claude API.

Claude не редактирует изображение — вырезание и центрирование делает processor.py.
Здесь модель отвечает на то, что алгоритм не умеет: считать маркировку с детали
и оценить, не срезан ли край, не осталось ли ошмётков фона.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from PIL import Image

from app.config import settings

log = logging.getLogger(__name__)

ISSUE_CODES = [
    "background_not_white",
    "leftover_background",
    "part_clipped",
    "edge_eaten",
    "part_off_center",
    "foreign_object",
    "blurry",
    "other",
]

SYSTEM_PROMPT = """You inspect product photos of industrial/machining parts that have
just been auto-processed: the background was removed and the part was composited
centred on a pure white canvas.

You do two things:

1. OCR. Read any part marking engraved, stamped or printed on the part itself
   (e.g. "SBHA12-20", "MGEHR2020-2", "CNMG120408"). Return it exactly as printed,
   preserving case, digits and hyphens. If no marking is legible, return null.
   Never guess a plausible-looking code — an unreadable marking is null.

2. Quality control of the processed image against the original. Compare them and
   judge only the processing, not the photography: whether the background is a clean
   uniform white, whether any grey/dust/shadow survived, whether the cut-out ate into
   the part's silhouette, whether part of the part is missing or clipped, whether the
   part sits centred, and whether a foreign object was carried over from the original.

Be strict about `edge_eaten` and `part_clipped` — a silhouette missing a screw head or
a corner is a defect even when the rest looks clean. Be tolerant of the part's own
surface: scratches, machining marks and factory blemishes are the part, not artifacts.

verdict: "ok" — ship it; "warn" — usable but a human should glance at it;
"fail" — must be reprocessed. Keep `comment` to one short sentence in Russian."""

SCHEMA = {
    "type": "object",
    "properties": {
        "marking": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "description": "Part marking read off the part, exactly as printed, or null.",
        },
        "part_description": {
            "type": "string",
            "description": "Short noun phrase naming the part, in Russian.",
        },
        "verdict": {"type": "string", "enum": ["ok", "warn", "fail"]},
        "issues": {
            "type": "array",
            "items": {"type": "string", "enum": ISSUE_CODES},
        },
        "comment": {"type": "string"},
    },
    "required": ["marking", "part_description", "verdict", "issues", "comment"],
    "additionalProperties": False,
}


@dataclass
class QcResult:
    ok: bool
    marking: str | None = None
    part_description: str = ""
    verdict: str = "unknown"
    issues: list[str] = field(default_factory=list)
    comment: str = ""
    usage: dict[str, int] = field(default_factory=dict)
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "marking": self.marking,
            "part_description": self.part_description,
            "verdict": self.verdict,
            "issues": self.issues,
            "comment": self.comment,
            "usage": self.usage,
            "error": self.error,
        }


def _client():
    from anthropic import Anthropic

    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY не задан")
    return Anthropic(api_key=settings.anthropic_api_key)


def _encode(data: bytes, max_edge: int) -> dict[str, Any]:
    """Ужать картинку перед отправкой — токены за изображение считаются по площади."""
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    if max(img.size) > max_edge:
        ratio = max_edge / max(img.size)
        img = img.resize((round(img.width * ratio), round(img.height * ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": base64.standard_b64encode(buf.getvalue()).decode(),
        },
    }


def _parse(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def review(original: bytes, processed: bytes, local_warnings: list[str]) -> QcResult:
    """Отправить пару «до/после» на проверку. Никогда не бросает — ошибка едет в поле error."""
    if not settings.enable_claude:
        return QcResult(ok=True, verdict="skipped", comment="Проверка Claude отключена")

    hint = ""
    if local_warnings:
        hint = (
            "\n\nAutomated pre-checks flagged: "
            + ", ".join(local_warnings)
            + ". Verify these specifically, and ignore them if they look fine to you."
        )

    content = [
        {"type": "text", "text": "Original photo (input to the pipeline):"},
        _encode(original, 1024),
        {"type": "text", "text": "Processed result (what the pipeline produced):"},
        _encode(processed, 1024),
        {
            "type": "text",
            "text": "Read the marking off the part and quality-check the processed image."
            + hint,
        },
    ]

    request: dict[str, Any] = {
        "model": settings.anthropic_model,
        # max_tokens ограничивает размышления + ответ вместе. JSON тут короткий,
        # но на Opus 5 рассуждения включены по умолчанию — оставляем запас.
        "max_tokens": 8000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": content}],
        "output_config": {
            "effort": settings.claude_effort,
            "format": {"type": "json_schema", "schema": SCHEMA},
        },
    }

    try:
        client = _client()
        response = client.messages.create(**request)
    except TypeError:
        # SDK старее, чем output_config — просим JSON текстом.
        request.pop("output_config", None)
        request["system"] = SYSTEM_PROMPT + (
            "\n\nReturn ONLY a JSON object matching this schema, no prose:\n"
            + json.dumps(SCHEMA)
        )
        try:
            response = _client().messages.create(**request)
        except Exception as exc:  # noqa: BLE001
            log.warning("Claude QC failed: %s", exc)
            return QcResult(ok=False, verdict="error", error=str(exc))
    except Exception as exc:  # noqa: BLE001
        log.warning("Claude QC failed: %s", exc)
        return QcResult(ok=False, verdict="error", error=str(exc))

    stop_reason = getattr(response, "stop_reason", None)
    if stop_reason == "refusal":
        return QcResult(ok=False, verdict="error", error="Запрос отклонён фильтром модели")
    if stop_reason == "max_tokens":
        return QcResult(ok=False, verdict="error", error="Ответ модели обрезан лимитом токенов")

    text = "".join(block.text for block in response.content if block.type == "text")
    if not text.strip():
        return QcResult(ok=False, verdict="error", error="Пустой ответ модели")

    try:
        payload = _parse(text)
    except json.JSONDecodeError as exc:
        return QcResult(ok=False, verdict="error", error=f"Ответ не разобран как JSON: {exc}")

    usage = getattr(response, "usage", None)
    return QcResult(
        ok=True,
        marking=(payload.get("marking") or None),
        part_description=payload.get("part_description") or "",
        verdict=payload.get("verdict") or "unknown",
        issues=list(payload.get("issues") or []),
        comment=payload.get("comment") or "",
        usage={
            "input_tokens": getattr(usage, "input_tokens", 0) or 0,
            "output_tokens": getattr(usage, "output_tokens", 0) or 0,
        },
    )
