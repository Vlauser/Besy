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

    print(f"{'Город':<18}{'создано':>9}{'обновлено':>11}{'пропущено':>11}{'повторов':>10}")
    for item in report["locations"]:
        mark = "  — НЕ ЗАГРУЗИЛСЯ" if item["failed"] else ""
        print(
            f"{item['city']:<18}{item['created']:>9}{item['updated']:>11}"
            f"{item['skipped']:>11}{item['repeated']:>10}{mark}"
        )
    print(
        f"\nВсего: создано {report['created']}, обновлено {report['updated']}, "
        f"пропущено {report['skipped']}, повторов {report['repeated']}"
    )
    if report["repeated"]:
        # Повтор — это событие, пришедшее дважды в одном обходе. Много
        # повторов означает, что постраничная выборка вернула пересекающиеся
        # куски, и до дальних событий мы просто не добрались.
        print("Повторы — одно и то же событие на разных страницах выдачи.")


if __name__ == "__main__":
    asyncio.run(main())
