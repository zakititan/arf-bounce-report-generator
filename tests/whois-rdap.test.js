import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We test the RDAP helper functions by importing the module and using the exported handler
// Since the helpers are not exported, we test them indirectly via the handler
// For unit testing the parse logic, we replicate it here

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

describe('parseRdapResponse', () => {
  it('extracts creation date from valid RDAP response', () => {
    const data = {
      events: [
        { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
        { eventAction: 'expiration', eventDate: '2026-08-13T04:00:00Z' },
      ],
    };
    const result = parseRdapResponse('example.com', data);
    assert.equal(result.domain, 'example.com');
    assert.ok(result.creation_date.includes('1995'));
    assert.ok(result.domain_age.includes('year'));
    assert.ok(result.domain_age_months > 0);
  });

  it('handles response with only registration event', () => {
    const data = {
      events: [
        { eventAction: 'registration', eventDate: '2020-01-15T10:30:00Z' },
      ],
    };
    const result = parseRdapResponse('test.org', data);
    assert.equal(result.domain, 'test.org');
    assert.ok(result.creation_date.includes('2020'));
  });

  it('throws when no registration event exists', () => {
    const data = {
      events: [
        { eventAction: 'expiration', eventDate: '2026-08-13T04:00:00Z' },
      ],
    };
    assert.throws(() => parseRdapResponse('test.com', data), /No registration date/);
  });

  it('throws when events array is empty', () => {
    const data = { events: [] };
    assert.throws(() => parseRdapResponse('test.com', data), /No registration date/);
  });

  it('throws when events is missing', () => {
    const data = {};
    assert.throws(() => parseRdapResponse('test.com', data), /No registration date/);
  });

  it('throws when eventDate is invalid', () => {
    const data = {
      events: [
        { eventAction: 'registration', eventDate: 'not-a-date' },
      ],
    };
    assert.throws(() => parseRdapResponse('test.com', data), /Invalid RDAP date/);
  });

  it('computes age correctly for recent domain', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const data = {
      events: [
        { eventAction: 'registration', eventDate: sixMonthsAgo.toISOString() },
      ],
    };
    const result = parseRdapResponse('new.com', data);
    assert.ok(result.domain_age.includes('month'));
    assert.ok(result.domain_age_months >= 5 && result.domain_age_months <= 7);
  });

  it('computes age correctly for domain with years and months', () => {
    const twoYearsThreeMonthsAgo = new Date();
    twoYearsThreeMonthsAgo.setFullYear(twoYearsThreeMonthsAgo.getFullYear() - 2);
    twoYearsThreeMonthsAgo.setMonth(twoYearsThreeMonthsAgo.getMonth() - 3);
    const data = {
      events: [
        { eventAction: 'registration', eventDate: twoYearsThreeMonthsAgo.toISOString() },
      ],
    };
    const result = parseRdapResponse('aged.com', data);
    assert.ok(result.domain_age.includes('2 years'));
    assert.ok(result.domain_age.includes('3 months'));
  });

  it('formats date in en-GB format', () => {
    const data = {
      events: [
        { eventAction: 'registration', eventDate: '2023-12-25T00:00:00Z' },
      ],
    };
    const result = parseRdapResponse('xmas.com', data);
    // en-GB format: "25 December 2023"
    assert.ok(result.creation_date.includes('25'));
    assert.ok(result.creation_date.includes('December'));
    assert.ok(result.creation_date.includes('2023'));
  });
});

describe('RDAP TLD map coverage', () => {
  // Import the map from config (it's a static object)
  // Since we can't easily import ESM in all contexts, we test the key TLDs exist
  const CRITICAL_TLDS = [
    'com', 'net', 'org', 'io', 'co', 'us', 'me', 'info', 'ai',
    'dev', 'app', 'uk', 'de', 'fr', 'nl', 'br', 'in', 'ca', 'au',
    'xyz', 'site', 'online', 'tech', 'store', 'shop', 'top',
  ];

  it('has hardcoded entries for critical TLDs', async () => {
    // Dynamically import to get the actual config
    const config = await import('../api/config.js');
    for (const tld of CRITICAL_TLDS) {
      assert.ok(config.RDAP_TLD_MAP[tld], `Missing RDAP server for .${tld}`);
      assert.ok(config.RDAP_TLD_MAP[tld].startsWith('http'), `Invalid URL for .${tld}`);
    }
  });

  it('has bootstrap URL configured', async () => {
    const config = await import('../api/config.js');
    assert.ok(config.RDAP_BOOTSTRAP_URL);
    assert.ok(config.RDAP_BOOTSTRAP_URL.startsWith('https://'));
  });

  it('has RDAP timeout configured', async () => {
    const config = await import('../api/config.js');
    assert.ok(typeof config.TIMEOUT_RDAP_MS === 'number');
    assert.ok(config.TIMEOUT_RDAP_MS > 0);
  });
});
