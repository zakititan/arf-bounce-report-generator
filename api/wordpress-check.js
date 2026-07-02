import { sanitiseDomain, createCache } from './_utils.js';

const cache = createCache(15 * 60 * 1000);
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; SecurityChecker/1.0)';

const PROBE_PATHS = [
  {
    path: '/',
    check(text) {
      return /wp-content\/|wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(text);
    },
    signal: 'wp-content',
  },
  {
    path: '/wp-login.php',
    check(text) {
      return /id=["']loginform["']|name=["']wp-submit["']|<title>[^<]*Log In[^<]*<\/title>/i.test(text);
    },
    signal: 'wp-login.php',
  },
  {
    path: '/wp-json/wp/v2/users',
    check(text, status) {
      return status === 200 && /"id"\s*:/.test(text);
    },
    signal: 'wp-rest-api',
  },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const domain = sanitiseDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid or missing domain parameter' });

  const cached = cache.get(domain);
  if (cached) return res.status(200).json(cached);

  for (const scheme of ['https', 'http']) {
    for (const { path, check, signal } of PROBE_PATHS) {
      const url = `${scheme}://${domain}${path}`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'follow',
        });
        const text = await response.text();
        if (check(text, response.status)) {
          const result = { detected: true, reason: `WordPress detected via ${signal}` };
          cache.set(domain, result);
          return res.status(200).json(result);
        }
      } catch {
        continue;
      }
    }
  }

  const result = { detected: false, reason: 'WordPress not detected' };
  cache.set(domain, result);
  return res.status(200).json(result);
}
