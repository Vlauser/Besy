"""Время из базы — в сравнимом виде.

Колонки объявлены как DateTime(timezone=True), но зону обратно отдаёт не
всякая база: Postgres отдаёт, SQLite — нет. Сравнение наивного времени с
`datetime.now(timezone.utc)` роняет запрос с TypeError, и падает оно только
на той базе, где зоны нет, — то есть в разработке и в тестах, а не там, где
это заметили бы сразу.
"""

from __future__ import annotations

from datetime import datetime, timezone


def as_utc(value: datetime | None) -> datetime | None:
    """Дополнить время зоной UTC, если база вернула его без зоны."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
