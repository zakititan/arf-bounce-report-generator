import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARKED_KEYWORDS, PARKED_TITLE_KEYWORDS, PARKED_DOMAIN_PATTERNS,
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

function redirectsToParkedService(response) {
  const url = response.url || '';
  const lower = url.toLowerCase();
  return PARKED_DOMAIN_PATTERNS.some(pattern => lower.includes(pattern));
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
});

// ── redirectsToParkedService ──────────────────────────────────────────
describe('redirectsToParkedService', () => {
  it('detects Sedo redirect', () => {
    const resp = { url: 'https://sedo.com/search/details/?domain=example.com' };
    assert.ok(redirectsToParkedService(resp));
  });

  it('detects Afternic redirect', () => {
    const resp = { url: 'https://www.afternic.com/domain/example.com' };
    assert.ok(redirectsToParkedService(resp));
  });

  it('detects Dan.com redirect', () => {
    const resp = { url: 'https://dan.com/buy/example.com' };
    assert.ok(redirectsToParkedService(resp));
  });

  it('detects GoDaddy redirect', () => {
    const resp = { url: 'https://www.godaddy.com/domainsearch/find?domain=example.com' };
    assert.ok(redirectsToParkedService(resp));
  });

  it('allows legitimate redirects', () => {
    const resp = { url: 'https://example.com/blog/article' };
    assert.equal(redirectsToParkedService(resp), false);
  });

  it('handles response with no url', () => {
    const resp = {};
    assert.equal(redirectsToParkedService(resp), false);
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
