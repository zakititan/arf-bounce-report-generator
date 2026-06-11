// Shared utilities for API handlers (Node.js runtime)
import { createHmac } from 'crypto';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from './config.js';

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
 * Uses RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS from config by default.
 */
export function isRateLimited(
  store,
  ip,
  limit   = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
) {
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
 */
export function withMiddleware(rateLimitStore, handler) {
  const ALLOWED_ORIGIN = process.env.APP_URL || '';

  return async function (req, res) {
    const origin = req.headers.origin || '';

    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN || origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.status(204).end();

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (isRateLimited(rateLimitStore, ip)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }

    return handler(req, res);
  };
}

/**
 * Classifies a caught error from an external fetch into a user-facing
 * message and an HTTP status code.
 */
export function classifyFetchError(err, serviceName, timeoutMs) {
  const name  = err?.name  || '';
  const msg   = err?.message || '';
  const lower = msg.toLowerCase();

  if (name === 'AbortError' || lower.includes('timed out') || lower.includes('timeout')) {
    return {
      status: 504,
      error:  `${serviceName} lookup timed out — try again in a moment.`,
      reason: 'timeout',
    };
  }

  const upstreamMatch = lower.match(/upstream (\d{3})/);
  if (upstreamMatch) {
    const code = Number(upstreamMatch[1]);
    if (code === 401 || code === 403) {
      return {
        status: 502,
        error:  `${serviceName} API key is invalid or unauthorised — check your environment variables.`,
        reason: 'auth',
      };
    }
    if (code === 429) {
      return {
        status: 502,
        error:  `${serviceName} upstream rate limit reached — please wait a moment and try again.`,
        reason: 'upstream_rate_limit',
      };
    }
    if (code >= 500) {
      return {
        status: 502,
        error:  `${serviceName} service is temporarily unavailable (upstream ${code}) — try again shortly.`,
        reason: 'upstream_error',
      };
    }
  }

  if (lower.includes('not set') || lower.includes('misconfigured') || lower.includes('api key')) {
    return {
      status: 500,
      error:  `${serviceName} API key is not configured — contact the administrator.`,
      reason: 'misconfigured',
    };
  }

  if (lower.includes('fetch failed') || lower.includes('enotfound') || lower.includes('econnrefused')) {
    return {
      status: 502,
      error:  `Could not reach the ${serviceName} service — check your internet connection and try again.`,
      reason: 'network',
    };
  }

  return {
    status: 502,
    error:  `${serviceName} lookup failed — ${msg || 'unknown error'}.`,
    reason: 'unknown',
  };
}
