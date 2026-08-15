"""Приём клиентских ошибок: пишем в журнал, но не даём себя завалить."""

import logging

import pytest

from app.routers import diagnostics

# Пометка только на сетевые проверки: два теста лимитера синхронные.
async_test = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def clean_limiter():
    diagnostics._seen.clear()
    yield
    diagnostics._seen.clear()


@async_test
async def test_an_error_reaches_the_log(client, caplog):
    with caplog.at_level(logging.WARNING, logger="treffit.client"):
        response = await client.post(
            "/client-errors",
            json={"message": "Cannot read properties of undefined", "bundle": "index-abc.js"},
        )
    assert response.status_code == 204
    assert "Cannot read properties of undefined" in caplog.text
    assert "index-abc.js" in caplog.text


@async_test
async def test_no_token_is_needed(client):
    """Половина интересных сбоев случается до авторизации."""
    assert (await client.post("/client-errors", json={"message": "упало до входа"})).status_code == 204


@async_test
async def test_a_long_message_is_refused(client):
    response = await client.post("/client-errors", json={"message": "x" * 5000})
    assert response.status_code == 422


@async_test
async def test_an_empty_body_is_refused(client):
    assert (await client.post("/client-errors", json={})).status_code == 422


@async_test
async def test_a_burst_from_one_address_is_held_back(client, caplog):
    """Одна поломка в цикле отрисовки выстреливает сотней ошибок подряд."""
    with caplog.at_level(logging.WARNING, logger="treffit.client"):
        for index in range(diagnostics.BURST + 15):
            response = await client.post("/client-errors", json={"message": f"сбой {index}"})
            # Придержанное сообщение всё равно получает 204: клиенту незачем
            # знать про лимиты, а повторять он не должен.
            assert response.status_code == 204

    logged = [line for line in caplog.text.splitlines() if "сбой" in line]
    assert len(logged) == diagnostics.BURST


def test_the_limiter_forgets_old_hits():
    """Окно скользящее: вчерашние сообщения не должны блокировать сегодня."""
    for _ in range(diagnostics.BURST):
        assert diagnostics._allow("1.2.3.4", now=1000.0)
    assert diagnostics._allow("1.2.3.4", now=1000.0) is False
    assert diagnostics._allow("1.2.3.4", now=1000.0 + diagnostics.WINDOW_SECONDS + 1) is True


def test_the_limiter_does_not_grow_without_bound():
    """Счётчик адресов сам не должен стать утечкой памяти."""
    now = 5000.0
    for index in range(diagnostics.MAX_TRACKED + 500):
        diagnostics._allow(f"10.0.{index // 256}.{index % 256}", now=now)
    assert len(diagnostics._seen) <= diagnostics.MAX_TRACKED
