import { sanitiseDomain, withMiddleware, classifyFetchError } from './_utils.js';
import {
  TIMEOUT_WEBSITE_MS,
  WEBSITE_MAX_BODY_BYTES,
  WEBSITE_MIN_CONTENT_LEN,
  PARKED_KEYWORDS,
} from './config.js';

const rateLimitStore = new Map();

export default withMiddleware(rateLimitStore, async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid or missing domain parameter' });

  const decoder = new TextDecoder();
  const urls = [`https://${domain}`, `http://${domain}`];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SiteChecker/1.0)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(TIMEOUT_WEBSITE_MS),
        redirect: 'follow',
      });

      const status = response.status;
      if (status === 404 || status === 410)
        return res.status(200).json({ verdict: 'No website', status, reason: `HTTP ${status}` });
      if (status >= 500)
        return res.status(200).json({ verdict: 'Unreachable', status, reason: `Server error ${status}` });

      const reader = response.body.getReader();
      let bodyText = '', bytesRead = 0;
      while (bytesRead < WEBSITE_MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bodyText += decoder.decode(value, { stream: true });
        bytesRead += value.byteLength;
      }
      reader.cancel();

      const bodyLower  = bodyText.toLowerCase();
      const bodyLength = bodyText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;

      if (PARKED_KEYWORDS.some(kw => bodyLower.includes(kw)))
        return res.status(200).json({ verdict: 'Fake', status, reason: 'Parked or placeholder page detected' });
      if (bodyLength < WEBSITE_MIN_CONTENT_LEN)
        return res.status(200).json({ verdict: 'Fake', status, reason: 'Page has very little content' });

      return res.status(200).json({ verdict: 'Legit', status, reason: `Reachable with content (HTTP ${status})` });
    } catch (err) {
      const isLastUrl = url === urls[urls.length - 1];
      if (!isLastUrl) continue;

      const { error, reason } = classifyFetchError(err, 'Website check', TIMEOUT_WEBSITE_MS);
      return res.status(200).json({ verdict: 'No website', status: 0, reason: error, errorReason: reason });
    }
  }
});
