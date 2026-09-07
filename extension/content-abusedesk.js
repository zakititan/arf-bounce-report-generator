(function () {
  var requestId = new URLSearchParams(window.location.search).get('rgRequestId') || 'legacy';
  function log(msg) { console.log('[Report→AbuseDesk] ' + msg); }

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
          requestId: requestId
        }
      });
    } catch (e) { /* extension context gone — nothing to do */ }
  }

  function findUnblockButton() {
    var el = document.getElementById('unblockBtn');
    if (!el) {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === 'Unblock') { el = btns[i]; break; }
      }
    }
    return el || null;
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

  function reasonKey() { return 'unsuspendReason:' + requestId; }
  function verifyKey(account) { return 'unsuspendVerify:' + requestId + ':' + encodeURIComponent(account); }

  // A marker is scoped to both the run and account. Individual storage keys
  // avoid read-modify-write collisions between concurrent tabs.
  function setVerifyEntry(account, attempt, cb) {
    chrome.storage.local.set({ [verifyKey(account)]: { ts: Date.now(), attempt: attempt || 1 } }, function () {
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
    chrome.storage.local.get([reasonKey(), verifyKey(new URLSearchParams(window.location.search).get('entity') || '')], async function (result) {
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
      var rec = result[reasonKey()];
      var fresh = rec && typeof rec === 'object' && typeof rec.reason === 'string' && rec.reason !== '' &&
                  typeof rec.ts === 'number' && (Date.now() - rec.ts) <= 90000;
      if (!fresh) { log('No fresh unsuspend reason in storage'); return; }
      var reason = rec.reason;

      log('Starting unsuspend automation for ' + account);

      var unblockBtn = await waitFor(findUnblockButton, 10000);
      if (!unblockBtn) {
        log('Unblock button not found');
        showToast('Unblock button not found for ' + account);
        reportDone({ outcome: 'failed', account: account });
        return;
      }
      log('Clicking Unblock for ' + account);
      simulateClick(unblockBtn);

      var textarea = await waitFor(function () { return document.querySelector('textarea'); }, 5000);
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

      // Fast-fail: a visible error right after saving means no reload needed.
      await sleep(2500);
      if (detectError()) {
        showToast('\u274C Unsuspension failed for ' + account + ' — see error on page');
        log('Error indicator shown after save for ' + account);
        reportDone({ outcome: 'failed', account: account });
        return;
      }

      // Mark this account for verification, then reload — USER STATUS only
      // reflects the unsuspension after a page reload.
      setVerifyEntry(account, 1, function () {
        showToast('Save accepted — reloading to verify user status\u2026');
        log('Reloading to verify USER STATUS for ' + account);
        setTimeout(function () { location.reload(); }, 800);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
