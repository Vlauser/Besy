from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import cities
from .config import settings
from .routers import (
    admin,
    auth,
    chats,
    discover,
    events,
    me,
    media,
    meetups,
    payments,
    realtime,
    safety,
    telegram,
    verification,
)
from .schemas import ConfigOut, TestCardOut
from .services.matching import TEST_CARDS
from .ws import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.media_root.mkdir(parents=True, exist_ok=True)
    await manager.startup()
    try:
        yield
    finally:
        await manager.shutdown()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Backend for the Treffit Telegram Mini App",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    auth.router,
    me.router,
    verification.router,
    discover.router,
    chats.router,
    events.router,
    meetups.router,
    media.router,
    safety.router,
    payments.router,
    admin.router,
    telegram.router,
    realtime.router,
):
    app.include_router(router)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok"}


@app.get("/config", response_model=ConfigOut, tags=["meta"])
async def config() -> ConfigOut:
    """Product rules the client reads at startup instead of hardcoding.

    The reveal threshold lives on the server; this endpoint only tells the
    UI what to render, it never grants anything.
    """
    return ConfigOut(
        blind_mode=settings.blind_mode,
        reveal_threshold=settings.reveal_threshold,
        min_age=settings.min_age,
        max_photos=settings.max_photos,
        daily_like_limit=settings.daily_like_limit,
        dev_auth_allowed=settings.allow_dev_auth,
        cities=list(cities.NAMES),
        test_cards=[TestCardOut(**card) for card in TEST_CARDS],
    )
