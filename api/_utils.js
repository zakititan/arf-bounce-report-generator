import { createHmac } from 'crypto';
import { IPV4_PATTERN, IPV6_PATTERN, LOCALHOST_NAMES, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, SESSION_MAX_AGE_MS } from './config.js';

// ── Domain sanitisation ───────────────────────────────────────────────────────
/**
 * Strips protocol, path, query, fragment, and port from an input string,
 * returning a clean lowercase hostname. Returns null for:
 *  - empty / non-string input
 *  - IPv4 addresses  (SSRF prevention)
 *  - IPv6 addresses  (SSRF prevention)
 *  - localhost names (SSRF prevention)
 */
export function sanitiseDomain(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let v = raw.trim();
  v = v.replace(/^https?:\/\//i, '');
  v = v.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  // Strip email user part (frontend already does this, but belt-and-suspenders)
  const atIdx = v.indexOf('@');
  if (atIdx !== -1) v = v.slice(atIdx + 1);
  v = v.toLowerCase().trim();
  if (!v) return null;

  // Reject IPv4
  if (IPV4_PATTERN.test(v)) return null;

  // Reject IPv6 (bare e.g. ::1 or bracketed e.g. [::1])
  if (IPV6_PATTERN.test(v)) return null;

  // Reject localhost variants
  if (LOCALHOST_NAMES.includes(v)) return null;
  if (/\.(localhost|local|internal)$/.test(v)) return null;

  // Reject malformed hostnames: each label must start/end with alnum and
  // may contain hyphens; no consecutive dots; TLD must be at least 2 alpha chars.
  // This prevents constructions like 'a..b.com' or '-sub.domain.com'.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v)) return null;

  return v;
}

// ── Auth tokens (Node crypto — used by api/login.js) ─────────────────────────
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
 * Verify a token produced by signToken().
 * Uses constant-time comparison to prevent timing attacks.
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
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return false;

    // Verify token payload contains valid session claims
    let parsed;
    try { parsed = JSON.parse(payload); } catch { return false; }
    if (!parsed || parsed.sub !== 'authenticated' || typeof parsed.iat !== 'number') return false;
    const age = Date.now() - parsed.iat;
    if (age > SESSION_MAX_AGE_MS || age < 0) return false;

    return true;
  } catch {
    return false;
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
export async function checkRateLimit(ip) {
  try {
    const { kv } = await import('@vercel/kv');
    const key = `rl:${ip}`;
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, RATE_LIMIT_WINDOW_MS / 1000);
    return count > RATE_LIMIT_MAX;
  } catch {
    // Fallback: if @vercel/kv is not installed or KV is not configured, allow all
    return false;
  }
}

// ── Middleware wrapper ────────────────────────────────────────────────────────
/**
 * Wraps a Vercel API handler with:
 *  - CORS headers (origin restricted to APP_ORIGIN env var)
 *  - Rate limiting (uses the provided store)
 *  - Method guard (GET only)
 */
export function withMiddleware(handler) {
  return async function (req, res) {
    const allowedOrigin = process.env.APP_ORIGIN || '';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (allowedOrigin) res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (await checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many requests — please slow down.' });
    }

    return handler(req, res);
  };
}

// ── Error classification ──────────────────────────────────────────────────────
/**
 * Classifies a fetch/network error into a user-friendly message + internal reason.
 */
export function classifyFetchError(err, context, timeoutMs) {
  if (err.name === 'AbortError' || err.name === 'TimeoutError') {
    return {
      status: 504,
      error: `${context} timed out after ${timeoutMs / 1000}s`,
      reason: 'timeout',
    };
  }
  if (err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
    return { status: 502, error: `${context}: domain not found (NXDOMAIN)`, reason: 'nxdomain' };
  }
  if (err.code === 'ECONNREFUSED') {
    return { status: 502, error: `${context}: connection refused`, reason: 'connrefused' };
  }
  return { status: 502, error: `${context} failed: ${err.message}`, reason: 'unknown' };
}
