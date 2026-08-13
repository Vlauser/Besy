"""WebSocket hub.

Two backends behind one interface:

* **in-process** (default) — fine for a single uvicorn worker.
* **Redis pub/sub** — set `TREFFIT_REDIS_URL` and every worker and host
  publishes to one channel, so a user connected to worker 1 still receives
  events produced on worker 2.

Callers only ever touch `manager.send()` / `manager.broadcast()`; which
backend is live is decided at startup.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket

from .config import settings

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._redis = None
        self._pubsub_task: asyncio.Task | None = None

    # ---------------- lifecycle ----------------

    async def startup(self) -> None:
        if not settings.redis_url:
            logger.info("Realtime: in-process hub (single worker)")
            return
        try:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
            await self._redis.ping()
        except Exception:  # noqa: BLE001 - degrade instead of refusing to boot
            logger.exception("Realtime: Redis недоступен, остаёмся на in-process хабе")
            self._redis = None
            return
        self._pubsub_task = asyncio.create_task(self._consume())
        logger.info("Realtime: Redis pub/sub на %s", settings.realtime_channel)

    async def shutdown(self) -> None:
        if self._pubsub_task:
            self._pubsub_task.cancel()
            try:
                await self._pubsub_task
            except asyncio.CancelledError:
                pass
            self._pubsub_task = None
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    async def _consume(self) -> None:
        """Deliver events published by any worker to sockets held here."""
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(settings.realtime_channel)
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(message["data"])
                except (TypeError, ValueError, KeyError):
                    continue
                user_id = envelope.get("user_id")
                payload = envelope.get("payload")
                if isinstance(user_id, int) and isinstance(payload, dict):
                    await self._deliver(user_id, payload)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Realtime: подписка Redis оборвалась")
        finally:
            await pubsub.unsubscribe(settings.realtime_channel)
            await pubsub.aclose()

    # ---------------- connections ----------------

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[user_id].add(websocket)

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[user_id].discard(websocket)
            if not self._connections[user_id]:
                self._connections.pop(user_id, None)

    def is_online(self, user_id: int) -> bool:
        """Whether this process holds a socket for the user.

        With Redis in play another worker may hold one, so a False here is
        "not connected *here*". Push notifications treat that correctly by
        asking `is_online_anywhere`.
        """
        return bool(self._connections.get(user_id))

    async def is_online_anywhere(self, user_id: int) -> bool:
        if self._redis is None:
            return self.is_online(user_id)
        if self.is_online(user_id):
            return True
        return bool(await self._redis.exists(self._presence_key(user_id)))

    @staticmethod
    def _presence_key(user_id: int) -> str:
        return f"treffit:online:{user_id}"

    async def mark_online(self, user_id: int) -> None:
        if self._redis is not None:
            # TTL-backed so a hard crash cannot leave someone "online" forever.
            await self._redis.set(self._presence_key(user_id), "1", ex=90)

    async def refresh_presence(self, user_id: int) -> None:
        await self.mark_online(user_id)

    async def mark_offline(self, user_id: int) -> None:
        if self._redis is not None and not self.is_online(user_id):
            await self._redis.delete(self._presence_key(user_id))

    # ---------------- publishing ----------------

    async def send(self, user_id: int, payload: dict) -> None:
        if self._redis is None:
            await self._deliver(user_id, payload)
            return
        await self._redis.publish(
            settings.realtime_channel, json.dumps({"user_id": user_id, "payload": payload})
        )

    async def broadcast(self, user_ids, payload: dict) -> None:
        for user_id in user_ids:
            await self.send(user_id, payload)

    async def _deliver(self, user_id: int, payload: dict) -> None:
        for websocket in list(self._connections.get(user_id, ())):
            try:
                await websocket.send_json(payload)
            except (RuntimeError, OSError):
                # Socket died between the snapshot and the send.
                await self.disconnect(user_id, websocket)


manager = ConnectionManager()
