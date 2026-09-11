(function () {
  var requestId = new URLSearchParams(window.location.search).get('rgRequestId') || 'legacy';
  function log(msg) { console.log('[Report→AbuseDesk] ' + msg); }

  // Pure helpers live in extension/ad-helpers.js (no browser deps). The
  // content script is a classic script (no imports), so helpers are read as
  // globals when present, with inline fallbacks mirroring them until the
  // manifest loads ad-helpers.js before this file.
  function adHelpers() {
    try { if (typeof AD_HELPERS !== 'undefined' && AD_HELPERS) return AD_HELPERS; } catch (e) { /* not loaded yet */ }
    try { if (typeof window !== 'undefined' && window.AD_HELPERS) return window.AD_HELPERS; } catch (e) { /* noop */ }
    try { if (typeof globalThis !== 'undefined' && globalThis.AD_HELPERS) return globalThis.AD_HELPERS; } catch (e) { /* noop */ }
    return null;
  }

  function showToast(message) {
    var existing = document.getElementById('rg-unsuspend-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'rg-unsuspend-toast';
    toast.textContent = message;
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var bg = dark ? '#1a1a2e' : '#ffffff';
    var fg = dark ? '#e0e0e0' : '#1f2328';
    var shadow = dark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.18)';
    toast.style.cssText =
      'position:fixed;bottom:24px;right:24px;background:' + bg + ';color:' + fg + ';' +
      'padding:12px 20px;border-radius:8px;font-size:13px;font-family:system-ui,sans-serif;' +
      'z-index:999999;box-shadow:0 4px 12px ' + shadow + ';transition:opacity 300ms ease;';
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 300);
    }, 6000);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(find, timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var check = function () {
        var el = find();
        if (el) { resolve(el); return; }
        if (Date.now() - start > timeoutMs) { resolve(null); return; }
        setTimeout(check, 300);
      };
      check();
    });
  }

  function simulateClick(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.click();
  }

  // Tell the service worker this tab's automation run ended. The worker only
  // closes tabs it opened itself (tracked by tab id); manual visits are ignored.
  function reportDone(result) {
    var r = result || {};
    try {
      chrome.runtime.sendMessage({
        action: 'ad-tab-done',
        data: {
          failed: r.outcome === 'failed',
          outcome: r.outcome || 'unknown',
          account: r.account || '',
          requestId: requestId,
          cause: r.cause || ''
        }
      });
    } catch (e) { /* extension context gone — nothing to do */ }
  }

  function findUnblockButton() {
    var h = adHelpers();
    var toInfo = function (el) {
      return {
        text: (el && el.textContent) || '',
        disabled: !!(el && el.disabled),
        ariaDisabled: el && el.getAttribute ? el.getAttribute('aria-disabled') : null,
        hidden: !!(el && (el.hidden || el.offsetParent === null)),
        visible: !!(el && el.offsetParent !== null)
      };
    };
    var isMatch = function (text) {
      if (h && h.isUnblockLabel) return h.isUnblockLabel(text);
      var s = (text == null ? '' : String(text)).replace(/\s+/g, ' ').trim().toLowerCase();
      return s.replace(/ /g, '') === 'unblock';
    };
    var isUsable = function (el) {
      if (!el) return false;
      if (h && h.isUnblockButtonCandidate) return h.isUnblockButtonCandidate(toInfo(el));
      return isMatch(el.textContent) && !el.disabled && el.offsetParent !== null && !el.hidden &&
        (!el.getAttribute || String(el.getAttribute('aria-disabled') || '').toLowerCase() !== 'true');
    };
    var idEl = document.getElementById('unblockBtn');
    if (idEl && isUsable(idEl)) return idEl;
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (isUsable(btns[i])) return btns[i];
    }
    return null;
  }

  function detectError() {
    var err = document.querySelector('.error, .alert-danger, [class*="error"]');
    return (err && err.offsetParent !== null && (err.textContent || '').trim()) ? err : null;
  }

  function readBadgeStatus(labelText) {
    var fields = document.querySelectorAll('.bu-field');
    for (var i = 0; i < fields.length; i++) {
      var label = fields[i].querySelector('.bu-field-label');
      if (!label || (label.textContent || '').trim().toLowerCase() !== labelText) continue;
      var value = fields[i].querySelector('.bu-field-value') || fields[i];
      var t = (value.textContent || '').trim().toLowerCase();
      if (t.indexOf('suspend') !== -1) return 'Suspended';
      if (t.indexOf('active') !== -1) return 'Active';
    }
    return '';
  }

  // Authoritative status check: the USER STATUS badge on the Blocked Users
  // page. The page does not live-update after unsuspension, so this is read
  // AFTER a reload (see verification flow below).
  //
  // Actual AD DOM (verified via DevTools):
  //   div.bu-field
  //     ├─ div.bu-field-label   → "User Status"  (Title Case; CSS uppercases it)
  //     └─ div.bu-field-value
  //          └─ span.bu-badge.bu-badge-active → "active"   (lowercase)
  function readUserStatus() { return readBadgeStatus('user status'); }
  function readDomainStatus() { return readBadgeStatus('domain status'); }

  // Plan B: the AD page renders the badge from this API — ask the service
  // worker (which has host permission) to fetch it directly.
  function fetchStatusViaApi(account) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ action: 'ad-user-status', data: { account: account } }, function (resp) {
          if (chrome.runtime.lastError) { void chrome.runtime.lastError; resolve(''); return; }
          resolve(resp && resp.success ? (resp.status || '') : '');
        });
      } catch (e) { resolve(''); }
    });
  }

  function reasonKey() {
    var h = adHelpers();
    if (h && h.createSharedReasonKey) return h.createSharedReasonKey(requestId);
    return 'unsuspendReason:' + requestId;
  }
  function perAccountReasonKey(account) {
    var h = adHelpers();
    if (h && h.createPerAccountReasonKey) return h.createPerAccountReasonKey(requestId, account);
    return 'unsuspendReason:' + requestId + ':' + String(account == null ? '' : account).trim().toLowerCase();
  }
  function isFreshReason(rec, now) {
    var h = adHelpers();
    if (h && h.isFreshReasonRecord) return h.isFreshReasonRecord(rec, now);
    return rec && typeof rec === 'object' && typeof rec.reason === 'string' && rec.reason !== '' &&
      typeof rec.ts === 'number' && ((typeof now === 'number' ? now : Date.now()) - rec.ts) <= 90000;
  }
  function findReasonTextarea() {
    var scoped = null;
    try {
      scoped = document.querySelector('[role="dialog"] textarea, .modal textarea, form textarea');
      if (!scoped) {
        var container = document.querySelector('[role="dialog"], .modal, [class*="modal"], form');
        if (container) scoped = container.querySelector('textarea');
      }
    } catch (e) { scoped = null; }
    var fallback = null;
    try { fallback = document.querySelector('textarea'); } catch (e) { fallback = null; }
    var h = adHelpers();
    if (h && h.selectPreferredTextarea) return h.selectPreferredTextarea(scoped, fallback);
    return scoped || fallback || null;
  }
  function errorPollTimeoutMs() {
    var h = adHelpers();
    if (h && typeof h.ERROR_POLL_TIMEOUT_MS === 'number') return h.ERROR_POLL_TIMEOUT_MS;
    return 5000;
  }
  function verifyKey(account) { return 'unsuspendVerify:' + requestId + ':' + encodeURIComponent(account); }

  // A marker is scoped to both the run and account. Individual storage keys
  // avoid read-modify-write collisions between concurrent tabs.
  function setVerifyEntry(account, attempt, cb) {
    chrome.storage.local.set({ [verifyKey(account)]: { ts: Date.now(), attempt: attempt || 1 } }, function () {
      // Fail closed: without a persisted marker the post-reload load can't
      // enter verification mode, so reloading would re-run the automation
      // forever. Surface the failure instead of looping.
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        log('Verify marker write failed: ' + (chrome.runtime.lastError.message || 'storage unavailable'));
        showToast('\u274C Could not save verification state for ' + account + ' — storage unavailable');
        reportDone({ outcome: 'failed', account: account, cause: 'verify marker write failed' });
        return;
      }
      if (cb) cb();
    });
  }
  function consumeVerifyEntry(account, cb) {
    chrome.storage.local.get(verifyKey(account), function (result) {
      var entry = result[verifyKey(account)];
      var ts = entry && typeof entry.ts === 'number' ? entry.ts : null;
      if (cb) cb(ts);
      if (entry) chrome.storage.local.remove(verifyKey(account), function () {});
    });
  }

  // Reload the page and read the USER STATUS badge — the only trustworthy
  // signal that the unsuspension actually took effect.
  function isDomainEntity(account) {
    return account && account.indexOf('@') === -1;
  }

  async function verifyByReload(account, attempt) {
    var status = await waitFor(readUserStatus, 10000);
    if (!status) status = await fetchStatusViaApi(account);
    var domainStatus = '';
    if (isDomainEntity(account)) {
      domainStatus = await waitFor(readDomainStatus, 5000);
    }
    var outcome;

    function isActive(s) { return s === 'Active'; }

    if (isDomainEntity(account)) {
      // Domain entities require BOTH customer status and domain status to be active.
      if (isActive(status) && isActive(domainStatus)) {
        outcome = 'confirmed';
        showToast('\u2705 Unsuspension verified for ' + account + ' — customer: Active, domain: Active');
      } else if (status === 'Suspended' || domainStatus === 'Suspended') {
        outcome = 'failed';
        var parts = [];
        if (status) parts.push('customer: ' + status);
        if (domainStatus) parts.push('domain: ' + domainStatus);
        showToast('\u274C Unsuspension failed for ' + account + ' — ' + (parts.join(', ') || 'status unknown'));
      } else if ((!status || !domainStatus) && (!attempt || attempt < 2)) {
        log('Could not read full status for ' + account + ' on attempt ' + (attempt || 1) + ' — retrying');
        setVerifyEntry(account, 2, function () {
          showToast('Retrying verification for ' + account + '…');
          setTimeout(function () { location.reload(); }, 1500);
        });
        return;
      } else {
        outcome = 'unknown';
        showToast('\u26A0\uFE0F Could not read status for ' + account + ' — please check manually');
      }
    } else {
      // User entities: only customer status matters.
      if (isActive(status)) {
        outcome = 'confirmed';
        showToast('\u2705 Unsuspension verified for ' + account + ' — user status: Active');
      } else if (status === 'Suspended') {
        outcome = 'failed';
        showToast('\u274C Unsuspension failed for ' + account + ' — user status still Suspended');
      } else if (!status && (!attempt || attempt < 2)) {
        log('Could not read status for ' + account + ' on attempt ' + (attempt || 1) + ' — retrying');
        setVerifyEntry(account, 2, function () {
          showToast('Retrying verification for ' + account + '…');
          setTimeout(function () { location.reload(); }, 1500);
        });
        return;
      } else {
        outcome = 'unknown';
        showToast('\u26A0\uFE0F Could not read user status for ' + account + ' — please check manually');
      }
    }

    log('Verification for ' + account + ': ' + outcome + (status ? ' (customer:' + status + ')' : '') + (domainStatus ? ' (domain:' + domainStatus + ')' : ''));
    reportDone({ outcome: outcome, account: account });
  }

  async function run() {
    var earlyEntity = new URLSearchParams(window.location.search).get('entity') || '';
    var earlyHelpers = adHelpers();
    var reasonKeys = earlyHelpers && earlyHelpers.getReasonLookupKeys
      ? earlyHelpers.getReasonLookupKeys(requestId, earlyEntity)
      : [perAccountReasonKey(earlyEntity), reasonKey()];
    chrome.storage.local.get([reasonKeys[0], reasonKeys[1], verifyKey(earlyEntity)], async function (result) {
      var account = new URLSearchParams(window.location.search).get('entity');
      if (!account) { log('No entity in URL — skipping automation'); return; }

      // ── Verification mode: this load was triggered by our own reload ──
      var vEntry = result[verifyKey(account)];
      var vTs = vEntry && typeof vEntry.ts === 'number' ? vEntry.ts : null;
      var vAttempt = vEntry && typeof vEntry.attempt === 'number' ? vEntry.attempt : 1;
      if (typeof vTs === 'number' && (Date.now() - vTs) <= 90000) {
        if (vAttempt >= 2) consumeVerifyEntry(account, function () {});
        log('Verification mode for ' + account + ' (attempt ' + vAttempt + ')');
        await sleep(500); // let the results table finish rendering
        await verifyByReload(account, vAttempt);
        return;
      }

      // ── Automation mode ──
      // Per-account key first (unsuspendReason:{requestId}:{lowercased-account}),
      // then the shared per-request key. Slow bulks expire later tabs past the
      // 90s TTL — never hang the run: always reportDone, even with no reason.
      var hReason = adHelpers();
      var perRec = result[perAccountReasonKey(account)];
      var sharedRec = result[reasonKey()];
      var selected = hReason && hReason.selectFreshReason
        ? hReason.selectFreshReason(perRec, sharedRec)
        : (isFreshReason(perRec) ? { reason: perRec.reason, source: 'per-account' }
          : (isFreshReason(sharedRec) ? { reason: sharedRec.reason, source: 'shared' } : null));
      if (!selected) {
        var cause = hReason && hReason.buildMissingReasonCause
          ? hReason.buildMissingReasonCause(account)
          : ('No fresh unsuspend reason for ' + account + ' (checked per-account and shared keys, 90s TTL)');
        log(cause);
        showToast('\u26A0\uFE0F ' + cause);
        reportDone({ outcome: 'unverified', account: account, cause: cause });
        return;
      }
      var reason = selected.reason;

      log('Starting unsuspend automation for ' + account);

      var unblockBtn = await waitFor(findUnblockButton, 10000);
      if (!unblockBtn) {
        // No Unblock button: the account may already be Active (no action
        // needed) — report confirmed instead of failed in that case.
        var badgeStatus = readUserStatus();
        var hMissing = adHelpers();
        var missingOutcome = hMissing && hMissing.classifyNoUnblockOutcome
          ? hMissing.classifyNoUnblockOutcome(badgeStatus)
          : (String(badgeStatus || '').trim().toLowerCase() === 'active' ? 'confirmed' : 'failed');
        if (missingOutcome === 'confirmed') {
          log('No Unblock button but USER STATUS is Active for ' + account + ' — already unsuspended');
          showToast('\u2705 Already Active for ' + account + ' — no Unblock needed');
        } else {
          log('Unblock button not found');
          showToast('Unblock button not found for ' + account);
        }
        reportDone({ outcome: missingOutcome, account: account });
        return;
      }
      log('Clicking Unblock for ' + account);
      simulateClick(unblockBtn);

      var textarea = await waitFor(findReasonTextarea, 5000);
      if (!textarea) {
        log('Textarea not found');
        showToast('Textarea not found for ' + account);
        reportDone({ outcome: 'failed', account: account });
        return;
      }
      log('Pasting reason for ' + account);
      textarea.focus();
      textarea.value = reason;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      var saveBtn = await waitFor(function () {
        var el = document.getElementById('submitBtn');
        return (el && el.offsetParent !== null) ? el : null;
      }, 5000);
      if (!saveBtn) {
        log('submitBtn not found');
        showToast('Save button not found for ' + account);
        reportDone({ outcome: 'failed', account: account });
        return;
      }
      log('Clicking Save for ' + account);
      simulateClick(saveBtn);

      // Fast-fail: poll briefly for a visible error after saving (slow
      // networks) instead of a fixed sleep-then-check that false-proceeds.
      var saveError = await waitFor(detectError, errorPollTimeoutMs());
      if (saveError) {
        showToast('\u274C Unsuspension failed for ' + account + ' — see error on page');
        log('Error indicator shown after save for ' + account);
        reportDone({ outcome: 'failed', account: account });
        return;
      }

      // Mark this account for verification, then reload — USER STATUS only
      // reflects the unsuspension after a page reload.
      // Domain entities verify in a FRESH tab instead: the AD page is janky
      // on reload for domain lookups, so the worker opens a clean tab (which
      // enters verification mode via the marker) and swaps this one out.
      var hDom = adHelpers();
      var domainCase = (hDom && hDom.isDomainEntity) ? hDom.isDomainEntity(account) : isDomainEntity(account);
      setVerifyEntry(account, 1, function () {
        if (!domainCase) {
          showToast('Save accepted — reloading to verify user status…');
          log('Reloading to verify USER STATUS for ' + account);
          setTimeout(function () { location.reload(); }, 800);
          return;
        }
        var region = '';
        try { region = new URLSearchParams(window.location.search).get('region') || ''; } catch (e) {}
        showToast('Save accepted — opening a fresh tab to verify domain status…');
        log('Requesting fresh verify tab for domain ' + account);
        function fallbackToReload(why) {
          log('Fresh verify tab unavailable (' + why + ') — falling back to reload');
          setTimeout(function () { location.reload(); }, 800);
        }
        try {
          chrome.runtime.sendMessage({ action: 'open-verify-tab', data: { account: account, region: region, requestId: requestId } }, function (resp) {
            if (chrome.runtime.lastError || !resp || !resp.success) {
              fallbackToReload((resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no response');
              return;
            }
            log('Fresh verify tab opened for ' + account + ' — verdict will arrive from there');
          });
        } catch (e) { fallbackToReload(e.message); }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
