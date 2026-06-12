/**
 * api.js — All fetch calls to backend API endpoints.
 * Exports: fetchWhois, fetchWebsiteCheck, fetchDkimCheck
 * Each function creates its own AbortController for timeout/cancellation.
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

/**
 * Fetch wrapper that returns parsed JSON or throws a user-friendly error.
 * Handles network errors, non-JSON responses, and HTTP error statuses.
 */
async function apiFetch(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
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
