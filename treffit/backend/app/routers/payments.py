from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import current_user
from ..models import Purchase, User
from ..schemas import InvoiceIn, InvoiceOut
from ..services import bot

router = APIRouter(prefix="/payments", tags=["payments"])

# Digital goods inside a Mini App must be sold in Stars (XTR) — the app
# stores require it, so there is no card path here on purpose.
PRODUCTS: dict[str, dict] = {
    "premium_1m": {"title": "Treffit Premium — 1 месяц", "description": "Кто вас лайкнул, безлимит лайков, буст анкеты", "amount": 299},
    "boost": {"title": "Буст анкеты", "description": "Ваша анкета выше в колоде 24 часа", "amount": 99},
    "likes_pack": {"title": "Пачка лайков", "description": "+100 лайков сверх дневного лимита", "amount": 49},
}


async def _create_invoice_link(product: dict, payload: str) -> str | None:
    """Ask the Bot API for a Stars invoice link. Returns None without a token
    so local development still exercises the rest of the flow."""
    if not settings.bot_token:
        return None
    try:
        return await bot.call(
            "createInvoiceLink",
            {
                "title": product["title"],
                "description": product["description"],
                "payload": payload,
                "currency": "XTR",
                "prices": [{"label": product["title"], "amount": product["amount"]}],
            },
            raise_on_error=True,
        )
    except bot.BotError as exc:
        raise HTTPException(status_code=502, detail=f"Telegram отклонил счёт: {exc}") from exc


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

    link = await _create_invoice_link(product, invoice_payload)
    return InvoiceOut(
        payload=invoice_payload, product=payload.product, amount=product["amount"], invoice_link=link
    )


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
