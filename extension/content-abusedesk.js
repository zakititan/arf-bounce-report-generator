(function () {
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
          account: r.account || ''
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

  // Authoritative status check: the USER STATUS badge on the Blocked Users
  // page. The page does not live-update after unsuspension, so this is read
  // AFTER a reload (see verification flow below).
  function readUserStatus() {
    try {
      var res = document.evaluate(
        '//*[normalize-space(text())="USER STATUS"]',
        document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
      );
      for (var i = 0; i < res.snapshotLength; i++) {
        var node = res.snapshotItem(i);
        var row = node.closest('tr') || node.parentElement;
        var hay = ((row && row.textContent) || '').toUpperCase();
        var idx = hay.indexOf('USER STATUS');
        var seg = idx >= 0 ? hay.slice(idx + 'USER STATUS'.length) : hay;
        if (seg.indexOf('SUSPENDED') !== -1) return 'Suspended';
        if (seg.indexOf('ACTIVE') !== -1) return 'Active';
      }
    } catch (e) { /* XPath unsupported — fall through */ }
    return '';
  }

  // Per-account verify markers: after saving, the page reloads and this
  // script runs again while the unsuspend reason is still TTL-fresh. The
  // marker switches that load into verification mode instead of re-running
  // the automation.
  function getVerifyMap(cb) {
    chrome.storage.local.get(['unsuspendVerify'], function (r) {
      cb(r.unsuspendVerify || {});
    });
  }
  function setVerifyEntry(account, cb) {
    getVerifyMap(function (map) {
      map[account] = Date.now();
      chrome.storage.local.set({ unsuspendVerify: map }, function () { if (cb) cb(); });
    });
  }
  function consumeVerifyEntry(account, cb) {
    getVerifyMap(function (map) {
      var ts = map[account];
      if (cb) cb(typeof ts === 'number' ? ts : null);
      if (ts) {
        delete map[account];
        chrome.storage.local.set({ unsuspendVerify: map }, function () {});
      }
    });
  }

  // Reload the page and read the USER STATUS badge — the only trustworthy
  // signal that the unsuspension actually took effect.
  async function verifyByReload(account) {
    var status = await waitFor(readUserStatus, 15000);
    var outcome;
    if (status === 'Active') {
      outcome = 'confirmed';
      showToast('\u2705 Unsuspension verified for ' + account + ' — user status: Active');
    } else if (status === 'Suspended') {
      outcome = 'failed';
      showToast('\u274C Unsuspension failed for ' + account + ' — user status still Suspended');
    } else {
      outcome = 'unknown';
      showToast('\u26A0\uFE0F Could not read user status for ' + account + ' — please check manually');
    }
    log('Verification for ' + account + ': ' + outcome + (status ? ' (' + status + ')' : ''));
    reportDone({ outcome: outcome, account: account });
  }

  async function run() {
    chrome.storage.local.get(['unsuspendReason', 'unsuspendVerify'], async function (result) {
      var account = new URLSearchParams(window.location.search).get('entity');
      if (!account) { log('No entity in URL — skipping automation'); return; }

      // ── Verification mode: this load was triggered by our own reload ──
      var vMap = result.unsuspendVerify || {};
      var vTs = vMap[account];
      if (typeof vTs === 'number' && (Date.now() - vTs) <= 90000) {
        consumeVerifyEntry(account, function () {});
        log('Verification mode for ' + account);
        await sleep(500); // let the results table finish rendering
        await verifyByReload(account);
        return;
      }

      // ── Automation mode ──
      var rec = result.unsuspendReason;
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
      setVerifyEntry(account, function () {
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
