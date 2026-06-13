import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, parseCsvRow, sanitiseDomainInput } from '../scripts/pure.js';
import { describeReason, getCached, setCache } from '../scripts/api.js';
import { parseAgeToDays } from '../scripts/ui.js';

// ── escapeHtml ────────────────────────────────────────────────────────
describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes angle brackets', () => {
    assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
  });

  it('converts newlines to <br>', () => {
    assert.equal(escapeHtml('line1\nline2'), 'line1<br>line2');
  });

  it('handles string with no special characters', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.equal(escapeHtml(''), '');
  });

  it('escapes multiple special characters in sequence', () => {
    assert.equal(escapeHtml('<&>'), '&lt;&amp;&gt;');
  });
});

// ── parseCsvRow ───────────────────────────────────────────────────────
describe('parseCsvRow', () => {
  it('parses simple comma-separated values', () => {
    assert.deepEqual(parseCsvRow('a,b,c'), ['a', 'b', 'c']);
  });

  it('handles quoted fields containing commas', () => {
    assert.deepEqual(parseCsvRow('"hello, world",b,c'), ['hello, world', 'b', 'c']);
  });

  it('handles escaped quotes inside quoted fields', () => {
    assert.deepEqual(parseCsvRow('"say ""hello""",b'), ['say "hello"', 'b']);
  });

  it('handles empty fields', () => {
    assert.deepEqual(parseCsvRow('a,,c'), ['a', '', 'c']);
  });

  it('trims whitespace', () => {
    assert.deepEqual(parseCsvRow(' a , b , c '), ['a', 'b', 'c']);
  });

  it('handles single field (no commas)', () => {
    assert.deepEqual(parseCsvRow('hello'), ['hello']);
  });

  it('handles mixed quoted and unquoted fields', () => {
    assert.deepEqual(parseCsvRow('a,"b,c",d'), ['a', 'b,c', 'd']);
  });

  it('handles empty string', () => {
    assert.deepEqual(parseCsvRow(''), ['']);
  });
});

// ── sanitiseDomainInput ───────────────────────────────────────────────
describe('sanitiseDomainInput', () => {
  it('strips http:// protocol', () => {
    assert.equal(sanitiseDomainInput('http://example.com'), 'example.com');
  });

  it('strips https:// protocol', () => {
    assert.equal(sanitiseDomainInput('https://example.com'), 'example.com');
  });

  it('strips email user part', () => {
    assert.equal(sanitiseDomainInput('user@example.com'), 'example.com');
  });

  it('strips path', () => {
    assert.equal(sanitiseDomainInput('example.com/some/path'), 'example.com');
  });

  it('strips query string', () => {
    assert.equal(sanitiseDomainInput('example.com?foo=bar'), 'example.com');
  });

  it('strips hash', () => {
    assert.equal(sanitiseDomainInput('example.com#section'), 'example.com');
  });

  it('strips port', () => {
    assert.equal(sanitiseDomainInput('example.com:8080'), 'example.com');
  });

  it('lowercases result', () => {
    assert.equal(sanitiseDomainInput('EXAMPLE.COM'), 'example.com');
  });

  it('trims whitespace', () => {
    assert.equal(sanitiseDomainInput('  example.com  '), 'example.com');
  });

  it('strips email with https', () => {
    assert.equal(sanitiseDomainInput('https://user@example.com/path'), 'example.com');
  });
});

// ── describeReason ────────────────────────────────────────────────────
describe('describeReason', () => {
  it('returns correct message for timeout', () => {
    const result = describeReason('timeout', 'fallback');
    assert.equal(result, 'Lookup timed out — try again in a moment.');
  });

  it('returns correct message for auth', () => {
    const result = describeReason('auth', 'fallback');
    assert.equal(result, 'API key is invalid or misconfigured.');
  });

  it('returns correct message for misconfigured', () => {
    const result = describeReason('misconfigured', 'fallback');
    assert.equal(result, 'API key is not configured — contact the administrator.');
  });

  it('returns correct message for upstream_rate_limit', () => {
    const result = describeReason('upstream_rate_limit', 'fallback');
    assert.equal(result, 'Upstream rate limit reached — wait a moment and retry.');
  });

  it('returns correct message for upstream_error', () => {
    const result = describeReason('upstream_error', 'fallback');
    assert.equal(result, 'The lookup service is temporarily unavailable.');
  });

  it('returns correct message for network', () => {
    const result = describeReason('network', 'fallback');
    assert.equal(result, 'Could not reach the lookup service — check your connection.');
  });

  it('returns fallback for unknown reason', () => {
    const result = describeReason('unknown_reason', 'custom fallback');
    assert.equal(result, 'custom fallback');
  });
});

// ── parseAgeToDays ────────────────────────────────────────────────────
describe('parseAgeToDays', () => {
  it('parses "2 years 3 months"', () => {
    assert.equal(parseAgeToDays('2 years 3 months'), 2 * 365 + 3 * 30);
  });

  it('parses "1 year"', () => {
    assert.equal(parseAgeToDays('1 year'), 365);
  });

  it('parses "6 months"', () => {
    assert.equal(parseAgeToDays('6 months'), 180);
  });

  it('parses "15 days"', () => {
    assert.equal(parseAgeToDays('15 days'), 15);
  });

  it('parses "30 days"', () => {
    assert.equal(parseAgeToDays('30 days'), 30);
  });

  it('parses "1 year 0 months"', () => {
    assert.equal(parseAgeToDays('1 year 0 months'), 365);
  });

  it('parses plain number string', () => {
    assert.equal(parseAgeToDays('42'), 42);
  });

  it('returns null for unparseable string', () => {
    assert.equal(parseAgeToDays('no numbers here'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseAgeToDays(''), null);
  });
});
