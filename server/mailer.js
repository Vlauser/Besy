'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./db');

const TRANSPORT = (process.env.BESY_MAIL_TRANSPORT || 'log').toLowerCase();
const FROM = process.env.BESY_MAIL_FROM || 'Besy <no-reply@besy.local>';
const OUTBOX = path.join(DATA_DIR, 'outbox');

let smtpTransport = null;

function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('Для BESY_MAIL_TRANSPORT=smtp нужен пакет nodemailer');
  }
  smtpTransport = nodemailer.createTransport({
    host: process.env.BESY_SMTP_HOST,
    port: Number(process.env.BESY_SMTP_PORT) || 587,
    secure: process.env.BESY_SMTP_SECURE === 'true',
    auth: process.env.BESY_SMTP_USER
      ? { user: process.env.BESY_SMTP_USER, pass: process.env.BESY_SMTP_PASSWORD }
      : undefined,
  });
  return smtpTransport;
}

/**
 * Sends a message. Without SMTP configured the letter is written to
 * data/outbox and its key link is printed, which keeps flows testable.
 */
async function sendMail({ to, subject, text }) {
  if (TRANSPORT === 'smtp') {
    await getSmtpTransport().sendMail({ from: FROM, to, subject, text });
    return { transport: 'smtp' };
  }

  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${Date.now()}-${to.replace(/[^\w.@-]/g, '_')}.eml`);
  fs.writeFileSync(file, `From: ${FROM}\nTo: ${to}\nSubject: ${subject}\nDate: ${new Date().toUTCString()}\n\n${text}\n`);
  console.log(`[mail] ${subject} → ${to}\n${text.split('\n').find((line) => line.includes('http')) || ''}`);
  return { transport: 'log', file };
}

function baseUrl(req) {
  if (process.env.BESY_PUBLIC_URL) return process.env.BESY_PUBLIC_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { sendMail, baseUrl, OUTBOX, TRANSPORT };
