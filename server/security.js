'use strict';

const crypto = require('node:crypto');

const CSRF_COOKIE = 'besy_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/* ------------------------------------------------------------------ headers */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/* --------------------------------------------------------------------- CSRF */

/** Issues a readable CSRF cookie the frontend echoes back in a header. */
function csrfToken(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
  req.csrfToken = token;
  next();
}

/**
 * Double-submit check: a state-changing request must carry the cookie value in
 * a header, which cross-site attackers cannot read or set.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);

  if (!cookie || !header || cookie.length !== header.length
      || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return res.status(403).json({ error: 'Проверка CSRF не пройдена — обновите страницу' });
  }

  const origin = req.get('origin');
  if (origin) {
    const host = req.get('host');
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* malformed Origin */ }
    if (originHost !== host) {
      return res.status(403).json({ error: 'Запрос с чужого origin отклонён' });
    }
  }

  next();
}

/* ------------------------------------------------------------ rate limiting */

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now - 3600000) buckets.delete(key);
  }
}, 600000).unref?.();

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Fixed-window limiter. `name` separates independent budgets so that, say,
 * uploading a lot does not lock a user out of browsing.
 */
function rateLimit({ name, limit, windowMs, message, keyFn }) {
  return function limiter(req, res, next) {
    if (process.env.BESY_RATE_LIMIT === 'off') return next();

    const key = `${name}:${keyFn ? keyFn(req) : clientKey(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', Math.ceil((bucket.resetAt - now) / 1000));

    if (bucket.count > limit) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({
        error: message || 'Слишком много запросов, попробуйте немного позже',
      });
    }

    next();
  };
}

/** Drops the counter for a key, e.g. after a successful login. */
function resetLimit(name, key) {
  buckets.delete(`${name}:${key}`);
}

/* ------------------------------------------------- brute-force login guard */

const failures = new Map();
const LOCK_THRESHOLD = 5;
const LOCK_MS = 15 * 60 * 1000;

function loginGuard(identifier, ip) {
  const key = `${String(identifier).toLowerCase()}|${ip}`;
  const record = failures.get(key);
  if (!record) return { locked: false };
  if (record.lockedUntil > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((record.lockedUntil - Date.now()) / 1000) };
  }
  if (record.lockedUntil && record.lockedUntil <= Date.now()) failures.delete(key);
  return { locked: false };
}

function recordLoginFailure(identifier, ip) {
  const key = `${String(identifier).toLowerCase()}|${ip}`;
  const record = failures.get(key) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= LOCK_THRESHOLD) {
    // Each further miss doubles the wait, up to an hour.
    const extra = Math.min(record.count - LOCK_THRESHOLD, 2);
    record.lockedUntil = Date.now() + LOCK_MS * (2 ** extra);
  }
  failures.set(key, record);
  return record;
}

function clearLoginFailures(identifier, ip) {
  failures.delete(`${String(identifier).toLowerCase()}|${ip}`);
}

/* --------------------------------------------------------- signed media URLs */

const SIGNING_SECRET = process.env.BESY_SECRET
  || crypto.createHash('sha256').update(`besy-dev-${process.env.BESY_DATA_DIR || 'default'}`).digest('hex');

const SIGNED_MEDIA = process.env.BESY_SIGNED_MEDIA === 'on';
const SIGNED_TTL_MS = Math.max(60, Number(process.env.BESY_SIGNED_TTL || 21600)) * 1000;

function signMedia(videoId, viewerKey) {
  const expires = Date.now() + SIGNED_TTL_MS;
  const payload = `${videoId}.${viewerKey}.${expires}`;
  const signature = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('base64url');
  return { token: `${expires}.${signature}`, expires };
}

function verifyMediaToken(videoId, viewerKey, token) {
  if (!token || typeof token !== 'string') return false;
  const [expiresRaw, signature] = token.split('.');
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  const expected = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`${videoId}.${viewerKey}.${expires}`)
    .digest('base64url');

  return signature && signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Stable per-viewer identity used both for view counting and URL signing. */
function viewerKey(req) {
  if (req.user) return `u${req.user.id}`;
  const ip = clientKey(req);
  const ua = req.get('user-agent') || '';
  return `a${crypto.createHash('sha256').update(ip + ua).digest('hex').slice(0, 24)}`;
}

module.exports = {
  CSRF_COOKIE,
  CSRF_HEADER,
  SIGNED_MEDIA,
  securityHeaders,
  csrfToken,
  csrfProtection,
  rateLimit,
  resetLimit,
  loginGuard,
  recordLoginFailure,
  clearLoginFailures,
  signMedia,
  verifyMediaToken,
  viewerKey,
  clientKey,
  SIGNING_SECRET,
};
