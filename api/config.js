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
export const WEBSITE_MAX_BODY_BYTES   = 80_000;
export const WEBSITE_MIN_CONTENT_LEN  = 300;

// Phrases that, when found in the page title, indicate a parked or placeholder site
export const PARKED_TITLE_KEYWORDS = [
  'parked', 'for sale', 'buy this domain', 'domain is parked',
  'domain name is for sale', 'coming soon', 'under construction',
  'this domain', 'default page', 'placeholder', 'sitio en construcción',
  'site en construction', 'page d\'accueil', 'welcome to',
  'it works', 'default web page', 'index of',
];

// Phrases anywhere in the body that strongly indicate parked/placeholder pages
export const PARKED_KEYWORDS = [
  'parked', 'for sale', 'buy this domain', 'domain for sale', 'domain is parked',
  'under construction', 'coming soon', 'this domain', 'sedoparking',
  'hugedomains', 'dan.com', 'godaddy', 'namecheap parking', 'afternic',
  'brandbucket', 'this page is intentionally left blank', 'default web page',
  'placeholder page', 'welcome to nginx', 'welcome to apache',
  'it works!', 'test page for', 'apache2 ubuntu default',
  'this domain is parked', 'domain name is for sale',
  'buy this domain name', 'sedo parking', 'domain parking',
  'this webpage is parked', 'is parked free', 'parking page',
  'buy now', 'domain names', 'web hosting', 'register domain',
  'this domain may be for sale', 'domain registration',
  'your domain is expired', 'renew your domain',
  'is for sale on afternic', 'is for sale at afternic',
  'purchase this domain', 'own this domain',
  'get this domain', 'claim this domain',
  // Builder / CMS default pages
  'welcome to your site', 'edit your site', 'start building your website',
  'your website is coming soon', 'this site was built with',
  'create your website', 'built with', 'powered by',
  'welcome to wordpress', 'welcome to joomla',
  'default page - cpanel', 'cpanel default page',
  'plesk default page', 'iis windows server',
  'apache is functioning normally', 'nginx is functioning normally',
  'this is the default index page', 'no site configured',
  'website is not configured', 'default website',
];

// Known domain-parking / placeholder services (checked via redirect target)
export const PARKED_DOMAIN_PATTERNS = [
  'sedo.com', 'afternic.com', 'dan.com', 'hugedomains.com',
  'godaddy.com', 'namecheap.com', 'brandbucket.com',
  'bodis.com', 'parkingcrew.net', 'voodoo.com',
  'cashparking.com', 'domainmarket.com', 'buydomains.com',
  'undeveloped.com', 'afternic', 'sedoparking',
];

// Minimum ratio of visible text to total bytes (filters out image-only / thin-content pages)
export const WEBSITE_MIN_TEXT_RATIO = 0.01;

// SPA root mount element selectors — pages with these + JS bundles are likely legit SPAs
export const SPA_ROOT_PATTERNS = [
  'id="root"', "id='root'", 'id="app"', "id='app'",
  'id="__nuxt"', 'id="__next"', 'id="gatsby-focus-wrapper"',
  '<app-root>', '<app-component>',
];

// ── Security: domain sanitisation ────────────────────────────────────────────
// Matches bare IPv4 addresses (e.g. 192.168.1.1) — already rejected in sanitiseDomain
export const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

// Matches IPv6 addresses in bare or bracket form (e.g. ::1, [::1], 2001:db8::1)
export const IPV6_PATTERN = /^\[?[0-9a-f:]+\]?$/i;

// Hostnames that must never be fetched to prevent SSRF
export const LOCALHOST_NAMES = ['localhost', '0.0.0.0', 'ip6-localhost', 'ip6-loopback'];
