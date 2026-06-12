import { signToken, checkRateLimit } from './_utils.js';
import { globalRateLimitStore } from './config.js';

const PASSWORD = process.env.APP_PASSWORD;
const COOKIE_NAME = 'auth_session';
const MAX_AGE = 60 * 60 * 8; // 8 hours

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if a === b in both length and content.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!PASSWORD) {
    res.status(500).json({ error: 'Server misconfiguration: APP_PASSWORD environment variable is not set' });
    return;
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (checkRateLimit(globalRateLimitStore, ip)) {
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
    token = signToken('authenticated');
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
