import { sanitiseDomain, withMiddleware, createCache } from './_utils.js';
import { DKIM_FAMILIES, DKIM_SELECTORS, TIMEOUT_DKIM_MS } from './config.js';

const cache = createCache(15 * 60 * 1000);

export default withMiddleware(async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  const cached = cache.get(domain);
  if (cached) return res.status(200).json(cached);

  // Phase 1: query base selectors (titan, neo) for early termination
  const baseSelectors = DKIM_FAMILIES.map(f => f);
  const baseResults = await Promise.allSettled(
    baseSelectors.map(selector => lookupDkim(selector, domain))
  );

  const baseMatched = baseResults
    .map((r, i) => (r.status === 'fulfilled' && r.value ? { selector: baseSelectors[i], record: r.value } : null))
    .filter(Boolean);

  let matched = baseMatched;

  // Phase 2: if no base match, query remaining indexed selectors
  if (matched.length === 0) {
    const indexedSelectors = DKIM_SELECTORS.filter(s => !baseSelectors.includes(s));
    const indexedResults = await Promise.allSettled(
      indexedSelectors.map(selector => lookupDkim(selector, domain))
    );

    matched = indexedResults
      .map((r, i) => (r.status === 'fulfilled' && r.value ? { selector: indexedSelectors[i], record: r.value } : null))
      .filter(Boolean);
  }

  const result = {
    status: matched.length > 0 ? 'Set' : 'Not Set',
    selectors_found: matched.map(m => m.selector),
    detail: matched[0] || null,
  };

  cache.set(domain, result);
  return res.status(200).json(result);
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
