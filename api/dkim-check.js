import { sanitiseDomain, withMiddleware } from './_utils.js';
import { DKIM_FAMILIES, DKIM_INDEXED_RANGE, TIMEOUT_DKIM_MS } from './config.js';

export default withMiddleware(async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  // Phase 1: check only base selectors (titan, neo)
  const baseResults = await Promise.allSettled(
    DKIM_FAMILIES.map(selector => lookupDkim(selector, domain))
  );

  const matchedFamily = baseResults
    .map((r, i) => (r.status === 'fulfilled' && r.value ? { family: DKIM_FAMILIES[i], record: r.value } : null))
    .filter(Boolean);

  if (matchedFamily.length === 0) {
    return res.status(200).json({ status: 'Not Set', selectors_found: [], detail: null });
  }

  // Phase 2: check numbered variants for the first matched family only
  const best = matchedFamily[0];
  const numberedSelectors = DKIM_INDEXED_RANGE.map(n => `${best.family}${n}`);
  const numberedResults = await Promise.allSettled(
    numberedSelectors.map(selector => lookupDkim(selector, domain))
  );

  const allSelectors = [best.family, ...numberedSelectors];
  const matched = [best, ...numberedResults
    .map((r, i) => (r.status === 'fulfilled' && r.value ? { selector: numberedSelectors[i], record: r.value } : null))
    .filter(Boolean)];

  return res.status(200).json({
    status: 'Set',
    selectors_found: matched.map(m => m.selector),
    detail: matched[0],
  });
});

async function lookupDkim(selector, domain) {
  const hostname = `${selector}._domainkey.${domain}`;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=TXT`;
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_DKIM_MS),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.Status !== 0 || !data.Answer) return null;
    const txt = data.Answer
      .map(a => a.data.replace(/\" \"/g, '').replace(/"/g, ''))
      .find(t => t.includes('v=DKIM1') || t.includes('p='));
    return txt || null;
  } catch {
    return null;
  }
}
