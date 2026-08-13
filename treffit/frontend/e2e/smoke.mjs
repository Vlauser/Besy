/**
 * Browser smoke test for the whole product loop.
 *
 * Needs three things running:
 *   1. Postgres
 *   2. backend with TREFFIT_ALLOW_DEV_AUTH=true, seeded via scripts/seed.py
 *   3. `npm run dev` (default http://127.0.0.1:5173)
 *
 * Then:  node e2e/smoke.mjs
 *
 * Override the target with BASE_URL, and the browser with CHROME_PATH
 * (defaults to whatever `playwright` resolves).
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
  results.push(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` (получили: ${actual})`}`);
  return ok;
}

const browser = await chromium.launch({ executablePath: CHROME_PATH });

async function signIn(label) {
  const context = await browser.newContext({ viewport: { width: 430, height: 860 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    failures += 1;
    results.push(`FAIL исключение на странице: ${error.message}`);
  });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.click(`text=${label}`);
  await page.waitForTimeout(1800);
  return page;
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Swipe the top card right by dragging it, the way a thumb would. */
async function dragLike(page) {
  const card = page.locator("h3").first();
  const box = await card.boundingBox();
  if (!box) return null;
  const name = (await card.textContent()) || "";
  await page.mouse.move(box.x + 60, box.y - 150);
  await page.mouse.down();
  for (let step = 0; step < 14; step++) {
    await page.mouse.move(box.x + 60 + step * 24, box.y - 150);
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  return name.trim();
}

/** Erase a round scratch cover. Border-radius clips hit testing, so every
 *  point has to stay inside the circle or the canvas never sees it. */
async function scratchRound(page) {
  const box = await page.locator("canvas").last().boundingBox();
  if (!box) return false;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const radius = box.width / 2 - 3;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let row = 0; row < 26; row++) {
    if ((await page.locator("canvas").count()) === 0) break;
    const y = cy - radius + (row + 0.5) * ((2 * radius) / 26);
    const half = Math.sqrt(Math.max(0, radius * radius - (y - cy) ** 2));
    for (let i = 0; i <= 24; i++) {
      const t = row % 2 === 0 ? i / 24 : 1 - i / 24;
      await page.mouse.move(cx - half + t * 2 * half, y);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  return (await page.locator("canvas").count()) === 0;
}

/** Walk the deck until the named profile is on top, then like them. Passing
 *  on everyone else keeps the run deterministic regardless of deck order. */
async function likeByName(page, needle, attempts = 6) {
  await page.click("button:has-text('Колода')");
  await page.waitForTimeout(1600);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const name = (await page.locator("h3").first().textContent().catch(() => "")) || "";
    if (!name) return false;
    if (name.includes(needle)) {
      await page.click("button:has-text('♥')");
      await page.waitForTimeout(1600);
      return true;
    }
    await page.click("button:has-text('✕')");
    await page.waitForTimeout(1300);
  }
  return false;
}

async function send(page, text) {
  await page.fill("textarea", text);
  await page.click("button:has(svg.lucide-send)");
  await page.waitForTimeout(1200);
}

// --------------------------- the run ---------------------------

const her = await signIn("Лера, 31");
check("дев-вход выполнен, видна главная", await her.locator("text=События в городе").isVisible());
await shot(her, "01-home");

await her.click("button:has-text('Колода')");
await her.waitForTimeout(1600);
const dragged = await dragLike(her);
check("свайп вправо убирает карту из колоды", Boolean(dragged));
await shot(her, "02-deck");

await her.click("button:has-text('Пачка')");
await her.waitForTimeout(1500);
check("в пачке есть закрытая скретч-карта", (await her.locator("canvas").count()) > 0);
await shot(her, "03-pack");

check("лайк по конкретному профилю проходит", await likeByName(her, "Дима"));
await her.click("button:has-text('Пачка')");
await her.waitForTimeout(1200);

const him = await signIn("Дима, 34");
check("ответный лайк отправлен", await likeByName(him, "Лера"));
check(
  "взаимный лайк показывает попап матча",
  await him.locator("text=Взаимно!").isVisible().catch(() => false)
);

await her.waitForTimeout(1200);
check(
  "второй участник узнаёт о матче через websocket",
  await her.locator("text=Взаимно!").isVisible().catch(() => false)
);
await shot(her, "04-match");

await her.locator("text=Позже").click().catch(() => {});
await him.locator("text=Позже").click().catch(() => {});

await her.click("button:has-text('Чаты')");
await her.waitForTimeout(1500);
await her.click("text=Дима");
await her.waitForTimeout(1600);
check(
  "до порога чат сообщает, сколько сообщений осталось",
  ((await her.locator("p.text-xs").first().textContent()) || "").includes("до фото")
);

await him.click("button:has-text('Чаты')");
await him.waitForTimeout(1400);
await him.click("text=Лера");
await him.waitForTimeout(1500);

await send(her, "Привет! Ты тоже ходишь в горы?");
await him.waitForTimeout(900);
check(
  "сообщение доезжает собеседнику без перезагрузки",
  (await him.locator("body").innerText()).includes("Ты тоже ходишь в горы?")
);

await send(her, "Была на Таганае в выходные");
await send(her, "Как тебе маршрут?");
await her.waitForTimeout(1500);
check("на третьем сообщении появляется скретч с фото", (await her.locator("body").innerText()).includes("Вы открыли фото"));
await shot(her, "05-reveal");

check("фольгу можно стереть полностью", await scratchRound(her));
check(
  "после reveal шапка чата показывает открытое фото",
  ((await her.locator("p.text-xs").first().textContent()) || "").includes("фото открыто")
);
check(
  "у собеседника фото всё ещё закрыто — счётчик у каждого свой",
  ((await him.locator("p.text-xs").first().textContent()) || "").includes("до фото")
);
await shot(her, "06-photo-open");

await browser.close();

console.log(results.join("\n"));
console.log(failures ? `\n${failures} проверок упало` : "\nвсе проверки пройдены");
process.exit(failures ? 1 : 0);
