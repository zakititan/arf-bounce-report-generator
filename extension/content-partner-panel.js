(function() {
  if (window.__reportGenPartnerPanelLoaded) return;
  window.__reportGenPartnerPanelLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function waitForElement(selector, timeout) {
    return new Promise(function(resolve) {
      var el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      var observer = new MutationObserver(function() {
        el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function() { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  function waitForElementVisible(selector, timeout) {
    return new Promise(function(resolve) {
      var check = function() {
        var el = document.querySelector(selector);
        if (el && el.offsetParent !== null) { resolve(el); return; }
        var observer = new MutationObserver(function() {
          el = document.querySelector(selector);
          if (el && el.offsetParent !== null) { observer.disconnect(); resolve(el); }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        setTimeout(function() { observer.disconnect(); resolve(null); }, timeout);
      };
      check();
    });
  }

  function waitForTextInBody(text, timeout) {
    return new Promise(function(resolve) {
      if (document.body.innerText.indexOf(text) !== -1) { resolve(true); return; }
      var observer = new MutationObserver(function() {
        if (document.body.innerText.indexOf(text) !== -1) { observer.disconnect(); resolve(true); }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      setTimeout(function() { observer.disconnect(); resolve(false); }, timeout);
    });
  }

  function parseAccountHistory() {
    var rows = document.querySelectorAll('table tbody tr, [class*="row"], [class*="Row"]');
    var events = [];
    var tableEl = document.querySelector('table');
    if (tableEl) {
      var trs = tableEl.querySelectorAll('tr');
      for (var i = 0; i < trs.length; i++) {
        var cells = trs[i].querySelectorAll('td');
        if (cells.length >= 2) {
          events.push({
            date: (cells[0] || {}).textContent || '',
            action: (cells[1] || {}).textContent || '',
            role: (cells[2] || {}).textContent || ''
          });
        }
      }
    }
    if (events.length === 0) {
      var allText = document.body.innerText;
      var lines = allText.split('\n');
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j].trim();
        if (line.indexOf('Password reset') !== -1 || line.indexOf('Suspension') !== -1 || line.indexOf('Suspended') !== -1 || line.indexOf('Unsuspended') !== -1) {
          events.push({ date: '', action: line, role: '' });
        }
      }
    }
    return events;
  }

  function analyzeHistory(events) {
    var suspensionIdx = -1;
    var passwordResetAfterSuspension = false;

    // Find the most recent suspension (first one in newest-first list)
    for (var i = 0; i < events.length; i++) {
      var action = events[i].action.toLowerCase();
      if (action.indexOf('suspend') !== -1 && action.indexOf('un') === -1) {
        suspensionIdx = i;
        break;
      }
    }

    // If we found a suspension, check if any password reset appears BEFORE it
    // in the DOM (which means it happened AFTER the suspension chronologically)
    if (suspensionIdx > 0) {
      for (var j = 0; j < suspensionIdx; j++) {
        if (events[j].action.toLowerCase().indexOf('password reset') !== -1) {
          passwordResetAfterSuspension = true;
          break;
        }
      }
    }

    var lastSuspension = suspensionIdx >= 0 ? events[suspensionIdx] : null;
    var lastPasswordReset = null;
    for (var k = 0; k < events.length; k++) {
      if (events[k].action.toLowerCase().indexOf('password reset') !== -1) {
        lastPasswordReset = events[k];
        break;
      }
    }

    return {
      passwordChanged: passwordResetAfterSuspension,
      lastSuspension: lastSuspension ? lastSuspension.action : null,
      lastPasswordReset: lastPasswordReset ? lastPasswordReset.action : null,
      events: events
    };
  }

  async function runPartnerPanelLookup(account) {
    try {
      var input = document.querySelector('input[name="domainName"], input.dashboard-input, input[type="text"]');
      if (!input) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', data: { success: false, error: 'Input field not found' } });
        return;
      }

      input.value = account;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);

      var getInfoBtn = document.querySelector('button[name="btndashBoard"], button.dashboard-button, button.button-primary');
      if (!getInfoBtn) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', data: { success: false, error: 'Get Info button not found' } });
        return;
      }
      getInfoBtn.click();

      var found = await waitForTextInBody('Orders for domain', 10000);
      if (!found) {
        var errorMsg = document.querySelector('.error, .dashboard-error');
        var errText = errorMsg ? errorMsg.textContent.trim() : '';
        chrome.runtime.sendMessage({ action: 'partner-panel-result', data: { success: false, error: errText || 'No orders found for this account' } });
        return;
      }

      await sleep(1500);

      var viewBtns = document.querySelectorAll('button');
      var activeViewBtn = null;
      var allRows = document.querySelectorAll('tr, [class*="row"], [class*="Row"]');

      for (var r = 0; r < allRows.length; r++) {
        var rowText = allRows[r].textContent;
        if (rowText.indexOf('Active') !== -1) {
          var btns = allRows[r].querySelectorAll('button');
          for (var b = 0; b < btns.length; b++) {
            if (btns[b].textContent.trim() === 'View') {
              activeViewBtn = btns[b];
              break;
            }
          }
          if (activeViewBtn) break;
        }
      }

      if (!activeViewBtn) {
        var allViewBtns = document.querySelectorAll('button');
        for (var v = 0; v < allViewBtns.length; v++) {
          if (allViewBtns[v].textContent.trim() === 'View') {
            activeViewBtn = allViewBtns[v];
            break;
          }
        }
      }

      if (!activeViewBtn) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', data: { success: false, error: 'No View button found' } });
        return;
      }

      activeViewBtn.click();
      await waitForTextInBody('EMAIL INFORMATION', 10000);
      await sleep(1500);

      var viewHistoryBtn = null;
      var allBtns = document.querySelectorAll('button, a');
      for (var h = 0; h < allBtns.length; h++) {
        if (allBtns[h].textContent.trim().indexOf('View Account History') !== -1) {
          viewHistoryBtn = allBtns[h];
          break;
        }
      }

      if (!viewHistoryBtn) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', data: { success: false, error: 'View Account History button not found' } });
        return;
      }

      viewHistoryBtn.click();
      await waitForTextInBody('Action History', 10000);
      await sleep(2000);

      var events = parseAccountHistory();
      var analysis = analyzeHistory(events);

      chrome.runtime.sendMessage({
        action: 'partner-panel-result',
        data: {
          success: true,
          account: account,
          passwordChanged: analysis.passwordChanged,
          lastSuspension: analysis.lastSuspension,
          lastPasswordReset: analysis.lastPasswordReset,
          events: events
        }
      });

    } catch (e) {
      chrome.runtime.sendMessage({ action: 'partner-panel-result', data: { success: false, error: e.message } });
    }
  }

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'run-partner-panel-lookup') {
      sendResponse({ received: true });
      runPartnerPanelLookup(message.account);
      return true;
    }
  });
})();
