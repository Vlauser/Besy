"""WebSocket hub: in-process and Redis pub/sub fan-out.

The Redis tests exercise a real server when one is reachable at
TREFFIT_TEST_REDIS_URL (default redis://localhost:6379/15), and skip
otherwise — the point is to prove cross-worker delivery, which a fake
in-memory client would not.
"""

import asyncio
import os

import pytest

from app.config import settings
from app.ws import ConnectionManager

REDIS_URL = os.environ.get("TREFFIT_TEST_REDIS_URL", "redis://localhost:6379/15")

pytestmark = pytest.mark.asyncio


class FakeSocket:
    """Enough of a WebSocket for the hub to talk to."""

    def __init__(self):
        self.sent = []
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, payload):
        self.sent.append(payload)


class DeadSocket(FakeSocket):
    async def send_json(self, payload):
        raise RuntimeError("socket is gone")


async def redis_available() -> bool:
    try:
        import redis.asyncio as aioredis
    except ImportError:
        return False
    try:
        client = aioredis.from_url(REDIS_URL)
        await client.ping()
        await client.aclose()
        return True
    except Exception:  # noqa: BLE001
        return False


needs_redis = pytest.mark.skipif(
    not asyncio.run(redis_available()), reason="Redis не запущен на TREFFIT_TEST_REDIS_URL"
)


# --------------------------- in-process ---------------------------


async def test_delivers_to_a_connected_user():
    hub = ConnectionManager()
    socket = FakeSocket()
    await hub.connect(7, socket)

    await hub.send(7, {"type": "ping-test"})
    assert socket.sent == [{"type": "ping-test"}]
    assert socket.accepted is True


async def test_nothing_is_sent_to_someone_else():
    hub = ConnectionManager()
    socket = FakeSocket()
    await hub.connect(7, socket)
    await hub.send(8, {"type": "not-yours"})
    assert socket.sent == []


async def test_all_sockets_of_one_user_receive_it():
    """Same account open on a phone and a laptop."""
    hub = ConnectionManager()
    phone, laptop = FakeSocket(), FakeSocket()
    await hub.connect(7, phone)
    await hub.connect(7, laptop)

    await hub.send(7, {"type": "match"})
    assert phone.sent == laptop.sent == [{"type": "match"}]


async def test_a_dead_socket_is_dropped_not_retried():
    hub = ConnectionManager()
    dead = DeadSocket()
    await hub.connect(7, dead)

    await hub.send(7, {"type": "message"})
    assert hub.is_online(7) is False


async def test_disconnect_clears_presence():
    hub = ConnectionManager()
    socket = FakeSocket()
    await hub.connect(7, socket)
    assert hub.is_online(7) is True
    await hub.disconnect(7, socket)
    assert hub.is_online(7) is False


async def test_broadcast_reaches_each_recipient():
    hub = ConnectionManager()
    a, b = FakeSocket(), FakeSocket()
    await hub.connect(1, a)
    await hub.connect(2, b)

    await hub.broadcast([1, 2], {"type": "announcement"})
    assert a.sent == b.sent == [{"type": "announcement"}]


async def test_without_redis_presence_is_local():
    hub = ConnectionManager()
    assert await hub.is_online_anywhere(7) is False
    await hub.connect(7, FakeSocket())
    assert await hub.is_online_anywhere(7) is True


# --------------------------- redis fan-out ---------------------------


@needs_redis
async def test_event_published_on_one_worker_reaches_the_other(monkeypatch):
    """The whole point of the Redis backend."""
    monkeypatch.setattr(settings, "redis_url", REDIS_URL)
    monkeypatch.setattr(settings, "realtime_channel", "treffit:test:fanout")

    worker_a, worker_b = ConnectionManager(), ConnectionManager()
    await worker_a.startup()
    await worker_b.startup()
    try:
        socket = FakeSocket()
        await worker_b.connect(42, socket)
        await asyncio.sleep(0.2)  # let the subscription settle

        # Published on A, where the user has no socket at all.
        await worker_a.send(42, {"type": "message", "chat_id": 1})

        for _ in range(50):
            if socket.sent:
                break
            await asyncio.sleep(0.05)
        assert socket.sent == [{"type": "message", "chat_id": 1}]
    finally:
        await worker_a.shutdown()
        await worker_b.shutdown()


@needs_redis
async def test_presence_is_visible_across_workers(monkeypatch):
    monkeypatch.setattr(settings, "redis_url", REDIS_URL)
    monkeypatch.setattr(settings, "realtime_channel", "treffit:test:presence")

    worker_a, worker_b = ConnectionManager(), ConnectionManager()
    await worker_a.startup()
    await worker_b.startup()
    try:
        await worker_b.connect(43, FakeSocket())
        await worker_b.mark_online(43)

        # A holds no socket for 43 but must still consider them online.
        assert worker_a.is_online(43) is False
        assert await worker_a.is_online_anywhere(43) is True

        await worker_b.disconnect(43, next(iter(worker_b._connections.get(43, [FakeSocket()]))))
        await worker_b.mark_offline(43)
        assert await worker_a.is_online_anywhere(43) is False
    finally:
        await worker_a.shutdown()
        await worker_b.shutdown()


@needs_redis
async def test_unreachable_redis_falls_back_instead_of_crashing(monkeypatch):
    """A Redis outage must not take the whole service down with it."""
    monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:6399/0".replace("6399", "1"))

    hub = ConnectionManager()
    await hub.startup()
    try:
        socket = FakeSocket()
        await hub.connect(44, socket)
        await hub.send(44, {"type": "message"})
        assert socket.sent == [{"type": "message"}]
    finally:
        await hub.shutdown()
