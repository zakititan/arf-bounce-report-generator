const WHOISJSON_API_KEY = 'fcf49be1f4580586473b62287702feec7ad2fe9ffc0d32f510a19b7875be93b2';

function sanitiseDomain(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let d = raw.trim();
  d = d.replace(/^https?:\/\//i, '');
  d = d.split('/')[0].split('?')[0].split('#')[0];
  d = d.split(':')[0];
  d = d.toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9\-\.]{1,252}[a-z0-9]$/.test(d)) return null;
  return d;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const domain = sanitiseDomain(req.query.domain);
  if (!domain) {
    res.status(400).json({ error: 'Invalid or missing domain parameter' });
    return;
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
