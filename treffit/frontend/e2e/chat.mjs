/**
 * Проверка переписки на подставном API: догрузка истории вверх и то, что
 * прокрутка при этом не прыгает.
 *
 * Бэкенд не нужен, как и в motion.mjs — хватает `npm run dev`:
 *
 *   node e2e/chat.mjs
 *
 * Сервер отдавал историю страницами с самого начала, а клиент брал только
 * последнюю: в длинной переписке всё, что старше пятидесяти сообщений,
 * было недостижимо. Такое не видно ни в одном коротком тестовом чате,
 * поэтому проверка отдельная и с заведомо длинной историей.
 */

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5173";
const CHROME_PATH = process.env.CHROME_PATH || undefined;

const results = [];
let failures = 0;

function check(label, actual, expected = true) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  results.push(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` (получили: ${JSON.stringify(actual)})`}`);
}

const CONFIG = {
  blind_mode: false,
  reveal_threshold: 10,
  min_age: 18,
  max_photos: 6,
  daily_like_limit: 50,
  dev_auth_allowed: false,
  cities: ["Москва"],
  test_cards: [],
};

const ME = {
  id: 1,
  telegram_id: 1,
  username: "tester",
  first_name: "Тест",
  last_name: null,
  birth_date: "1995-01-01",
  age: 30,
  gender: "male",
  seeking_gender: "female",
  seeking_age_min: 18,
  seeking_age_max: 40,
  city: "Москва",
  bio: null,
  interests: [],
  test_answers: {},
  test_completed_at: null,
  consent_pdn_at: "2024-01-01T00:00:00Z",
  consent_photo_at: "2024-01-01T00:00:00Z",
  is_premium: false,
  is_verified: false,
  is_onboarded: true,
  photos: [],
};

const PARTNER = {
  id: 2,
  first_name: "Аня",
  age: 27,
  city: "Москва",
  bio: null,
  interests: [],
  compatibility_pct: 80,
  shared_flags: [],
  event: null,
  is_verified: false,
  is_online: false,
  photos: [],
  photos_locked: false,
};

// Всего сообщений в переписке и размер страницы — как на сервере.
const TOTAL = 130;
const PAGE = 50;

function message(id) {
  return {
    id,
    chat_id: 1,
    sender_id: id % 2 ? 2 : 1,
    type: "text",
    body: `сообщение ${id}`,
    sent_at: new Date(Date.UTC(2026, 0, 1, 12, 0, id % 60)).toISOString(),
    read_at: null,
    mine: id % 2 === 0,
    edited: false,
    deleted: false,
    photo_url: null,
    reply_to: null,
    reactions: [],
  };
}

/** Страница истории: как у сервера — по возрастанию, новее всего в конце. */
function page(beforeId) {
  const top = beforeId ? Number(beforeId) : TOTAL + 1;
  const from = Math.max(1, top - PAGE);
  const ids = [];
  for (let id = from; id < top; id += 1) ids.push(id);
  return ids.map(message);
}

const CHAT = {
  id: 1,
  match_id: 1,
  other: PARTNER,
  revealed: true,
  remaining_to_reveal: 0,
  sent_count: 10,
  has_conversation: true,
  unread: 0,
  last_message: message(TOTAL),
  last_message_at: message(TOTAL).sent_at,
  started_at: "2026-01-01T10:00:00Z",
};

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const context = await browser.newContext({ viewport: { width: 430, height: 860 }, hasTouch: true });
const page_ = await context.newPage();
page_.on("pageerror", (error) => {
  failures += 1;
  results.push(`FAIL исключение на странице: ${error.message}`);
});

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const historyCalls = [];

await page_.route("**/telegram-web-app.js*", (route) => route.abort());
await page_.route(
  (url) => url.pathname.startsWith("/api/"),
  (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/config") return json(route, CONFIG);
    if (path === "/api/me") return json(route, ME);
    if (path === "/api/likes/incoming/count") return json(route, { count: 0 });
    if (path === "/api/payments/products") return json(route, { items: [] });
    if (path === "/api/chats") return json(route, [CHAT]);
    if (path === "/api/chats/1") return json(route, CHAT);
    if (path === "/api/chats/1/messages") {
      const before = url.searchParams.get("before_id");
      historyCalls.push(before);
      return json(route, page(before));
    }
    if (path === "/api/chats/1/read") return route.fulfill({ status: 204, body: "" });
    return json(route, []);
  }
);

await page_.goto(BASE_URL, { waitUntil: "domcontentloaded" });
const tab = (name) => page_.locator("button").filter({ hasText: new RegExp(`^${name}$`) }).last();
await tab("Чаты").waitFor({ timeout: 15000 });
await tab("Чаты").click();

await page_.locator("text=Аня").first().click();
// Точное совпадение: `text=` ищет подстроку, и «сообщение 1» поймало бы
// и 10, и 100 — счётчики врали бы в обе стороны.
const said = (id) => page_.getByText(`сообщение ${id}`, { exact: true });
await said(TOTAL).waitFor({ timeout: 10000 });

// В режиме разработки React монтирует экран дважды, поэтому считаем не
// все обращения, а только страничные — с before_id.
const paged = () => historyCalls.filter(Boolean);
check("первая страница пришла без before_id", paged().length, 0);
check("самое старое сообщение ещё не загружено", await said(1).count(), 0);

const box = page_.locator("div.overflow-y-auto").last();

/* ---------------- догрузка вверх ---------------- */

// Запоминаем, на каком сообщении стоит взгляд, чтобы поймать прыжок.
const anchor = page_.locator(`text=сообщение ${TOTAL - PAGE + 2}`).first();
await box.evaluate((el) => el.scrollTo({ top: 0 }));
await page_.waitForTimeout(900);

check("догрузка ушла на сервер по before_id", paged().length >= 1);
check("старые сообщения появились", (await said(TOTAL - PAGE - 5).count()) > 0);

// Прокрутка должна была уехать вниз ровно на высоту вставки: сообщение,
// на которое человек смотрел, обязано остаться там же, где было.
const stillThere = await anchor.count();
check("прежнее сообщение никуда не делось", stillThere > 0);
const scrolledAway = await box.evaluate((el) => el.scrollTop);
check("прокрутка не осталась в самом верху", scrolledAway > 0);

/* ---------------- конец истории ---------------- */

for (let i = 0; i < 3; i += 1) {
  await box.evaluate((el) => el.scrollTo({ top: 0 }));
  await page_.waitForTimeout(700);
}
check("дошли до самого начала переписки", (await said(1).count()) > 0);
const callsAtStart = paged().length;
await box.evaluate((el) => el.scrollTo({ top: 0 }));
await page_.waitForTimeout(700);
check("в начале переписки запросы прекращаются", paged().length, callsAtStart);

console.log(results.join("\n"));
console.log(failures ? `\n${failures} проверок не прошло` : "\nвсё прошло");
await browser.close();
process.exit(failures ? 1 : 0);
