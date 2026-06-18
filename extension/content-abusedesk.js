(function () {
  var POLL_INTERVAL = 500;
  var MAX_WAIT_MS = 20000;

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

  function findButtonByPartialText(text) {
    var all = document.querySelectorAll(
      'button, a, input[type="button"], input[type="submit"], span[role="button"], div[role="button"], [onclick]'
    );
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var content = (el.value || el.textContent || '').trim();
      if (content.includes(text)) return el;
    }
    return null;
  }

  function waitForButton(text, maxMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var poll = setInterval(function () {
        var btn = findButtonByPartialText(text);
        if (btn) { clearInterval(poll); resolve(btn); return; }
        if (Date.now() - start > maxMs) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });
  }

  async function run() {
    chrome.storage.local.get(['unsuspendReason', 'unsuspendAccount'], async function (result) {
      var reason = result.unsuspendReason;
      var account = result.unsuspendAccount;
      if (!reason) { log('No unsuspend reason in storage — page loaded normally, not via extension'); return; }

      chrome.storage.local.remove(['unsuspendReason', 'unsuspendAccount']);
      log('Starting unsuspend automation for ' + account);

      var unblockBtn = await waitForButton('Unblock', MAX_WAIT_MS);
      if (!unblockBtn) {
        log('Unblock button not found');
        showToast('Could not find Unblock button');
        return;
      }
      log('Clicking Unblock');
      unblockBtn.click();

      var textarea = await waitForElement('textarea', MAX_WAIT_MS);
      if (!textarea) {
        log('Reason textarea not found');
        showToast('Could not find reason textarea');
        return;
      }
      log('Pasting reason into textarea');

      textarea.focus();
      textarea.value = reason;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      log('Waiting for framework to process textarea change...');
      await sleep(1000);

      log('Searching for Save button...');
      var saveBtn = await waitForButton('Save reason and proceed', MAX_WAIT_MS);

      if (!saveBtn) {
        log('Initial search failed — scanning ALL elements on page...');
        var allEls = document.querySelectorAll('*');
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          var txt = (el.value || el.textContent || '').trim();
          if (txt.includes('Save reason') || txt === 'Save' || txt === 'Save reason and proceed') {
            log('Found match: <' + el.tagName + '> class="' + el.className + '" text="' + txt.substring(0, 50) + '"');
            saveBtn = el;
            break;
          }
        }
      }

      if (!saveBtn) {
        log('Save button NOT found after full scan');
        showToast('Could not find Save button — check console');
        return;
      }

      log('Clicking Save: <' + saveBtn.tagName + '>');
      saveBtn.click();

      showToast('Unsuspend completed for ' + account);
      log('Automation complete for ' + account);
    });
  }

  function waitForElement(selector, maxMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var poll = setInterval(function () {
        var el = document.querySelector(selector);
        if (el) { clearInterval(poll); resolve(el); return; }
        if (Date.now() - start > maxMs) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
