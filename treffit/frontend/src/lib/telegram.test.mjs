import assert from "node:assert/strict";
import test from "node:test";

/**
 * Высота вьюпорта — единственное число, от которого зависит вся вёрстка
 * оболочки. Стоит записать в него переходное значение, и приложение
 * схлопывается в полоску: таб-бар уезжает под шапку, тело пустеет.
 *
 * Модуль читает `window` при каждом вызове, поэтому подменяем его прямо
 * здесь и импортируем один раз.
 */
function setup({ innerHeight, viewportStableHeight }) {
  globalThis.window = {
    innerHeight,
    addEventListener() {},
    removeEventListener() {},
    Telegram:
      viewportStableHeight === undefined
        ? undefined
        : { WebApp: { viewportStableHeight, initData: "x" } },
  };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
}

const { getViewportHeight } = await import("./telegram.js");

test("обычный запуск: берём высоту, которую сообщил Telegram", () => {
  setup({ innerHeight: 800, viewportStableHeight: 740 });
  assert.equal(getViewportHeight(), 740);
});

test("переходная высота при повторном открытии игнорируется", () => {
  // Ровно то, что видно на записи: Telegram отдаёт десятки пикселей, пока
  // веб-вью разворачивается. Записать это значение — значит схлопнуть окно.
  setup({ innerHeight: 800, viewportStableHeight: 48 });
  assert.equal(getViewportHeight(), 800);
});

test("ноль от Telegram — не высота", () => {
  setup({ innerHeight: 812, viewportStableHeight: 0 });
  assert.equal(getViewportHeight(), 812);
});

test("вне Telegram работаем по высоте окна", () => {
  setup({ innerHeight: 900, viewportStableHeight: undefined });
  assert.equal(getViewportHeight(), 900);
});

test("когда врут оба источника, отдаём минимально осмысленную высоту", () => {
  setup({ innerHeight: 12, viewportStableHeight: 30 });
  assert.equal(getViewportHeight(), 320);
});

test("маленький, но правдоподобный экран не подменяется", () => {
  // iPhone SE в развёрнутом мини-аппе — примерно столько. Это настоящая
  // высота, и подменять её нельзя.
  setup({ innerHeight: 667, viewportStableHeight: 560 });
  assert.equal(getViewportHeight(), 560);
});
