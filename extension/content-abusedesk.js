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

  function simulateClick(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.click();
  }

  async function run() {
    chrome.storage.local.get(['unsuspendReason', 'unsuspendAccount'], async function (result) {
      var reason = result.unsuspendReason;
      var account = result.unsuspendAccount;
      if (!reason) { log('No unsuspend reason in storage'); return; }

      chrome.storage.local.remove(['unsuspendReason', 'unsuspendAccount']);
      log('Starting unsuspend automation for ' + account);

      await sleep(2000);

      log('Scanning page for all clickable elements...');
      var allEls = document.querySelectorAll('*');
      var buttons = [];
      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        var tag = el.tagName.toLowerCase();
        if (tag === 'button' || tag === 'a' || tag === 'input' || el.getAttribute('role') === 'button') {
          var txt = (el.value || el.textContent || '').trim().substring(0, 80);
          if (txt) buttons.push({ tag: tag, class: el.className, text: txt, visible: el.offsetParent !== null });
        }
      }
      log('Found ' + buttons.length + ' buttons: ' + JSON.stringify(buttons.slice(0, 30)));

      var unblockBtn = null;
      for (var i = 0; i < allEls.length; i++) {
        var txt = (allEls[i].value || allEls[i].textContent || '').trim();
        if (txt === 'Unblock' || txt.includes('Unblock')) {
          unblockBtn = allEls[i];
          break;
        }
      }

      if (!unblockBtn) {
        log('Unblock button not found');
        showToast('Could not find Unblock button');
        return;
      }
      log('Clicking Unblock');
      simulateClick(unblockBtn);

      await sleep(1000);

      var textarea = document.querySelector('textarea');
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

      await sleep(1500);

      log('Scanning for Save button after textarea fill...');
      var allEls2 = document.querySelectorAll('*');
      var saveBtn = null;
      for (var i = 0; i < allEls2.length; i++) {
        var el = allEls2[i];
        var txt = (el.value || el.textContent || '').trim();
        if (txt.includes('Save reason and proceed')) {
          saveBtn = el;
          log('Found Save button: <' + el.tagName + '> class="' + el.className + '"');
          break;
        }
      }

      if (!saveBtn) {
        log('Save button not found — trying to click any green/blue button in modal...');
        var modal = document.querySelector('.modal, .modal-content, [role="dialog"], .popup, .overlay');
        if (modal) {
          log('Found modal container: <' + modal.tagName + '>');
          var modalBtns = modal.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
          log('Modal has ' + modalBtns.length + ' buttons');
          for (var i = 0; i < modalBtns.length; i++) {
            var b = modalBtns[i];
            var btxt = (b.value || b.textContent || '').trim();
            log('  Button[' + i + ']: "' + btxt.substring(0, 60) + '"');
            if (btxt.includes('Save') || btxt.includes('Proceed') || btxt.includes('Confirm')) {
              saveBtn = b;
              break;
            }
          }
        }
      }

      if (!saveBtn) {
        log('Save button NOT found — showing all buttons on page');
        showToast('Could not find Save button — check console');
        return;
      }

      log('Clicking Save button');
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
