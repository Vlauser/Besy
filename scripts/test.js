'use strict';

/**
 * Runs the seven suites, each against a server started just for it.
 *
 * They used to be chained straight into one long-running instance, and that
 * quietly broke them: the rate limiters are keyed by address, so by the time
 * the security suite asked whether a spent backup code is refused, the login
 * budget for 127.0.0.1 was already gone and the answer came back as "too many
 * requests" instead of "no". A suite that shares a limiter with the suite
 * before it is not testing what it says it tests.
 *
 * So every suite gets its own process, its own database under data-test, and
 * its own untouched budgets. `npm run smoke:*` still points at whatever server
 * you have running, which is what you want while working on one thing.
 */

require('./check-node');

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.BESY_TEST_DATA_DIR || path.join(ROOT, 'data-test');

const SUITES = [
  ['smoke.js', 'основное'],
  ['smoke-security.js', 'безопасность'],
  ['smoke-social.js', 'сообщество'],
  ['smoke-live.js', 'эфиры и субтитры'],
  ['smoke-growth.js', 'рост и аналитика'],
  ['smoke-matching.js', 'сверка загрузок'],
  ['smoke-safety.js', 'защита пользователей'],
];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`сервер не поднялся за ${timeoutMs / 1000} с`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function runSuite(file, label) {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), BESY_DATA_DIR: DATA_DIR, BESY_URL: base };

  const server = spawn(process.execPath, ['--experimental-sqlite', path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env,
  });

  try {
    await waitForHealth(base);
    process.stdout.write(`\n── ${label} (${file}) ─ порт ${port}\n`);
    return await run(process.execPath, [path.join(__dirname, file)], env);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.on('exit', resolve));
  }
}

(async function main() {
  const failed = [];
  for (const [file, label] of SUITES) {
    const code = await runSuite(file, label);
    if (code !== 0) {
      failed.push(label);
      // Keep going: one broken area should not hide the state of the rest.
    }
  }

  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  if (failed.length) {
    process.stdout.write(`\n❌ Не прошли наборы: ${failed.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`\n✅ Все семь наборов пройдены\n`);
})();
