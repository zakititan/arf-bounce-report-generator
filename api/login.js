import { signToken, checkRateLimit, safeEqual, getClientIp } from './_utils.js';
import { SESSION_MAX_AGE_S } from './config.js';

const PASSWORD = (process.env.APP_PASSWORD || '').trim();
const COOKIE_NAME = '__Host-auth_session';
const MAX_AGE = SESSION_MAX_AGE_S;
const ALLOWED_ORIGIN = process.env.APP_ORIGIN || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (ALLOWED_ORIGIN) res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!PASSWORD) {
    res.status(500).json({ error: 'Server misconfiguration: APP_PASSWORD environment variable is not set' });
    return;
  }

  const ip = getClientIp(req);
  if (await checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many login attempts — please wait a moment.' });
    return;
  }

  const { password } = req.body || {};

  if (!password || !safeEqual(password, PASSWORD)) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  let token;
  try {
    const payload = JSON.stringify({ sub: 'authenticated', iat: Date.now() });
    token = signToken(payload);
  } catch {
    res.status(500).json({ error: 'Server misconfiguration: AUTH_SECRET not set' });
    return;
  }

  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}; Path=/`
  );
  res.status(200).json({ ok: true });
}
