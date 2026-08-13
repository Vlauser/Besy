from __future__ import annotations

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..db import SessionLocal
from ..models import Chat, User
from ..security import decode_access_token
from ..ws import manager

router = APIRouter(tags=["realtime"])

WS_POLICY_VIOLATION = 1008


@router.websocket("/ws")
async def realtime(websocket: WebSocket, token: str = Query(default="")) -> None:
    """Live channel for messages, typing and match notifications.

    Sending is deliberately *not* supported here — messages go through
    POST /chats/{id}/messages so the reveal counter has one code path.
    """
    try:
        user_id = decode_access_token(token)
    except jwt.PyJWTError:
        await websocket.close(code=WS_POLICY_VIOLATION)
        return

    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.id == user_id))
        if user is None or not user.is_active or user.is_banned:
            await websocket.close(code=WS_POLICY_VIOLATION)
            return

    await manager.connect(user_id, websocket)
    await websocket.send_json({"type": "ready", "user_id": user_id})
    try:
        while True:
            event = await websocket.receive_json()
            kind = event.get("type")
            if kind == "ping":
                await websocket.send_json({"type": "pong"})
            elif kind == "typing":
                await _relay_typing(user_id, event)
    except WebSocketDisconnect:
        pass
    except (ValueError, RuntimeError):
        # Malformed frame — drop the socket rather than trusting it further.
        pass
    finally:
        await manager.disconnect(user_id, websocket)


async def _relay_typing(user_id: int, event: dict) -> None:
    chat_id = event.get("chat_id")
    if not isinstance(chat_id, int):
        return
    async with SessionLocal() as session:
        chat = await session.get(Chat, chat_id)
        if chat is None or not chat.is_member(user_id):
            return
        other_id = chat.other_id(user_id)
    await manager.send(
        other_id, {"type": "typing", "chat_id": chat_id, "user_id": user_id, "state": bool(event.get("state", True))}
    )
