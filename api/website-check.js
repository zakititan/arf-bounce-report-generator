import { sanitiseDomain, withMiddleware } from './_utils.js';

const rateLimitStore = new Map();

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 50_000;
const MIN_CONTENT_LENGTH = 200;

const PARKED_KEYWORDS = [
  'parked', 'for sale', 'buy this domain', 'domain for sale', 'under construction',
  'coming soon', 'this domain', 'sedoparking', 'hugedomains', 'dan.com',
  'godaddy', 'namecheap parking', 'afternic', 'brandbucket',
  'this page is intentionally left blank', 'default web page',
  'placeholder page', 'welcome to nginx', 'welcome to apache',
  'it works!', 'test page for', 'apache2 ubuntu default',
];

export default withMiddleware(rateLimitStore, async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid or missing domain parameter' });

  const decoder = new TextDecoder();
  const urls = [`https://${domain}`, `http://${domain}`];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteChecker/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      const status = response.status;
      if (status === 404 || status === 410)
        return res.status(200).json({ verdict: 'No website', status, reason: `HTTP ${status}` });
      if (status >= 500)
        return res.status(200).json({ verdict: 'Unreachable', status, reason: `Server error ${status}` });

      const reader = response.body.getReader();
      let bodyText = '', bytesRead = 0;
      while (bytesRead < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bodyText += decoder.decode(value, { stream: true });
        bytesRead += value.byteLength;
      }
      reader.cancel();

      const bodyLower = bodyText.toLowerCase();
      const bodyLength = bodyText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;

      if (PARKED_KEYWORDS.some(kw => bodyLower.includes(kw)))
        return res.status(200).json({ verdict: 'Fake', status, reason: 'Parked or placeholder page detected' });
      if (bodyLength < MIN_CONTENT_LENGTH)
        return res.status(200).json({ verdict: 'Fake', status, reason: 'Page has very little content' });

      return res.status(200).json({ verdict: 'Legit', status, reason: `Reachable with content (HTTP ${status})` });
    } catch (err) {
      if (url === urls[urls.length - 1])
        return res.status(200).json({ verdict: 'No website', status: 0, reason: err.message || 'Connection failed' });
    }
  }
});
