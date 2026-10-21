/**
 * mail-records.js — Reports a domain's mail infrastructure: MX, SPF and DMARC.
 *
 * GET /api/mail-records?domain=<domain>
 *   200 → { mx: string[], spf: string|null, dmarc: string|null,
 *           spf_present: boolean, dmarc_present: boolean }
 *   400 → { error: 'Invalid or missing domain parameter' }
 *
 * DNS data is read from Google DNS-over-HTTPS, exactly like api/dkim-check.js.
 * A missing MX record never suppresses the SPF/DMARC lookups — all three are
 * resolved independently.
 */
import { sanitiseDomain, withMiddleware, createCache } from './_utils.js';
import { DNS_RESOLVE_URL, TIMEOUT_MAIL_RECORDS_MS } from './config.js';

const cache = createCache(15 * 60 * 1000);

export default withMiddleware(async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  const cached = cache.get(domain);
  if (cached) return res.status(200).json(cached);

  const [mx, spf, dmarc] = await Promise.all([
    lookupMxRecords(domain),
    lookupTxtRecord(domain, 'v=spf1'),          // SPF lives on the apex domain
    lookupTxtRecord(`_dmarc.${domain}`, 'v=DMARC1'),
  ]);

  const result = {
    mx,
    spf,
    dmarc,
    spf_present: spf !== null,
    dmarc_present: dmarc !== null,
  };

  cache.set(domain, result);
  return res.status(200).json(result);
});

/**
 * Looks up the MX records of a domain.
 * @param {string} domain - Apex hostname, e.g. 'example.com'.
 * @returns {Promise<string[]>} Exchange hostnames, without the priority prefix
 *   and without the trailing dot. Empty when there are no MX records.
 */
export async function lookupMxRecords(domain) {
  const url = `${DNS_RESOLVE_URL}?name=${encodeURIComponent(domain)}&type=MX`;
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MAIL_RECORDS_MS),
    });
    if (!r.ok) return [];
    const data = await r.json();
    if (data.Status !== 0 || !data.Answer) return [];
    return data.Answer
      .map(a => parseMxExchange(a?.data))
      .filter(host => Boolean(host));
  } catch {
    return [];
  }
}

/**
 * Looks up a TXT record that starts with a given prefix (case-insensitive).
 * @param {string} name - Hostname to query, e.g. '_dmarc.example.com'.
 * @param {string} prefix - Expected record prefix, e.g. 'v=spf1'.
 * @returns {Promise<string|null>} The record text, or null when absent.
 */
export async function lookupTxtRecord(name, prefix) {
  const url = `${DNS_RESOLVE_URL}?name=${encodeURIComponent(name)}&type=TXT`;
  const wanted = String(prefix || '').toLowerCase();
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MAIL_RECORDS_MS),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.Status !== 0 || !data.Answer) return null;
    const match = data.Answer
      .flatMap(a => extractTxtStrings(a?.data))
      .find(t => t.toLowerCase().startsWith(wanted));
    return match ? match.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the TXT strings carried by a single DNS answer.
 *
 * dns.google returns TXT data as one or more quoted segments:
 *   "v=spf1 " "include:x -all"
 * The joined form is one TXT record split across segments, so it is offered
 * first; the individual segments follow as a fallback for answers that mix
 * several unrelated TXT strings.
 * @param {string} raw - The raw `data` field of a DNS answer.
 * @returns {string[]}
 */
function extractTxtStrings(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  const joined = raw.replace(/\" \"/g, '').replace(/"/g, '').trim();
  const segments = (raw.match(/\"[^\"]*\"/g) || [])
    .map(s => s.replace(/"/g, '').trim())
    .filter(Boolean);
  return segments.length ? [joined, ...segments] : [joined];
}

/**
 * Parses the exchange host out of an MX answer.
 * dns.google returns the priority and the host in one string: "10 mx1.titan.email."
 * @param {string} raw - The raw `data` field of an MX answer.
 * @returns {string|null} The host without its priority and trailing dot.
 */
function parseMxExchange(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split(/\s+/);
  const host = (parts[parts.length - 1] || '').replace(/\.$/, '');
  if (!host || /^\d+$/.test(host)) return null;
  return host;
}
