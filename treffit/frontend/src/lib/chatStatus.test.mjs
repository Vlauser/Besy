import assert from "node:assert/strict";
import test from "node:test";

import { partnerStatus } from "./chatStatus.js";

/* Главное, ради чего написан модуль: при выключенном слепом режиме сервер
   всё равно отдаёт revealed: true, и шапка сообщала «фото открыто» о том,
   что никто не закрывал. */
test("без слепого режима про фото не говорим, даже когда revealed", () => {
  const status = partnerStatus({
    typing: false,
    blindMode: false,
    revealed: true,
    remaining: 0,
    online: true,
  });
  assert.equal(status.text, "онлайн");
  assert.equal(status.tone, "muted");
});

test("без слепого режима offline тоже про сеть, а не про фото", () => {
  const status = partnerStatus({
    typing: false,
    blindMode: false,
    revealed: true,
    remaining: 0,
    online: false,
  });
  assert.equal(status.text, "не в сети");
});

test("в слепом режиме открытое фото — это событие", () => {
  const status = partnerStatus({
    typing: false,
    blindMode: true,
    revealed: true,
    remaining: 0,
    online: false,
  });
  assert.equal(status.text, "фото открыто");
  assert.equal(status.tone, "precious");
});

test("в слепом режиме до открытия считаем сообщения", () => {
  const status = partnerStatus({
    typing: false,
    blindMode: true,
    revealed: false,
    remaining: 2,
    online: true,
  });
  assert.equal(status.text, "ещё 2 сообщ. до фото");
  assert.equal(status.tone, "muted");
});

test("набор текста важнее любого другого состояния", () => {
  for (const blindMode of [true, false]) {
    const status = partnerStatus({
      typing: true,
      blindMode,
      revealed: true,
      remaining: 3,
      online: false,
    });
    assert.equal(status.text, "печатает…");
    assert.equal(status.tone, "typing");
  }
});
