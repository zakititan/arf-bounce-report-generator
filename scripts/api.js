/**
 * api.js — All fetch calls to backend API endpoints.
 * Exports: fetchWhois, fetchWebsiteCheck, fetchDkimCheck
 */

export async function fetchWhois(domain) {
  const res = await fetch('/api/whois?domain=' + encodeURIComponent(domain));
  const data = await res.json();
  if (data.error || !data.creation_date) throw new Error(data.error || 'No creation date found');
  return data;
}

export async function fetchWebsiteCheck(domain) {
  const res = await fetch('/api/website-check?domain=' + encodeURIComponent(domain));
  return res.json();
}

export async function fetchDkimCheck(domain) {
  const res = await fetch('/api/dkim-check?domain=' + encodeURIComponent(domain));
  return res.json();
}
