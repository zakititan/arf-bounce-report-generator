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
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.AD_HELPERS = api;
  }
  if (typeof window !== 'undefined') {
    window.AD_HELPERS = api;
  }
})();
