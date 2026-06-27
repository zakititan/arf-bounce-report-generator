import { sanitiseDomain, createCache } from './_utils.js';

const cache = createCache(15 * 60 * 1000);
const TIMEOUT_MS = 8000;

const XMLRPC_PROBE_BODY = `<?xml version="1.0"?>
<methodCall>
  <methodName>system.listMethods</methodName>
  <params></params>
</methodCall>`;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const domain = sanitiseDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid or missing domain parameter' });

  const cached = cache.get(domain);
  if (cached) return res.status(200).json(cached);

  for (const scheme of ['https', 'http']) {
    const url = `${scheme}://${domain}/xmlrpc.php`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'User-Agent': 'Mozilla/5.0 (compatible; SecurityChecker/1.0)',
        },
        body: XMLRPC_PROBE_BODY,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });

      if (response.status === 404) continue;

      if (response.status === 403) {
        const result = {
          vulnerable: false,
          accessible: false,
          reason: 'xmlrpc.php exists but is blocked (HTTP 403)',
        };
        cache.set(domain, result);
        return res.status(200).json(result);
      }

      const text = await response.text();
      const isXmlRpcResponse = /<methodResponse>/i.test(text) || /<fault>/i.test(text);

      if (isXmlRpcResponse) {
        const result = {
          vulnerable: true,
          reason: `xmlrpc.php is publicly accessible and responding to XML-RPC calls (HTTP ${response.status})`,
        };
        cache.set(domain, result);
        return res.status(200).json(result);
      }

    } catch {
      continue;
    }
  }

  const result = { vulnerable: false, reason: 'xmlrpc.php not found or not responding' };
  cache.set(domain, result);
  return res.status(200).json(result);
}
