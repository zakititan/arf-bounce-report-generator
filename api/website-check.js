const PARKED_KEYWORDS = [
  'parked', 'for sale', 'buy this domain', 'domain for sale', 'under construction',
  'coming soon', 'this domain', 'sedoparking', 'hugedomains', 'dan.com',
  'godaddy', 'namecheap parking', 'afternic', 'brandbucket',
  'this page is intentionally left blank', 'default web page',
  'placeholder page', 'welcome to nginx', 'welcome to apache',
  'it works!', 'test page for', 'apache2 ubuntu default',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { domain } = req.query;
  if (!domain) { res.status(400).json({ error: 'Missing domain parameter' }); return; }

  const clean = domain
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim();

  const urls = [`https://${clean}`, `http://${clean}`];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SiteChecker/1.0)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });

      const status = response.status;

      if (status === 404 || status === 410) {
        return res.status(200).json({ verdict: 'No website', status, reason: `HTTP ${status}` });
      }

      if (status >= 500) {
        return res.status(200).json({ verdict: 'Unreachable', status, reason: `Server error ${status}` });
      }

      // Read up to 50KB of body for keyword scanning
      const reader = response.body.getReader();
      let bodyText = '';
      let bytesRead = 0;
      const maxBytes = 50000;

      while (bytesRead < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        bodyText += new TextDecoder().decode(value);
        bytesRead += value.byteLength;
      }
      reader.cancel();

      const bodyLower = bodyText.toLowerCase();
      const bodyLength = bodyText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;

      // Check for parked/empty signals
      const isParked = PARKED_KEYWORDS.some(kw => bodyLower.includes(kw));
      const isEmpty = bodyLength < 200;

      if (isParked) {
        return res.status(200).json({ verdict: 'Fake', status, reason: 'Parked or placeholder page detected' });
      }

      if (isEmpty) {
        return res.status(200).json({ verdict: 'Fake', status, reason: 'Page has very little content' });
      }

      return res.status(200).json({ verdict: 'Legit', status, reason: `Reachable with content (HTTP ${status})` });

    } catch (err) {
      // Try next URL (http fallback)
      if (url === urls[urls.length - 1]) {
        return res.status(200).json({ verdict: 'No website', status: 0, reason: err.message || 'Connection failed' });
      }
    }
  }
}
