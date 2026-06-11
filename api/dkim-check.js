import { sanitiseDomain, withMiddleware } from './_utils.js';
import { DKIM_SELECTORS, TIMEOUT_DKIM_MS, globalRateLimitStore } from './config.js';

export default withMiddleware(globalRateLimitStore, async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  const results = await Promise.allSettled(
    DKIM_SELECTORS.map(selector => lookupDkim(selector, domain))
  );

  const matched = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      matched.push({ selector: DKIM_SELECTORS[i], record: r.value });
    }
  });

  if (matched.length > 0) {
    return res.status(200).json({
      status: 'Set',
      selectors_found: matched.map(m => m.selector),
      detail: matched[0],
    });
  }

  return res.status(200).json({ status: 'Not Set', selectors_found: [], detail: null });
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
