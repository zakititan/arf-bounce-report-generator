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

  function simulateClick(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.click();
  }

  async function run() {
    chrome.storage.local.get(['unsuspendReason'], async function (result) {
      var reason = result.unsuspendReason;
      if (!reason) { log('No unsuspend reason in storage'); return; }

      var account = new URLSearchParams(window.location.search).get('entity');
      if (!account) { log('No entity in URL — skipping automation'); return; }
      log('Starting unsuspend automation for ' + account);

      await sleep(2000);

      var unblockBtn = document.getElementById('unblockBtn');
      if (!unblockBtn) {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].textContent.trim() === 'Unblock') { unblockBtn = btns[i]; break; }
        }
      }
      if (!unblockBtn) { log('Unblock button not found'); showToast('Unblock button not found for ' + account); return; }
      log('Clicking Unblock for ' + account);
      simulateClick(unblockBtn);

      await sleep(1500);

      var textarea = document.querySelector('textarea');
      if (!textarea) { log('Textarea not found'); showToast('Textarea not found for ' + account); return; }
      log('Pasting reason for ' + account);
      textarea.focus();
      textarea.value = reason;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      await sleep(1000);

      var saveBtn = document.getElementById('submitBtn');
      if (!saveBtn) { log('submitBtn not found'); showToast('Save button not found for ' + account); return; }
      log('Clicking Save for ' + account);
      simulateClick(saveBtn);

      await sleep(500);
      showToast('Unsuspend completed for ' + account);
      log('Automation complete for ' + account);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
