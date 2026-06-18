(function () {
  var POLL_INTERVAL = 500;
  var MAX_WAIT_MS = 15000;

  function log(msg) { console.log('[Report→AbuseDesk] ' + msg); }

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

  function waitForText(text, maxMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var poll = setInterval(function () {
        var btns = document.querySelectorAll('button, a, input[type="button"]');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].textContent.trim().includes(text)) { clearInterval(poll); resolve(btns[i]); return; }
        }
        if (Date.now() - start > maxMs) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });
  }

  async function run() {
    chrome.storage.local.get(['unsuspendReason', 'unsuspendAccount'], async function (result) {
      var reason = result.unsuspendReason;
      var account = result.unsuspendAccount;
      if (!reason) { log('No unsuspend reason found — skipping automation'); return; }

      chrome.storage.local.remove(['unsuspendReason', 'unsuspendAccount']);
      log('Starting unsuspend automation for ' + account + ', reason: ' + reason);

      var unblockBtn = await waitForText('UnsuspendCustomer', MAX_WAIT_MS);
      if (!unblockBtn) { log('UnsuspendCustomer button not found'); return; }
      log('Found UnsuspendCustomer button — clicking');
      unblockBtn.click();

      var textarea = await waitForElement('textarea', MAX_WAIT_MS);
      if (!textarea) { log('Reason textarea not found'); return; }
      log('Found textarea — pasting reason');
      textarea.value = reason;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      var saveBtn = await waitForText('Save reason and proceed', MAX_WAIT_MS);
      if (!saveBtn) { log('Save button not found'); return; }
      log('Found Save button — clicking');
      saveBtn.click();

      log('Unsuspend automation complete for ' + account);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
