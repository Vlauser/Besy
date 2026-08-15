"""Приём сообщений об ошибках со стороны клиента.

Пока этого не было, каждый сбой в мини-аппе оставлял после себя только
скриншот: страница пустая, а почему — неизвестно. Здесь браузер сообщает,
что у него сломалось, и это попадает в журнал сервиса.

Ручка нарочно без авторизации: половина интересных сбоев случается до
того, как приложение успело получить токен, — и как раз они самые
непонятные. Плата за это — жёсткие ограничения: короткие поля, потолок на
частоту с одного адреса и никакого хранения в базе.
"""

from __future__ import annotations

import logging
import time
from collections import deque

from fastapi import APIRouter, Request, Response, status

from ..schemas import ClientErrorIn

logger = logging.getLogger("treffit.client")

router = APIRouter(tags=["diagnostics"])

# Не больше стольких сообщений с одного адреса за окно. Одна поломка на
# странице способна выстрелить сотней ошибок подряд — журнал от этого
# станет бесполезным, а канал забитым.
BURST = 10
WINDOW_SECONDS = 60.0
# Сколько адресов держим на учёте. Без потолка счётчик сам станет утечкой
# памяти: адресов в интернете больше, чем у нас памяти.
MAX_TRACKED = 2000

_seen: dict[str, deque[float]] = {}


def _allow(ip: str, now: float | None = None) -> bool:
    """Пропустить ли ещё одно сообщение с этого адреса."""
    now = time.monotonic() if now is None else now
    hits = _seen.get(ip)
    if hits is None:
        if len(_seen) >= MAX_TRACKED:
            # Чистим то, что уже протухло; если чистить нечего — молча
            # отказываем, но не растём.
            for key in [k for k, v in _seen.items() if not v or now - v[-1] > WINDOW_SECONDS]:
                del _seen[key]
            if len(_seen) >= MAX_TRACKED:
                return False
        hits = _seen[ip] = deque(maxlen=BURST)

    while hits and now - hits[0] > WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= BURST:
        return False
    hits.append(now)
    return True


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def report(payload: ClientErrorIn, request: Request) -> Response:
    """Записать ошибку клиента в журнал сервиса.

    Отвечаем 204 всегда — даже когда придержали по частоте. Клиенту незачем
    знать про наши лимиты, а повторять он всё равно не должен.
    """
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
    if not _allow(ip):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # Одной строкой: так её видно в journalctl без раскопок.
    logger.warning(
        "клиент %s: %s | где: %s | сборка: %s | путь: %s%s",
        ip,
        payload.message,
        payload.source or "—",
        payload.bundle or "—",
        payload.path or "—",
        f"\n{payload.stack}" if payload.stack else "",
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
