import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/ad-helpers.js';

const {
  REASON_TTL_MS,
  ERROR_POLL_TIMEOUT_MS,
  ERROR_POLL_INTERVAL_MS,
  normalizeButtonLabel,
  isUnblockLabel,
  isUsableButton,
  isUnblockButtonCandidate,
  classifyNoUnblockOutcome,
  createSharedReasonKey,
  createPerAccountReasonKey,
  getReasonLookupKeys,
  isFreshReasonRecord,
  selectFreshReason,
  buildMissingReasonCause,
  isVisibleErrorRecord,
  selectPreferredTextarea,
} = globalThis.AD_HELPERS;

// ── tolerant unblock matching ─────────────────────────────────────────
describe('normalizeButtonLabel', () => {
  it('lowercases and trims exact matches', () => {
    assert.equal(normalizeButtonLabel('Unblock'), 'unblock');
    assert.equal(normalizeButtonLabel('  UNBLOCK  '), 'unblock');
  });

  it('collapses internal whitespace to a single space', () => {
    assert.equal(normalizeButtonLabel('Un\n\t  block '), 'un block');
  });

  it('returns empty string for nullish input', () => {
    assert.equal(normalizeButtonLabel(null), '');
    assert.equal(normalizeButtonLabel(undefined), '');
  });
});

describe('isUnblockLabel', () => {
  it('matches exact Unblock text', () => {
    assert.equal(isUnblockLabel('Unblock'), true);
  });

  it('matches case-insensitively with surrounding whitespace', () => {
    assert.equal(isUnblockLabel('  unblock  '), true);
    assert.equal(isUnblockLabel('UNBLOCK'), true);
    assert.equal(isUnblockLabel('\nUnBlock\t'), true);
  });

  it('matches when whitespace splits the word', () => {
    assert.equal(isUnblockLabel('Un block'), true);
    assert.equal(isUnblockLabel('Un\nblock'), true);
  });

  it('rejects non-unblock labels', () => {
    assert.equal(isUnblockLabel('Block'), false);
    assert.equal(isUnblockLabel('Unblock now'), false);
    assert.equal(isUnblockLabel(''), false);
    assert.equal(isUnblockLabel(null), false);
  });
});

describe('isUsableButton', () => {
  it('treats an enabled visible button as usable', () => {
    assert.equal(isUsableButton({ disabled: false, hidden: false }), true);
  });

  it('skips disabled buttons', () => {
    assert.equal(isUsableButton({ disabled: true, hidden: false }), false);
  });

  it('skips aria-disabled buttons', () => {
    assert.equal(isUsableButton({ disabled: false, ariaDisabled: true }), false);
    assert.equal(isUsableButton({ disabled: false, ariaDisabled: 'true' }), false);
  });

  it('skips hidden or invisible buttons', () => {
    assert.equal(isUsableButton({ disabled: false, hidden: true }), false);
    assert.equal(isUsableButton({ disabled: false, hidden: false, visible: false }), false);
  });
});

describe('isUnblockButtonCandidate', () => {
  it('accepts a tolerant unblock label on a usable button', () => {
    assert.equal(isUnblockButtonCandidate({ text: '  UNBLOCK ', disabled: false, hidden: false }), true);
  });

  it('rejects disabled or hidden buttons even with matching text', () => {
    assert.equal(isUnblockButtonCandidate({ text: 'Unblock', disabled: true, hidden: false }), false);
    assert.equal(isUnblockButtonCandidate({ text: 'Unblock', disabled: false, hidden: true }), false);
  });

  it('rejects usable buttons with non-matching text', () => {
    assert.equal(isUnblockButtonCandidate({ text: 'Block', disabled: false, hidden: false }), false);
  });
});

describe('classifyNoUnblockOutcome', () => {
  it('reports confirmed when USER STATUS badge reads Active', () => {
    assert.equal(classifyNoUnblockOutcome('Active'), 'confirmed');
    assert.equal(classifyNoUnblockOutcome('active'), 'confirmed');
    assert.equal(classifyNoUnblockOutcome('  ACTIVE  '), 'confirmed');
  });

  it('reports failed for Suspended, unknown or missing status', () => {
    assert.equal(classifyNoUnblockOutcome('Suspended'), 'failed');
    assert.equal(classifyNoUnblockOutcome(''), 'failed');
    assert.equal(classifyNoUnblockOutcome(null), 'failed');
  });
});

// ── per-account reason keys ───────────────────────────────────────────
describe('reason key builders', () => {
  it('builds the shared per-request key', () => {
    assert.equal(createSharedReasonKey('req123'), 'unsuspendReason:req123');
  });

  it('falls back to legacy for missing requestId', () => {
    assert.equal(createSharedReasonKey(''), 'unsuspendReason:legacy');
    assert.equal(createPerAccountReasonKey('', 'a@x.com'), 'unsuspendReason:legacy:a@x.com');
  });

  it('builds the per-account key with a lowercased account', () => {
    assert.equal(createPerAccountReasonKey('req123', 'User@Example.COM'), 'unsuspendReason:req123:user@example.com');
  });

  it('trims whitespace around the account in the per-account key', () => {
    assert.equal(createPerAccountReasonKey('req123', '  A@X.com  '), 'unsuspendReason:req123:a@x.com');
  });

  it('returns per-account key first, then shared key', () => {
    assert.deepEqual(getReasonLookupKeys('req123', 'A@X.com'), [
      'unsuspendReason:req123:a@x.com',
      'unsuspendReason:req123',
    ]);
  });
});

describe('isFreshReasonRecord', () => {
  const now = 1700000000000;

  it('returns true within the TTL window', () => {
    assert.equal(isFreshReasonRecord({ reason: 'r', ts: now - 1000 }, now), true);
  });

  it('returns true exactly at the TTL boundary', () => {
    assert.equal(isFreshReasonRecord({ reason: 'r', ts: now - REASON_TTL_MS }, now), true);
  });

  it('returns false past the TTL', () => {
    assert.equal(isFreshReasonRecord({ reason: 'r', ts: now - REASON_TTL_MS - 1 }, now), false);
  });

  it('returns false for empty reason or bad ts', () => {
    assert.equal(isFreshReasonRecord({ reason: '', ts: now - 1000 }, now), false);
    assert.equal(isFreshReasonRecord({ reason: 'r' }, now), false);
    assert.equal(isFreshReasonRecord(null, now), false);
  });
});

describe('selectFreshReason', () => {
  const now = 1700000000000;
  const freshPer = { reason: 'per', ts: now - 1000 };
  const freshShared = { reason: 'shared', ts: now - 1000 };
  const stale = { reason: 'old', ts: now - REASON_TTL_MS - 1000 };

  it('prefers the fresh per-account record', () => {
    assert.deepEqual(selectFreshReason(freshPer, freshShared, now), { reason: 'per', source: 'per-account' });
  });

  it('falls back to the shared record when per-account is stale', () => {
    assert.deepEqual(selectFreshReason(stale, freshShared, now), { reason: 'shared', source: 'shared' });
    assert.deepEqual(selectFreshReason(null, freshShared, now), { reason: 'shared', source: 'shared' });
  });

  it('returns null when neither record is fresh', () => {
    assert.equal(selectFreshReason(stale, stale, now), null);
    assert.equal(selectFreshReason(null, null, now), null);
  });
});

describe('buildMissingReasonCause', () => {
  it('mentions the account and both key scopes', () => {
    const cause = buildMissingReasonCause('a@x.com');
    assert.ok(cause.includes('a@x.com'));
    assert.ok(cause.includes('per-account'));
    assert.ok(cause.includes('shared'));
  });
});

// ── scoped fields + error watch ───────────────────────────────────────
describe('error poll constants', () => {
  it('polls up to ~5s for slow networks', () => {
    assert.equal(ERROR_POLL_TIMEOUT_MS, 5000);
    assert.ok(ERROR_POLL_INTERVAL_MS > 0 && ERROR_POLL_INTERVAL_MS <= 500);
  });

  it('exports REASON_TTL_MS of 90000', () => {
    assert.equal(REASON_TTL_MS, 90000);
    assert.equal(globalThis.AD_HELPERS.REASON_TTL_MS, 90000);
  });
});

describe('isVisibleErrorRecord', () => {
  it('counts visible non-empty errors', () => {
    assert.equal(isVisibleErrorRecord({ text: 'Something failed', visible: true }), true);
  });

  it('ignores hidden or blank errors', () => {
    assert.equal(isVisibleErrorRecord({ text: '  ', visible: true }), false);
    assert.equal(isVisibleErrorRecord({ text: 'boom', visible: false }), false);
    assert.equal(isVisibleErrorRecord(null), false);
  });
});

describe('selectPreferredTextarea', () => {
  it('prefers the dialog-scoped textarea over document scope', () => {
    const scoped = { id: 'scoped' };
    const fallback = { id: 'fallback' };
    assert.equal(selectPreferredTextarea(scoped, fallback), scoped);
  });

  it('falls back to document scope when no scoped textarea exists', () => {
    const fallback = { id: 'fallback' };
    assert.equal(selectPreferredTextarea(null, fallback), fallback);
    assert.equal(selectPreferredTextarea(null, null), null);
  });
});
