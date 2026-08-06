from __future__ import annotations

import hashlib
import hmac
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.core import processor
from app.core.jobs import Job, store
from app.core.processor import ProcessOptions

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("besy")

STATIC_DIR = Path(__file__).parent / "static"
AUTH_COOKIE = "besy_auth"


def _auth_token() -> str:
    return hashlib.sha256(f"besy::{settings.app_password}".encode()).hexdigest()


def require_auth(request: Request) -> None:
    if not settings.app_password:
        return
    token = request.cookies.get(AUTH_COOKIE, "")
    if not hmac.compare_digest(token, _auth_token()):
        raise HTTPException(status_code=401, detail="Требуется вход")


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.start()
    if settings.enable_claude and not settings.anthropic_api_key:
        log.warning("ENABLE_CLAUDE=true, но ANTHROPIC_API_KEY пуст — проверка будет падать")
    try:
        processor.warmup()
        log.info("модель сегментации %s загружена", settings.rembg_model)
    except Exception as exc:  # noqa: BLE001
        log.warning("не удалось прогреть модель на старте: %s", exc)
    yield
    await store.stop()


app = FastAPI(title="Besy — обработка фото деталей", lifespan=lifespan)


def _job_or_404(job_id: str) -> Job:
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Задача не найдена или устарела")
    return job


def _item_or_404(job: Job, item_id: str):
    item = next((i for i in job.items if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Файл не найден")
    return item


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
async def get_config(request: Request) -> JSONResponse:
    authed = not settings.app_password or request.cookies.get(AUTH_COOKIE) == _auth_token()
    return JSONResponse(
        {
            "auth_required": bool(settings.app_password),
            "authenticated": authed,
            "claude_enabled": settings.enable_claude,
            "claude_configured": bool(settings.anthropic_api_key),
            "model": settings.anthropic_model,
            "max_files": settings.max_files_per_job,
            "max_upload_mb": settings.max_upload_mb,
            "defaults": ProcessOptions().as_dict(),
        }
    )


@app.post("/api/login")
async def login(response: Response, password: str = Form(...)) -> dict:
    if not settings.app_password:
        return {"ok": True}
    if not hmac.compare_digest(password, settings.app_password):
        raise HTTPException(status_code=401, detail="Неверный пароль")
    response.set_cookie(
        AUTH_COOKIE, _auth_token(), httponly=True, samesite="lax", max_age=30 * 24 * 3600
    )
    return {"ok": True}


@app.post("/api/jobs", dependencies=[Depends(require_auth)])
async def create_job(
    files: list[UploadFile] = File(...),
    options: str = Form("{}"),
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="Не выбрано ни одного файла")
    if len(files) > settings.max_files_per_job:
        raise HTTPException(
            status_code=400,
            detail=f"За раз можно загрузить не больше {settings.max_files_per_job} файлов",
        )

    try:
        raw = json.loads(options or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Некорректные параметры обработки")

    allowed = set(ProcessOptions().as_dict())
    opts = ProcessOptions(**{k: v for k, v in raw.items() if k in allowed})
    if not (0.1 <= opts.fill_height <= 1.0 and 0.1 <= opts.fill_width_max <= 1.0):
        raise HTTPException(status_code=400, detail="Доля заполнения должна быть в пределах 0.1–1.0")
    if not (200 <= opts.canvas_width <= 4000 and 200 <= opts.canvas_height <= 4000):
        raise HTTPException(status_code=400, detail="Размер холста вне допустимых пределов")

    job = store.create(opts)
    limit = settings.max_upload_mb * 1024 * 1024
    for upload in files:
        data = await upload.read()
        if not data:
            continue
        if len(data) > limit:
            raise HTTPException(
                status_code=413,
                detail=f"{upload.filename}: больше {settings.max_upload_mb} МБ",
            )
        await store.add_item(job, upload.filename or "image.jpg", data)

    if not job.items:
        store.delete(job)
        raise HTTPException(status_code=400, detail="Все файлы оказались пустыми")

    return job.public()


@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_auth)])
async def get_job(job_id: str) -> dict:
    return _job_or_404(job_id).public()


@app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_auth)])
async def cancel_job(job_id: str) -> dict:
    job = _job_or_404(job_id)
    store.cancel(job)
    return job.public()


@app.delete("/api/jobs/{job_id}", dependencies=[Depends(require_auth)])
async def delete_job(job_id: str) -> dict:
    store.delete(_job_or_404(job_id))
    return {"ok": True}


@app.post("/api/jobs/{job_id}/items/{item_id}/retry", dependencies=[Depends(require_auth)])
async def retry_item(job_id: str, item_id: str, alpha_matting: bool = False) -> dict:
    job = _job_or_404(job_id)
    item = _item_or_404(job, item_id)
    if item.status == "processing":
        raise HTTPException(status_code=409, detail="Файл ещё обрабатывается")
    overrides = ProcessOptions(**{**job.options.as_dict(), "alpha_matting": alpha_matting})
    item.options = overrides
    await store.requeue(job, item)
    return item.public()


@app.patch("/api/jobs/{job_id}/items/{item_id}", dependencies=[Depends(require_auth)])
async def rename_item(job_id: str, item_id: str, output_name: str = Form(...)) -> dict:
    job = _job_or_404(job_id)
    item = _item_or_404(job, item_id)
    stem = Path(output_name).stem.strip()
    if not stem:
        raise HTTPException(status_code=400, detail="Пустое имя файла")
    item.output_name = f"{stem[:80]}.jpg"
    return item.public()


@app.get("/api/jobs/{job_id}/items/{item_id}/source", dependencies=[Depends(require_auth)])
async def item_source(job_id: str, item_id: str) -> FileResponse:
    job = _job_or_404(job_id)
    _item_or_404(job, item_id)
    path = job.src_path(item_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Исходник недоступен")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/jobs/{job_id}/items/{item_id}/result", dependencies=[Depends(require_auth)])
async def item_result(job_id: str, item_id: str) -> FileResponse:
    job = _job_or_404(job_id)
    item = _item_or_404(job, item_id)
    path = job.out_path(item_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Результат ещё не готов")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="{item.output_name or item_id}.jpg"'},
    )


@app.get("/api/jobs/{job_id}/download", dependencies=[Depends(require_auth)])
async def download_job(job_id: str) -> Response:
    job = _job_or_404(job_id)
    payload = store.build_zip(job)
    if not payload:
        raise HTTPException(status_code=404, detail="Нет готовых файлов для скачивания")
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="besy-{job.id}.zip"'},
    )


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
