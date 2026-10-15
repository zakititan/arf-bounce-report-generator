// ad-helpers.js — Pure shared logic for AbuseDesk unsuspend automation.
// Classic script, no imports/exports. No browser dependencies: pure functions
// taking strings/objects only. Content script (content-abusedesk.js) reads via
// globalThis.AD_HELPERS; node tests import this file for its side effect.
(function () {
  var REASON_TTL_MS = 90000;
  var ERROR_POLL_TIMEOUT_MS = 5000;
  var ERROR_POLL_INTERVAL_MS = 250;

  function normalizeButtonLabel(text) {
    var s = text == null ? '' : String(text);
    return s.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isUnblockLabel(text) {
    return normalizeButtonLabel(text).replace(/ /g, '') === 'unblock';
  }

  function isUsableButton(info) {
    if (!info || typeof info !== 'object') return false;
    if (info.disabled) return false;
    var aria = info.ariaDisabled;
    if (aria === true) return false;
    if (typeof aria === 'string' && aria.trim().toLowerCase() === 'true') return false;
    if (info.hidden) return false;
    if (info.visible === false) return false;
    return true;
  }

  function isUnblockButtonCandidate(info) {
    if (!info || typeof info !== 'object') return false;
    return isUnblockLabel(info.text) && isUsableButton(info);
  }

  function classifyNoUnblockOutcome(userStatus) {
    var s = userStatus == null ? '' : String(userStatus);
    return s.trim().toLowerCase() === 'active' ? 'confirmed' : 'failed';
  }

  function createSharedReasonKey(requestId) {
    return 'unsuspendReason:' + (requestId || 'legacy');
  }

  function createPerAccountReasonKey(requestId, account) {
    return 'unsuspendReason:' + (requestId || 'legacy') + ':' + String(account == null ? '' : account).trim().toLowerCase();
  }

  function getReasonLookupKeys(requestId, account) {
    return [createPerAccountReasonKey(requestId, account), createSharedReasonKey(requestId)];
  }

  function isFreshReasonRecord(record, now) {
    var t = typeof now === 'number' ? now : Date.now();
    if (!record || typeof record.reason !== 'string' || record.reason.length === 0) return false;
    if (typeof record.ts !== 'number' || !isFinite(record.ts)) return false;
    return t - record.ts <= REASON_TTL_MS;
  }

  function selectFreshReason(perAccountRec, sharedRec, now) {
    var t = typeof now === 'number' ? now : Date.now();
    if (isFreshReasonRecord(perAccountRec, t)) return { reason: perAccountRec.reason, source: 'per-account' };
    if (isFreshReasonRecord(sharedRec, t)) return { reason: sharedRec.reason, source: 'shared' };
    return null;
  }

  function buildMissingReasonCause(account) {
    return 'No fresh unsuspend reason for ' + (account || 'unknown') + ' (checked per-account and shared keys, 90s TTL)';
  }

  function isVisibleErrorRecord(info) {
    if (!info || typeof info !== 'object') return false;
    if (!info.visible) return false;
    return typeof info.text === 'string' && info.text.trim().length > 0;
  }

  function selectPreferredTextarea(scoped, fallback) {
    return scoped || fallback || null;
  }

  // Domain entities (bare domains, no '@') verify in a fresh tab; email
  // entities keep the reload-in-place flow (the AD page is janky on reload
  // for domain lookups).
  function isDomainEntity(account) {
    return typeof account === 'string' && account.length > 0 && account.indexOf('@') === -1;
  }

  // The Abuse Desk renders its results table progressively, so the first
  // non-empty badge read can be a stale pre-save value. This polls until the
  // same non-empty value shows up `consecutive` times in a row, and resolves
  // '' if the budget runs out before the badge settles.
  async function stableBadgeRead(read, options) {
    if (typeof read !== 'function') return '';

    var opts = options || {};
    var consecutive = typeof opts.consecutive === 'number' && opts.consecutive > 0
      ? Math.floor(opts.consecutive)
      : 2;
    var gapMs = typeof opts.gapMs === 'number' && opts.gapMs > 0 ? opts.gapMs : 800;
    var timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs >= 0 ? opts.timeoutMs : 10000;
    var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var sleep = typeof opts.sleep === 'function'
      ? opts.sleep
      : function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    // Hard stop so a frozen/injected clock can never spin forever.
    var maxIterations = Math.max(1, Math.ceil(timeoutMs / gapMs) + 1);

    var start = now();
    var pending = '';
    var streak = 0;
    var iterations = 0;

    while (iterations < maxIterations) {
      if (now() - start > timeoutMs) break;
      iterations += 1;

      var raw = read();
      var value = raw == null ? '' : String(raw);

      if (!value) {
        pending = '';
        streak = 0;
      } else if (value === pending) {
        streak += 1;
        if (streak >= consecutive) return value;
      } else {
        pending = value;
        streak = 1;
      }

      await sleep(gapMs);
    }

    return '';
  }

  var api = {
    REASON_TTL_MS: REASON_TTL_MS,
    ERROR_POLL_TIMEOUT_MS: ERROR_POLL_TIMEOUT_MS,
    ERROR_POLL_INTERVAL_MS: ERROR_POLL_INTERVAL_MS,
    normalizeButtonLabel: normalizeButtonLabel,
    isUnblockLabel: isUnblockLabel,
    isUsableButton: isUsableButton,
    isUnblockButtonCandidate: isUnblockButtonCandidate,
    classifyNoUnblockOutcome: classifyNoUnblockOutcome,
    createSharedReasonKey: createSharedReasonKey,
    createPerAccountReasonKey: createPerAccountReasonKey,
    getReasonLookupKeys: getReasonLookupKeys,
    isFreshReasonRecord: isFreshReasonRecord,
    selectFreshReason: selectFreshReason,
    buildMissingReasonCause: buildMissingReasonCause,
    isVisibleErrorRecord: isVisibleErrorRecord,
    selectPreferredTextarea: selectPreferredTextarea,
    isDomainEntity: isDomainEntity,
    stableBadgeRead: stableBadgeRead,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.AD_HELPERS = api;
  }
  if (typeof window !== 'undefined') {
    window.AD_HELPERS = api;
  }
})();
