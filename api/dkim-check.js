// DKIM selector families to probe.
// Checks bare selector first, then indexed variants 1–9.
const FAMILIES = ['titan', 'neo'];
const INDEXED_RANGE = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const SELECTORS = FAMILIES.flatMap(family => [
  family,
  ...INDEXED_RANGE.map(n => `${family}${n}`),
]);
// Expands to: titan, titan1, titan2, …, titan9, neo, neo1, …, neo9

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: 'domain is required' });

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
};

async function lookupDkim(selector, domain) {
  const hostname = `${selector}._domainkey.${domain}`;
  const url = `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=TXT`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const data = await r.json();
    // Status 0 = NOERROR; Status 3 = NXDOMAIN (no record)
    if (data.Status !== 0 || !data.Answer) return null;
    const txt = data.Answer
      .map(a => a.data.replace(/\" \"/g, '').replace(/"/g, ''))
      .find(t => t.includes('v=DKIM1') || t.includes('p='));
    return txt || null;
  } catch {
    return null;
  }
}
