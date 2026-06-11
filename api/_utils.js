import { IPV4_PATTERN, IPV6_PATTERN, LOCALHOST_NAMES, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from './config.js';

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
  v = v.toLowerCase().trim();
  if (!v) return null;

  // Reject IPv4
  if (IPV4_PATTERN.test(v)) return null;

  // Reject IPv6 (bare e.g. ::1 or bracketed e.g. [::1])
  if (IPV6_PATTERN.test(v)) return null;

  // Reject localhost variants
  if (LOCALHOST_NAMES.includes(v)) return null;

  return v;
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
/**
 * In-process sliding-window rate limiter.
 * store: a shared Map (pass globalRateLimitStore from config.js)
 */
export function checkRateLimit(store, ip) {
  const now = Date.now();
  const entry = store.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    store.set(ip, { count: 1, windowStart: now });
    return false; // not limited
  }

  entry.count += 1;
  store.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX; // true = over limit
}

// ── Middleware wrapper ────────────────────────────────────────────────────────
/**
 * Wraps a Vercel API handler with:
 *  - CORS headers
 *  - Rate limiting (uses the provided store)
 *  - Method guard (GET only)
 */
export function withMiddleware(rateLimitStore, handler) {
  return async function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (checkRateLimit(rateLimitStore, ip)) {
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
      error: `${context} timed out after ${timeoutMs / 1000}s`,
      reason: 'timeout',
    };
  }
  if (err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
    return { error: `${context}: domain not found (NXDOMAIN)`, reason: 'nxdomain' };
  }
  if (err.code === 'ECONNREFUSED') {
    return { error: `${context}: connection refused`, reason: 'connrefused' };
  }
  return { error: `${context} failed: ${err.message}`, reason: 'unknown' };
}
