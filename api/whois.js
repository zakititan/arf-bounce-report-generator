import { sanitiseDomain, isRateLimited } from './_utils.js';

const WHOISJSON_API_KEY = process.env.WHOISJSON_API_KEY;
const ALLOWED_ORIGIN = process.env.APP_URL || '';
const rateLimitStore = new Map();

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(rateLimitStore, ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  if (!WHOISJSON_API_KEY) {
    return res.status(500).json({ error: 'WHOISJSON_API_KEY environment variable is not set' });
  }

  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Invalid or missing domain parameter' });
  }

  try {
    const response = await fetch(
      `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`,
      {
        headers: {
          Authorization: `TOKEN=${WHOISJSON_API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!response.ok) throw new Error('WhoisJSON upstream ' + response.status);
    const data = await response.json();
    let creationRaw = data.creation_date || data.created_date || data.created || null;
    let creationFormatted = null, domainAgeMonths = null, domainAgeText = null;
    if (creationRaw) {
      let createdAt;
      if (typeof creationRaw === 'number') createdAt = new Date(creationRaw * 1000);
      else if (Array.isArray(creationRaw)) createdAt = new Date(creationRaw[0]);
      else createdAt = new Date(creationRaw);
      if (!isNaN(createdAt.getTime())) {
        creationFormatted = createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const now = new Date();
        const totalMonths = (now.getFullYear() - createdAt.getFullYear()) * 12 + (now.getMonth() - createdAt.getMonth());
        const years = Math.floor(totalMonths / 12), months = totalMonths % 12;
        domainAgeMonths = totalMonths;
        if (years > 0 && months > 0) domainAgeText = `${years} year${years > 1 ? 's' : ''} ${months} month${months > 1 ? 's' : ''}`;
        else if (years > 0) domainAgeText = `${years} year${years > 1 ? 's' : ''}`;
        else domainAgeText = `${months} month${months > 1 ? 's' : ''}`;
      }
    }
    res.status(200).json({ domain, creation_date: creationFormatted, domain_age: domainAgeText, domain_age_months: domainAgeMonths });
  } catch (err) {
    res.status(502).json({ error: err.message || 'WHOIS lookup failed' });
  }
}
