import { sanitiseDomain, withMiddleware, classifyFetchError } from './_utils.js';
import {
  TIMEOUT_WEBSITE_MS,
  WEBSITE_MAX_BODY_BYTES,
  WEBSITE_MIN_CONTENT_LEN,
  WEBSITE_MIN_TEXT_RATIO,
  PARKED_KEYWORDS,
  PARKED_TITLE_KEYWORDS,
  PARKED_DOMAIN_PATTERNS,
  SPA_ROOT_PATTERNS,
  globalRateLimitStore,
} from './config.js';

// ── Helpers ───────────────────────────────────────────────────────────

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractMetaRobots(html) {
  const m = html.match(/<meta\s+name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  return m ? m[1].toLowerCase() : '';
}

function hasNoindex(html) {
  const robots = extractMetaRobots(html);
  return robots.includes('noindex');
}

function isImageOnlyPage(bodyText, bodyBytes) {
  const textLen = bodyText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;
  if (bodyBytes === 0) return false;
  return (textLen / bodyBytes) < WEBSITE_MIN_TEXT_RATIO;
}

function titleMatchesParked(title) {
  const lower = title.toLowerCase();
  return PARKED_TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

function bodyMatchesParked(body) {
  const lower = body.toLowerCase();
  return PARKED_KEYWORDS.some(kw => lower.includes(kw));
}

function redirectsToParkedService(response) {
  const url = response.url || '';
  const lower = url.toLowerCase();
  return PARKED_DOMAIN_PATTERNS.some(pattern => lower.includes(pattern));
}

function isSpaShell(bodyText) {
  const hasJsBundle = /<script\s[^>]*src=["'][^"']*\.js/i.test(bodyText);
  if (!hasJsBundle) return false;
  const lower = bodyText.toLowerCase();
  return SPA_ROOT_PATTERNS.some(pattern => lower.includes(pattern));
}

// ── Main handler ──────────────────────────────────────────────────────

export default withMiddleware(globalRateLimitStore, async function handler(req, res) {
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
        return res.status(200).json({ verdict: 'No website', status, reason: `HTTP ${status} — page not found` });
      if (status >= 500)
        return res.status(200).json({ verdict: 'Unreachable', status, reason: `Server error HTTP ${status}` });

      // Check if the final URL after redirects goes to a known parking service
      if (redirectsToParkedService(response)) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: `Redirected to known domain parking service: ${new URL(response.url).hostname}`,
        });
      }

      const reader = response.body.getReader();
      let bodyText = '', bytesRead = 0;
      while (bytesRead < WEBSITE_MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bodyText += decoder.decode(value, { stream: true });
        bytesRead += value.byteLength;
      }
      reader.cancel();

      if (!bodyText.trim()) {
        return res.status(200).json({ verdict: 'No website', status, reason: 'Empty response body' });
      }

      const bodyLower  = bodyText.toLowerCase();
      const visibleText = bodyText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const bodyLength = visibleText.length;

      // Check title tag for parked indicators
      const title = extractTitle(bodyText);
      if (title && titleMatchesParked(title)) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: `Page title suggests parked or placeholder site: "${title}"`,
        });
      }

      // Check for meta robots noindex (common on placeholder / parked pages)
      if (hasNoindex(bodyText) && bodyLength < WEBSITE_MIN_CONTENT_LEN * 2) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: 'Page has noindex meta tag and very little content',
        });
      }

      // Check parked keywords
      if (bodyMatchesParked(bodyLower)) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: 'Parked, placeholder, or default template content detected',
        });
      }

      // Image-only or near-empty pages (e.g. just a logo image)
      if (isImageOnlyPage(bodyText, bytesRead) && bodyLength < WEBSITE_MIN_CONTENT_LEN * 1.5) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: 'Page contains mostly markup/images with very little text content',
        });
      }

      // SPA shell detection — if the page is a JS-driven app with a legitimate title,
      // treat it as a valid website even though the initial HTML has minimal content
      const isSpa = isSpaShell(bodyText);
      if (isSpa && bodyLength < WEBSITE_MIN_CONTENT_LEN) {
        return res.status(200).json({
          verdict: 'Valid Website',
          status,
          reason: `JavaScript application detected (SPA) — content loaded client-side (HTTP ${status})`,
        });
      }

      // Minimal content check
      if (bodyLength < WEBSITE_MIN_CONTENT_LEN) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: `Page has very little content (${bodyLength} chars)`,
        });
      }

      return res.status(200).json({
        verdict: 'Valid Website',
        status,
        reason: `Reachable with content (HTTP ${status})`,
      });
    } catch (err) {
      const isLastUrl = url === urls[urls.length - 1];
      if (!isLastUrl) continue;

      const { error, reason } = classifyFetchError(err, 'Website check', TIMEOUT_WEBSITE_MS);
      return res.status(200).json({ verdict: 'No website', status: 0, reason: error, errorReason: reason });
    }
  }
});
