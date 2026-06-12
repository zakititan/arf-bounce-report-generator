import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARKED_KEYWORDS, PARKED_TITLE_KEYWORDS, PARKED_DOMAIN_PATTERNS, SPA_ROOT_PATTERNS,
} from '../api/config.js';

// Replicate helpers here since they're not exported from website-check.js
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

function titleMatchesParked(title) {
  const lower = title.toLowerCase();
  return PARKED_TITLE_KEYWORDS.some(kw => lower.includes(kw));
}

function bodyMatchesParked(body) {
  const lower = body.toLowerCase();
  return PARKED_KEYWORDS.some(kw => lower.includes(kw));
}

function redirectsToParkedService(response, requestedDomain) {
  const finalUrl = response.url || '';
  if (!finalUrl) return false;
  let finalHostname;
  try {
    finalHostname = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const normalise = h => h.replace(/^www\./, '');
  const normFinal = normalise(finalHostname);
  const normRequested = normalise((requestedDomain || '').toLowerCase());
  if (normFinal === normRequested) return false;
  return PARKED_DOMAIN_PATTERNS.some(pattern => finalHostname.includes(pattern));
}

// ── extractTitle ──────────────────────────────────────────────────────
describe('extractTitle', () => {
  it('extracts a simple title', () => {
    const html = '<html><head><title>Example Domain</title></head><body></body></html>';
    assert.equal(extractTitle(html), 'Example Domain');
  });

  it('returns empty string when no title', () => {
    assert.equal(extractTitle('<html></html>'), '');
  });

  it('handles title with extra attributes', () => {
    const html = '<title data-test="1">My Site</title>';
    assert.equal(extractTitle(html), 'My Site');
  });

  it('returns empty string for empty title tag', () => {
    assert.equal(extractTitle('<title></title>'), '');
  });

  it('returns empty string for title with nested HTML (regex cannot cross inner tags)', () => {
    // Known limitation: regex [^<]* stops at the first < inside title, so <b> breaks matching entirely
    assert.equal(extractTitle('<title>My <b>Bold</b> Site</title>'), '');
  });

  it('handles multiline title', () => {
    const html = '<title>\n  My Site\n</title>';
    assert.equal(extractTitle(html), 'My Site');
  });

  it('handles title with HTML entities (raw, not decoded)', () => {
    assert.equal(extractTitle('<title>Acme &amp; Co</title>'), 'Acme &amp; Co');
  });

  it('returns first match when multiple title tags exist', () => {
    const html = '<title>First</title><title>Second</title>';
    assert.equal(extractTitle(html), 'First');
  });
});

// ── titleMatchesParked ────────────────────────────────────────────────
describe('titleMatchesParked', () => {
  it('detects "parked" in title', () => {
    assert.ok(titleMatchesParked('This Domain is Parked'));
  });

  it('detects "for sale" in title', () => {
    assert.ok(titleMatchesParked('example.com is for sale'));
  });

  it('detects "coming soon" in title', () => {
    assert.ok(titleMatchesParked('Coming Soon | Example'));
  });

  it('detects "under construction" in title', () => {
    assert.ok(titleMatchesParked('Under Construction'));
  });

  it('allows normal titles', () => {
    assert.equal(titleMatchesParked('Acme Corp | Official Website'), false);
    assert.equal(titleMatchesParked('Blog - My Personal Thoughts'), false);
    assert.equal(titleMatchesParked('Shop Online | Best Deals'), false);
  });

  it('detects uppercase PARKED', () => {
    assert.ok(titleMatchesParked('THIS DOMAIN IS PARKED'));
  });

  it('detects "buy this domain" in title', () => {
    assert.ok(titleMatchesParked('Buy this domain today!'));
  });

  it('detects "default page" in title', () => {
    assert.ok(titleMatchesParked('Default Page'));
  });

  it('detects "placeholder" in title', () => {
    assert.ok(titleMatchesParked('Placeholder Site'));
  });
});

// ── bodyMatchesParked ─────────────────────────────────────────────────
describe('bodyMatchesParked', () => {
  it('detects "parked" in body', () => {
    assert.ok(bodyMatchesParked('<html>This domain is parked by the owner</html>'));
  });

  it('detects "sedo parking"', () => {
    assert.ok(bodyMatchesParked('<html>sedo parking page</html>'));
  });

  it('detects GoDaddy default page', () => {
    assert.ok(bodyMatchesParked('<html>godaddy parking</html>'));
  });

  it('detects default Apache page', () => {
    assert.ok(bodyMatchesParked('<html>Apache is functioning normally</html>'));
  });

  it('detects default nginx page', () => {
    assert.ok(bodyMatchesParked('<html>Welcome to nginx</html>'));
  });

  it('detects cPanel default', () => {
    assert.ok(bodyMatchesParked('<html>Default page - cpanel</html>'));
  });

  it('allows normal content', () => {
    assert.equal(bodyMatchesParked('<html><body><h1>Welcome to our store</h1><p>We sell products.</p></body></html>'), false);
  });

  it('detects "hugedomains" in body', () => {
    assert.ok(bodyMatchesParked('<html>This domain is listed at hugedomains.com</html>'));
  });

  it('detects "welcome to wordpress" in body', () => {
    assert.ok(bodyMatchesParked('<html>Welcome to WordPress. This is your first post.</html>'));
  });

  it('detects "plesk default page" in body', () => {
    assert.ok(bodyMatchesParked('<html>Plesk Default Page</html>'));
  });

  it('detects "iis windows server" in body', () => {
    assert.ok(bodyMatchesParked('<html>IIS Windows Server</html>'));
  });

  it('detects "brandbucket" in body', () => {
    assert.ok(bodyMatchesParked('<html>brandbucket parking page</html>'));
  });

  it('detects "no site configured" in body', () => {
    assert.ok(bodyMatchesParked('<html>No site configured</html>'));
  });
});

// ── redirectsToParkedService ──────────────────────────────────────────
describe('redirectsToParkedService', () => {
  it('detects Sedo redirect (cross-domain)', () => {
    const resp = { url: 'https://sedo.com/search/details/?domain=example.com' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('detects Afternic redirect (cross-domain)', () => {
    const resp = { url: 'https://www.afternic.com/domain/example.com' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('detects Dan.com redirect (cross-domain)', () => {
    const resp = { url: 'https://dan.com/buy/example.com' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('detects GoDaddy redirect (cross-domain)', () => {
    const resp = { url: 'https://www.godaddy.com/domainsearch/find?domain=example.com' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('does NOT flag apex → www normalisation', () => {
    const resp = { url: 'https://www.example.com/page' };
    assert.equal(redirectsToParkedService(resp, 'example.com'), false);
  });

  it('does NOT flag www → apex normalisation', () => {
    const resp = { url: 'https://example.com/page' };
    assert.equal(redirectsToParkedService(resp, 'www.example.com'), false);
  });

  it('allows legitimate redirects within same domain', () => {
    const resp = { url: 'https://example.com/blog/article' };
    assert.equal(redirectsToParkedService(resp, 'example.com'), false);
  });

  it('handles response with no url', () => {
    const resp = {};
    assert.equal(redirectsToParkedService(resp, 'example.com'), false);
  });

  it('handles invalid URL gracefully', () => {
    const resp = { url: 'not-a-valid-url' };
    assert.equal(redirectsToParkedService(resp, 'example.com'), false);
  });

  it('detects Sedo redirect with port', () => {
    const resp = { url: 'https://sedo.com:8443/search/details/?domain=example.com' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('detects subdomain parking service', () => {
    const resp = { url: 'https://parking.sedo.com/page' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('detects afternic without .com via includes pattern', () => {
    const resp = { url: 'https://www.afternic.biz/domain/example.com' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('handles uppercase hostname in response URL', () => {
    const resp = { url: 'https://SEDO.COM/search/' };
    assert.ok(redirectsToParkedService(resp, 'example.com'));
  });

  it('handles empty response URL string', () => {
    const resp = { url: '' };
    assert.equal(redirectsToParkedService(resp, 'example.com'), false);
  });
});

// ── config integrity ──────────────────────────────────────────────────
describe('PARKED_KEYWORDS integrity', () => {
  it('does not include empty strings', () => {
    PARKED_KEYWORDS.forEach((kw, i) => {
      assert.ok(kw.trim().length > 0, `empty keyword at index ${i}`);
    });
  });

  it('all keywords are lowercase', () => {
    PARKED_KEYWORDS.forEach((kw, i) => {
      assert.equal(kw, kw.toLowerCase(), `keyword at index ${i} is not lowercase: "${kw}"`);
    });
  });
});

describe('PARKED_TITLE_KEYWORDS integrity', () => {
  it('does not include empty strings', () => {
    PARKED_TITLE_KEYWORDS.forEach((kw, i) => {
      assert.ok(kw.trim().length > 0, `empty title keyword at index ${i}`);
    });
  });
});

describe('PARKED_TITLE_KEYWORDS lowercase integrity', () => {
  it('all title keywords are lowercase', () => {
    PARKED_TITLE_KEYWORDS.forEach((kw, i) => {
      assert.equal(kw, kw.toLowerCase(), `title keyword at index ${i} is not lowercase: "${kw}"`);
    });
  });
});

describe('PARKED_DOMAIN_PATTERNS integrity', () => {
  it('does not include empty strings', () => {
    PARKED_DOMAIN_PATTERNS.forEach((pattern, i) => {
      assert.ok(pattern.trim().length > 0, `empty domain pattern at index ${i}`);
    });
  });

  it('all domain patterns are lowercase', () => {
    PARKED_DOMAIN_PATTERNS.forEach((pattern, i) => {
      assert.equal(pattern, pattern.toLowerCase(), `domain pattern at index ${i} is not lowercase: "${pattern}"`);
    });
  });
});

describe('SPA_ROOT_PATTERNS integrity', () => {
  it('does not include empty strings', () => {
    SPA_ROOT_PATTERNS.forEach((pattern, i) => {
      assert.ok(pattern.trim().length > 0, `empty SPA root pattern at index ${i}`);
    });
  });

  it('all SPA root patterns are lowercase', () => {
    SPA_ROOT_PATTERNS.forEach((pattern, i) => {
      assert.equal(pattern, pattern.toLowerCase(), `SPA root pattern at index ${i} is not lowercase: "${pattern}"`);
    });
  });
});
