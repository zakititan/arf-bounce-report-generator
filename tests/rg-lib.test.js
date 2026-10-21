import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as rgLib from '../extension/rg-lib.js';
import {
  REASON_TTL_MS,
  JIRA_DONE_TRANSITION_ID,
  analyzeHistory,
  buildJiraIssueBody,
  extractImagesRegex,
  buildFallbackJiraUrl,
  isReasonFresh,
  isSuccessfulResponse,
  createRequestContextKey,
  getScopedJiraUrl,
  selectJiraUrl,
  createUnsuspendReasonKey,
  createPerAccountUnsuspendReasonKey,
  isSafeAppsScriptUrl,
  createUnsuspendVerifyKey,
  isSafeJiraUrl,
  isSafeGoogleSheetsUrl,
  isValidAccountIdentifier,
} from '../extension/rg-lib.js';

// ── constants ─────────────────────────────────────────────────────────
describe('constants', () => {
  it('exports REASON_TTL_MS of 90000', () => {
    assert.equal(REASON_TTL_MS, 90000);
  });

  it('exports JIRA_DONE_TRANSITION_ID of "71"', () => {
    assert.equal(JIRA_DONE_TRANSITION_ID, '71');
  });
});

describe('isSuccessfulResponse', () => {
  it('counts only an ok HTTP response as successful', () => {
    assert.equal(isSuccessfulResponse({ ok: true, status: 200 }), true);
    assert.equal(isSuccessfulResponse({ ok: false, status: 500 }), false);
  });

  it('does not treat a missing response as successful', () => {
    assert.equal(isSuccessfulResponse(null), false);
  });
});

describe('web app message security helpers', () => {
  it('uses distinct request-scoped keys for unsuspension state', () => {
    assert.notEqual(createUnsuspendReasonKey('run-1'), createUnsuspendReasonKey('run-2'));
    assert.notEqual(createUnsuspendVerifyKey('run-1', 'a@example.com'), createUnsuspendVerifyKey('run-2', 'a@example.com'));
    assert.notEqual(createUnsuspendVerifyKey('run-1', 'a@example.com'), createUnsuspendVerifyKey('run-1', 'b@example.com'));
  });

  it('builds distinct per-account unsuspend reason keys', () => {
    assert.equal(createPerAccountUnsuspendReasonKey('run-1', 'A@Example.com'), 'unsuspendReason:run-1:a@example.com');
    assert.notEqual(createPerAccountUnsuspendReasonKey('run-1', 'a@example.com'), createPerAccountUnsuspendReasonKey('run-1', 'b@example.com'));
    assert.notEqual(createPerAccountUnsuspendReasonKey('run-1', 'a@example.com'), createUnsuspendReasonKey('run-1'));
  });

  it('accepts only safe Apps Script logging URLs', () => {
    assert.equal(isSafeAppsScriptUrl('https://script.google.com/macros/s/abc/exec'), true);
    assert.equal(isSafeAppsScriptUrl('https://script.googleusercontent.com/macros/echo?x=1'), true);
    for (const url of [
      'http://script.google.com/macros/s/abc/exec',
      'https://evil.example/log',
      'javascript:alert(1)',
      '',
      null,
    ]) assert.equal(isSafeAppsScriptUrl(url), false);
  });
  it('accepts only expected JIRA and Google Sheets HTTPS result URLs', () => {
    assert.equal(isSafeJiraUrl('https://jira.directi.com/browse/NEW-1'), true);
    assert.equal(isSafeGoogleSheetsUrl('https://docs.google.com/spreadsheets/d/abc123/edit#gid=1&range=A1'), true);
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://evil.example/browse/NEW-1',
      'http://jira.directi.com/browse/NEW-1',
      'https://docs.google.com/document/d/abc123',
    ]) {
      assert.equal(isSafeJiraUrl(url) || isSafeGoogleSheetsUrl(url), false, url);
    }
  });

  it('rejects one-character TLDs but accepts valid punycode accounts', () => {
    assert.equal(isValidAccountIdentifier('example.x'), false);
    assert.equal(isValidAccountIdentifier('user@example.x'), false);
    assert.equal(isValidAccountIdentifier('example.xn--p1ai'), true);
    assert.equal(isValidAccountIdentifier('user@example.xn--p1ai'), true);
  });

  it('accepts the production and project-scoped Vercel preview origins only', () => {
    assert.equal(rgLib.isAllowedWebAppOrigin('https://arf-bounce-report-generator.vercel.app'), true);
    assert.equal(rgLib.isAllowedWebAppOrigin('https://arf-bounce-report-generator-git-test-project-improvements-zaki-titans-projects.vercel.app'), true);
    assert.equal(rgLib.isAllowedWebAppOrigin('https://preview-123.vercel.app'), false);
    assert.equal(rgLib.isAllowedWebAppOrigin('http://localhost:3000'), true);
    assert.equal(rgLib.isAllowedWebAppOrigin('https://evil.example'), false);
    assert.equal(rgLib.isAllowedWebAppOrigin('null'), false);
  });

  it('validates result payload shapes before the app consumes them', () => {
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: 'jira_123', success: true,
      issueKey: 'NEW-1', url: 'https://jira.directi.com/browse/NEW-1'
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: 'jira_123', success: true,
      issueKey: 'NEW-1'
    }), false);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_LOG_SHEET_RESULT', requestId: 'sheet_123', success: false, error: 'failed'
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'PARTNER_PANEL_RESULT', requestId: 'partner_123', data: { success: true }
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'PARTNER_PANEL_RESULT', requestId: 'partner_123', data: 'forged'
    }), false);
  });

  it('rejects malformed or invalid result request IDs', () => {
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', requestId: 'bad id', success: false
    }), false);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', success: false
    }), true);
  });

  it('generates distinct IDs for distinct submissions even with identical inputs', () => {
    const first = rgLib.createRequestId('jira', 1234, 0.5);
    const second = rgLib.createRequestId('jira', 1234, 0.5);
    assert.notEqual(first, second);
  });

  it('requires typed JIRA payload fields before forwarding', () => {
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA', text: 'report', html: '', panel: 'arf',
      account: 'user@example.com', requestId: 'jira_123'
    }), true);
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA', text: '', html: '', panel: 'arf',
      account: 'user@example.com', requestId: 'jira_123'
    }), false);
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA', text: 'report', html: '', panel: 'arf',
      account: 'not an account', requestId: 'jira_123'
    }), false);
  });

  it('accepts comma-separated valid accounts with or without spaces', () => {
    assert.deepEqual(rgLib.normalizeAccountList('one@example.com,two.example.com, three@example.net'), [
      'one@example.com', 'two.example.com', 'three@example.net'
    ]);
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_UNSUSPEND', accounts: ['one@example.com', 'two.example.com'],
      text: 'report', html: '', panel: 'bounce', requestId: 'unsuspend_123'
    }), true);
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_UNSUSPEND', accounts: ['one@example.com', 'bad account'],
      text: 'report', html: '', panel: 'bounce', requestId: 'unsuspend_123'
    }), false);
  });

  it('returns a stored JIRA URL only for the current report context', () => {
    const key = createRequestContextKey('report_2', 'bounce', 'jira_2');
    const stored = {
      [key]: { url: 'https://jira.directi.com/browse/NEW-1' },
      [createRequestContextKey('report_2', 'bounce', 'jira_3')]: { url: 'https://jira.directi.com/browse/NEW-3' },
    };
    assert.equal(getScopedJiraUrl(stored, 'report_2', 'bounce', 'jira_2'), stored[key].url);
    assert.equal(getScopedJiraUrl(stored, 'report_2', 'bounce', 'jira_3'), 'https://jira.directi.com/browse/NEW-3');
    assert.equal(getScopedJiraUrl(stored, 'report_1', 'bounce', 'jira_2'), '');
    assert.equal(getScopedJiraUrl(stored, 'report_2', 'arf', 'jira_2'), '');
    assert.equal(getScopedJiraUrl(stored, 'report_2', 'bounce', 'jira_1'), '');
    assert.equal(getScopedJiraUrl({ lastJiraUrl: stored }, 'report_2', 'bounce', 'jira_2'), '');
  });

  it('prefers the current panel JIRA link and falls back to scoped storage', () => {
    const stored = 'https://jira.directi.com/browse/NEW-3';
    assert.equal(selectJiraUrl('https://jira.directi.com/browse/NEW-4', stored), 'https://jira.directi.com/browse/NEW-4');
    assert.equal(selectJiraUrl('', stored), stored);
    assert.equal(selectJiraUrl('javascript:alert(1)', stored), stored);
  });
});

// ── domain status bridge messages ───────────────────────────────────────
// The domain-check panel asks the extension what Abuse Desk says about ONE
// domain or email. The exchange is read-only: nothing is unsuspended, no JIRA
// issue is filed and no automation runs behind it.
//
//   web app → REPORT_GENERATOR_DOMAIN_STATUS
//   extension → REPORT_GENERATOR_DOMAIN_STATUS_RESULT
describe('domain status bridge messages', () => {
  const domainRequest = {
    type: 'REPORT_GENERATOR_DOMAIN_STATUS',
    panel: 'domaincheck',
    account: 'flockcloud.tech',
    region: 'us-east-1',
    requestId: 'domstat_123',
  };

  it('accepts a well-formed domain status request', () => {
    assert.equal(rgLib.validateWebAppMessage(domainRequest), true);
  });

  it('accepts an email account as well as a domain', () => {
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, account: 'user@example.com' }), true);
  });

  it('rejects a domain status request with a missing or malformed requestId', () => {
    const { requestId, ...withoutRequestId } = domainRequest;
    assert.equal(rgLib.validateWebAppMessage(withoutRequestId), false);
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, requestId: '' }), false);
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, requestId: 'bad id' }), false);
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, requestId: 42 }), false);
  });

  it('rejects a domain status request whose panel, account or region is not a string', () => {
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, panel: 1 }), false);
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, account: null }), false);
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, account: 42 }), false);
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, region: undefined }), false);
    assert.equal(rgLib.validateWebAppMessage({ ...domainRequest, region: false }), false);
  });

  const domainResult = {
    type: 'REPORT_GENERATOR_DOMAIN_STATUS_RESULT',
    requestId: 'domstat_123',
    success: true,
    account: 'flockcloud.tech',
    domainStatus: 'active',
    customerStatus: 'active',
    userStatus: '',
    outcome: 'confirmed',
    error: null,
  };

  it('accepts a well-formed domain status result', () => {
    assert.equal(rgLib.validateExtensionResult(domainResult), true);
  });

  it('accepts a failed domain status result carrying an error string', () => {
    assert.equal(rgLib.validateExtensionResult({
      ...domainResult,
      success: false,
      domainStatus: '',
      customerStatus: '',
      outcome: 'unknown',
      error: 'AbuseDesk status unreadable (HTTP 401)',
    }), true);
  });

  it('rejects a domain status result with no success flag', () => {
    // The shipped defect, twice over: validateExtensionResult() gates EVERY
    // result payload on a boolean `success` BEFORE the type-specific branch,
    // so a payload without it is discarded outright and the panel hangs until
    // its timeout. Pin it explicitly for this type.
    const { success, ...withoutSuccess } = domainResult;
    assert.equal(rgLib.validateExtensionResult(withoutSuccess), false);
  });

  it('rejects a non-boolean success flag', () => {
    assert.equal(rgLib.validateExtensionResult({ ...domainResult, success: 'yes' }), false);
  });

  it('rejects a domain status result whose statuses are not strings', () => {
    assert.equal(rgLib.validateExtensionResult({ ...domainResult, domainStatus: 1 }), false);
    assert.equal(rgLib.validateExtensionResult({ ...domainResult, customerStatus: 42 }), false);
    assert.equal(rgLib.validateExtensionResult({ ...domainResult, userStatus: true }), false);
    assert.equal(rgLib.validateExtensionResult({ ...domainResult, outcome: {} }), false);
    assert.equal(rgLib.validateExtensionResult({ ...domainResult, error: 7 }), false);
  });
});

// ── analyzeHistory ────────────────────────────────────────────────────
describe('analyzeHistory', () => {
  it('finds the newest suspension date (events are newest-first)', () => {
    const events = [
      { date: '2024-06-01', action: 'Suspension', role: 'admin' },
      { date: '2024-02-01', action: 'Suspension', role: 'admin' },
    ];
    const result = analyzeHistory(events);
    assert.equal(result.suspensionDate, '2024-06-01');
  });

  it('returns passwordChanged true when a password reset happens after the suspension', () => {
    const events = [
      { date: '2024-05-01', action: 'Password reset' },
      { date: '2024-04-01', action: 'Suspension' },
    ];
    const result = analyzeHistory(events);
    assert.equal(result.passwordChanged, true);
    assert.equal(result.suspensionDate, '2024-04-01');
    assert.equal(result.lastPasswordResetDate, '2024-05-01');
  });

  it('returns passwordChanged false when the reset only predates the suspension', () => {
    const events = [
      { date: '2024-04-01', action: 'Suspension' },
      { date: '2024-03-01', action: 'Password reset' },
    ];
    const result = analyzeHistory(events);
    assert.equal(result.passwordChanged, false);
    assert.equal(result.lastPasswordResetDate, '2024-03-01');
  });

  it('returns passwordChanged false and N/A dates when there are no suspension events', () => {
    const events = [
      { date: '2024-05-01', action: 'Password reset' },
      { date: '2024-01-01', action: 'Login success' },
    ];
    const result = analyzeHistory(events);
    assert.equal(result.passwordChanged, false);
    assert.equal(result.suspensionDate, 'N/A');
    assert.equal(result.lastPasswordResetDate, '2024-05-01');
  });

  it('never treats "Unsuspension" as a suspension', () => {
    const events = [
      { date: '2024-05-01', action: 'Unsuspension' },
      { date: '2024-04-01', action: 'Suspension' },
    ];
    const result = analyzeHistory(events);
    // Newest matching event is skipped because "Unsuspension" contains "un".
    assert.equal(result.suspensionDate, '2024-04-01');
  });

  it('does not treat "Suspension removed" as a suspension', () => {
    const result = analyzeHistory([{ date: '2024-05-01', action: 'Suspension removed' }]);
    assert.equal(result.suspensionDate, 'N/A');
    assert.equal(result.passwordChanged, false);
  });

  it('uses the first (newest) password event for lastPasswordResetDate', () => {
    const events = [
      { date: '2024-06-10', action: 'Password changed' },
      { date: '2024-03-02', action: 'Password reset' },
      { date: '2024-01-01', action: 'Suspended' },
    ];
    const result = analyzeHistory(events);
    assert.equal(result.lastPasswordResetDate, '2024-06-10');
  });

  it('matches actions case-insensitively', () => {
    const events = [
      { date: '2024-05-01', action: 'PASSWORD RESET' },
      { date: '2024-04-01', action: 'SUSPENSION' },
    ];
    const result = analyzeHistory(events);
    assert.equal(result.suspensionDate, '2024-04-01');
    assert.equal(result.passwordChanged, true);
    assert.equal(result.lastPasswordResetDate, '2024-05-01');
  });

  it('does not match "Suspended" (lacks the literal "suspens" substring)', () => {
    // Documents current behaviour: the matcher requires the exact substring
    // "suspens", which "Suspended" does not contain ("suspend" ends in "d").
    const result = analyzeHistory([{ date: '2024-05-01', action: 'Account suspended' }]);
    assert.equal(result.suspensionDate, 'N/A');
  });
});

// ── buildJiraIssueBody ────────────────────────────────────────────────
describe('buildJiraIssueBody', () => {
  it('maps the arf panel to ARF label/type and fixed field ids', () => {
    const body = buildJiraIssueBody({ text: 'body text', panel: 'arf', account: 'a@x.com' });
    assert.deepEqual(body.fields.labels, ['ARF_unsuspension']);
    assert.equal(body.fields.summary, 'ARF unsuspension request: a@x.com');
    assert.deepEqual(body.fields.project, { id: '12900' });
    assert.deepEqual(body.fields.issuetype, { id: '10902' });
    assert.deepEqual(body.fields.priority, { id: '10000' });
  });

  it('maps the smtpsuspend panel to SMTP Compromised', () => {
    const body = buildJiraIssueBody({ text: 't', panel: 'smtpsuspend', account: 'a@x.com' });
    assert.deepEqual(body.fields.labels, ['SMTP_unsuspension']);
    assert.equal(body.fields.summary, 'SMTP Compromised unsuspension request: a@x.com');
  });

  it('defaults unknown panels to Bounce', () => {
    const body = buildJiraIssueBody({ text: 't', panel: 'bounce', account: 'a@x.com' });
    assert.deepEqual(body.fields.labels, ['Bounce_unsuspension']);
    assert.equal(body.fields.summary, 'Bounce unsuspension request: a@x.com');
  });

  it('passes the description through unchanged', () => {
    const body = buildJiraIssueBody({ text: 'line1\nline2 <b>', panel: 'arf', account: 'a' });
    assert.equal(body.fields.description, 'line1\nline2 <b>');
  });

  it('includes customfield_12211 when zdLink is set', () => {
    const body = buildJiraIssueBody({ text: 't', panel: 'arf', account: 'a', zdLink: 'https://zd.example/1' });
    assert.equal(body.fields.customfield_12211, 'https://zd.example/1');
  });

  it('omits customfield_12211 when zdLink is undefined or empty string', () => {
    const noLink = buildJiraIssueBody({ text: 't', panel: 'arf', account: 'a' });
    assert.equal('customfield_12211' in noLink.fields, false);
    const emptyLink = buildJiraIssueBody({ text: 't', panel: 'arf', account: 'a', zdLink: '' });
    assert.equal('customfield_12211' in emptyLink.fields, false);
  });
});

// ── extractImagesRegex ────────────────────────────────────────────────
describe('extractImagesRegex', () => {
  it('extracts base64, mimeType and dataUrl from a single image', () => {
    const html = '<img src="data:image/png;base64,QUJD">';
    assert.deepEqual(extractImagesRegex(html), [
      {
        base64: 'QUJD',
        mimeType: 'image/png',
        filename: 'screenshot-1.png',
        dataUrl: 'data:image/png;base64,QUJD',
      },
    ]);
  });

  it('derives the filename from alt text, sanitising to [a-z0-9_] plus .png', () => {
    const html = '<img alt="my shot!.png" src="data:image/jpeg;base64,QUJD">';
    const images = extractImagesRegex(html);
    assert.equal(images[0].filename, 'my_shot__png.png');
    assert.equal(images[0].mimeType, 'image/jpeg');
  });

  it('falls back to screenshot-N.png when there is no alt attribute', () => {
    const images = extractImagesRegex('<img src="data:image/gif;base64,R0lGOD">');
    assert.equal(images[0].filename, 'screenshot-1.png');
    assert.equal(images[0].mimeType, 'image/gif');
  });

  it('extracts multiple images in document order with incrementing fallback names', () => {
    const html =
      '<img src="data:image/png;base64,AAA">' +
      '<img src="data:image/png;base64,BBB">' +
      '<img src="data:image/png;base64,CCC">';
    const images = extractImagesRegex(html);
    assert.equal(images.length, 3);
    assert.deepEqual(images.map((i) => i.base64), ['AAA', 'BBB', 'CCC']);
    assert.deepEqual(images.map((i) => i.filename), ['screenshot-1.png', 'screenshot-2.png', 'screenshot-3.png']);
  });

  it('returns an empty array for HTML without inline images', () => {
    assert.deepEqual(extractImagesRegex('<p>no images here</p>'), []);
    assert.deepEqual(extractImagesRegex('<img src="https://example.com/a.png">'), []);
  });

  it('composes mimeType as image/<type> for non-png types', () => {
    const images = extractImagesRegex('<img src="data:image/webp;base64,UklGR">');
    assert.equal(images[0].mimeType, 'image/webp');
    assert.equal(images[0].base64, 'UklGR');
  });
});

// ── buildFallbackJiraUrl ──────────────────────────────────────────────
describe('buildFallbackJiraUrl', () => {
  it('contains the fixed project, issuetype and priority params', () => {
    const url = buildFallbackJiraUrl({ panel: 'arf', account: 'a@x.com', text: 'hello' });
    assert.ok(url.includes('pid=12900'));
    assert.ok(url.includes('issuetype=10902'));
    assert.ok(url.includes('priority=10000'));
  });

  it('sets the labels param according to the panel', () => {
    assert.ok(buildFallbackJiraUrl({ panel: 'arf', account: 'a', text: 't' }).includes('&labels=ARF_unsuspension'));
    assert.ok(
      buildFallbackJiraUrl({ panel: 'smtpsuspend', account: 'a', text: 't' }).includes('&labels=SMTP_unsuspension')
    );
    assert.ok(
      buildFallbackJiraUrl({ panel: 'bounce', account: 'a', text: 't' }).includes('&labels=Bounce_unsuspension')
    );
  });

  it('URI-encodes the summary', () => {
    const url = buildFallbackJiraUrl({ panel: 'bounce', account: 'user@example.com', text: 't' });
    assert.ok(url.includes('&summary=' + encodeURIComponent('Bounce unsuspension request: user@example.com')));
  });

  it('URI-encodes the description and truncates text beyond 2000 characters', () => {
    const short = 'short & <text>';
    const shortUrl = buildFallbackJiraUrl({ panel: 'arf', account: 'a', text: short });
    assert.ok(shortUrl.includes('&description=' + encodeURIComponent(short)));

    const long = 'x'.repeat(2500);
    const longUrl = buildFallbackJiraUrl({ panel: 'arf', account: 'a', text: long });
    assert.ok(longUrl.endsWith('&description=' + encodeURIComponent(long.slice(0, 2000))));
    assert.ok(!longUrl.includes(encodeURIComponent(long)));
  });
});

// ── isReasonFresh ─────────────────────────────────────────────────────
describe('isReasonFresh', () => {
  const now = 1700000000000;

  it('returns true within the TTL window', () => {
    assert.equal(isReasonFresh({ reason: 'rate limited', ts: now - 50000 }, now), true);
  });

  it('returns true exactly at the TTL boundary', () => {
    assert.equal(isReasonFresh({ reason: 'rate limited', ts: now - REASON_TTL_MS }, now), true);
  });

  it('returns false 1ms past the TTL boundary', () => {
    assert.equal(isReasonFresh({ reason: 'rate limited', ts: now - REASON_TTL_MS - 1 }, now), false);
  });

  it('returns false when ts is missing', () => {
    assert.equal(isReasonFresh({ reason: 'rate limited' }, now), false);
  });

  it('returns false for null or undefined records', () => {
    assert.equal(isReasonFresh(null, now), false);
    assert.equal(isReasonFresh(undefined, now), false);
  });

  it('returns false for an empty-string reason', () => {
    assert.equal(isReasonFresh({ reason: '', ts: now - 1000 }, now), false);
  });

  it('returns false for a non-finite ts', () => {
    assert.equal(isReasonFresh({ reason: 'r', ts: NaN }, now), false);
    assert.equal(isReasonFresh({ reason: 'r', ts: Infinity }, now), false);
  });

  it('returns false for a negative (very old) ts', () => {
    assert.equal(isReasonFresh({ reason: 'r', ts: -1000 }, now), false);
  });

  it('returns false for a non-string reason', () => {
    assert.equal(isReasonFresh({ reason: 42, ts: now - 1000 }, now), false);
  });
});

// ── capInlineImages ───────────────────────────────────────────────────
describe('capInlineImages', () => {
  const mk = (base64, extra = {}) => ({ mimeType: 'image/png', base64, filename: 'a.png', ...extra });

  it('keeps images under limits without mutating input', () => {
    const input = [mk('QUJD'), mk('REVG')];
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = rgLib.capInlineImages(input);
    assert.equal(out.kept.length, 2);
    assert.deepEqual(out.dropped, { count: 0, bytes: 0 });
    assert.deepEqual(input, snapshot);
  });

  it('enforces maxCount, keeping first N', () => {
    const images = Array.from({ length: 12 }, (_, i) => mk('QUJD', { filename: `${i}.png` }));
    const out = rgLib.capInlineImages(images);
    assert.equal(out.kept.length, 10);
    assert.equal(out.dropped.count, 2);
    assert.deepEqual(out.kept.map((x) => x.filename), Array.from({ length: 10 }, (_, i) => `${i}.png`));
  });

  it('drops images exceeding maxBytesEach', () => {
    const big = 'A'.repeat(400); // 300 bytes
    const out = rgLib.capInlineImages([mk('QUJD'), mk(big)], { maxBytesEach: 100 });
    assert.equal(out.kept.length, 1);
    assert.equal(out.kept[0].base64, 'QUJD');
    assert.equal(out.dropped.count, 1);
    assert.equal(out.dropped.bytes, 300);
  });

  it('enforces maxBytesTotal across kept images', () => {
    const img = 'A'.repeat(400); // 300 bytes each
    const out = rgLib.capInlineImages([mk(img), mk(img), mk(img)], { maxBytesTotal: 600 });
    assert.equal(out.kept.length, 2);
    assert.equal(out.dropped.count, 1);
    assert.equal(out.dropped.bytes, 300);
  });

  it('honours custom maxCount', () => {
    const images = [mk('QUJD'), mk('REVG'), mk('SElK')];
    const out = rgLib.capInlineImages(images, { maxCount: 2 });
    assert.equal(out.kept.length, 2);
    assert.equal(out.dropped.count, 1);
  });
});

// ── matchesActiveStatus ───────────────────────────────────────────────
describe('matchesActiveStatus', () => {
  it('matches active case-insensitively with surrounding text', () => {
    assert.equal(rgLib.matchesActiveStatus('Active'), true);
    assert.equal(rgLib.matchesActiveStatus('  ACTIVE  '), true);
    assert.equal(rgLib.matchesActiveStatus('Status: active (verified)'), true);
  });

  it('rejects inactive, reactivated and similar words', () => {
    assert.equal(rgLib.matchesActiveStatus('inactive'), false);
    assert.equal(rgLib.matchesActiveStatus('InActive user'), false);
    assert.equal(rgLib.matchesActiveStatus('reactivated'), false);
    assert.equal(rgLib.matchesActiveStatus('actively'), false);
    assert.equal(rgLib.matchesActiveStatus('hyperactive'), false);
  });

  it('returns false for non-strings and blank input', () => {
    assert.equal(rgLib.matchesActiveStatus(''), false);
    assert.equal(rgLib.matchesActiveStatus('   '), false);
    assert.equal(rgLib.matchesActiveStatus(null), false);
    assert.equal(rgLib.matchesActiveStatus(undefined), false);
    assert.equal(rgLib.matchesActiveStatus(42), false);
  });
});

// ── createPendingMap ──────────────────────────────────────────────────
describe('createPendingMap', () => {
  it('stores, retrieves and tracks entries by key', () => {
    const m = rgLib.createPendingMap();
    assert.equal(m.size(), 0);
    assert.equal(m.has('a'), false);
    m.set('a', 1);
    m.set('b', 2);
    assert.equal(m.get('a'), 1);
    assert.equal(m.has('a'), true);
    assert.equal(m.size(), 2);
  });

  it('resolve removes the entry and fulfils the stored deferred', async () => {
    const m = rgLib.createPendingMap();
    let done = null;
    m.set('req-1', { resolve: (v) => { done = v; } });
    assert.equal(m.resolve('req-1', 'ok'), true);
    assert.equal(done, 'ok');
    assert.equal(m.has('req-1'), false);
    assert.equal(m.size(), 0);
    assert.equal(m.resolve('missing', 'x'), false);
  });

  it('reject removes the entry and rejects the stored deferred', () => {
    const m = rgLib.createPendingMap();
    let failed = null;
    m.set('req-2', { reject: (e) => { failed = e; } });
    const err = new Error('boom');
    assert.equal(m.reject('req-2', err), true);
    assert.equal(failed, err);
    assert.equal(m.has('req-2'), false);
    assert.equal(m.reject('missing', err), false);
  });

  it('throws TypeError for non-empty-string keys', () => {
    const m = rgLib.createPendingMap();
    for (const bad of ['', 42, null, undefined, {}, []]) {
      assert.throws(() => m.set(bad, 1), TypeError);
      assert.throws(() => m.get(bad), TypeError);
      assert.throws(() => m.has(bad), TypeError);
      assert.throws(() => m.resolve(bad, 1), TypeError);
      assert.throws(() => m.reject(bad, new Error('x')), TypeError);
    }
  });
});

// ── JIRA transition discovery + create payload ────────────────────────
describe('discoverDoneTransitionId', () => {
  it('returns the id of the transition leading to Done', () => {
    const res = { transitions: [
      { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
      { id: '71', name: 'Done', to: { name: 'Done' } },
    ] };
    assert.equal(rgLib.discoverDoneTransitionId(res), '71');
  });

  it('prefers exact Done over Closed and matches case-insensitively', () => {
    const res = { transitions: [
      { id: '81', name: 'Close', to: { name: 'Closed' } },
      { id: '72', name: 'done it', to: { name: 'DONE' } },
    ] };
    assert.equal(rgLib.discoverDoneTransitionId(res), '72');
    assert.equal(rgLib.discoverDoneTransitionId({ transitions: [{ id: '81', to: { name: 'closed' } }] }), '81');
  });

  it('returns null when absent or malformed', () => {
    assert.equal(rgLib.discoverDoneTransitionId({ transitions: [{ id: '21', to: { name: 'In Progress' } }] }), null);
    assert.equal(rgLib.discoverDoneTransitionId({ transitions: [] }), null);
    assert.equal(rgLib.discoverDoneTransitionId({}), null);
    assert.equal(rgLib.discoverDoneTransitionId(null), null);
  });
});

describe('isValidJiraCreatePayload', () => {
  it('accepts non-blank text with account and panel', () => {
    assert.equal(rgLib.isValidJiraCreatePayload({ text: 'hello', html: '', account: 'a@x.com', panel: 'arf' }), true);
  });

  it('accepts blank text when html contains an inline image', () => {
    const html = '<img src="data:image/png;base64,QUJD">';
    assert.equal(rgLib.isValidJiraCreatePayload({ text: '   ', html, account: 'a@x.com', panel: 'arf' }), true);
  });

  it('rejects blank text with no extractable images', () => {
    assert.equal(rgLib.isValidJiraCreatePayload({ text: '  ', html: '<p>no img</p>', account: 'a@x.com', panel: 'arf' }), false);
    assert.equal(rgLib.isValidJiraCreatePayload({ text: '', html: '', account: 'a@x.com', panel: 'arf' }), false);
  });

  it('rejects blank account or panel', () => {
    assert.equal(rgLib.isValidJiraCreatePayload({ text: 'hi', html: '', account: '  ', panel: 'arf' }), false);
    assert.equal(rgLib.isValidJiraCreatePayload({ text: 'hi', html: '', account: 'a@x.com', panel: '' }), false);
    assert.equal(rgLib.isValidJiraCreatePayload({ text: 'hi', html: '', account: null, panel: 'arf' }), false);
  });
});

describe('buildJiraTransitionDiscoveryUrl', () => {
  it('builds a transitions URL builder for an issue key', () => {
    const build = rgLib.buildJiraTransitionDiscoveryUrl('https://jira.directi.com');
    assert.equal(build('NEW-1'), 'https://jira.directi.com/rest/api/2/issue/NEW-1/transitions');
    const trailing = rgLib.buildJiraTransitionDiscoveryUrl('https://jira.directi.com/');
    assert.equal(trailing('NEW-1'), 'https://jira.directi.com/rest/api/2/issue/NEW-1/transitions');
  });
});

// ── buildBulkSummary ────────────────────────────────────────────────────
describe('buildBulkSummary', () => {
  it('joins, trims and dedupes comma-separated input', () => {
    assert.equal(rgLib.buildBulkSummary('a@x.com, b@x.com, a@x.com'), 'a@x.com, b@x.com');
  });

  it('handles array input with blanks and dupes', () => {
    assert.equal(rgLib.buildBulkSummary([' a@x.com ', '', 'b@x.com', 'a@x.com', '  ']), 'a@x.com, b@x.com');
  });

  it('splits commas inside array elements and returns empty for blank input', () => {
    assert.equal(rgLib.buildBulkSummary(['a@x.com, b@x.com', 'b@x.com']), 'a@x.com, b@x.com');
    assert.equal(rgLib.buildBulkSummary('  , , '), '');
    assert.equal(rgLib.buildBulkSummary([]), '');
  });
});

// ── storage safety (quota-blowout + janitor) ───────────────────────────
describe('isStorableReportHtml', () => {
  it('accepts small HTML for the manual-fallback store', () => {
    assert.equal(rgLib.isStorableReportHtml('<p>hi</p>'), true);
    assert.equal(rgLib.isStorableReportHtml(''), true);
  });

  it('rejects multi-MB base64 HTML that would blow the storage quota', () => {
    assert.equal(rgLib.isStorableReportHtml('x'.repeat(600 * 1024)), false);
    assert.equal(rgLib.isStorableReportHtml(null), false);
  });
});

describe('findStaleStorageKeys', () => {  it('flags expired unsuspend, verify and fallback-report keys', () => {
    const now = 1_000_000;
    const stale = { reason: 'https://jira.directi.com/browse/X-1', ts: now - 200_000 };
    const fresh = { reason: 'https://jira.directi.com/browse/X-2', ts: now };
    const keys = rgLib.findStaleStorageKeys({
      'unsuspendReason:req-1': stale,
      'unsuspendReason:req-1:a@x.com': stale,
      'unsuspendVerify:req-1:a@x.com': { ts: now - 200_000, attempt: 1 },
      'unsuspendReason:req-2': fresh,
      'reportData:["r","arf","q"]': { text: 't', timestamp: now - 20 * 60 * 1000 },
      'jiraUrl:["r","arf","q"]': { url: 'https://jira.directi.com/browse/X-3', ts: now - 25 * 3600 * 1000 },
      'unrelated': { ts: 0 },
    }, now);
    assert.ok(keys.includes('unsuspendReason:req-1'));
    assert.ok(keys.includes('unsuspendReason:req-1:a@x.com'));
    assert.ok(keys.includes('unsuspendVerify:req-1:a@x.com'));
    assert.ok(keys.includes('reportData:["r","arf","q"]'));
    assert.ok(keys.includes('jiraUrl:["r","arf","q"]'));
    assert.ok(!keys.includes('unsuspendReason:req-2'));
    assert.ok(!keys.includes('unrelated'));
  });

  it('keeps fresh entries and tolerates malformed values', () => {
    const now = 1_000_000;
    assert.deepEqual(rgLib.findStaleStorageKeys({
      'unsuspendReason:req-1': { reason: 'x', ts: now },
      'reportData:k': { text: 't', timestamp: now },
      'jiraUrl:k': { url: 'https://jira.directi.com/browse/X-1', ts: now },
      'unsuspendReason:broken': 'not-an-object',
    }, now), []);
  });
});

// ── buildAbuseDeskUrl ─────────────────────────────────────────────────
describe('buildAbuseDeskUrl', () => {
  it('builds the blocked-users URL with entity, region and request id', () => {
    assert.equal(
      rgLib.buildAbuseDeskUrl('user@example.com', 'us-east-1', 'req-1'),
      'https://abusedesk.ops.titan.email/blocked_users.html?entity=user%40example.com&region=us-east-1&rgRequestId=req-1'
    );
  });

  it('omits the request id when absent', () => {
    assert.equal(
      rgLib.buildAbuseDeskUrl('example.com', 'eu-central-1', ''),
      'https://abusedesk.ops.titan.email/blocked_users.html?entity=example.com&region=eu-central-1'
    );
  });
});

describe('extractJiraIssueKey', () => {
  it('extracts the key from a safe browse URL', () => {
    assert.equal(rgLib.extractJiraIssueKey('https://jira.directi.com/browse/TAE-1234'), 'TAE-1234');
  });

  it('extracts the key from a selectedIssue query param', () => {
    assert.equal(
      rgLib.extractJiraIssueKey('https://jira.directi.com/secure/RapidBoard.jspa?selectedIssue=ABC-99'),
      'ABC-99'
    );
  });

  it('rejects unsafe hosts, malformed keys and non-strings', () => {
    assert.equal(rgLib.extractJiraIssueKey('https://evil.example/browse/TAE-1234'), null);
    assert.equal(rgLib.extractJiraIssueKey('https://jira.directi.com/browse/not-a-key'), null);
    assert.equal(rgLib.extractJiraIssueKey('https://jira.directi.com/browse/TAE-1234/extra'), null);
    assert.equal(rgLib.extractJiraIssueKey(''), null);
    assert.equal(rgLib.extractJiraIssueKey(null), null);
    assert.equal(rgLib.extractJiraIssueKey(42), null);
  });
});

describe('JIRA description message validation', () => {
  it('accepts a well-formed description request', () => {
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA_DESCRIPTION',
      requestId: 'desc-1',
      panel: 'direct',
      jiraUrl: 'https://jira.directi.com/browse/TAE-1234',
    }), true);
  });

  it('rejects description requests with bad requestId or missing jiraUrl', () => {
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA_DESCRIPTION',
      requestId: '!!!',
      panel: 'direct',
      jiraUrl: 'https://jira.directi.com/browse/TAE-1234',
    }), false);
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA_DESCRIPTION',
      requestId: 'desc-1',
      panel: 'direct',
    }), false);
  });

  it('accepts successful and failed description results', () => {
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DESCRIPTION_RESULT',
      requestId: 'desc-1',
      success: true,
      issueKey: 'TAE-1234',
      description: 'text',
      summary: 'Bounce unsuspension request: a@x.com',
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DESCRIPTION_RESULT',
      requestId: 'desc-1',
      success: false,
      error: 'nope',
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DESCRIPTION_RESULT',
      requestId: 'desc-1',
    }), false);
  });
});

describe('JIRA done message validation', () => {
  it('accepts a well-formed done request', () => {
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA_DONE',
      requestId: 'done-1',
      panel: 'direct',
      jiraUrl: 'https://jira.directi.com/browse/TAE-1234',
      accounts: 'a@x.com, b@x.com',
    }), true);
  });

  it('rejects done requests with bad requestId or missing fields', () => {
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA_DONE',
      requestId: '!!!',
      panel: 'direct',
      jiraUrl: 'https://jira.directi.com/browse/TAE-1234',
      accounts: 'a@x.com',
    }), false);
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA_DONE',
      requestId: 'done-1',
      panel: 'direct',
      jiraUrl: 'https://jira.directi.com/browse/TAE-1234',
    }), false);
    assert.equal(rgLib.validateWebAppMessage({
      type: 'REPORT_GENERATOR_JIRA_DONE',
      requestId: 'done-1',
      panel: 'direct',
      accounts: 'a@x.com',
    }), false);
  });

  it('accepts done results with done/commented flags', () => {
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DONE_RESULT',
      requestId: 'done-1',
      success: true,
      issueKey: 'TAE-1234',
      done: true,
      commented: true,
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DONE_RESULT',
      requestId: 'done-1',
      success: true,
      issueKey: 'TAE-1234',
      done: true,
      commented: false,
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DONE_RESULT',
      requestId: 'done-1',
      success: false,
      error: 'nope',
    }), true);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DONE_RESULT',
      requestId: 'done-1',
    }), false);
    assert.equal(rgLib.validateExtensionResult({
      type: 'REPORT_GENERATOR_JIRA_DONE_RESULT',
      requestId: 'done-1',
      success: true,
      done: 'yes',
    }), false);
  });
});

// ── extractAdUserStatus ───────────────────────────────────────────────
describe('extractAdUserStatus', () => {
  it('reads the top-level user_status and userStatus keys', () => {
    assert.equal(rgLib.extractAdUserStatus({ user_status: 'Active' }), 'Active');
    assert.equal(rgLib.extractAdUserStatus({ userStatus: 'Suspended' }), 'Suspended');
    assert.equal(rgLib.extractAdUserStatus({ user_status: 'active', userStatus: 'Suspended' }), 'active');
  });

  it('reads one level of nesting under data and result, both casings', () => {
    assert.equal(rgLib.extractAdUserStatus({ data: { user_status: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdUserStatus({ data: { userStatus: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdUserStatus({ result: { user_status: 'Suspended' } }), 'Suspended');
    assert.equal(rgLib.extractAdUserStatus({ result: { userStatus: 'Suspended' } }), 'Suspended');
  });

  it('prefers top-level user_status over userStatus and every nested form', () => {
    const nested = {
      user_status: 'top-snake',
      userStatus: 'top-camel',
      data: { user_status: 'data-snake', userStatus: 'data-camel' },
      result: { user_status: 'result-snake', userStatus: 'result-camel' },
    };
    assert.equal(rgLib.extractAdUserStatus(nested), 'top-snake');
    // …then userStatus, then data.*, then result.*
    assert.equal(rgLib.extractAdUserStatus({ ...nested, user_status: undefined }), 'top-camel');
    assert.equal(
      rgLib.extractAdUserStatus({ data: nested.data, result: nested.result }),
      'data-snake'
    );
    assert.equal(rgLib.extractAdUserStatus({ result: nested.result }), 'result-snake');
  });

  it('ignores non-string values at every level and returns an empty string', () => {
    for (const bad of [42, null, undefined, true, { nested: 'Active' }, ['Active'], '']) {
      assert.equal(rgLib.extractAdUserStatus({ user_status: bad }), '', String(bad));
      assert.equal(rgLib.extractAdUserStatus({ userStatus: bad }), '', String(bad));
      assert.equal(rgLib.extractAdUserStatus({ data: { user_status: bad } }), '', String(bad));
      assert.equal(rgLib.extractAdUserStatus({ data: { userStatus: bad } }), '', String(bad));
      assert.equal(rgLib.extractAdUserStatus({ result: { user_status: bad } }), '', String(bad));
      assert.equal(rgLib.extractAdUserStatus({ result: { userStatus: bad } }), '', String(bad));
    }
    // A non-object container hides the nested keys entirely.
    assert.equal(rgLib.extractAdUserStatus({ data: 'Active', result: 7 }), '');
  });

  it('does not throw for hostile top-level inputs', () => {
    for (const bad of [null, undefined, 'a string', 42, [], {}, { data: 7 }, NaN, true]) {
      assert.doesNotThrow(() => rgLib.extractAdUserStatus(bad), String(bad));
      assert.equal(rgLib.extractAdUserStatus(bad), '', String(bad));
    }
  });

  it('trims the value it returns and treats whitespace-only as absent', () => {
    assert.equal(rgLib.extractAdUserStatus({ user_status: '  Active  ' }), 'Active');
    assert.equal(rgLib.extractAdUserStatus({ data: { userStatus: '\tSuspended\n' } }), 'Suspended');
    assert.equal(rgLib.extractAdUserStatus({ user_status: '   ' }), '');
    assert.equal(rgLib.extractAdUserStatus({ result: { user_status: '\n\t' } }), '');
  });
});

// ── resolveVerifiedOutcome ────────────────────────────────────────────
describe('resolveVerifiedOutcome', () => {
  it('covers every row of the badge × api decision table', () => {
    const v = rgLib.resolveVerifiedOutcome;
    // badge active → confirmed, whatever the API says
    assert.equal(v({ badgeStatus: 'Active', apiStatus: 'active' }), 'confirmed');
    assert.equal(v({ badgeStatus: 'Active', apiStatus: 'suspended' }), 'confirmed');
    assert.equal(v({ badgeStatus: 'Active', apiStatus: '' }), 'confirmed');
    // badge suspended → API rescues an active user, otherwise failed
    assert.equal(v({ badgeStatus: 'Suspended', apiStatus: 'active' }), 'confirmed');
    assert.equal(v({ badgeStatus: 'Suspended', apiStatus: 'suspended' }), 'failed');
    assert.equal(v({ badgeStatus: 'Suspended', apiStatus: '' }), 'failed');
    // badge neither → the API decides, unknown when it says nothing
    assert.equal(v({ badgeStatus: '', apiStatus: 'active' }), 'confirmed');
    assert.equal(v({ badgeStatus: '', apiStatus: 'suspended' }), 'failed');
    assert.equal(v({ badgeStatus: '', apiStatus: '' }), 'unknown');
  });

  it('compares both inputs case-insensitively and ignores surrounding whitespace', () => {
    const v = rgLib.resolveVerifiedOutcome;
    assert.equal(v({ badgeStatus: ' ACTIVE ', apiStatus: 'suspended' }), 'confirmed');
    assert.equal(v({ badgeStatus: 'suspended', apiStatus: '\tACTIVE\n' }), 'confirmed');
    assert.equal(v({ badgeStatus: 'SUSPENDED', apiStatus: 'Suspended' }), 'failed');
    assert.equal(v({ badgeStatus: '   ', apiStatus: '  ACTIVE  ' }), 'confirmed');
    assert.equal(v({ badgeStatus: 'status: ACTIVE (verified)', apiStatus: 'garbage' }), 'confirmed');
  });

  it('never treats "inactive" as active', () => {
    const v = rgLib.resolveVerifiedOutcome;
    assert.equal(v({ badgeStatus: 'inactive', apiStatus: '' }), 'unknown');
    assert.equal(v({ badgeStatus: 'INACTIVE', apiStatus: 'suspended' }), 'failed');
    assert.equal(v({ badgeStatus: 'inactive', apiStatus: 'active' }), 'confirmed');
    assert.equal(v({ badgeStatus: 'reactivated', apiStatus: 'hyperactive' }), 'unknown');
  });

  it('returns unknown for missing, non-object or garbage input without throwing', () => {
    const v = rgLib.resolveVerifiedOutcome;
    assert.equal(v(), 'unknown');
    assert.equal(v(null), 'unknown');
    assert.equal(v(undefined), 'unknown');
    assert.equal(v('Active'), 'unknown');
    assert.equal(v(42), 'unknown');
    assert.equal(v([]), 'unknown');
    assert.equal(v({}), 'unknown');
    assert.equal(v({ badgeStatus: 'Active' }), 'confirmed');   // apiStatus simply absent
    assert.equal(v({ apiStatus: 'active' }), 'confirmed');
    assert.equal(v({ badgeStatus: null, apiStatus: 42 }), 'unknown');
    assert.doesNotThrow(() => v());
  });
});

// ── buildAdStatusUrl ──────────────────────────────────────────────────
describe('buildAdStatusUrl', () => {
  it('builds the user and domain status URLs, both carrying the region param', () => {
    assert.equal(
      rgLib.buildAdStatusUrl('user', 'user@example.com', 'us-east-1'),
      'https://api-abusedesk.ops.titan.email/api/v1/users/status/?email=user%40example.com&region=us-east-1'
    );
    assert.equal(
      rgLib.buildAdStatusUrl('domain', 'example.com', 'eu-central-1'),
      'https://api-abusedesk.ops.titan.email/api/v1/domains/status/?domain=example.com&region=eu-central-1'
    );
  });

  it('falls back to the user URL for an unknown or absent kind', () => {
    const userUrl = 'https://api-abusedesk.ops.titan.email/api/v1/users/status/?email=a%40x.com&region=us-east-1';
    assert.equal(rgLib.buildAdStatusUrl('nonsense', 'a@x.com', 'us-east-1'), userUrl);
    assert.equal(rgLib.buildAdStatusUrl(undefined, 'a@x.com', 'us-east-1'), userUrl);
    assert.equal(rgLib.buildAdStatusUrl(null, 'a@x.com', 'us-east-1'), userUrl);
    assert.equal(rgLib.buildAdStatusUrl('', 'a@x.com', 'us-east-1'), userUrl);
    assert.equal(rgLib.buildAdStatusUrl('DOMAIN', 'a@x.com', 'us-east-1'), userUrl);   // case-sensitive
    assert.equal(rgLib.buildAdStatusUrl('users', 'a@x.com', 'us-east-1'), userUrl);
  });

  it('defaults the region to us-east-1 when absent, empty or not a string', () => {
    const expected = 'https://api-abusedesk.ops.titan.email/api/v1/domains/status/?domain=a%40x.com&region=us-east-1';
    assert.equal(rgLib.buildAdStatusUrl('domain', 'a@x.com'), expected);
    assert.equal(rgLib.buildAdStatusUrl('domain', 'a@x.com', ''), expected);
    assert.equal(rgLib.buildAdStatusUrl('domain', 'a@x.com', null), expected);
    assert.equal(rgLib.buildAdStatusUrl('domain', 'a@x.com', 42), expected);
    assert.equal(
      rgLib.buildAdStatusUrl('user', 'a@x.com', undefined),
      'https://api-abusedesk.ops.titan.email/api/v1/users/status/?email=a%40x.com&region=us-east-1'
    );
  });

  it('URI-encodes the account', () => {
    assert.equal(
      rgLib.buildAdStatusUrl('user', 'first.last+tag@sub.example.com', 'us-east-1'),
      'https://api-abusedesk.ops.titan.email/api/v1/users/status/?email=first.last%2Btag%40sub.example.com&region=us-east-1'
    );
    assert.equal(
      rgLib.buildAdStatusUrl('user', 'a b@x.com', 'us-east-1'),
      'https://api-abusedesk.ops.titan.email/api/v1/users/status/?email=a%20b%40x.com&region=us-east-1'
    );
    // A caller-owned region is encoded too.
    assert.equal(
      rgLib.buildAdStatusUrl('domain', 'example.com', 'a b&c'),
      'https://api-abusedesk.ops.titan.email/api/v1/domains/status/?domain=example.com&region=a%20b%26c'
    );
  });

  it('throws a TypeError for a non-string account but allows an empty one', () => {
    for (const bad of [null, undefined, 42, true, {}, [], Symbol('x')]) {
      assert.throws(() => rgLib.buildAdStatusUrl('user', bad, 'us-east-1'), TypeError, String(bad));
    }
    // Validation belongs to callers — an empty account still yields a URL.
    assert.equal(
      rgLib.buildAdStatusUrl('domain', '', 'us-east-1'),
      'https://api-abusedesk.ops.titan.email/api/v1/domains/status/?domain=&region=us-east-1'
    );
  });
});

// ── extractAdDomainStatus ─────────────────────────────────────────────
describe('extractAdDomainStatus', () => {
  it('reads the top-level domain_status and domainStatus keys', () => {
    assert.equal(rgLib.extractAdDomainStatus({ domain_status: 'Active' }), 'Active');
    assert.equal(rgLib.extractAdDomainStatus({ domainStatus: 'Suspended' }), 'Suspended');
    assert.equal(rgLib.extractAdDomainStatus({ domain_status: 'active', domainStatus: 'Suspended' }), 'active');
  });

  it('reads one level of nesting under data and result, both casings', () => {
    assert.equal(rgLib.extractAdDomainStatus({ data: { domain_status: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdDomainStatus({ data: { domainStatus: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdDomainStatus({ result: { domain_status: 'Suspended' } }), 'Suspended');
    assert.equal(rgLib.extractAdDomainStatus({ result: { domainStatus: 'Suspended' } }), 'Suspended');
  });

  it('prefers top-level domain_status over domainStatus and every nested form', () => {
    const nested = {
      domain_status: 'top-snake',
      domainStatus: 'top-camel',
      data: { domain_status: 'data-snake', domainStatus: 'data-camel' },
      result: { domain_status: 'result-snake', domainStatus: 'result-camel' },
    };
    assert.equal(rgLib.extractAdDomainStatus(nested), 'top-snake');
    // …then domainStatus, then data.*, then result.*
    assert.equal(rgLib.extractAdDomainStatus({ ...nested, domain_status: undefined }), 'top-camel');
    assert.equal(
      rgLib.extractAdDomainStatus({ data: nested.data, result: nested.result }),
      'data-snake'
    );
    assert.equal(
      rgLib.extractAdDomainStatus({ data: { domainStatus: 'data-camel' }, result: nested.result }),
      'data-camel'
    );
    assert.equal(rgLib.extractAdDomainStatus({ result: nested.result }), 'result-snake');
  });

  it('ignores non-string values at every level and returns an empty string', () => {
    for (const bad of [42, null, undefined, true, { nested: 'Active' }, ['Active'], '']) {
      assert.equal(rgLib.extractAdDomainStatus({ domain_status: bad }), '', String(bad));
      assert.equal(rgLib.extractAdDomainStatus({ domainStatus: bad }), '', String(bad));
      assert.equal(rgLib.extractAdDomainStatus({ data: { domain_status: bad } }), '', String(bad));
      assert.equal(rgLib.extractAdDomainStatus({ data: { domainStatus: bad } }), '', String(bad));
      assert.equal(rgLib.extractAdDomainStatus({ result: { domain_status: bad } }), '', String(bad));
      assert.equal(rgLib.extractAdDomainStatus({ result: { domainStatus: bad } }), '', String(bad));
    }
    // A non-object container hides the nested keys entirely.
    assert.equal(rgLib.extractAdDomainStatus({ data: 'Active', result: 7 }), '');
    // The user endpoint's keys are not domain keys.
    assert.equal(rgLib.extractAdDomainStatus({ user_status: 'Active', userStatus: 'Active' }), '');
  });

  it('does not throw for hostile top-level inputs', () => {
    for (const bad of [null, undefined, 'a string', 42, [], {}, { data: 7 }, NaN, true]) {
      assert.doesNotThrow(() => rgLib.extractAdDomainStatus(bad), String(bad));
      assert.equal(rgLib.extractAdDomainStatus(bad), '', String(bad));
    }
    const throwing = { get domain_status() { throw new Error('boom'); } };
    assert.doesNotThrow(() => rgLib.extractAdDomainStatus(throwing));
    assert.equal(rgLib.extractAdDomainStatus(throwing), '');
  });

  it('trims the value it returns and treats whitespace-only as absent', () => {
    assert.equal(rgLib.extractAdDomainStatus({ domain_status: '  Active  ' }), 'Active');
    assert.equal(rgLib.extractAdDomainStatus({ data: { domainStatus: '\tSuspended\n' } }), 'Suspended');
    assert.equal(rgLib.extractAdDomainStatus({ domain_status: '   ' }), '');
    assert.equal(rgLib.extractAdDomainStatus({ result: { domain_status: '\n\t' } }), '');
  });
});

// ── captured /api/v1/domains/status/ response ──────────────────────────
// Verbatim body from the live endpoint. Two facts here are invisible from any
// synthetic fixture and are the whole reason the extractors were broken:
//   1. `data` is an ARRAY of rows, not a single object, so `json.data.domain_status`
//      is undefined on it and the status the API sent is silently dropped.
//   2. The row carries its OWN `customer_status` — the domain owner's status —
//      which is a different key from the user endpoint's `user_status`.
const CAPTURED_DOMAIN_STATUS_RESPONSE = {
  data: [
    {
      domain_name: 'flockcloud.tech',
      domain_status: 'active',
      domain_id: 14,
      is_paid: 0,
      partner_id: 1,
      mx_verified: 1,
      created_at: '2019-02-11T07:07:59',
      updated_at: '2026-10-08T11:02:06',
      customer_id: 1288131,
      customer_email: 'anuj@titan.email',
      customer_status: 'active',
      enable_unblock: false,
      cus_enable_unblock: false,
      total_accounts: 1,
      active_accounts: 1,
      deleted_accounts: 0,
      suspended_accounts: 0,
      domain_orders: ['flockcloud.tech'],
      customer_suspension_used_domain: null,
    },
  ],
};

describe('extractAdUserStatus — captured response and array envelopes', () => {
  it('returns an empty string for the captured domain response, which has no user_status', () => {
    // The domain row's customer_status is the domain owner's status, not the
    // email entity's user_status, so this endpoint must never look like a user
    // hit. Asserted explicitly because the captured body has an active-looking
    // status sitting right there that could be mistaken for one.
    assert.equal(rgLib.extractAdUserStatus(CAPTURED_DOMAIN_STATUS_RESPONSE), '');
    assert.equal(rgLib.extractAdUserStatus(CAPTURED_DOMAIN_STATUS_RESPONSE.data[0].user_status), '');
    assert.equal(rgLib.extractAdUserStatus({ data: [CAPTURED_DOMAIN_STATUS_RESPONSE.data[0]] }), '');
  });

  it('reads user_status and userStatus from the first element of a data array', () => {
    assert.equal(rgLib.extractAdUserStatus({ data: [{ user_status: 'Active' }] }), 'Active');
    assert.equal(rgLib.extractAdUserStatus({ data: [{ userStatus: 'Suspended' }] }), 'Suspended');
    // Only the first row counts — the endpoint returns exactly one row today,
    // and a later row must not be mistaken for the record we asked about.
    assert.equal(rgLib.extractAdUserStatus({ data: [{ other: 1 }, { user_status: 'Active' }] }), '');
  });

  it('returns an empty string without throwing when the first data element is not an object', () => {
    for (const bad of ['Active', 42, null, undefined, true]) {
      assert.doesNotThrow(() => rgLib.extractAdUserStatus({ data: [bad] }), String(bad));
      assert.equal(rgLib.extractAdUserStatus({ data: [bad] }), '', String(bad));
    }
  });

  it('returns an empty string without throwing for an empty data array', () => {
    assert.doesNotThrow(() => rgLib.extractAdUserStatus({ data: [] }));
    assert.equal(rgLib.extractAdUserStatus({ data: [] }), '');
    assert.equal(rgLib.extractAdUserStatus({ data: [], result: { user_status: 'Active' } }), 'Active');
  });

  it('still reads a plain-object data envelope', () => {
    assert.equal(rgLib.extractAdUserStatus({ data: { user_status: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdUserStatus({ data: { userStatus: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdUserStatus({ data: 'Active', result: 7 }), '');
  });

  it('prefers top-level, then a data array row, then result', () => {
    const nested = {
      user_status: 'top-snake',
      userStatus: 'top-camel',
      data: [{ user_status: 'data-snake', userStatus: 'data-camel' }],
      result: { user_status: 'result-snake', userStatus: 'result-camel' },
    };
    assert.equal(rgLib.extractAdUserStatus(nested), 'top-snake');
    assert.equal(rgLib.extractAdUserStatus({ ...nested, user_status: undefined }), 'top-camel');
    assert.equal(
      rgLib.extractAdUserStatus({ data: nested.data, result: nested.result }),
      'data-snake'
    );
    assert.equal(rgLib.extractAdUserStatus({ result: nested.result }), 'result-snake');
  });

  it('returns an empty string without throwing for hostile top-level inputs', () => {
    for (const bad of [null, undefined, 'a string', 42, [], {}, { data: 7 }, NaN, true]) {
      assert.doesNotThrow(() => rgLib.extractAdUserStatus(bad), String(bad));
      assert.equal(rgLib.extractAdUserStatus(bad), '', String(bad));
    }
  });
});

describe('extractAdDomainStatus — captured response and array envelopes', () => {
  it('reads domain_status out of the captured response whose data is an array', () => {
    // The production regression: the row was always there, `json.data.domain_status`
    // just never addressed it because data holds a row list.
    assert.equal(rgLib.extractAdDomainStatus(CAPTURED_DOMAIN_STATUS_RESPONSE), 'active');
    assert.equal(rgLib.extractAdDomainStatus({ data: [CAPTURED_DOMAIN_STATUS_RESPONSE.data[0]] }), 'active');
  });

  it('reads domain_status and domainStatus from the first element of a data array', () => {
    assert.equal(rgLib.extractAdDomainStatus({ data: [{ domain_status: 'Active' }] }), 'Active');
    assert.equal(rgLib.extractAdDomainStatus({ data: [{ domainStatus: 'Suspended' }] }), 'Suspended');
    assert.equal(rgLib.extractAdDomainStatus({ data: [{ other: 1 }, { domain_status: 'Active' }] }), '');
  });

  it('returns an empty string without throwing when the first data element is not an object', () => {
    for (const bad of ['active', 42, null, undefined, true]) {
      assert.doesNotThrow(() => rgLib.extractAdDomainStatus({ data: [bad] }), String(bad));
      assert.equal(rgLib.extractAdDomainStatus({ data: [bad] }), '', String(bad));
    }
  });

  it('returns an empty string without throwing for an empty data array', () => {
    assert.doesNotThrow(() => rgLib.extractAdDomainStatus({ data: [] }));
    assert.equal(rgLib.extractAdDomainStatus({ data: [] }), '');
    assert.equal(rgLib.extractAdDomainStatus({ data: [], result: { domain_status: 'Active' } }), 'Active');
  });

  it('still reads a plain-object data envelope', () => {
    assert.equal(rgLib.extractAdDomainStatus({ data: { domain_status: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdDomainStatus({ data: { domainStatus: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdDomainStatus({ data: 'Active', result: 7 }), '');
  });

  it('prefers top-level, then a data array row, then result', () => {
    const nested = {
      domain_status: 'top-snake',
      domainStatus: 'top-camel',
      data: [{ domain_status: 'data-snake', domainStatus: 'data-camel' }],
      result: { domain_status: 'result-snake', domainStatus: 'result-camel' },
    };
    assert.equal(rgLib.extractAdDomainStatus(nested), 'top-snake');
    assert.equal(rgLib.extractAdDomainStatus({ ...nested, domain_status: undefined }), 'top-camel');
    assert.equal(
      rgLib.extractAdDomainStatus({ data: nested.data, result: nested.result }),
      'data-snake'
    );
    assert.equal(rgLib.extractAdDomainStatus({ result: nested.result }), 'result-snake');
  });

  it('returns an empty string without throwing for hostile top-level inputs', () => {
    for (const bad of [null, undefined, 'a string', 42, [], {}, { data: 7 }, NaN, true]) {
      assert.doesNotThrow(() => rgLib.extractAdDomainStatus(bad), String(bad));
      assert.equal(rgLib.extractAdDomainStatus(bad), '', String(bad));
    }
  });
});

// ── extractAdCustomerStatus ───────────────────────────────────────────
describe('extractAdCustomerStatus', () => {
  it('reads customer_status out of the captured domain response', () => {
    // Same body as above: the domain owner's status lives on the domain row,
    // which is the only place the endpoint ever reports it.
    assert.equal(rgLib.extractAdCustomerStatus(CAPTURED_DOMAIN_STATUS_RESPONSE), 'active');
    assert.equal(rgLib.extractAdCustomerStatus({ data: [CAPTURED_DOMAIN_STATUS_RESPONSE.data[0]] }), 'active');
  });

  it('reads the top-level customer_status and customerStatus keys', () => {
    assert.equal(rgLib.extractAdCustomerStatus({ customer_status: 'Active' }), 'Active');
    assert.equal(rgLib.extractAdCustomerStatus({ customerStatus: 'Suspended' }), 'Suspended');
    assert.equal(rgLib.extractAdCustomerStatus({ customer_status: 'active', customerStatus: 'Suspended' }), 'active');
  });

  it('reads customer_status and customerStatus from the first element of a data array', () => {
    assert.equal(rgLib.extractAdCustomerStatus({ data: [{ customer_status: 'Active' }] }), 'Active');
    assert.equal(rgLib.extractAdCustomerStatus({ data: [{ customerStatus: 'Suspended' }] }), 'Suspended');
    assert.equal(rgLib.extractAdCustomerStatus({ data: [{ other: 1 }, { customer_status: 'Active' }] }), '');
  });

  it('still reads a plain-object data envelope and a result envelope', () => {
    assert.equal(rgLib.extractAdCustomerStatus({ data: { customer_status: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdCustomerStatus({ data: { customerStatus: 'Active' } }), 'Active');
    assert.equal(rgLib.extractAdCustomerStatus({ result: { customer_status: 'Suspended' } }), 'Suspended');
    assert.equal(rgLib.extractAdCustomerStatus({ result: { customerStatus: 'Suspended' } }), 'Suspended');
  });

  it('prefers top-level, then a data array row, then result', () => {
    const nested = {
      customer_status: 'top-snake',
      customerStatus: 'top-camel',
      data: [{ customer_status: 'data-snake', customerStatus: 'data-camel' }],
      result: { customer_status: 'result-snake', customerStatus: 'result-camel' },
    };
    assert.equal(rgLib.extractAdCustomerStatus(nested), 'top-snake');
    assert.equal(rgLib.extractAdCustomerStatus({ ...nested, customer_status: undefined }), 'top-camel');
    assert.equal(
      rgLib.extractAdCustomerStatus({ data: nested.data, result: nested.result }),
      'data-snake'
    );
    assert.equal(rgLib.extractAdCustomerStatus({ result: nested.result }), 'result-snake');
  });

  it('returns an empty string without throwing when the first data element is not an object', () => {
    for (const bad of ['active', 42, null, undefined, true]) {
      assert.doesNotThrow(() => rgLib.extractAdCustomerStatus({ data: [bad] }), String(bad));
      assert.equal(rgLib.extractAdCustomerStatus({ data: [bad] }), '', String(bad));
    }
  });

  it('returns an empty string without throwing for an empty data array', () => {
    assert.doesNotThrow(() => rgLib.extractAdCustomerStatus({ data: [] }));
    assert.equal(rgLib.extractAdCustomerStatus({ data: [] }), '');
  });

  it('ignores non-string values at every level and returns an empty string', () => {
    for (const bad of [42, null, undefined, true, { nested: 'Active' }, ['Active'], '']) {
      assert.equal(rgLib.extractAdCustomerStatus({ customer_status: bad }), '', String(bad));
      assert.equal(rgLib.extractAdCustomerStatus({ customerStatus: bad }), '', String(bad));
      assert.equal(rgLib.extractAdCustomerStatus({ data: [{ customer_status: bad }] }), '', String(bad));
      assert.equal(rgLib.extractAdCustomerStatus({ data: [{ customerStatus: bad }] }), '', String(bad));
      assert.equal(rgLib.extractAdCustomerStatus({ result: { customer_status: bad } }), '', String(bad));
      assert.equal(rgLib.extractAdCustomerStatus({ result: { customerStatus: bad } }), '', String(bad));
    }
    // A non-object container hides the nested keys entirely.
    assert.equal(rgLib.extractAdCustomerStatus({ data: 'Active', result: 7 }), '');
  });

  it('does not confuse the domain and user keys for its own', () => {
    assert.equal(rgLib.extractAdCustomerStatus({ domain_status: 'active', user_status: 'Active' }), '');
    assert.equal(rgLib.extractAdCustomerStatus({ data: [{ domain_status: 'active', user_status: 'Active' }] }), '');
  });

  it('returns an empty string without throwing for hostile top-level inputs', () => {
    for (const bad of [null, undefined, 'a string', 42, [], {}, { data: 7 }, NaN, true]) {
      assert.doesNotThrow(() => rgLib.extractAdCustomerStatus(bad), String(bad));
      assert.equal(rgLib.extractAdCustomerStatus(bad), '', String(bad));
    }
    const throwing = { get customer_status() { throw new Error('boom'); } };
    assert.doesNotThrow(() => rgLib.extractAdCustomerStatus(throwing));
    assert.equal(rgLib.extractAdCustomerStatus(throwing), '');
  });

  it('trims the value it returns and treats whitespace-only as absent', () => {
    assert.equal(rgLib.extractAdCustomerStatus({ customer_status: '  Active  ' }), 'Active');
    assert.equal(rgLib.extractAdCustomerStatus({ data: [{ customerStatus: '\tSuspended\n' }] }), 'Suspended');
    assert.equal(rgLib.extractAdCustomerStatus({ customer_status: '   ' }), '');
    assert.equal(rgLib.extractAdCustomerStatus({ data: [] , result: { customer_status: '\n\t' } }), '');
  });
});

describe('captured domain response through both extractors', () => {
  it('reads domain_status and customer_status from the same payload and settles the verdict', () => {
    const payload = CAPTURED_DOMAIN_STATUS_RESPONSE;
    const domainStatus = rgLib.extractAdDomainStatus(payload);
    const customerStatus = rgLib.extractAdCustomerStatus(payload);
    assert.equal(domainStatus, 'active');
    assert.equal(customerStatus, 'active');
    // Both sides present is the only way resolveDomainOutcome confirms — this
    // is the row that used to read '' and leave the domain unknown.
    assert.equal(rgLib.resolveDomainOutcome({ domainStatus, customerStatus }), 'confirmed');
  });

  it('still fails the pair when only the domain row says suspended', () => {
    const payload = { data: [{ domain_status: 'suspended', customer_status: 'active' }] };
    assert.equal(rgLib.resolveDomainOutcome({
      domainStatus: rgLib.extractAdDomainStatus(payload),
      customerStatus: rgLib.extractAdCustomerStatus(payload),
    }), 'failed');
  });
});

// ── resolveDomainOutcome ──────────────────────────────────────────────
describe('resolveDomainOutcome', () => {
  it('covers every row of the customer × domain decision table', () => {
    const v = rgLib.resolveDomainOutcome;
    // Both sides must be Active to confirm.
    assert.equal(v({ customerStatus: 'Active', domainStatus: 'active' }), 'confirmed');
    assert.equal(v({ customerStatus: 'active', domainStatus: 'Active' }), 'confirmed');
    // A suspension on either side fails.
    assert.equal(v({ customerStatus: 'Suspended', domainStatus: 'Suspended' }), 'failed');
    assert.equal(v({ customerStatus: 'Suspended', domainStatus: 'active' }), 'failed');
    assert.equal(v({ customerStatus: 'active', domainStatus: 'Suspended' }), 'failed');
    // Anything short of both-active on both-suspended is unknown.
    assert.equal(v({ customerStatus: 'active', domainStatus: '' }), 'unknown');
    assert.equal(v({ customerStatus: '', domainStatus: 'active' }), 'unknown');
    assert.equal(v({ customerStatus: '', domainStatus: '' }), 'unknown');
    assert.equal(v({ customerStatus: 'garbage', domainStatus: 'active' }), 'unknown');
  });

  it('lets a suspension fail the pair even when the other side is unreadable', () => {
    const v = rgLib.resolveDomainOutcome;
    // Regression: 'failed' must win over 'unknown' — a known suspension is a
    // definitive verdict, not a gap in our knowledge.
    assert.equal(v({ customerStatus: 'Suspended', domainStatus: '' }), 'failed');
    assert.equal(v({ customerStatus: 'Suspended', domainStatus: undefined }), 'failed');
    assert.equal(v({ customerStatus: 'Suspended' }), 'failed');
    assert.equal(v({ customerStatus: '', domainStatus: 'Suspended' }), 'failed');
    assert.equal(v({ domainStatus: 'suspended' }), 'failed');
    assert.equal(v({ customerStatus: 'Suspended', domainStatus: 'garbage' }), 'failed');
  });

  it('compares both inputs case-insensitively and ignores surrounding whitespace', () => {
    const v = rgLib.resolveDomainOutcome;
    assert.equal(v({ customerStatus: ' ACTIVE ', domainStatus: '\tactive\n' }), 'confirmed');
    assert.equal(v({ customerStatus: 'ACTIVE', domainStatus: ' Active ' }), 'confirmed');
    assert.equal(v({ customerStatus: 'SUSPENDED', domainStatus: 'Active' }), 'failed');
    assert.equal(v({ customerStatus: '  active ', domainStatus: ' suspended ' }), 'failed');
    assert.equal(v({ customerStatus: 'status: ACTIVE (verified)', domainStatus: ' Active ' }), 'confirmed');
  });

  it('never treats "inactive" as active', () => {
    const v = rgLib.resolveDomainOutcome;
    assert.equal(v({ customerStatus: 'inactive', domainStatus: 'active' }), 'unknown');
    assert.equal(v({ customerStatus: 'active', domainStatus: 'INACTIVE' }), 'unknown');
    assert.equal(v({ customerStatus: 'inactive', domainStatus: 'inactive' }), 'unknown');
    assert.equal(v({ customerStatus: 'reactivated', domainStatus: 'active' }), 'unknown');
    assert.equal(v({ customerStatus: 'hyperactive', domainStatus: 'Active' }), 'unknown');
    // …but an inactive customer plus a suspended domain still fails outright.
    assert.equal(v({ customerStatus: 'inactive', domainStatus: 'suspended' }), 'failed');
  });

  it('returns unknown for missing, non-object or garbage input without throwing', () => {
    const v = rgLib.resolveDomainOutcome;
    assert.equal(v(), 'unknown');
    assert.equal(v(null), 'unknown');
    assert.equal(v(undefined), 'unknown');
    assert.equal(v('Active'), 'unknown');
    assert.equal(v(42), 'unknown');
    assert.equal(v([]), 'unknown');
    assert.equal(v({}), 'unknown');
    assert.equal(v({ customerStatus: null, domainStatus: 42 }), 'unknown');
    assert.equal(v({ customerStatus: {} }), 'unknown');
    assert.doesNotThrow(() => v());
  });
});

// ── parseAdStatusBody ──────────────────────────────────────────────────
// The 401 body below is the reason this function exists at all.
//
// Provenance: captured with curl against the live AbuseDesk status endpoint
// (GET /api/v1/domains/status/?domain=flockcloud.tech) while the browser
// session was stale. The gunicorn reverse proxy stamped the response with
// `HTTP/1.1 401`, `Server: gunicorn`, `Expired: 1` and
// `Location: https://abusedesk.riva.co/login.html` — yet the body that came
// back with it was a complete, valid, fully populated status document:
//
//     HTTP/1.1 401
//     Server: gunicorn
//     Access-Control-Allow-Origin: https://abusedesk.ops.titan.email
//     Expired: 1
//     Location: https://abusedesk.riva.co/login.html
//
//     {"data": [{"domain_name": "flockcloud.tech", "domain_status": "active", ...
//                "customer_status": "active", ...}]}
//
// The application behind the proxy ran to completion and answered with the
// real data; only the status line lied. So `response.ok` is meaningless on
// this endpoint and every check that did `if (!r.ok) throw` threw away the
// one usable answer it had. These tests pin the corrected rule: judge the
// response by the BODY.
const CAPTURED_401_BODY =
  '{"data": [{"domain_name": "flockcloud.tech", "domain_status": "active", ' +
  '"domain_id": 14, "is_paid": 0, "partner_id": 1, "mx_verified": 1, ' +
  '"created_at": "2019-02-11T07:07:59", "updated_at": "2026-10-08T11:02:06", ' +
  '"customer_id": 1288131, "customer_email": "anuj@titan.email", ' +
  '"customer_status": "active", "enable_unblock": false, "cus_enable_unblock": false, ' +
  '"total_accounts": 1, "active_accounts": 1, "deleted_accounts": 0, ' +
  '"suspended_accounts": 0, "domain_orders": ["flockcloud.tech"], ' +
  '"customer_suspension_used_domain": null}]}';

describe('parseAdStatusBody', () => {
  // Shared shape assertion: a usable result has a payload and no error, an
  // unusable one has neither a payload nor a silent (empty) explanation.
  const assertUnusable = (result, label) => {
    assert.equal(result.json, null, label);
    assert.equal(typeof result.error, 'string', label);
    assert.ok(result.error.length > 0, `${label}: error must not be empty`);
    assert.ok(result.error.length <= 200, `${label}: error must stay under 200 chars`);
  };

  it('reads the real 401-with-valid-body response as usable and extracts both statuses from it', () => {
    // The captured body is the same document as the object fixture above, so
    // this fixture and that one can never silently drift apart.
    assert.deepEqual(JSON.parse(CAPTURED_401_BODY), CAPTURED_DOMAIN_STATUS_RESPONSE);

    const result = rgLib.parseAdStatusBody(CAPTURED_401_BODY);
    assert.notEqual(result.json, null);
    assert.equal(result.error, '');
    // The whole point: a 401 whose body is populated yields the real answer.
    assert.equal(rgLib.extractAdDomainStatus(result.json), 'active');
    assert.equal(rgLib.extractAdCustomerStatus(result.json), 'active');
    assert.equal(
      rgLib.resolveDomainOutcome({
        domainStatus: rgLib.extractAdDomainStatus(result.json),
        customerStatus: rgLib.extractAdCustomerStatus(result.json),
      }),
      'confirmed'
    );
  });

  it('accepts a JSON object and returns that same parsed payload', () => {
    const result = rgLib.parseAdStatusBody('{"domain_status":"active","customer_status":"active"}');
    assert.equal(result.error, '');
    assert.deepEqual(result.json, { domain_status: 'active', customer_status: 'active' });
    // Identity matters to the caller: it hands this object straight to the
    // extractors, so a re-stringify or a lossy copy here would be a regression.
    const again = rgLib.parseAdStatusBody('{"data":{"user_status":"Active"}}');
    assert.equal(again.error, '');
    assert.deepEqual(again.json, { data: { user_status: 'Active' } });
    assert.notEqual(again.json, null);
    assert.equal(rgLib.extractAdUserStatus(again.json), 'Active');
    // An empty object and an object with no status keys are still usable
    // payloads — "no status key" is a verdict for the extractors, not for us.
    assert.deepEqual(rgLib.parseAdStatusBody('{}').json, {});
    assert.equal(rgLib.parseAdStatusBody('{}').error, '');
  });

  it('accepts a JSON array as usable', () => {
    // /api/v1/domains/status/ wraps its row list in an array, so an array body
    // is the endpoint's normal shape and must not be mistaken for a primitive.
    const result = rgLib.parseAdStatusBody('[{"domain_status":"active"}]');
    assert.equal(result.error, '');
    assert.ok(Array.isArray(result.json));
    assert.equal(result.json.length, 1);
    assert.equal(rgLib.extractAdDomainStatus({ data: result.json }), 'active');

    const empty = rgLib.parseAdStatusBody('[]');
    assert.equal(empty.error, '');
    assert.deepEqual(empty.json, []);

    const rows = [{ domain_status: 'active' }];
    assert.deepEqual(rgLib.parseAdStatusBody(JSON.stringify(rows)).json, rows);
  });

  it('rejects empty and whitespace-only bodies', () => {
    for (const blank of ['', '   ', '\n\t ', '\t', '\r\n', '  \n\t\r  ']) {
      assertUnusable(rgLib.parseAdStatusBody(blank), JSON.stringify(blank));
    }
  });

  it('rejects a body that is not JSON at all', () => {
    assertUnusable(rgLib.parseAdStatusBody('not json at all'), 'not json at all');
    assertUnusable(rgLib.parseAdStatusBody('{"data": '), 'truncated object');
    assertUnusable(rgLib.parseAdStatusBody("{'data': 'active'}"), 'single quotes');
  });

  it('rejects an HTML login page body', () => {
    // What a genuinely unauthenticated response looks like once the proxy
    // stops passing the real document through: not JSON, hence unusable.
    assertUnusable(
      rgLib.parseAdStatusBody('<html><body>Please log in</body></html>'),
      'login page'
    );
  });

  it('rejects the JSON literal null', () => {
    const result = rgLib.parseAdStatusBody('null');
    assertUnusable(result, 'null literal');
    assert.equal(result.json, null);
  });

  it('rejects JSON primitives that parse but carry no payload', () => {
    for (const primitive of ['42', '"str"', 'true', 'false', '0', '"hello"', '3.14']) {
      assertUnusable(rgLib.parseAdStatusBody(primitive), primitive);
    }
  });

  it('rejects non-string inputs without throwing', () => {
    for (const bad of [null, undefined, 42, {}, [], true, false, NaN, () => {}, Symbol('x')]) {
      let result;
      assert.doesNotThrow(() => { result = rgLib.parseAdStatusBody(bad); }, String(bad));
      assertUnusable(result, String(bad));
    }
    // No argument at all is the same case as undefined.
    assertUnusable(rgLib.parseAdStatusBody(), 'no argument');
  });

  it('describes a non-string input with a non-empty string error that never echoes the value', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      const { error } = rgLib.parseAdStatusBody(bad);
      assert.equal(typeof error, 'string');
      assert.ok(error.length > 0);
      assert.ok(error.length <= 200);
    }
  });

  it('never throws for inputs whose toString or valueOf misbehaves', () => {
    const hostile = {
      toString() { throw new Error('boom'); },
      valueOf() { throw new Error('boom'); },
    };
    assert.doesNotThrow(() => rgLib.parseAdStatusBody(hostile));
    assertUnusable(rgLib.parseAdStatusBody(hostile), 'throwing toString/valueOf');

    // A getter that throws is the same hazard one layer down.
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'data', { get() { throw new Error('boom'); } });
    assertUnusable(rgLib.parseAdStatusBody(throwingGetter), 'throwing getter');

    const cyclic = { self: null };
    cyclic.self = cyclic;
    assertUnusable(rgLib.parseAdStatusBody(cyclic), 'cyclic object');
  });

  it('caps the error length instead of echoing a huge unparseable body', () => {
    const garbage = 'x'.repeat(10000);
    const result = rgLib.parseAdStatusBody(garbage);
    assertUnusable(result, '10k garbage');
    assert.ok(result.error.length <= 200);
    // Truncated, not re-sent: at most ~120 characters of the body may appear.
    assert.ok(!result.error.includes(garbage));
    assert.ok(!result.error.includes('x'.repeat(200)));

    // A long HTML page is the same shape of problem.
    const page = '<html><body>' + 'Please log in. '.repeat(2000) + '</body></html>';
    const html = rgLib.parseAdStatusBody(page);
    assertUnusable(html, 'long html page');
    assert.ok(html.error.length <= 200);
  });
});

// -- isEmptyAdStatusPayload ---------------------------------------------------
//
// The AbuseDesk status API answers a request for a domain it does not know �
// or for a WRONG REGION � with a perfectly valid but EMPTY body:
//
//   {"data": []}
//
// That parses fine, so nothing in the read path treats it as an error, and
// the extractors simply find no status key and return ''. The result is a
// bare "Unknown" in the UI with no clue why. Detecting the empty result
// lets the panel say what actually happened.

describe('isEmptyAdStatusPayload', () => {
  it('is true for an empty data array', () => {
    assert.equal(rgLib.isEmptyAdStatusPayload({ data: [] }), true);
  });

  it('is false when the data array has a row', () => {
    assert.equal(rgLib.isEmptyAdStatusPayload({ data: [{ domain_status: 'active' }] }), false);
  });

  it('is false when there is no data array at all', () => {
    assert.equal(rgLib.isEmptyAdStatusPayload({}), false);
    assert.equal(rgLib.isEmptyAdStatusPayload({ data: null }), false);
    assert.equal(rgLib.isEmptyAdStatusPayload({ domain_status: 'active' }), false);
  });

  it('is false for a non-object payload', () => {
    assert.equal(rgLib.isEmptyAdStatusPayload(null), false);
    assert.equal(rgLib.isEmptyAdStatusPayload(undefined), false);
    assert.equal(rgLib.isEmptyAdStatusPayload('data'), false);
  });
});
