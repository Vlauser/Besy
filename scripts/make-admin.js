#!/usr/bin/env node
/**
 * Grants or revokes moderator rights.
 * Usage: node --experimental-sqlite scripts/make-admin.js <username> [--revoke]
 */
'use strict';

const { db } = require('../server/db');

const [, , username, flag] = process.argv;

if (!username) {
  console.error('Использование: node --experimental-sqlite scripts/make-admin.js <логин> [--revoke]');
  process.exit(1);
}

const user = db.prepare('SELECT id, username, is_admin FROM users WHERE lower(username) = lower(?)')
  .get(username);

if (!user) {
  console.error(`Пользователь «${username}» не найден`);
  process.exit(1);
}

const makeAdmin = flag !== '--revoke';
db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(makeAdmin ? 1 : 0, user.id);

console.log(makeAdmin
  ? `✅ ${user.username} теперь модератор`
  : `✅ у ${user.username} больше нет прав модератора`);
