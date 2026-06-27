import { sanitiseDomain, withMiddleware, createCache } from './_utils.js';

const cache = createCache(15 * 60 * 1000);
const TIMEOUT_MS = 8000;

const SMTP_ENV_PATTERNS = [
  /MAIL_USERNAME\s*=\s*\S+/i,
  /MAIL_PASSWORD\s*=\s*\S+/i,
  /MAIL_HOST\s*=\s*\S+/i,
  /SMTP_USERNAME\s*=\s*\S+/i,
  /SMTP_PASSWORD\s*=\s*\S+/i,
];

const LARAVEL_ENV_MARKERS = [
  /APP_KEY\s*=\s*base64:/i,
  /APP_ENV\s*=/i,
  /DB_CONNECTION\s*=/i,
];

const PROBE_PATHS = ['/.env', '/.env.backup', '/.env.old', '/api/.env'];

export default withMiddleware(async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid or missing domain parameter' });

  const cached = cache.get(domain);
  if (cached) return res.status(200).json(cached);

  for (const path of PROBE_PATHS) {
    for (const scheme of ['https', 'http']) {
      const url = `${scheme}://${domain}${path}`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SecurityChecker/1.0)' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'follow',
        });

        if (response.status !== 200) continue;

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) continue;

        const text = await response.text();

        const isLaravelEnv = LARAVEL_ENV_MARKERS.some(p => p.test(text));
        const hasSmtpCreds = SMTP_ENV_PATTERNS.some(p => p.test(text));

        if (isLaravelEnv && hasSmtpCreds) {
          const result = {
            vulnerable: true,
            path,
            reason: `Exposed Laravel .env with SMTP credentials at ${path}`,
          };
          cache.set(domain, result);
          return res.status(200).json(result);
        }

        if (isLaravelEnv) {
          const result = {
            vulnerable: true,
            path,
            reason: `Exposed Laravel .env file found at ${path} (file is publicly accessible)`,
          };
          cache.set(domain, result);
          return res.status(200).json(result);
        }

      } catch {
        continue;
      }
    }
  }

  const result = { vulnerable: false, reason: 'No exposed Laravel .env file found' };
  cache.set(domain, result);
  return res.status(200).json(result);
});
