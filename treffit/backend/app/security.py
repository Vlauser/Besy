"""Telegram initData verification and session tokens."""

import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

import jwt

from .config import settings


class InitDataError(ValueError):
    pass


def verify_init_data(init_data: str, bot_token: str, max_age_seconds: int | None = None) -> dict:
    """Validate the `initData` string Telegram hands to a Mini App.

    Returns the parsed payload (with `user` decoded from JSON) or raises
    InitDataError. Follows the scheme documented by Telegram: the signing key
    is HMAC-SHA256 of the bot token under the literal key "WebAppData".
    """
    if not bot_token:
        raise InitDataError("bot token is not configured")
    if not init_data:
        raise InitDataError("initData is empty")

    try:
        pairs = dict(parse_qsl(init_data, strict_parsing=True, keep_blank_values=True))
    except ValueError as exc:
        raise InitDataError("initData is not a valid query string") from exc

    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise InitDataError("initData has no hash")

    data_check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        raise InitDataError("initData hash mismatch")

    max_age = settings.init_data_max_age_seconds if max_age_seconds is None else max_age_seconds
    auth_date = pairs.get("auth_date")
    if max_age > 0:
        if not auth_date or not auth_date.isdigit():
            raise InitDataError("initData has no usable auth_date")
        if time.time() - int(auth_date) > max_age:
            raise InitDataError("initData is expired")

    payload: dict = dict(pairs)
    if "user" in payload:
        try:
            payload["user"] = json.loads(payload["user"])
        except json.JSONDecodeError as exc:
            raise InitDataError("initData user payload is not valid JSON") from exc
    if not isinstance(payload.get("user"), dict) or "id" not in payload["user"]:
        raise InitDataError("initData has no user")

    return payload


def create_access_token(user_id: int, *, ttl_hours: int | None = None) -> str:
    now = datetime.now(timezone.utc)
    ttl = settings.jwt_ttl_hours if ttl_hours is None else ttl_hours
    claims = {"sub": str(user_id), "iat": int(now.timestamp()), "exp": int((now + timedelta(hours=ttl)).timestamp())}
    return jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int:
    """Return the user id inside a session token, or raise jwt.PyJWTError."""
    claims = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    sub = claims.get("sub")
    if sub is None:
        raise jwt.InvalidTokenError("token has no subject")
    return int(sub)
