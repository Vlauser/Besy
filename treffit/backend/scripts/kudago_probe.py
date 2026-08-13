"""Что именно приходит от КудаGo и почему события не проходят разбор.

    python -m scripts.kudago_probe [location]

Печатает ответ одной страницы: сколько событий пришло, сколько из них
отсеялось и по какой причине, плюс сырой JSON первых двух — чтобы было
видно, в каком виде источник отдаёт даты и картинки.

Ничего не пишет в базу.
"""

import asyncio
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

import httpx

from app.config import settings
from app.services import kudago


def skip_reason(raw: dict, now: datetime) -> str:
    """Та же логика, что в parse_event, но с объяснением решения."""
    dates = raw.get("dates")
    if not dates:
        return "нет поля dates" if dates is None else "dates пустой"
    if not isinstance(dates, list):
        return f"dates не список, а {type(dates).__name__}"

    starts = [slot.get("start") for slot in dates if isinstance(slot, dict)]
    if not starts:
        return "в dates нет объектов со start"
    if all(not isinstance(s, int) for s in starts):
        return f"start не число: {starts[:3]}"
    if all(isinstance(s, int) and s <= 0 for s in starts):
        return "все start <= 0 (бессрочное событие)"

    if kudago._pick_start(dates, now) is None:
        newest = max((s for s in starts if isinstance(s, int) and s > 0), default=None)
        when = datetime.fromtimestamp(newest, tz=timezone.utc).isoformat() if newest else "?"
        return f"все даты в прошлом (последняя {when})"

    if not (raw.get("short_title") or raw.get("title") or "").strip():
        return "пустой заголовок"
    return "проходит"


async def main() -> None:
    location = sys.argv[1] if len(sys.argv) > 1 else settings.kudago_location
    now = datetime.now(timezone.utc)

    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "Treffit/1.0"}) as client:
        try:
            data = await kudago.fetch_page(client, location, 1, now)
        except httpx.HTTPError as exc:
            sys.exit(f"Запрос не прошёл: {exc!r}")

    results = data.get("results") or []
    print(f"Регион: {location}")
    print(f"Всего в выдаче: {data.get('count', '?')}, на странице: {len(results)}")
    print(f"Сейчас: {now.isoformat()}\n")

    if not results:
        sys.exit("Пустая страница — дальше смотреть нечего.")

    reasons = Counter(skip_reason(raw, now) for raw in results)
    print("Почему события отсеиваются:")
    for reason, count in reasons.most_common():
        print(f"  {count:>4}  {reason}")

    # Есть ли вообще картинки в ответе — ради них всё и затевалось.
    with_images = sum(1 for raw in results if kudago._pick_image(raw.get("images")))
    print(f"\nС афишей: {with_images} из {len(results)}")

    print("\n--- сырой JSON первых двух событий ---")
    for raw in results[:2]:
        print(json.dumps(raw, ensure_ascii=False, indent=2)[:2000])
        print("---")

    # Полезно понять, какими выглядят даты у самого первого.
    first_dates = (results[0].get("dates") or [])[:4]
    print("\ndates первого события, расшифровка:")
    for slot in first_dates:
        if not isinstance(slot, dict):
            print(f"  не объект: {slot!r}")
            continue
        for key in ("start", "end"):
            value = slot.get(key)
            if isinstance(value, int) and 0 < value < 32503680000:
                stamp = datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
            else:
                stamp = "вне диапазона"
            print(f"  {key}={value!r} → {stamp}")
        print("  ·")


if __name__ == "__main__":
    asyncio.run(main())
