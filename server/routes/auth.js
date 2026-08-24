'use strict';

const express = require('express');
const crypto = require('node:crypto');
const QRCode = require('qrcode');

const { db } = require('../db');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  requireAuth, setSessionCookie, clearSessionCookie, SESSION_COOKIE,
} = require('../auth');
const {
  rateLimit, loginGuard, recordLoginFailure, clearLoginFailures, clientKey,
} = require('../security');
const totp = require('../totp');
const { sendMail, baseUrl } = require('../mailer');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = { verify: 24 * 60 * 60 * 1000, reset: 60 * 60 * 1000 };

const authLimit = rateLimit({
  name: 'auth',
  limit: Number(process.env.BESY_AUTH_RATE_LIMIT) || 20,
  windowMs: 15 * 60 * 1000,
  message: 'Слишком много попыток входа, подождите немного',
});

const emailLimit = rateLimit({
  name: 'email',
  limit: Number(process.env.BESY_EMAIL_RATE_LIMIT) || 5,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много писем — попробуйте через час',
});

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.display_name,
    about: user.about,
    // A URL, not the storage key: the key is an implementation detail and the
    // browser cannot fetch it.
    avatar: (user.avatar ?? user.avatar_file) ? `/media/avatar/${user.username}` : null,
    banner: (user.banner ?? user.banner_file) ? `/media/banner/${user.username}` : null,
    isAdmin: Boolean(user.isAdmin ?? user.is_admin),
    emailVerified: Boolean(user.emailVerifiedAt ?? user.email_verified_at),
    twoFactor: Boolean(user.twoFactor ?? user.totp_enabled),
    strikes: user.strikes ?? 0,
    createdAt: user.createdAt ?? user.created_at,
  };
}

/** Rejects the handful of passwords that show up in every credential dump. */
const WEAK_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui',
  'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'letmein1', 'football',
]);

function passwordProblem(password, { username, email }) {
  if (password.length < 8) return 'Пароль должен быть не короче 8 символов';
  if (password.length > 200) return 'Пароль слишком длинный';
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return 'Такой пароль слишком простой';
  if (username && password.toLowerCase().includes(String(username).toLowerCase())) {
    return 'Пароль не должен содержать логин';
  }
  if (email && password.toLowerCase() === String(email).toLowerCase()) {
    return 'Пароль не должен совпадать с e-mail';
  }
  if (/^(.)\1+$/.test(password)) return 'Пароль состоит из одного символа';
  return null;
}

function issueToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`
    INSERT INTO email_tokens (token, user_id, purpose, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, purpose, Date.now() + TOKEN_TTL[purpose], Date.now());
  return token;
}

/** Looks a token up without spending it. */
function findToken(token, purpose) {
  const row = db.prepare('SELECT * FROM email_tokens WHERE token = ? AND purpose = ?').get(token, purpose);
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  return row;
}

function spendToken(token) {
  db.prepare('UPDATE email_tokens SET used_at = ? WHERE token = ?').run(Date.now(), token);
}

function consumeToken(token, purpose) {
  const row = findToken(token, purpose);
  if (!row) return null;
  spendToken(token);
  return row;
}

async function sendVerification(req, user) {
  const token = issueToken(user.id, 'verify');
  await sendMail({
    to: user.email,
    subject: 'Подтвердите e-mail на Besy',
    text: `Здравствуйте, ${user.display_name}!\n\nПодтвердите адрес, чтобы загружать видео:\n${baseUrl(req)}/verify?token=${token}\n\nСсылка действует 24 часа.`,
  });
}

/* ------------------------------------------------------------------ signup */

router.post('/register', authLimit, async (req, res, next) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim() || username;

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Логин: 3–24 символа, латиница, цифры и «_»' });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Некорректный e-mail' });

  const weak = passwordProblem(password, { username, email });
  if (weak) return res.status(400).json({ error: weak });
  if (displayName.length > 48) return res.status(400).json({ error: 'Имя канала не длиннее 48 символов' });

  const taken = db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?) OR email = ?')
    .get(username, email);
  if (taken) return res.status(409).json({ error: 'Такой логин или e-mail уже занят' });

  // The very first account owns the instance, so it gets moderator rights.
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

  const info = db.prepare(`
    INSERT INTO users (username, email, password_hash, display_name, is_admin, password_changed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, email, hashPassword(password), displayName, isFirstUser ? 1 : 0, Date.now(), Date.now());

  const userId = Number(info.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  try {
    await sendVerification(req, user);
  } catch (err) {
    next(err);
    return;
  }

  setSessionCookie(res, createSession(userId, req));
  res.status(201).json({ user: publicUser(user) });
});

/* ------------------------------------------------------------------- login */

router.post('/login', authLimit, (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const code = String(req.body.code || '').trim();
  const ip = clientKey(req);

  const guard = loginGuard(login, ip);
  if (guard.locked) {
    res.setHeader('Retry-After', guard.retryAfter);
    return res.status(429).json({
      error: `Слишком много неудачных попыток. Повторите через ${Math.ceil(guard.retryAfter / 60)} мин.`,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) OR email = lower(?)')
    .get(login, login);

  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(login, ip);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  if (user.banned_at) {
    return res.status(403).json({
      error: `Аккаунт заблокирован${user.ban_reason ? `: ${user.ban_reason}` : ''}`,
    });
  }

  if (user.totp_enabled) {
    if (!code) {
      return res.status(401).json({ error: 'Введите код из приложения', twoFactorRequired: true });
    }
    const backupHashes = JSON.parse(user.backup_codes || '[]');
    const backupHash = totp.hashBackupCode(code);
    const backupIndex = backupHashes.indexOf(backupHash);

    if (totp.verifyCode(user.totp_secret, code)) {
      // A valid TOTP code is enough.
    } else if (backupIndex !== -1) {
      backupHashes.splice(backupIndex, 1); // Backup codes are single-use.
      db.prepare('UPDATE users SET backup_codes = ? WHERE id = ?')
        .run(JSON.stringify(backupHashes), user.id);
    } else {
      recordLoginFailure(login, ip);
      return res.status(401).json({ error: 'Неверный код подтверждения', twoFactorRequired: true });
    }
  }

  clearLoginFailures(login, ip);
  setSessionCookie(res, createSession(user.id, req));
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

/**
 * Changing the handle. It is also the channel address, so this is not a display
 * setting: every link anyone has shared stops working the moment it changes.
 *
 * The old handle goes straight back into the pool, the way every other service
 * does it. That is what people expect, and the alternative — holding names
 * forever so nobody can impersonate you on the one you left — means a channel
 * quietly hoards every name it ever used.
 *
 * The cooldown stays, and not for link preservation: without it an account can
 * cycle handles fast enough that a strike or a block never catches up with a
 * recognisable name.
 */
const HANDLE_COOLDOWN_MS = Number(process.env.BESY_HANDLE_COOLDOWN_DAYS || 14) * 24 * 60 * 60 * 1000;

router.post('/me/username', requireAuth, authLimit, (req, res) => {
  const username = String(req.body.username || '').trim();

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Логин: 3–24 символа, латиница, цифры и «_»' });
  }
  if (username === req.user.username) {
    return res.status(400).json({ error: 'Это ваш текущий логин' });
  }

  const changedAt = db.prepare('SELECT username_changed_at AS at FROM users WHERE id = ?')
    .get(req.user.id).at;
  if (changedAt && Date.now() - changedAt < HANDLE_COOLDOWN_MS) {
    const days = Math.ceil((HANDLE_COOLDOWN_MS - (Date.now() - changedAt)) / (24 * 60 * 60 * 1000));
    return res.status(429).json({
      error: `Логин можно менять раз в ${HANDLE_COOLDOWN_MS / (24 * 60 * 60 * 1000)} дней. Осталось ${days}.`,
    });
  }

  const taken = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(username);
  if (taken && taken.id !== req.user.id) {
    return res.status(409).json({ error: 'Такой логин уже занят' });
  }

  const previous = req.user.username;
  db.prepare('UPDATE users SET username = ?, username_changed_at = ? WHERE id = ?')
    .run(username, Date.now(), req.user.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user), previous });
});

/* ------------------------------------------------------- email verification */

router.post('/verify/resend', requireAuth, emailLimit, async (req, res, next) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
  try {
    await sendVerification(req, user);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/verify', (req, res) => {
  const row = consumeToken(String(req.body.token || ''), 'verify');
  if (!row) return res.status(400).json({ error: 'Ссылка недействительна или устарела' });

  db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(Date.now(), row.user_id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  res.json({ user: publicUser(user) });
});

/* ---------------------------------------------------------- password reset */

router.post('/password/forgot', emailLimit, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  // Always answer the same way so the endpoint cannot enumerate accounts.
  if (user) {
    try {
      const token = issueToken(user.id, 'reset');
      await sendMail({
        to: user.email,
        subject: 'Сброс пароля на Besy',
        text: `Чтобы задать новый пароль, откройте ссылку:\n${baseUrl(req)}/reset?token=${token}\n\nСсылка действует 1 час. Если вы не запрашивали сброс — просто проигнорируйте письмо.`,
      });
    } catch (err) {
      return next(err);
    }
  }

  res.json({ ok: true });
});

router.post('/password/reset', authLimit, (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');

  const row = findToken(token, 'reset');
  if (!row) return res.status(400).json({ error: 'Ссылка недействительна или устарела' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  // Validate first: a rejected password must not burn the emailed link.
  const weak = passwordProblem(password, { username: user.username, email: user.email });
  if (weak) return res.status(400).json({ error: weak });

  spendToken(token);
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
    .run(hashPassword(password), Date.now(), user.id);
  // Everything signed in with the old password is now logged out.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

  res.json({ ok: true });
});

router.post('/password/change', requireAuth, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, user.password_hash)) {
    return res.status(401).json({ error: 'Текущий пароль неверен' });
  }

  const weak = passwordProblem(next, { username: user.username, email: user.email });
  if (weak) return res.status(400).json({ error: weak });

  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
    .run(hashPassword(next), Date.now(), user.id);

  // Keep the current session, drop the others.
  const keep = req.cookies?.[SESSION_COOKIE];
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, keep);

  res.json({ ok: true });
});

/* --------------------------------------------------------------------- 2FA */

router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  const secret = totp.generateSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ? AND totp_enabled = 0')
    .run(secret, req.user.id);

  const url = totp.otpauthUrl(secret, { account: req.user.email });
  try {
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    res.json({ secret, otpauthUrl: url, qr });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/enable', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.totp_enabled) return res.status(400).json({ error: 'Двухфакторная защита уже включена' });
  if (!user.totp_secret) return res.status(400).json({ error: 'Сначала начните настройку' });

  if (!totp.verifyCode(user.totp_secret, req.body.code)) {
    return res.status(400).json({ error: 'Код не подошёл — проверьте время на устройстве' });
  }

  const backupCodes = totp.generateBackupCodes();
  db.prepare('UPDATE users SET totp_enabled = 1, backup_codes = ? WHERE id = ?')
    .run(JSON.stringify(backupCodes.map(totp.hashBackupCode)), user.id);

  // Shown once: only hashes are stored.
  res.json({ ok: true, backupCodes });
});

router.post('/2fa/disable', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }

  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, backup_codes = '[]' WHERE id = ?")
    .run(user.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- sessions */

router.get('/sessions', requireAuth, (req, res) => {
  const current = req.cookies?.[SESSION_COOKIE];
  const rows = db.prepare(`
    SELECT token, ip, user_agent, created_at, last_seen_at
    FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC
  `).all(req.user.id);

  res.json({
    sessions: rows.map((row) => ({
      id: crypto.createHash('sha256').update(row.token).digest('hex').slice(0, 16),
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      current: row.token === current,
    })),
  });
});

router.delete('/sessions/:id', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(req.user.id);
  const match = rows.find(
    (row) => crypto.createHash('sha256').update(row.token).digest('hex').slice(0, 16) === req.params.id
  );
  if (!match) return res.status(404).json({ error: 'Сессия не найдена' });

  db.prepare('DELETE FROM sessions WHERE token = ?').run(match.token);
  if (match.token === req.cookies?.[SESSION_COOKIE]) clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/sessions/revoke-others', requireAuth, (req, res) => {
  const keep = req.cookies?.[SESSION_COOKIE];
  const info = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, keep);
  res.json({ ok: true, revoked: Number(info.changes) });
});

module.exports = router;
