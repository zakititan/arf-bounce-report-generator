import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  parseCsvRow,
  sanitiseDomainInput,
  sanitiseAccountInput,
  completeUnsuspendResults,
  matchesUnsuspendRequest,
  shouldFinishUnsuspendTracking,
  createUnsuspendRequestId,
  consumePendingRequest,
  createRequestContextKey,
  svgMarkup,
  validateAccountIdentifier,
  parseAccountList,
  validateExtensionResult,
} from '../scripts/pure.js';
import { describeReason, getCached, setCache } from '../scripts/api.js';
import { parseAgeToDays } from '../scripts/ui.js';
import {
  buildUnsuspendAccounts,
  cleanSheetReason,
  getSheetReportType,
} from '../scripts/report-actions.js';

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

// ── sanitiseAccountInput ──────────────────────────────────────────────
describe('sanitiseAccountInput', () => {
  it('trims whitespace', () => {
    assert.equal(sanitiseAccountInput('  user@example.com  '), 'user@example.com');
  });

  it('preserves email as-is', () => {
    assert.equal(sanitiseAccountInput('user@example.com'), 'user@example.com');
  });

  it('preserves email with plus addressing', () => {
    assert.equal(sanitiseAccountInput('user+tag@example.com'), 'user+tag@example.com');
  });

  it('preserves email with subdomain', () => {
    assert.equal(sanitiseAccountInput('user@mail.example.com'), 'user@mail.example.com');
  });

  it('strips HTML tags from domain', () => {
    assert.equal(sanitiseAccountInput('<b>example.com</b>'), 'example.com');
  });

  it('strips javascript: protocol from domain', () => {
    assert.equal(sanitiseAccountInput('javascript:alert(1)'), 'alert(1)');
  });

  it('strips control characters from domain', () => {
    assert.equal(sanitiseAccountInput('exam\x00ple.com'), 'example.com');
  });

  it('limits length to 254 characters', () => {
    const long = 'a'.repeat(300) + '.com';
    assert.equal(sanitiseAccountInput(long).length, 254);
  });

  it('returns empty string for empty input', () => {
    assert.equal(sanitiseAccountInput(''), '');
  });

  it('returns empty string for null input', () => {
    assert.equal(sanitiseAccountInput(null), '');
  });

  it('returns empty string for undefined input', () => {
    assert.equal(sanitiseAccountInput(undefined), '');
  });

  it('preserves domain with hyphens', () => {
    assert.equal(sanitiseAccountInput('my-domain.com'), 'my-domain.com');
  });

  it('strips http:// protocol from domain', () => {
    assert.equal(sanitiseAccountInput('http://titan.email/'), 'titan.email');
  });

  it('strips https:// protocol from domain', () => {
    assert.equal(sanitiseAccountInput('https://example.com'), 'example.com');
  });

  it('preserves email with http:// prefix', () => {
    assert.equal(sanitiseAccountInput('http://user@example.com'), 'http://user@example.com');
  });

  it('does not lowercase domain (unlike sanitiseDomainInput)', () => {
    assert.equal(sanitiseAccountInput('Example.COM'), 'Example.COM');
  });
});

describe('validateExtensionResult URL security', () => {
  it('rejects unsafe JIRA and Sheets URLs, including HTML payloads', () => {
    assert.equal(validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: 'jira_1', success: true,
      issueKey: 'NEW-1', url: 'javascript:alert(1)',
    }), false);
    assert.equal(validateExtensionResult({
      type: 'REPORT_GENERATOR_LOG_SHEET_RESULT', requestId: 'sheet_1', success: true,
      cellUrl: 'data:text/html,<img src=x onerror=alert(1)>',
    }), false);
  });

  it('accepts expected HTTPS result URLs', () => {
    assert.equal(validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: 'jira_1', success: true,
      issueKey: 'NEW-1', url: 'https://jira.directi.com/browse/NEW-1',
    }), true);
    assert.equal(validateExtensionResult({
      type: 'REPORT_GENERATOR_LOG_SHEET_RESULT', requestId: 'sheet_1', success: true,
      cellUrl: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=1&range=A1',
    }), true);
  });
});

describe('svgMarkup', () => {
  it('builds an escaped attribute wrapper around trusted icon content', () => {
    assert.equal(
      svgMarkup('<path/>', { width: '16', 'aria-hidden': 'true' }),
      '<svg width="16" aria-hidden="true"><path/></svg>',
    );
  });

  it('omits attributes whose names are not allowed', () => {
    assert.equal(
      svgMarkup('<path/>', { width: '16', onload: 'alert(1)' }),
      '<svg width="16"><path/></svg>',
    );
  });
});

describe('account validation', () => {
  it('accepts email and domain account identifiers', () => {
    assert.equal(validateAccountIdentifier('user+tag@example.com'), true);
    assert.equal(validateAccountIdentifier('sub.example.co.uk'), true);
    assert.equal(validateAccountIdentifier('example.xn--p1ai'), true);
  });

  it('rejects malformed account identifiers', () => {
    assert.equal(validateAccountIdentifier('example.x'), false);
    assert.equal(validateAccountIdentifier('user@example.x'), false);
    assert.equal(validateAccountIdentifier('user@@example.com'), false);
    assert.equal(validateAccountIdentifier('bad domain.example'), false);
    assert.equal(validateAccountIdentifier('javascript:alert(1)'), false);
    assert.equal(validateAccountIdentifier('example.xn--'), false);
  });

  it('parses valid comma-separated account lists', () => {
    assert.deepEqual(
      parseAccountList('one@example.com, sub.example.com, two@example.com'),
      ['one@example.com', 'sub.example.com', 'two@example.com'],
    );
  });

  it('rejects malformed comma-separated account lists', () => {
    assert.equal(parseAccountList('one@example.com, not an account'), null);
    assert.equal(parseAccountList('one@example.com,,two@example.com'), null);
  });
});

describe('concurrent request state', () => {
  it('consumes only the matching request and ignores completed or unknown responses', () => {
    const pending = new Map([
      ['jira-one', { panel: 'arf' }],
      ['jira-two', { panel: 'bounce' }],
    ]);

    assert.deepEqual(consumePendingRequest(pending, 'jira-two'), { panel: 'bounce' });
    assert.deepEqual(consumePendingRequest(pending, 'jira-one'), { panel: 'arf' });
    assert.equal(consumePendingRequest(pending, 'jira-two'), null);
    assert.equal(consumePendingRequest(pending, 'unknown'), null);
    assert.equal(pending.size, 0);
  });

  it('creates distinct storage keys for each report and request context', () => {
    assert.notEqual(
      createRequestContextKey('report-1', 'arf', 'jira-one'),
      createRequestContextKey('report-1', 'arf', 'jira-two'),
    );
    assert.notEqual(
      createRequestContextKey('report-1', 'arf', 'jira-one'),
      createRequestContextKey('report-2', 'arf', 'jira-one'),
    );
  });
});

describe('shouldFinishUnsuspendTracking', () => {
  it('finishes as soon as every expected account reports', () => {
    assert.equal(shouldFinishUnsuspendTracking({ resultCount: 2, expected: 2, now: 10, deadline: 100 }), true);
  });

  it('does not finish incomplete tracking at the soft 45-second point', () => {
    assert.equal(shouldFinishUnsuspendTracking({ resultCount: 1, expected: 2, now: 45_000, deadline: 90_000 }), false);
  });

  it('finishes incomplete tracking at the hard deadline', () => {
    assert.equal(shouldFinishUnsuspendTracking({ resultCount: 1, expected: 2, now: 90_000, deadline: 90_000 }), true);
  });
});

describe('completeUnsuspendResults', () => {
  it('adds unverified results for accounts that did not report', () => {
    assert.deepEqual(
      completeUnsuspendResults(['one@example.com', 'two@example.com'], [
        { account: 'one@example.com', outcome: 'confirmed' },
      ]),
      [
        { account: 'one@example.com', outcome: 'confirmed' },
        { account: 'two@example.com', outcome: 'unverified' },
      ],
    );
  });
});

describe('matchesUnsuspendRequest', () => {
  it('requires a request ID when an active request has one', () => {
    assert.equal(matchesUnsuspendRequest('current', undefined), false);
    assert.equal(matchesUnsuspendRequest('current', 'old'), false);
    assert.equal(matchesUnsuspendRequest('current', 'current'), true);
  });

  it('accepts legacy responses when no correlated request is active', () => {
    assert.equal(matchesUnsuspendRequest(null, undefined), true);
    assert.equal(matchesUnsuspendRequest(null, 'legacy-compatible'), true);
  });
});

describe('matchesRequest', () => {
  it('uses legacy compatibility only when no request is active', async () => {
    const { matchesRequest } = await import('../scripts/pure.js');
    assert.equal(matchesRequest(null, undefined), true);
    assert.equal(matchesRequest('current', undefined), false);
    assert.equal(matchesRequest('current', 'old'), false);
    assert.equal(matchesRequest('current', 'current'), true);
  });
});

describe('createUnsuspendRequestId', () => {
  it('creates a stable, traceable ID from supplied time and entropy', () => {
    assert.equal(createUnsuspendRequestId(1234, 0.5), 'unsuspend-ya-89oqgw');
  });
});

describe('buildUnsuspendAccounts', () => {
  it('includes blocked accounts while filtering the main account', () => {
    assert.deepEqual(
      buildUnsuspendAccounts('main@example.com', 'bounce', 'Yes', 'other@example.com, main@example.com, third@example.com'),
      ['main@example.com', 'other@example.com', 'third@example.com'],
    );
  });

  it('does not add blocked accounts for non-bounce panels', () => {
    assert.deepEqual(
      buildUnsuspendAccounts('main@example.com', 'arf', 'Yes', 'other@example.com'),
      ['main@example.com'],
    );
  });

  it('rejects malformed main or comma-separated accounts', () => {
    assert.equal(buildUnsuspendAccounts('not an account', 'bounce', 'No', ''), null);
    assert.equal(buildUnsuspendAccounts('main@example.com', 'bounce', 'Yes', 'bad account'), null);
  });
});

describe('getSheetReportType', () => {
  it('maps panel prefixes to sheet report types', () => {
    assert.equal(getSheetReportType('arf'), 'ARF');
    assert.equal(getSheetReportType('smtpsuspend'), 'SMTP');
    assert.equal(getSheetReportType('bounce'), 'BOUNCE');
  });
});

describe('cleanSheetReason', () => {
  it('removes report markers and screenshot labels while preserving report content', () => {
    assert.equal(
      cleanSheetReason('#ARF\nReason line\n── Screenshots ──\n1. proof.PNG\n#Bounce'),
      'Reason line',
    );
  });
});
