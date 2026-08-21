import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REASON_TTL_MS,
  JIRA_DONE_TRANSITION_ID,
  analyzeHistory,
  buildJiraIssueBody,
  extractImagesRegex,
  buildFallbackJiraUrl,
  isReasonFresh,
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
