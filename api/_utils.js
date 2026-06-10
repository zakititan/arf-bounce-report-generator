// Shared utilities for API handlers

/**
 * Sanitise a raw domain query param into a bare hostname.
 * Strips protocol, path, query-string, port and whitespace.
 * Returns null if the result is not a plausible domain.
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
 * @param {Map} store     - shared Map() per endpoint
 * @param {string} ip     - client IP
 * @param {number} limit  - max requests per window
 * @param {number} windowMs - window size in ms
 */
export function isRateLimited(store, ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const entry = store.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  store.set(ip, entry);
  return entry.count > limit;
}

/**
 * Generate HMAC-SHA256 signature of a message using AUTH_SECRET.
 */
export async function hmacSign(message) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Buffer.from(sig).toString('hex');
}

/**
 * Verify an HMAC-SHA256 signed token in the format "payload.signature".
 */
export async function hmacVerify(token) {
  if (!token || !token.includes('.')) return false;
  const lastDot = token.lastIndexOf('.');
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  try {
    const expected = await hmacSign(payload);
    return expected === sig;
  } catch {
    return false;
  }
}
