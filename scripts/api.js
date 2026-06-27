/**
 * api.js — All fetch calls to backend API endpoints.
 * Exports: fetchWhois, fetchWebsiteCheck, fetchDkimCheck, lookupMx
 * Each function creates its own AbortController for timeout/cancellation.
 */

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const _cache = new Map();

export function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _cache.delete(key); return null; }
  return entry.value;
}

export function setCache(key, value) {
  if (_cache.size > 500) {
    const cutoff = Date.now();
    for (const [k, v] of _cache) { if (cutoff > v.expires) _cache.delete(k); }
  }
  _cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Maps the `reason` field returned by the server into a short,
 * human-readable label suitable for a toast or inline hint.
 */
export function describeReason(reason, fallback) {
  const map = {
    timeout:             'Lookup timed out — try again in a moment.',
    auth:                'API key is invalid or misconfigured.',
    misconfigured:       'API key is not configured — contact the administrator.',
    upstream_rate_limit: 'Upstream rate limit reached — wait a moment and retry.',
    upstream_error:      'The lookup service is temporarily unavailable.',
    network:             'Could not reach the lookup service — check your connection.',
  };
  return map[reason] || fallback;
}

/**
 * Fetch wrapper that returns parsed JSON or throws a user-friendly error.
 * Handles network errors, non-JSON responses, and HTTP error statuses.
 */
async function apiFetch(url) {
  const cached = getCached(url);
  if (cached) return cached;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new Error('Request timed out — please try again.');
    throw new Error('Network error — could not reach the server.');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Unexpected response from server (HTTP ' + res.status + ').');
  }
  if (!res.ok || data.error) {
    throw new Error(describeReason(data?.reason, data?.error || 'Request failed (HTTP ' + res.status + ')'));
  }
  setCache(url, data);
  return data;
}

export async function fetchWhois(domain) {
  const data = await apiFetch('/api/whois?domain=' + encodeURIComponent(domain));
  if (!data.creation_date) throw new Error('No creation date found for this domain.');
  return data;
}

export async function fetchWebsiteCheck(domain) {
  return apiFetch('/api/website-check?domain=' + encodeURIComponent(domain));
}

export async function fetchDkimCheck(domain) {
  return apiFetch('/api/dkim-check?domain=' + encodeURIComponent(domain));
}

/**
 * Look up MX records for a domain via Google DNS-over-HTTPS.
 * Returns { region: 'na' | 'eu' } based on the MX record.
 * - mx1.titan.email → 'na'
 * - mx0101.titan.email → 'eu'
 * Returns { region: 'na' } as default if lookup fails or MX is unknown.
 */
export async function lookupMx(domain) {
  const url = 'https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=MX';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { region: 'na' };
    const data = await res.json();
    const answers = data.Answer || [];
    for (const a of answers) {
      if (a.type !== 15) continue;
      const exchange = (a.data || '').split(' ').pop().replace(/\.$/, '');
      if (exchange === 'mx0101.titan.email') return { region: 'eu' };
      if (exchange === 'mx1.titan.email') return { region: 'na' };
    }
    return { region: 'na' };
  } catch {
    return { region: 'na' };
  }
}

export async function fetchLaravelCheck(domain) {
  return apiFetch('/api/laravel-check?domain=' + encodeURIComponent(domain));
}

export async function fetchXmlrpcCheck(domain) {
  return apiFetch('/api/xmlrpc-check?domain=' + encodeURIComponent(domain));
}
