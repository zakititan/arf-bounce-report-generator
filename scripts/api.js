/**
 * api.js — All fetch calls to backend API endpoints.
 * Exports: fetchWhois, fetchWebsiteCheck, fetchDkimCheck
 */

/**
 * Maps the `reason` field returned by the server into a short,
 * human-readable label suitable for a toast or inline hint.
 */
function describeReason(reason, fallback) {
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

export async function fetchWhois(domain) {
  const res = await fetch('/api/whois?domain=' + encodeURIComponent(domain));
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(describeReason(data.reason, data.error || 'WHOIS lookup failed'));
  }
  if (!data.creation_date) throw new Error('No creation date found for this domain.');
  return data;
}

export async function fetchWebsiteCheck(domain) {
  const res = await fetch('/api/website-check?domain=' + encodeURIComponent(domain));
  if (!res.ok) throw new Error(`Website check failed: HTTP ${res.status}`);
  return res.json();
}

export async function fetchDkimCheck(domain) {
  const res = await fetch('/api/dkim-check?domain=' + encodeURIComponent(domain));
  if (!res.ok) throw new Error(`DKIM check failed: HTTP ${res.status}`);
  return res.json();
}
