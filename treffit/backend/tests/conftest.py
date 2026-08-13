"""Test bootstrap.

Defaults to a throwaway SQLite file so the suite runs with no services.
Point TREFFIT_DATABASE_URL at Postgres to run the same tests against the
production dialect.
"""

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="treffit-tests-"))
os.environ.setdefault("TREFFIT_DATABASE_URL", f"sqlite+aiosqlite:///{_TMP / 'test.db'}")
os.environ.setdefault("TREFFIT_MEDIA_ROOT", str(_TMP / "media"))
os.environ.setdefault("TREFFIT_SECRET_KEY", "test-secret-key")
os.environ.setdefault("TREFFIT_BOT_TOKEN", "424242:TEST-BOT-TOKEN")
os.environ.setdefault("TREFFIT_ALLOW_DEV_AUTH", "true")
os.environ.setdefault("TREFFIT_BLIND_MODE", "true")

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

pytest_plugins = ["pytest_asyncio"]


@pytest_asyncio.fixture(autouse=True)
async def clean_database():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    # Each test runs in its own event loop; pooled asyncpg connections are
    # bound to the loop that opened them, so the pool must not outlive it.
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def restore_settings():
    """Tests that flip product flags must not leak them into the next test."""
    snapshot = {
        "blind_mode": settings.blind_mode,
        "reveal_threshold": settings.reveal_threshold,
        "daily_like_limit": settings.daily_like_limit,
    }
    yield
    for key, value in snapshot.items():
        setattr(settings, key, value)


class Actor:
    """A signed-in user plus the helpers a test needs to act as them."""

    def __init__(self, client: AsyncClient, token: str, user: dict):
        self.client = client
        self.token = token
        self.user = user
        self.id = user["id"]

    @property
    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    async def get(self, url, **kw):
        return await self.client.get(url, headers=self.headers, **kw)

    async def post(self, url, **kw):
        return await self.client.post(url, headers=self.headers, **kw)

    async def patch(self, url, **kw):
        return await self.client.patch(url, headers=self.headers, **kw)

    async def delete(self, url, **kw):
        return await self.client.delete(url, headers=self.headers, **kw)


async def make_user(
    client: AsyncClient,
    telegram_id: int,
    *,
    name: str = "Тест",
    gender: str = "female",
    seeking: str = "male",
    birth_date: str = "1996-05-05",
    answers: dict | None = None,
    city: str = "Екатеринбург",
    onboard: bool = True,
) -> Actor:
    response = await client.post(
        "/auth/telegram", json={"dev_telegram_id": telegram_id, "dev_first_name": name}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    actor = Actor(client, body["access_token"], body["user"])
    if not onboard:
        return actor

    await actor.post("/me/consent", json={"pdn": True, "photo": True})
    patched = await actor.patch(
        "/me",
        json={
            "birth_date": birth_date,
            "gender": gender,
            "seeking_gender": seeking,
            "city": city,
        },
    )
    assert patched.status_code == 200, patched.text
    saved = await actor.post(
        "/me/test-answers",
        json={"answers": answers or {"1": "left", "2": "left", "3": "left", "4": "left", "5": "left", "6": "left"}},
    )
    assert saved.status_code == 200, saved.text
    actor.user = saved.json()
    return actor


@pytest.fixture
def user_factory(client):
    async def factory(telegram_id: int, **kwargs) -> Actor:
        return await make_user(client, telegram_id, **kwargs)

    return factory
