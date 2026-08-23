'use strict';

const express = require('express');
const { db } = require('../db');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  requireAuth, setSessionCookie, clearSessionCookie, SESSION_COOKIE,
} = require('../auth');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.display_name,
    isAdmin: (user.isAdmin ?? user.is_admin) ? true : false,
    about: user.about,
    avatar: user.avatar ?? user.avatar_file,
    createdAt: user.createdAt ?? user.created_at,
  };
}

router.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim() || username;

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Логин: 3–24 символа, латиница, цифры и «_»' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Некорректный e-mail' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
  }
  if (displayName.length > 48) {
    return res.status(400).json({ error: 'Имя канала не длиннее 48 символов' });
  }

  const taken = db.prepare(
    'SELECT 1 FROM users WHERE lower(username) = lower(?) OR email = ?'
  ).get(username, email);
  if (taken) {
    return res.status(409).json({ error: 'Такой логин или e-mail уже занят' });
  }

  // The very first account owns the instance, so it gets moderator rights.
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

  const info = db.prepare(`
    INSERT INTO users (username, email, password_hash, display_name, is_admin, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, email, hashPassword(password), displayName, isFirstUser ? 1 : 0, Date.now());

  const userId = Number(info.lastInsertRowid);
  setSessionCookie(res, createSession(userId));

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');

  const user = db.prepare(
    'SELECT * FROM users WHERE lower(username) = lower(?) OR email = lower(?)'
  ).get(login, login);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  if (user.banned_at) {
    return res.status(403).json({
      error: `Аккаунт заблокирован${user.ban_reason ? `: ${user.ban_reason}` : ''}`,
    });
  }

  setSessionCookie(res, createSession(user.id));
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

router.patch('/me', requireAuth, (req, res) => {
  const displayName = String(req.body.displayName ?? req.user.displayName).trim();
  const about = String(req.body.about ?? req.user.about).slice(0, 1000);

  if (!displayName || displayName.length > 48) {
    return res.status(400).json({ error: 'Имя канала: 1–48 символов' });
  }

  db.prepare('UPDATE users SET display_name = ?, about = ? WHERE id = ?')
    .run(displayName, about, req.user.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;
