"""In-process WebSocket hub.

Single-process only. Running more than one uvicorn worker means a user
connected to worker 1 will not receive events published on worker 2 — swap
this for a Redis pub/sub fan-out before scaling out.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

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
        return bool(self._connections.get(user_id))

    async def send(self, user_id: int, payload: dict) -> None:
        for websocket in list(self._connections.get(user_id, ())):
            try:
                await websocket.send_json(payload)
            except (RuntimeError, OSError):
                # Socket died between the snapshot and the send.
                await self.disconnect(user_id, websocket)

    async def broadcast(self, user_ids, payload: dict) -> None:
        for user_id in user_ids:
            await self.send(user_id, payload)


manager = ConnectionManager()
