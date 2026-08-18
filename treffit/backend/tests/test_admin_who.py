"""Команда `who`: найти человека по имени, когда telegram_id неизвестен.

Всё остальное в admin.py ищет только по telegram_id, а в разговоре человек
— это «Полина». Проверяем то, на чём такой поиск обычно и ломается:
регистр, частичное совпадение и несколько однофамильцев разом.
"""

import pytest

from app.db import SessionLocal
from app.models import User
from scripts.admin import cmd_who

pytestmark = pytest.mark.asyncio


async def make(session, *, telegram_id, name, birth_date, username=None):
    from datetime import date

    user = User(
        telegram_id=telegram_id,
        first_name=name,
        username=username,
        birth_date=date.fromisoformat(birth_date),
        gender="female",
        seeking_gender="male",
        city="Екатеринбург",
    )
    session.add(user)
    await session.commit()
    return user


async def test_finds_by_name_and_prints_the_birth_date(capsys):
    async with SessionLocal() as session:
        await make(session, telegram_id=777001, name="Полина", birth_date="1999-03-14")

    await cmd_who("Полина")
    out = capsys.readouterr().out
    assert "Полина" in out
    assert "1999-03-14" in out
    assert "777001" in out


async def test_case_and_partial_match(capsys):
    """«полин» должно находить «Полину» — иначе командой невозможно пользоваться."""
    async with SessionLocal() as session:
        await make(session, telegram_id=777002, name="Полина", birth_date="1999-03-14")

    await cmd_who("полин")
    assert "1999-03-14" in capsys.readouterr().out


async def test_every_match_is_printed(capsys):
    """Один ответ на два совпадения — это ответ про чужую анкету."""
    async with SessionLocal() as session:
        await make(session, telegram_id=777003, name="Полина", birth_date="1999-03-14")
        await make(session, telegram_id=777004, name="Полина", birth_date="2001-08-02")

    await cmd_who("Полина")
    out = capsys.readouterr().out
    assert "Найдено: 2" in out
    assert "1999-03-14" in out and "2001-08-02" in out


async def test_numeric_query_goes_by_telegram_id(capsys):
    async with SessionLocal() as session:
        await make(session, telegram_id=777005, name="Полина", birth_date="1999-03-14")
        await make(session, telegram_id=777006, name="Полина", birth_date="2001-08-02")

    await cmd_who("777006")
    out = capsys.readouterr().out
    assert "Найдено: 1" in out
    assert "2001-08-02" in out


async def test_missing_birth_date_says_so_instead_of_none(capsys):
    async with SessionLocal() as session:
        user = User(
            telegram_id=777007,
            first_name="Полина",
            seeking_gender="male",
            city="Екатеринбург",
        )
        session.add(user)
        await session.commit()

    await cmd_who("Полина")
    out = capsys.readouterr().out
    assert "не указана" in out
    assert "None" not in out


async def test_demo_profiles_are_marked(capsys):
    """У демо-анкет отрицательный telegram_id — их нельзя принять за живых."""
    async with SessionLocal() as session:
        await make(session, telegram_id=-777008, name="Полина", birth_date="1999-03-14")

    await cmd_who("Полина")
    assert "демо-анкета" in capsys.readouterr().out


async def test_nothing_found_is_an_explicit_exit(capsys):
    with pytest.raises(SystemExit) as exit_info:
        await cmd_who("Полина")
    assert "Полина" in str(exit_info.value)
