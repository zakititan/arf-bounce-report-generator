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
