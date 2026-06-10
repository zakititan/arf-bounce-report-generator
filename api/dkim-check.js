import { sanitiseDomain, isRateLimited } from './_utils.js';

const ALLOWED_ORIGIN = process.env.APP_URL || '';
const rateLimitStore = new Map();

const FAMILIES = ['titan', 'neo'];
const INDEXED_RANGE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SELECTORS = FAMILIES.flatMap(family => [
  family,
  ...INDEXED_RANGE.map(n => `${family}${n}`),
]);

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(rateLimitStore, ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  const results = await Promise.allSettled(
    SELECTORS.map(selector => lookupDkim(selector, domain))
  );

  const matched = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      matched.push({ selector: SELECTORS[i], record: r.value });
    }
  });

  if (matched.length > 0) {
    return res.status(200).json({
      status: 'Set',
      selectors_found: matched.map(m => m.selector),
      detail: matched[0],
    });
  }

  return res.status(200).json({
    status: 'Not Set',
    selectors_found: [],
    detail: null,
  });
}

async function lookupDkim(selector, domain) {
  const hostname = `${selector}._domainkey.${domain}`;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=TXT`;
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
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
