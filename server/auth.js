'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_COOKIE = 'besy_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.email, u.display_name, u.about, u.avatar_file,
           u.is_admin, u.banned_at, u.ban_reason, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    about: row.about,
    avatar: row.avatar_file,
    isAdmin: row.is_admin === 1,
    bannedAt: row.banned_at,
    banReason: row.ban_reason,
    createdAt: row.created_at,
  };
}

/** Populates req.user (or null) for every request. */
function attachUser(req, res, next) {
  req.user = userFromToken(req.cookies?.[SESSION_COOKIE]);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  if (req.user.bannedAt) {
    return res.status(403).json({
      error: `Аккаунт заблокирован${req.user.banReason ? `: ${req.user.banReason}` : ''}`,
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Нужны права модератора' });
  next();
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  attachUser,
  requireAuth,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
};
