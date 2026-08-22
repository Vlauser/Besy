#!/usr/bin/env node
/**
 * Проверка того, что раздаётся ровно собранное.
 *
 *   node scripts/check-dist.mjs --record   запомнить свежую сборку
 *   node scripts/check-dist.mjs            сверить с запомненным
 *
 * Зачем. Между «собрали» и «раздаётся пользователю» лежит каталог на
 * сервере, в который может писать кто угодно с доступом к машине. Чужой
 * скрипт, дописанный в бандл, снаружи выглядит как обычное приложение и
 * не ломает ни один тест — зато домен уезжает в чёрные списки браузеров,
 * а узнаётся об этом от пользователей.
 *
 * Проверка делает три вещи.
 *
 * 1. Сверяет каждый файл с контрольной суммой из dist.manifest.json.
 *    Манифест снимается на сервере сразу после сборки и туда же кладётся,
 *    рядом с dist. В гит он не идёт намеренно: сборка на другой машине
 *    даёт другие хеши, и сверка с чужим манифестом закричала бы на все
 *    файлы разом — а проверку, которая всегда красная, перестают читать.
 * 2. Ищет обращения к чужим доменам и конструкции, которыми обычно
 *    подгружают постороннее.
 * 3. Проверяет, что index.html ссылается на существующие файлы. Половина
 *    выложенной сборки даёт белый экран без единой ошибки в логах.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.env.DIST_DIR ? resolve(process.env.DIST_DIR) : join(ROOT, "dist");
const MANIFEST = process.env.MANIFEST_FILE
  ? resolve(process.env.MANIFEST_FILE)
  : join(ROOT, "dist.manifest.json");

/** Домены, к которым приложение обращается по делу.
 *
 *  w3.org и reactjs.org — не загрузки: первый живёт в атрибутах xmlns у
 *  SVG, второй в тексте ошибки React. Но отличить их от настоящей
 *  загрузки регулярным выражением нельзя, поэтому они здесь. */
const ALLOWED_HOSTS = new Set([
  "telegram.org",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "www.w3.org",
  "reactjs.org",
]);

/** Чем обычно подгружают чужое.
 *
 *  Границы слова обязательны: без них «Function(» находится внутри
 *  безобидного execUnsafeLocalFunction( из React, и проверка начинает
 *  ругаться на чистую сборку — то есть перестаёт что-либо значить. */
const DANGEROUS = [
  [/\beval\s*\(/g, "eval()"],
  [/\bnew\s+Function\s*\(/g, "new Function()"],
  [/\bdocument\s*\.\s*write\b/g, "document.write"],
  [/\bimportScripts\s*\(/g, "importScripts()"],
  [/<iframe\b/gi, "<iframe>"],
  [/\bnavigator\s*\.\s*sendBeacon\s*\(/g, "sendBeacon()"],
];

const TEXT = /\.(html|js|mjs|css|json|map|svg|txt|webmanifest)$/i;

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out.sort();
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function record() {
  const files = walk(DIST);
  const manifest = {
    recordedAt: new Date().toISOString(),
    files: Object.fromEntries(
      files.map((name) => {
        const path = join(DIST, name);
        return [name, { sha256: sha256(path), size: statSync(path).size }];
      })
    ),
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Запомнено файлов: ${files.length}`);
  console.log(`Манифест: ${relative(ROOT, MANIFEST)}`);
  console.log("Снимайте сразу после сборки — иначе сверять будет не с чем.");
}

/** Хосты, к которым обращается файл, кроме разрешённых. */
function foreignHosts(text) {
  const found = new Set();
  for (const match of text.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)) {
    const host = match[1].toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) found.add(host);
  }
  return [...found];
}

function verify() {
  const problems = [];
  const note = (message) => problems.push(message);

  if (!existsSync(DIST)) {
    console.error(`Каталог ${DIST} не найден — нечего проверять.`);
    process.exit(1);
  }

  const present = walk(DIST);

  /* ---------------- контрольные суммы ---------------- */

  if (!existsSync(MANIFEST)) {
    console.log("Манифеста нет — сверять не с чем. Сохраните: --record\n");
  } else {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const expected = manifest.files || {};
    console.log(`Манифест от ${manifest.recordedAt}, файлов в нём: ${Object.keys(expected).length}\n`);

    for (const [name, meta] of Object.entries(expected)) {
      const path = join(DIST, name);
      if (!existsSync(path)) {
        note(`пропал файл: ${name}`);
        continue;
      }
      const actual = sha256(path);
      if (actual !== meta.sha256) {
        note(`изменён файл: ${name}\n    было ${meta.sha256.slice(0, 16)}…, стало ${actual.slice(0, 16)}…`);
      }
    }
    for (const name of present) {
      if (!(name in expected)) note(`лишний файл: ${name}`);
    }
  }

  /* ---------------- содержимое ---------------- */

  for (const name of present) {
    if (!TEXT.test(name)) continue;
    const text = readFileSync(join(DIST, name), "utf8");

    for (const host of foreignHosts(text)) note(`чужой домен в ${name}: ${host}`);
    for (const [pattern, label] of DANGEROUS) {
      const hits = text.match(pattern);
      if (hits) note(`${label} в ${name} — ${hits.length} шт.`);
    }
  }

  /* ---------------- целостность index.html ---------------- */

  const indexPath = join(DIST, "index.html");
  if (!existsSync(indexPath)) {
    note("нет index.html");
  } else {
    const html = readFileSync(indexPath, "utf8");
    for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
      const target = match[1].replace(/^\//, "");
      // Половина выложенной сборки — белый экран без единой ошибки в
      // логах: index.html новый, а файлы, на которые он ссылается,
      // остались от прошлого раза.
      if (!present.includes(target)) note(`index.html ссылается на несуществующий ${target}`);
    }
  }

  /* ---------------- итог ---------------- */

  if (!problems.length) {
    console.log(`Проверено файлов: ${present.length}. Ничего постороннего.`);
    return 0;
  }
  console.log(`Нашлось: ${problems.length}\n`);
  for (const problem of problems) console.log(`  • ${problem}`);
  console.log("\nЕсли правок не делали — считайте, что каталог трогали не вы.");
  return 1;
}

process.exit(process.argv.includes("--record") ? (record(), 0) : verify());
