import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest

from app.security import InitDataError, create_access_token, decode_access_token, verify_init_data

BOT_TOKEN = "424242:TEST-BOT-TOKEN"


def sign_init_data(user: dict, auth_date: int | None = None, token: str = BOT_TOKEN) -> str:
    fields = {
        "auth_date": str(auth_date or int(time.time())),
        "query_id": "AAF_test",
        "user": json.dumps(user, separators=(",", ":"), ensure_ascii=False),
    }
    check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


def test_valid_init_data_is_accepted():
    init_data = sign_init_data({"id": 777, "first_name": "Аня", "username": "anya"})
    payload = verify_init_data(init_data, BOT_TOKEN)
    assert payload["user"]["id"] == 777
    assert payload["user"]["first_name"] == "Аня"


def test_tampered_payload_is_rejected():
    init_data = sign_init_data({"id": 777, "first_name": "Аня"})
    tampered = init_data.replace("777", "778")
    with pytest.raises(InitDataError, match="hash mismatch"):
        verify_init_data(tampered, BOT_TOKEN)


def test_wrong_bot_token_is_rejected():
    init_data = sign_init_data({"id": 777, "first_name": "Аня"})
    with pytest.raises(InitDataError, match="hash mismatch"):
        verify_init_data(init_data, "999:OTHER-TOKEN")


def test_expired_init_data_is_rejected():
    stale = int(time.time()) - 90_000
    init_data = sign_init_data({"id": 777, "first_name": "Аня"}, auth_date=stale)
    with pytest.raises(InitDataError, match="expired"):
        verify_init_data(init_data, BOT_TOKEN, max_age_seconds=3600)


def test_missing_hash_is_rejected():
    with pytest.raises(InitDataError):
        verify_init_data("auth_date=1&user=%7B%7D", BOT_TOKEN)


def test_empty_bot_token_is_rejected():
    with pytest.raises(InitDataError, match="bot token"):
        verify_init_data(sign_init_data({"id": 1, "first_name": "X"}), "")


def test_access_token_roundtrip():
    token = create_access_token(42)
    assert decode_access_token(token) == 42


def test_token_signed_with_other_key_is_rejected():
    import jwt

    forged = jwt.encode({"sub": "42"}, "not-the-secret", algorithm="HS256")
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(forged)
