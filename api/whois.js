export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { domain } = req.query;
  if (!domain) { res.status(400).json({ error: 'Missing domain parameter' }); return; }

  const clean = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase().trim();

  try {
    const response = await fetch(`https://domaininfo.shreshtait.com/api/search/${encodeURIComponent(clean)}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'arf-bounce-report-generator/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Upstream ' + response.status);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message || 'WHOIS lookup failed' });
  }
}
