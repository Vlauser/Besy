/**
 * Переподключение — то место, где ошибка не видна ни в одном экране: всё
 * нарисовано правильно, просто сообщения перестают приходить. Поэтому
 * проверяем его отдельно, на подставном сокете.
 */

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const CONNECTING = 0;

class FakeSocket {
  constructor() {
    FakeSocket.created += 1;
    this.readyState = CONNECTING;
    this.sent = [];
  }

  open() {
    this.readyState = OPEN;
    this.onopen?.();
  }

  /** Сервер или сеть оборвали связь. */
  die() {
    this.readyState = CLOSED;
    this.onclose?.();
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = CLOSED;
  }
}
FakeSocket.created = 0;
FakeSocket.OPEN = OPEN;
FakeSocket.CONNECTING = CONNECTING;
FakeSocket.CLOSING = CLOSING;
FakeSocket.CLOSED = CLOSED;

/** Минимальный DOM: нам нужны только слушатели и признак «скрыто». */
function fakeDom() {
  const handlers = { document: {}, window: {} };
  const add = (bag) => (name, fn) => {
    (bag[name] ||= []).push(fn);
  };
  globalThis.document = {
    hidden: false,
    addEventListener: add(handlers.document),
    removeEventListener: () => {},
  };
  globalThis.window = {
    // websocketUrl() строит адрес из window.location — без него сокет
    // не создаётся вовсе, и тест «не видит» ни одной попытки.
    location: { protocol: "https:", host: "treffit.ru" },
    addEventListener: add(handlers.window),
    removeEventListener: () => {},
  };
  return {
    fire(target, name) {
      (handlers[target][name] || []).forEach((fn) => fn());
    },
  };
}

let realtime;
let dom;
let sockets;

beforeEach(async () => {
  dom = fakeDom();
  sockets = [];
  globalThis.localStorage = { getItem: () => "token", setItem: () => {}, removeItem: () => {} };
  globalThis.WebSocket = class extends FakeSocket {
    constructor(...args) {
      super(...args);
      sockets.push(this);
    }
  };
  Object.assign(globalThis.WebSocket, { OPEN, CONNECTING, CLOSING, CLOSED });
  // Модуль хранит одиночку, поэтому берём его заново на каждый тест.
  const module = await import(`./realtime.js?${Math.random()}`);
  realtime = module.realtime;
});

// Сердцебиение живёт на setInterval: без явного закрытия node --test
// ждал бы его вечно и тест «зависал» бы вместо того, чтобы упасть.
afterEach(() => {
  realtime?.disconnect();
});

test("возврат в приложение поднимает мёртвый сокет сразу", () => {
  realtime.connect();
  sockets[0].open();
  assert.equal(sockets.length, 1);

  // Telegram усыпил веб-вью: сокет мёртв, но никто нам об этом не сказал.
  sockets[0].readyState = CLOSED;
  dom.fire("document", "visibilitychange");

  assert.equal(sockets.length, 2, "новый сокет должен открыться немедленно");
});

test("живой сокет при возврате не пересоздаётся, а проверяется пингом", () => {
  realtime.connect();
  sockets[0].open();
  dom.fire("window", "focus");

  assert.equal(sockets.length, 1, "рвать рабочее соединение незачем");
  assert.deepEqual(JSON.parse(sockets[0].sent.at(-1)), { type: "ping" });
});

test("серия обрывов заводит один таймер, а не по одному на каждый", (t) => {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  t.after(() => {
    globalThis.setTimeout = realSetTimeout;
  });

  realtime.connect();
  sockets[0].open();
  sockets[0].die();
  sockets[0].die();
  sockets[0].die();

  assert.equal(timers.length, 1, "иначе после десятка сворачиваний пойдут пачки попыток");
});

test("свой disconnect переподключение не запускает", (t) => {
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  t.after(() => {
    globalThis.setTimeout = realSetTimeout;
  });

  realtime.connect();
  sockets[0].open();
  realtime.disconnect();
  dom.fire("document", "visibilitychange");

  assert.equal(sockets.length, 1);
  assert.equal(timers.length, 0);
});
