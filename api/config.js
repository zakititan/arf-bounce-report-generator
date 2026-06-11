/**
 * config.js — Single source of truth for all API constants.
 * Import from here; never hardcode these values in individual handlers.
 */

// ── Rate limiting ────────────────────────────────────────────────────────────
export const RATE_LIMIT_MAX      = 20;      // requests per window per IP
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// Shared rate-limit store across all API handlers (single Map, not per-endpoint)
export const globalRateLimitStore = new Map();

// ── Timeouts (ms) ────────────────────────────────────────────────────────────
export const TIMEOUT_WHOIS_MS   = 10_000; // WhoisJSON is occasionally slow
export const TIMEOUT_WEBSITE_MS =  8_000; // website-check (two-URL fallback)
export const TIMEOUT_DKIM_MS    =  5_000; // parallel DNS queries
export const TIMEOUT_HEALTH_MS  =  5_000; // health-check probes

// ── DKIM ─────────────────────────────────────────────────────────────────────
export const DKIM_FAMILIES      = ['titan', 'neo'];
export const DKIM_INDEXED_RANGE = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// All selectors: titan, titan1…titan9, neo, neo1…neo9
export const DKIM_SELECTORS = DKIM_FAMILIES.flatMap(family => [
  family,
  ...DKIM_INDEXED_RANGE.map(n => `${family}${n}`),
]);

// ── Website check ─────────────────────────────────────────────────────────────
export const WEBSITE_MAX_BODY_BYTES   = 50_000;
export const WEBSITE_MIN_CONTENT_LEN  = 200;

export const PARKED_KEYWORDS = [
  'parked', 'for sale', 'buy this domain', 'domain for sale', 'under construction',
  'coming soon', 'this domain', 'sedoparking', 'hugedomains', 'dan.com',
  'godaddy', 'namecheap parking', 'afternic', 'brandbucket',
  'this page is intentionally left blank', 'default web page',
  'placeholder page', 'welcome to nginx', 'welcome to apache',
  'it works!', 'test page for', 'apache2 ubuntu default',
];
