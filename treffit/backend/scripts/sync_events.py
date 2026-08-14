"""Забрать афишу из КудаGo.

    python -m scripts.sync_events              все города, страниц по умолчанию
    python -m scripts.sync_events 20           все города, двадцать страниц
    python -m scripts.sync_events msk          только Москва
    python -m scripts.sync_events msk 5        Москва, пять страниц

По расписанию запускается таймером systemd — treffit-sync.timer, он ставится
из deploy/bootstrap.sh. Отдельная строка в cron не нужна.

Если в отчёте всё ушло в «пропущено», причину покажет scripts.kudago_probe:
он печатает, на чём именно спотыкается разбор, и сырой ответ источника.
"""

import asyncio
import sys

from app.db import SessionLocal
from app.services import kudago

# Страниц на город. При странице в 50 событий это до пятисот на город —
# столько же, сколько источник отдаёт по Москве и Петербургу целиком.
DEFAULT_PAGES = 10


def parse_args(argv: list[str]) -> tuple[str | None, int]:
    """Город и число страниц, в любом порядке разумности.

    Число первым аргументом означает страницы, а не город: иначе, чтобы
    задать только страницы, приходится передавать пустую строку — а пустая
    строка в кавычках плохо переживает и crontab, и systemd.
    """
    location: str | None = None
    pages = DEFAULT_PAGES

    args = list(argv)
    if args and not args[0].isdigit():
        location = args.pop(0) or None
    if args:
        pages = int(args[0])
    return location, pages


async def main() -> None:
    location, pages = parse_args(sys.argv[1:])

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
