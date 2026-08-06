"""Очередь пакетной обработки: хранение задач, воркеры, сборка ZIP."""

from __future__ import annotations

import asyncio
import io
import logging
import re
import shutil
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import settings
from app.core import claude_qc
from app.core.processor import ProcessingError, ProcessOptions, process_image

log = logging.getLogger(__name__)

JOB_TTL_SECONDS = 24 * 3600
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def _slug(value: str, fallback: str) -> str:
    cleaned = _SAFE_NAME.sub("-", value).strip("-._")
    return cleaned[:80] or fallback


@dataclass
class Item:
    id: str
    filename: str
    status: str = "queued"  # queued | processing | done | error
    error: str | None = None
    warnings: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    qc: dict[str, Any] | None = None
    output_name: str = ""
    duration_ms: int = 0
    # Переопределение параметров для повторной обработки одного файла.
    options: ProcessOptions | None = None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "filename": self.filename,
            "status": self.status,
            "error": self.error,
            "warnings": self.warnings,
            "metrics": self.metrics,
            "qc": self.qc,
            "output_name": self.output_name,
            "duration_ms": self.duration_ms,
        }


@dataclass
class Job:
    id: str
    created_at: float
    options: ProcessOptions
    items: list[Item] = field(default_factory=list)
    cancelled: bool = False

    @property
    def dir(self) -> Path:
        return settings.data_dir / "jobs" / self.id

    def src_path(self, item_id: str) -> Path:
        return self.dir / "src" / item_id

    def out_path(self, item_id: str) -> Path:
        return self.dir / "out" / f"{item_id}.jpg"

    def cut_path(self, item_id: str) -> Path:
        return self.dir / "cut" / f"{item_id}.png"

    def counts(self) -> dict[str, int]:
        totals = {"total": len(self.items), "queued": 0, "processing": 0, "done": 0, "error": 0}
        for item in self.items:
            totals[item.status] = totals.get(item.status, 0) + 1
        return totals

    def status(self) -> str:
        counts = self.counts()
        if self.cancelled:
            return "cancelled"
        if counts["queued"] or counts["processing"]:
            return "running"
        return "finished"

    def usage(self) -> dict[str, int]:
        totals = {"input_tokens": 0, "output_tokens": 0}
        for item in self.items:
            usage = (item.qc or {}).get("usage") or {}
            totals["input_tokens"] += usage.get("input_tokens", 0)
            totals["output_tokens"] += usage.get("output_tokens", 0)
        return totals

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "status": self.status(),
            "counts": self.counts(),
            "usage": self.usage(),
            "options": self.options.as_dict(),
            "items": [item.public() for item in self.items],
        }


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
        self._pool = ThreadPoolExecutor(max_workers=max(1, settings.workers))
        self._tasks: list[asyncio.Task] = []

    # --- lifecycle ---

    def start(self) -> None:
        loop = asyncio.get_running_loop()
        for _ in range(max(1, settings.workers)):
            self._tasks.append(loop.create_task(self._worker()))
        self._tasks.append(loop.create_task(self._janitor()))

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        self._pool.shutdown(wait=False, cancel_futures=True)

    # --- api ---

    def create(self, options: ProcessOptions) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], created_at=time.time(), options=options)
        for sub in ("src", "out", "cut"):
            (job.dir / sub).mkdir(parents=True, exist_ok=True)
        self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    async def add_item(self, job: Job, filename: str, data: bytes) -> Item:
        item = Item(id=uuid.uuid4().hex[:12], filename=filename)
        job.src_path(item.id).write_bytes(data)
        job.items.append(item)
        await self._queue.put((job.id, item.id))
        return item

    async def requeue(self, job: Job, item: Item) -> None:
        item.status = "queued"
        item.error = None
        item.warnings = []
        item.qc = None
        await self._queue.put((job.id, item.id))

    def cancel(self, job: Job) -> None:
        job.cancelled = True
        for item in job.items:
            if item.status == "queued":
                item.status = "error"
                item.error = "Отменено"

    def delete(self, job: Job) -> None:
        self._jobs.pop(job.id, None)
        shutil.rmtree(job.dir, ignore_errors=True)

    # --- worker ---

    async def _worker(self) -> None:
        while True:
            job_id, item_id = await self._queue.get()
            try:
                job = self._jobs.get(job_id)
                if not job or job.cancelled:
                    continue
                item = next((i for i in job.items if i.id == item_id), None)
                if not item or item.status not in ("queued",):
                    continue
                item.status = "processing"
                started = time.perf_counter()
                loop = asyncio.get_running_loop()
                try:
                    await loop.run_in_executor(self._pool, self._run_one, job, item)
                    item.status = "done"
                except ProcessingError as exc:
                    item.status = "error"
                    item.error = str(exc)
                except Exception as exc:  # noqa: BLE001
                    log.exception("item %s failed", item_id)
                    item.status = "error"
                    item.error = f"Внутренняя ошибка: {exc}"
                item.duration_ms = int((time.perf_counter() - started) * 1000)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("worker loop error")
            finally:
                self._queue.task_done()

    def _run_one(self, job: Job, item: Item) -> None:
        data = job.src_path(item.id).read_bytes()
        result = process_image(data, item.options or job.options)

        job.out_path(item.id).write_bytes(result.jpeg)
        job.cut_path(item.id).write_bytes(result.cutout_png)
        item.metrics = result.metrics
        item.warnings = result.warnings

        qc = claude_qc.review(data, result.jpeg, result.warnings)
        item.qc = qc.as_dict()

        stem = Path(item.filename).stem
        base = _slug(qc.marking, "") if qc.marking else ""
        item.output_name = f"{base or _slug(stem, item.id)}.jpg"

    # --- housekeeping ---

    async def _janitor(self) -> None:
        while True:
            await asyncio.sleep(600)
            cutoff = time.time() - JOB_TTL_SECONDS
            for job in list(self._jobs.values()):
                if job.created_at < cutoff:
                    log.info("cleaning up expired job %s", job.id)
                    self.delete(job)

    # --- export ---

    def build_zip(self, job: Job) -> bytes:
        buf = io.BytesIO()
        used: dict[str, int] = {}
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in job.items:
                if item.status != "done":
                    continue
                path = job.out_path(item.id)
                if not path.exists():
                    continue
                name = item.output_name or f"{item.id}.jpg"
                seen = used.get(name, 0)
                used[name] = seen + 1
                if seen:
                    name = f"{Path(name).stem}_{seen + 1}.jpg"
                archive.writestr(name, path.read_bytes())
        return buf.getvalue()


store = JobStore()
