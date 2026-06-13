import { withMiddleware, classifyFetchError } from './_utils.js';
import { TIMEOUT_HEALTH_MS } from './config.js';

async function checkWhoisAPI() {
  const key = process.env.WHOISJSON_API_KEY;
  if (!key) {
    return { ok: false, reason: 'misconfigured', message: 'WHOISJSON_API_KEY is not set.' };
  }
  try {
    const res = await fetch(
      'https://whoisjson.com/api/v1/whois?domain=example.com',
      {
        headers: { Authorization: `TOKEN=${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_HEALTH_MS),
      }
    );
    if (res.status === 401 || res.status === 403)
      return { ok: false, reason: 'auth', message: `API key rejected (HTTP ${res.status}).` };
    if (res.status === 429)
      return { ok: false, reason: 'rate_limited', message: 'WhoisJSON upstream rate limit reached.' };
    if (!res.ok)
      return { ok: false, reason: 'upstream_error', message: `Unexpected response: HTTP ${res.status}.` };
    return { ok: true, message: 'Reachable.' };
  } catch (err) {
    const { reason } = classifyFetchError(err, 'WHOIS', TIMEOUT_HEALTH_MS);
    return {
      ok: false,
      reason,
      message: reason === 'timeout'
        ? `Timed out after ${TIMEOUT_HEALTH_MS / 1000}s.`
        : `Network error: ${err?.message || 'unknown'}.`,
    };
  }
}

async function checkDnsAPI() {
  try {
    const res = await fetch(
      'https://dns.google/resolve?name=example.com&type=A',
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_HEALTH_MS),
      }
    );
    if (!res.ok)
      return { ok: false, reason: 'upstream_error', message: `Unexpected response: HTTP ${res.status}.` };
    let data;
    try { data = await res.json(); } catch {
      return { ok: false, reason: 'parse_error', message: 'DNS API returned non-JSON response.' };
    }
    if (data.Status !== 0)
      return { ok: false, reason: 'dns_error', message: `DNS status code ${data.Status}.` };
    return { ok: true, message: 'Reachable.' };
  } catch (err) {
    const { reason } = classifyFetchError(err, 'Google DNS', TIMEOUT_HEALTH_MS);
    return {
      ok: false,
      reason,
      message: reason === 'timeout'
        ? `Timed out after ${TIMEOUT_HEALTH_MS / 1000}s.`
        : `Network error: ${err?.message || 'unknown'}.`,
    };
  }
}

export default withMiddleware(async function handler(req, res) {
  const [whoisjson, googleDns] = await Promise.all([checkWhoisAPI(), checkDnsAPI()]);
  const allOk = whoisjson.ok && googleDns.ok;
  return res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    apis: { whoisjson, googleDns },
  });
});
