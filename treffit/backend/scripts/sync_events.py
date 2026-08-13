"""Забрать афишу из КудаGo.

    python -m scripts.sync_events              все города из настроек
    python -m scripts.sync_events msk          только Москва
    python -m scripts.sync_events msk 5        Москва, пять страниц

Для cron, например ежечасно:

    0 * * * * cd /srv/treffit/backend && .venv/bin/python -m scripts.sync_events >> var/sync.log 2>&1

Если в отчёте всё ушло в «пропущено», причину покажет scripts.kudago_probe:
он печатает, на чём именно спотыкается разбор, и сырой ответ источника.
"""

import asyncio
import sys

from app.db import SessionLocal
from app.services import kudago


async def main() -> None:
    location = sys.argv[1] if len(sys.argv) > 1 else None
    pages = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    async with SessionLocal() as session:
        report = await kudago.sync(session, location=location, pages=pages)

    for item in report["locations"]:
        mark = " — НЕ ЗАГРУЗИЛСЯ" if item["failed"] else ""
        print(
            f"{item['city']:<18} создано {item['created']:>4}, "
            f"обновлено {item['updated']:>4}, пропущено {item['skipped']:>4}{mark}"
        )
    print(
        f"\nВсего: создано {report['created']}, "
        f"обновлено {report['updated']}, пропущено {report['skipped']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
