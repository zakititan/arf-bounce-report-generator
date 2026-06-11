// Shared utilities for API handlers (Node.js runtime)
import { createHmac } from 'crypto';

/**
 * Sanitise a raw domain query param into a bare hostname.
 */
export function sanitiseDomain(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let d = raw.trim();
  d = d.replace(/^https?:\/\//i, '');
  d = d.split('/')[0].split('?')[0].split('#')[0];
  d = d.split(':')[0];
  d = d.toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9\-\.]{1,252}[a-z0-9]$/.test(d)) return null;
  return d;
}

/**
 * Simple in-memory IP rate limiter.
 */
export function isRateLimited(store, ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const entry = store.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  store.set(ip, entry);
  return entry.count > limit;
}

/**
 * Sign a payload with HMAC-SHA256 using Node crypto.
 * Returns "payload.hex_signature".
 */
export function signToken(payload) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/**
 * Verify a token signed by signToken().
 */
export function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const lastDot = token.lastIndexOf('.');
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  try {
    const secret = process.env.AUTH_SECRET;
    if (!secret) return false;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    // Constant-time comparison
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

/**
 * Higher-order wrapper that applies CORS headers and rate limiting
 * before delegating to the provided handler function.
 *
 * Usage:
 *   const store = new Map();
 *   export default withMiddleware(store, async (req, res) => { ... });
 */
export function withMiddleware(rateLimitStore, handler) {
  const ALLOWED_ORIGIN = process.env.APP_URL || '';

  return async function (req, res) {
    const origin = req.headers.origin || '';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN || origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.status(204).end();

    // Rate limiting
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (isRateLimited(rateLimitStore, ip)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }

    return handler(req, res);
  };
}
