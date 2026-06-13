import { sanitiseDomain, withMiddleware } from './_utils.js';
import { DKIM_FAMILIES, DKIM_INDEXED_RANGE, TIMEOUT_DKIM_MS } from './config.js';

export default withMiddleware(async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  const allSelectors = DKIM_FAMILIES.flatMap(family => [
    family,
    ...DKIM_INDEXED_RANGE.map(n => `${family}${n}`),
  ]);

  const results = await Promise.allSettled(
    allSelectors.map(selector => lookupDkim(selector, domain))
  );

  const matched = results
    .map((r, i) => (r.status === 'fulfilled' && r.value ? { selector: allSelectors[i], record: r.value } : null))
    .filter(Boolean);

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
