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

  function waitForElement(find, timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var check = function () {
        var el = find();
        if (el) { resolve(el); return; }
        if (Date.now() - start > timeoutMs) { resolve(null); return; }
        setTimeout(check, 200);
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
          failed: !!r.failed,
          outcome: r.outcome || (r.failed ? 'failed' : 'unknown'),
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

  // Look for an on-page success indicator: success/alert elements or toast/
  // notification containers whose text mentions unblocking. Our own overlay
  // toast is excluded from matching.
  function detectSuccess() {
    var sel = '.success, .alert-success, [class*="success"], .toast, .notification, [role="status"], [role="alert"]';
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.offsetParent) continue;
      if (el.id === 'rg-unsuspend-toast' || el.closest('#rg-unsuspend-toast')) continue;
      var t = (el.textContent || '').trim();
      if (t && /unsuspend|unblock|success|completed/i.test(t)) return el;
    }
    return null;
  }

  // Wait up to 8s for a definitive signal after clicking Save:
  //   error indicator          -> 'failed'
  //   success indicator OR the Unblock button disappearing -> 'confirmed'
  //   nothing definitive       -> 'unknown'
  function awaitVerdict() {
    return new Promise(function (resolve) {
      var start = Date.now();
      var tick = function () {
        if (detectError()) return resolve('failed');
        if (detectSuccess()) return resolve('confirmed');
        if (!findUnblockButton() && Date.now() - start > 1500) return resolve('confirmed');
        if (Date.now() - start > 8000) return resolve('unknown');
        setTimeout(tick, 300);
      };
      tick();
    });
  }

  async function run() {
    chrome.storage.local.get(['unsuspendReason'], async function (result) {
      var rec = result.unsuspendReason;
      var fresh = rec && typeof rec === 'object' && typeof rec.reason === 'string' && rec.reason !== '' &&
                  typeof rec.ts === 'number' && (Date.now() - rec.ts) <= 90000;
      if (!fresh) { log('No fresh unsuspend reason in storage'); return; }
      var reason = rec.reason;

      var account = new URLSearchParams(window.location.search).get('entity');
      if (!account) { log('No entity in URL — skipping automation'); return; }
      log('Starting unsuspend automation for ' + account);

      var unblockBtn = await waitForElement(findUnblockButton, 10000);
      if (!unblockBtn) {
        log('Unblock button not found');
        showToast('Unblock button not found for ' + account);
        reportDone({ outcome: 'failed', account: account });
        return;
      }
      log('Clicking Unblock for ' + account);
      simulateClick(unblockBtn);

      var textarea = await waitForElement(function () { return document.querySelector('textarea'); }, 5000);
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

      var saveBtn = await waitForElement(function () {
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

      var outcome = await awaitVerdict();
      if (outcome === 'confirmed') {
        showToast('\u2705 Unsuspension verified for ' + account);
        log('Unsuspension confirmed via page signals for ' + account);
      } else if (outcome === 'failed') {
        showToast('\u274C Unsuspension failed for ' + account + ' — see error on page');
        log('Error indicator shown after save for ' + account);
      } else {
        showToast('\u26A0\uFE0F Could not verify unsuspension for ' + account + ' — please check manually');
        log('No confirmation signal within timeout for ' + account);
      }
      reportDone({ outcome: outcome, account: account });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
