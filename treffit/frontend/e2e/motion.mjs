/**
 * Проверка оформления: заготовки вместо спиннеров и направление перехода
 * между вкладками.
 *
 * В отличие от smoke.mjs бэкенд не нужен — API подменяется прямо в
 * браузере. Нужен только `npm run dev`:
 *
 *   node e2e/motion.mjs
 *
 * Цель у теста узкая и оттого полезная: это всё вещи, которые ломаются
 * молча. Класс перехода легко потерять при правке App.jsx, а заготовки —
 * откатиться к спиннеру вместе с любым «поправил загрузку».
 */

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5173";
const CHROME_PATH = process.env.CHROME_PATH || undefined;
const SHOTS = process.env.SHOTS_DIR || null;

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

// Эти запросы держим висящими: пока они в пути, на экране должны стоять
// заготовки — ради них тест и написан.
const STALLED = ["/api/discover", "/api/chats", "/api/events"];

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const context = await browser.newContext({ viewport: { width: 430, height: 860 }, hasTouch: true });
const page = await context.newPage();
page.on("pageerror", (error) => {
  failures += 1;
  results.push(`FAIL исключение на странице: ${error.message}`);
});

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

// Скрипт Telegram здесь не нужен и только тратит время на ожидание.
await page.route("**/telegram-web-app.js*", (route) => route.abort());
await page.route(
  (url) => url.pathname.startsWith("/api/"),
  async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") return json(route, CONFIG);
    if (path === "/api/me") return json(route, ME);
    if (path === "/api/likes/incoming/count") return json(route, { count: 0 });
    if (path === "/api/payments/products") return json(route, { items: [] });
    if (STALLED.some((prefix) => path.startsWith(prefix))) {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      return route.abort();
    }
    return json(route, []);
  }
);

await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

// Именно кнопка нижней панели и точное совпадение: «Поиск» встречается и
// в подписях профиля («возраст поиска»), а text= ищет подстроку.
const tab = (name) => page.locator("button").filter({ hasText: new RegExp(`^${name}$`) }).last();
await tab("Поиск").waitFor({ timeout: 15000 });

/* ---------------- заготовки вместо спиннеров ---------------- */

check("на колоде показаны заготовки", (await page.locator(".skeleton").count()) > 0);
check("спиннера на колоде нет", await page.locator(".animate-spin").count(), 0);

/* ---------------- направление перехода ---------------- */

const screen = () => page.locator("#root div.min-h-full").first().getAttribute("class");

await tab("Мероприятия").click();
await page.waitForTimeout(60);
check("вперёд по панели — сдвиг справа", /screen-in-fwd/.test((await screen()) || ""));
check("на афише тоже заготовки", (await page.locator(".skeleton").count()) > 0);

await tab("Профиль").click();
await page.waitForTimeout(400);
await tab("Поиск").click();
await page.waitForTimeout(60);
check("назад по панели — сдвиг слева", /screen-in-back/.test((await screen()) || ""));

/* ---------------- блик на главной кнопке ---------------- */

await tab("События").click();
await page.waitForTimeout(400);
check("у главной кнопки есть блик", (await page.locator(".sheen").count()) > 0);

if (SHOTS) {
  await page.screenshot({ path: `${SHOTS}/meetups.png` });
  await tab("Поиск").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/deck-skeleton.png` });
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} проверок не прошло` : "\nвсё прошло");
await browser.close();
process.exit(failures ? 1 : 0);
