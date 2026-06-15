import { createHmac } from 'crypto';
import { IPV4_PATTERN, IPV6_PATTERN, LOCALHOST_NAMES, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, SESSION_MAX_AGE_MS } from './config.js';

const LOCAL_TLD_RE = /\.(localhost|local|internal)$/;

// ── In-memory response cache ────────────────────────────────────────────────
/**
 * Returns a generic in-memory cache with TTL and auto-pruning.
 * @param {number} ttlMs - Time-to-live in milliseconds.
 * @returns {{ get: (key: string) => any|null, set: (key: string, value: any) => void }}
 */
export function createCache(ttlMs) {
  const _store = new Map();

  function prune() {
    const now = Date.now();
    for (const [k, v] of _store) {
      if (v.expires < now) _store.delete(k);
    }
  }

  return {
    get(key) {
      const entry = _store.get(key);
      if (!entry) return null;
      if (entry.expires < Date.now()) {
        _store.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value) {
      _store.set(key, { value, expires: Date.now() + ttlMs });
      if (_store.size > 1000) prune();
    },
  };
}

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
  if (LOCAL_TLD_RE.test(v)) return null;

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
const _rateLimitStore = new Map();

export async function checkRateLimit(ip) {
  const now = Date.now();
  const entry = _rateLimitStore.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitStore.set(ip, { count: 1, windowStart: now });
    if (_rateLimitStore.size > 10_000) {
      const cutoff = now - RATE_LIMIT_WINDOW_MS;
      for (const [k, v] of _rateLimitStore) {
        if (v.windowStart < cutoff) _rateLimitStore.delete(k);
      }
    }
    return false;
  }

  entry.count += 1;
  _rateLimitStore.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
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
    const origin = process.env.APP_ORIGIN || '';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (origin) res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const ip = getClientIp(req);
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

// ── Shared helpers ────────────────────────────────────────────────────────────
/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if a === b in both length and content.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/**
 * Extract the client IP from a request, preferring X-Forwarded-For.
 */
export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}
