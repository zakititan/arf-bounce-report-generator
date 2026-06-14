import { sanitiseDomain, withMiddleware, classifyFetchError, createCache } from './_utils.js';
import { TIMEOUT_WHOIS_MS, RDAP_BOOTSTRAP_URL, TIMEOUT_RDAP_MS, RDAP_TLD_MAP } from './config.js';

const WHOISJSON_API_KEY = process.env.WHOISJSON_API_KEY;
const cache = createCache(15 * 60 * 1000);

export default withMiddleware(async function handler(req, res) {
  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  const cached = cache.get(domain);
  if (cached) return res.status(200).json(cached);

  // Try RDAP first
  try {
    const result = await lookupRdap(domain);
    cache.set(domain, result);
    return res.status(200).json(result);
  } catch {
    // RDAP failed — fall through to WhoisJSON
  }

  // Fallback: WhoisJSON
  if (!WHOISJSON_API_KEY) {
    return res.status(500).json({
      error: 'WHOIS API key is not configured — contact the administrator.',
      reason: 'misconfigured',
    });
  }

  try {
    const response = await fetch(
      `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`,
      {
        headers: { Authorization: `TOKEN=${WHOISJSON_API_KEY}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_WHOIS_MS),
      }
    );

    if (!response.ok) throw new Error('WhoisJSON upstream ' + response.status);

    const data = await response.json();
    let creationRaw = data.creation_date || data.created_date || data.created || null;
    let creationFormatted = null, domainAgeMonths = null, domainAgeText = null;

    if (creationRaw) {
      let createdAt;
      if (typeof creationRaw === 'number')       createdAt = creationRaw > 1e12 ? new Date(creationRaw) : new Date(creationRaw * 1000);
      else if (Array.isArray(creationRaw))        createdAt = new Date(creationRaw[0]);
      else                                        createdAt = new Date(creationRaw);

      if (!isNaN(createdAt.getTime())) {
        creationFormatted = createdAt.toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric',
        });
        const now = new Date();
        const totalMonths =
          (now.getFullYear() - createdAt.getFullYear()) * 12 +
          (now.getMonth()    - createdAt.getMonth());
        const years  = Math.floor(totalMonths / 12);
        const months = totalMonths % 12;
        domainAgeMonths = totalMonths;
        if (years > 0 && months > 0)
          domainAgeText = `${years} year${years > 1 ? 's' : ''} ${months} month${months > 1 ? 's' : ''}`;
        else if (years > 0)
          domainAgeText = `${years} year${years > 1 ? 's' : ''}`;
        else
          domainAgeText = `${months} month${months > 1 ? 's' : ''}`;
      }
    }

    const result = {
      domain,
      creation_date:      creationFormatted,
      domain_age:         domainAgeText,
      domain_age_months:  domainAgeMonths,
    };
    cache.set(domain, result);
    return res.status(200).json(result);
  } catch (err) {
    const { status, error, reason } = classifyFetchError(err, 'WHOIS', TIMEOUT_WHOIS_MS);
    return res.status(status).json({ error, reason });
  }
});

// ── RDAP lookup ───────────────────────────────────────────────────────────────
let _bootstrapMap = null;

async function lookupRdap(domain) {
  const tld = domain.split('.').pop();
  const rdapServer = await getRdapServer(tld);
  if (!rdapServer) throw new Error(`No RDAP server for .${tld}`);

  const response = await fetch(`${rdapServer}domain/${encodeURIComponent(domain)}`, {
    signal: AbortSignal.timeout(TIMEOUT_RDAP_MS),
    headers: { Accept: 'application/rdap+json' },
  });

  if (!response.ok) throw new Error(`RDAP ${response.status}`);
  const data = await response.json();
  return parseRdapResponse(domain, data);
}

async function getRdapServer(tld) {
  if (RDAP_TLD_MAP[tld]) return RDAP_TLD_MAP[tld];

  if (!_bootstrapMap) {
    const resp = await fetch(RDAP_BOOTSTRAP_URL, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error('Bootstrap fetch failed');
    const bootstrap = await resp.json();
    _bootstrapMap = new Map();
    for (const [tlds, urls] of bootstrap.services) {
      for (const t of tlds) {
        if (!_bootstrapMap.has(t)) _bootstrapMap.set(t, urls[0]);
      }
    }
  }

  return _bootstrapMap.get(tld) || null;
}

function parseRdapResponse(domain, data) {
  const events = data.events || [];
  const regEvent = events.find(e => e.eventAction === 'registration');
  if (!regEvent?.eventDate) throw new Error('No registration date in RDAP');

  const createdAt = new Date(regEvent.eventDate);
  if (isNaN(createdAt.getTime())) throw new Error('Invalid RDAP date');

  const creationFormatted = createdAt.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const now = new Date();
  const totalMonths = (now.getFullYear() - createdAt.getFullYear()) * 12 +
                      (now.getMonth() - createdAt.getMonth());
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  let domainAgeText;
  if (years > 0 && months > 0)
    domainAgeText = `${years} year${years > 1 ? 's' : ''} ${months} month${months > 1 ? 's' : ''}`;
  else if (years > 0)
    domainAgeText = `${years} year${years > 1 ? 's' : ''}`;
  else
    domainAgeText = `${months} month${months > 1 ? 's' : ''}`;

  return {
    domain,
    creation_date: creationFormatted,
    domain_age: domainAgeText,
    domain_age_months: totalMonths,
  };
}
