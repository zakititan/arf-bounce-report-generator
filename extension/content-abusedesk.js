(function () {
  function log(msg) { console.log('[Report→AbuseDesk] ' + msg); }

  function showToast(message) {
    var existing = document.getElementById('rg-unsuspend-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'rg-unsuspend-toast';
    toast.textContent = message;
    toast.style.cssText =
      'position:fixed;bottom:24px;right:24px;background:#1a1a2e;color:#e0e0e0;' +
      'padding:12px 20px;border-radius:8px;font-size:13px;font-family:system-ui,sans-serif;' +
      'z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 300ms ease;';
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 300);
    }, 5000);
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
  function reportDone(failed) {
    try {
      chrome.runtime.sendMessage({ action: 'ad-tab-done', data: { failed: !!failed } });
    } catch (e) { /* extension context gone — nothing to do */ }
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

      var unblockBtn = await waitForElement(function () {
        var el = document.getElementById('unblockBtn');
        if (!el) {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'Unblock') { el = btns[i]; break; }
          }
        }
        return el || null;
      }, 10000);
      if (!unblockBtn) { log('Unblock button not found'); showToast('Unblock button not found for ' + account); reportDone(true); return; }
      log('Clicking Unblock for ' + account);
      simulateClick(unblockBtn);

      var textarea = await waitForElement(function () { return document.querySelector('textarea'); }, 5000);
      if (!textarea) { log('Textarea not found'); showToast('Textarea not found for ' + account); reportDone(true); return; }
      log('Pasting reason for ' + account);
      textarea.focus();
      textarea.value = reason;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      var saveBtn = await waitForElement(function () {
        var el = document.getElementById('submitBtn');
        return (el && el.offsetParent !== null) ? el : null;
      }, 5000);
      if (!saveBtn) { log('submitBtn not found'); showToast('Save button not found for ' + account); reportDone(true); return; }
      log('Clicking Save for ' + account);
      simulateClick(saveBtn);

      var failed = await waitForElement(function () {
        var err = document.querySelector('.error, .alert-danger, [class*="error"]');
        return (err && err.offsetParent !== null && (err.textContent || '').trim()) ? err : null;
      }, 3000);
      if (failed) {
        showToast('Unsuspend may have failed for ' + account);
        log('Error indicator shown after save for ' + account);
      } else {
        showToast('Unsuspend completed for ' + account);
      }
      log('Automation complete for ' + account);
      reportDone(!!failed);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
