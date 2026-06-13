import { sanitiseDomain, withMiddleware, classifyFetchError, createCache } from './_utils.js';
import {
  TIMEOUT_WEBSITE_MS,
  WEBSITE_MAX_BODY_BYTES,
  WEBSITE_MIN_CONTENT_LEN,
  WEBSITE_MIN_TEXT_RATIO,
  PARKED_KEYWORDS,
  PARKED_TITLE_KEYWORDS,
  PARKED_DOMAIN_PATTERNS,
  SPA_ROOT_PATTERNS,
} from './config.js';

// ── Helpers ───────────────────────────────────────────────────────────

const HTML_TAG_RE = /<[^>]*>/g;
const WHITESPACE_RE = /\s+/g;
const decoder = new TextDecoder();
const cache = createCache(15 * 60 * 1000);

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractMetaRobots(html) {
  // Matches both <meta name="robots" content="noindex"> and
  // <meta content="noindex" name="robots"> (HTML5 allows attributes in any order)
  const m =
    html.match(/<meta\s[^>]*\bname=["']robots["'][^>]*\bcontent=["']([^"']*)["']/i) ||
    html.match(/<meta\s[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']robots["']/i);
  return m ? m[1].toLowerCase() : '';
}

function hasNoindex(html) {
  const robots = extractMetaRobots(html);
  return robots.includes('noindex');
}

function isImageOnlyPage(bodyLength, bodyBytes) {
  if (bodyBytes === 0) return false;
  return (bodyLength / bodyBytes) < WEBSITE_MIN_TEXT_RATIO;
}

function titleMatchesParked(title) {
  const lower = title.toLowerCase();
  return PARKED_TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

function bodyMatchesParked(body) {
  const lower = body.toLowerCase();
  return PARKED_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Returns true only if the final URL after redirects points to a known parking
 * service AND the redirect crossed domain boundaries (i.e. it is not a simple
 * apex ↔ www normalisation redirect for the same registered domain).
 *
 * Examples that should NOT flag:
 *   example.com  → www.example.com   (same domain, www prefix)
 *   www.example.com → example.com    (apex normalisation)
 *
 * Examples that SHOULD flag:
 *   example.com → sedo.com/park/...  (different domain, known parker)
 */
function redirectsToParkedService(response, requestedDomain) {
  const finalUrl = response.url || '';
  if (!finalUrl) return false;

  let finalHostname;
  try {
    finalHostname = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  // Strip leading 'www.' from both sides for comparison
  const normalise = h => h.replace(/^www\./, '');
  const normFinal = normalise(finalHostname);
  const normRequested = normalise(requestedDomain.toLowerCase());

  // Same registered domain — this is just a www/apex normalisation, not a parking redirect
  if (normFinal === normRequested) return false;

  return PARKED_DOMAIN_PATTERNS.some(pattern => finalHostname.includes(pattern));
}

/**
 * Returns true if the page looks like a JS SPA shell (has a JS bundle + a known
 * root mount element), AND the title does NOT match any parked/placeholder keywords.
 *
 * This prevents parked SPAs (rare but possible) from being incorrectly marked as
 * Valid Website.
 */
function isSpaShell(bodyText) {
  const hasJsBundle = /<script\s[^>]*src=["'][^"']*\.js/i.test(bodyText);
  if (!hasJsBundle) return false;
  const lower = bodyText.toLowerCase();
  const hasSpaRoot = SPA_ROOT_PATTERNS.some(pattern => lower.includes(pattern));
  if (!hasSpaRoot) return false;

  // If the SPA's <title> looks parked, do not treat it as a legit SPA
  const title = extractTitle(bodyText);
  if (title && titleMatchesParked(title)) return false;

  return true;
}

// ── Main handler ──────────────────────────────────────────────────────

export default withMiddleware(async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid or missing domain parameter' });

  const cached = cache.get(domain);
  if (cached) return res.status(200).json(cached);

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

      // Check if the final URL after redirects goes to a known parking service.
      // Pass the originally-requested domain so www ↔ apex redirects are not flagged.
      if (redirectsToParkedService(response, domain)) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: `Redirected to known domain parking service: ${new URL(response.url).hostname}`,
        });
      }

      const reader = response.body.getReader();
      let bytesRead = 0;
      let done = false;
      const chunks = [];
      while (bytesRead < WEBSITE_MAX_BODY_BYTES) {
        const result = await reader.read();
        done = result.done;
        if (done) break;
        chunks.push(decoder.decode(result.value, { stream: true }));
        bytesRead += result.value.byteLength;
      }
      if (!done) reader.cancel().catch(() => {});
      chunks.push(decoder.decode());
      const bodyText = chunks.join('');

      if (!bodyText.trim()) {
        return res.status(200).json({ verdict: 'No website', status, reason: 'Empty response body' });
      }

      const visibleText = bodyText.replace(HTML_TAG_RE, '').replace(WHITESPACE_RE, ' ').trim();
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

      // Check parked keywords (bodyMatchesParked handles lowercasing internally)
      if (bodyMatchesParked(bodyText)) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: 'Parked, placeholder, or default template content detected',
        });
      }

      // Image-only or near-empty pages (e.g. just a logo image)
      if (isImageOnlyPage(bodyLength, bytesRead) && bodyLength < WEBSITE_MIN_CONTENT_LEN * 1.5) {
        return res.status(200).json({
          verdict: 'No website',
          status,
          reason: 'Page contains mostly markup/images with very little text content',
        });
      }

      // SPA shell detection — only marks Legit if title does NOT look parked.
      // Prevents rare parked SPAs from being incorrectly classified as Valid Website.
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

      const result = {
        verdict: 'Valid Website',
        status,
        reason: `Reachable with content (HTTP ${status})`,
      };
      cache.set(domain, result);
      return res.status(200).json(result);
    } catch (err) {
      const isLastUrl = url === urls[urls.length - 1];
      if (!isLastUrl) continue;

      const { error, reason } = classifyFetchError(err, 'Website check', TIMEOUT_WEBSITE_MS);
      return res.status(200).json({ verdict: 'No website', status: 0, reason: error, errorReason: reason });
    }
  }
});
