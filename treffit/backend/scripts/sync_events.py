"""Pull upcoming events from KudaGo.

    python -m scripts.sync_events [location] [pages]

Meant for cron, e.g. hourly:

    0 * * * * cd /srv/treffit/backend && .venv/bin/python -m scripts.sync_events >> var/sync.log 2>&1
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
    print(
        f"{report['location']}: создано {report['created']}, "
        f"обновлено {report['updated']}, пропущено {report['skipped']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
