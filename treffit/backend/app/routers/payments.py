from __future__ import annotations

import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import current_user
from ..models import Purchase, User
from ..schemas import InvoiceIn, InvoiceOut

router = APIRouter(prefix="/payments", tags=["payments"])

# Digital goods inside a Mini App must be sold in Stars (XTR) — the app
# stores require it, so there is no card path here on purpose.
PRODUCTS: dict[str, dict] = {
    "premium_1m": {"title": "Treffit Premium — 1 месяц", "description": "Кто вас лайкнул, безлимит лайков, буст анкеты", "amount": 299},
    "boost": {"title": "Буст анкеты", "description": "Ваша анкета выше в колоде 24 часа", "amount": 99},
    "likes_pack": {"title": "Пачка лайков", "description": "+100 лайков сверх дневного лимита", "amount": 49},
}


async def _create_invoice_link(product_key: str, product: dict, payload: str) -> str | None:
    """Ask the Bot API for a Stars invoice link. Returns None without a token
    so local development still exercises the rest of the flow."""
    if not settings.bot_token:
        return None
    url = f"https://api.telegram.org/bot{settings.bot_token}/createInvoiceLink"
    body = {
        "title": product["title"],
        "description": product["description"],
        "payload": payload,
        "currency": "XTR",
        "prices": [{"label": product["title"], "amount": product["amount"]}],
    }
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(url, json=body)
    data = response.json()
    if not data.get("ok"):
        raise HTTPException(status_code=502, detail=f"Telegram отклонил счёт: {data.get('description')}")
    return data["result"]


@router.get("/products")
async def list_products() -> dict:
    return {
        "currency": "XTR",
        "items": [{"key": key, **value} for key, value in PRODUCTS.items()],
    }


@router.post("/invoice", response_model=InvoiceOut)
async def create_invoice(
    payload: InvoiceIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> InvoiceOut:
    product = PRODUCTS.get(payload.product)
    if product is None:
        raise HTTPException(status_code=404, detail="Товар не найден")

    invoice_payload = f"{payload.product}:{user.id}:{secrets.token_urlsafe(8)}"
    purchase = Purchase(
        user_id=user.id, product=payload.product, amount=product["amount"], payload=invoice_payload
    )
    session.add(purchase)
    await session.commit()

    link = await _create_invoice_link(payload.product, product, invoice_payload)
    return InvoiceOut(
        payload=invoice_payload, product=payload.product, amount=product["amount"], invoice_link=link
    )


def _grant(user: User, product: str) -> None:
    if product == "premium_1m":
        user.is_premium = True
    # boost / likes_pack are consumed by the discovery layer; the purchase
    # row is the record and no profile flag changes.


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Bot webhook for `successful_payment`.

    Telegram signs nothing here, so the shared secret set with
    `setWebhook(secret_token=...)` is the only authentication — reject the
    request outright when it does not match.
    """
    expected = settings.secret_key
    if not x_telegram_bot_api_secret_token or not secrets.compare_digest(
        x_telegram_bot_api_secret_token, expected
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad secret token")

    update = await request.json()
    message = update.get("message") or {}
    payment = message.get("successful_payment")
    if not payment:
        return {"ok": True, "ignored": True}

    invoice_payload = payment.get("invoice_payload")
    purchase = await session.scalar(select(Purchase).where(Purchase.payload == invoice_payload))
    if purchase is None:
        return {"ok": True, "unknown_payload": True}
    if purchase.status == "paid":
        # Telegram retries until it gets a 200; granting twice would be a bug.
        return {"ok": True, "duplicate": True}

    purchase.status = "paid"
    purchase.paid_at = datetime.now(timezone.utc)
    purchase.telegram_charge_id = payment.get("telegram_payment_charge_id")

    buyer = await session.get(User, purchase.user_id)
    if buyer is not None:
        _grant(buyer, purchase.product)
    await session.commit()
    return {"ok": True}


@router.get("/mine")
async def my_purchases(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[dict]:
    rows = await session.execute(
        select(Purchase).where(Purchase.user_id == user.id).order_by(Purchase.created_at.desc()).limit(50)
    )
    return [
        {
            "id": p.id,
            "product": p.product,
            "amount": p.amount,
            "currency": p.currency,
            "status": p.status,
            "paid_at": p.paid_at,
        }
        for p in rows.scalars()
    ]
