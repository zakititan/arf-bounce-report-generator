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
    var events = [];

    // 1. Try action-history specific cells first (from DOM screenshot: td.action-history-time + td.action-history-info)
    var timeCells = document.querySelectorAll('td.action-history-time');
    if (timeCells.length > 0) {
      for (var i = 0; i < timeCells.length; i++) {
        var timeTd = timeCells[i];
        var row = timeTd.parentElement;
        if (!row || row.tagName !== 'TR') continue;
        var infoTds = row.querySelectorAll('td.action-history-info');
        if (infoTds.length === 0) continue;

        var dateText = (timeTd.textContent || '').trim();
        var actionText = '';
        var roleText = '';

        // First action-history-info div has the action link, second has the role
        var actionDiv = infoTds[0].querySelector('.action-detail-link');
        if (actionDiv) {
          actionText = actionDiv.textContent.trim();
        } else {
          actionText = infoTds[0].textContent.trim();
        }

        if (infoTds.length >= 2) {
          roleText = infoTds[1].textContent.trim();
        }

        if (dateText && actionText) {
          events.push({ date: dateText, action: actionText, role: roleText });
        }
      }
    }

    // 2. Fallback: generic table parser
    if (events.length === 0) {
      var tables = document.querySelectorAll('table');
      for (var t = 0; t < tables.length; t++) {
        var trs = tables[t].querySelectorAll('tbody tr');
        for (var i = 0; i < trs.length; i++) {
          var cells = trs[i].querySelectorAll('td');
          if (cells.length >= 2) {
            var dateText = (cells[0] || {}).textContent || '';
            var actionText = (cells[1] || {}).textContent || '';
            if (dateText.trim() && actionText.trim()) {
              events.push({
                date: dateText.trim(),
                action: actionText.trim(),
                role: ((cells[2] || {}).textContent || '').trim()
              });
            }
          }
        }
        if (events.length > 0) break;
      }
    }

    // 3. Fallback: parse from body text
    if (events.length === 0) {
      var allText = document.body.innerText;
      var lines = allText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
      var datePattern = /^\d{1,2}\s+\w+\s+\d{4}/;

      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        var isAction = line.indexOf('Password reset') !== -1 ||
                       line.indexOf('Suspension') !== -1 ||
                       line.indexOf('Suspended') !== -1 ||
                       line.indexOf('Unsuspended') !== -1 ||
                       line.indexOf('Incoming Emails') !== -1 ||
                       line.indexOf('Flags Updated') !== -1 ||
                       line.indexOf('Created') !== -1 ||
                       line.indexOf('Made admin') !== -1 ||
                       line.indexOf('Made non-admin') !== -1 ||
                       line.indexOf('Data migration') !== -1;

        if (isAction) {
          // Look back 1-3 lines for the date
          var date = '';
          for (var k = j - 1; k >= Math.max(0, j - 3); k--) {
            if (datePattern.test(lines[k])) {
              date = lines[k];
              // Check if time is on the previous line
              if (k > 0 && /^\d{2}:\d{2}:\d{2}/.test(lines[k - 1])) {
                date = date + ' ' + lines[k - 1];
              }
              break;
            }
          }
          events.push({ date: date, action: line, role: '' });
        }
      }
    }

    return events;
  }

  function analyzeHistory(events) {
    var suspensionIdx = -1;
    var passwordResetAfterSuspension = false;
    var suspensionDate = 'N/A';
    var lastPasswordResetDate = 'N/A';

    for (var i = 0; i < events.length; i++) {
      var action = events[i].action.toLowerCase();
      if (action.indexOf('suspens') !== -1 && action.indexOf('un') === -1) {
        suspensionIdx = i;
        suspensionDate = events[i].date || 'N/A';
        break;
      }
    }

    if (suspensionIdx > 0) {
      for (var j = 0; j < suspensionIdx; j++) {
        if (events[j].action.toLowerCase().indexOf('password reset') !== -1) {
          passwordResetAfterSuspension = true;
          break;
        }
      }
    }

    for (var k = 0; k < events.length; k++) {
      if (events[k].action.toLowerCase().indexOf('password reset') !== -1) {
        lastPasswordResetDate = events[k].date || 'N/A';
        break;
      }
    }

    return {
      passwordChanged: passwordResetAfterSuspension,
      suspensionDate: suspensionDate,
      lastPasswordResetDate: lastPasswordResetDate,
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

      var historyReady = await new Promise(function(resolve) {
        var start = Date.now();
        var check = function() {
          var cells = document.querySelectorAll('td.action-history-time');
          if (cells.length > 0) { resolve(true); return; }
          if (Date.now() - start > 10000) { resolve(false); return; }
          setTimeout(check, 300);
        };
        check();
      });

      if (!historyReady) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', data: { success: false, error: 'Action History rows did not load' } });
        return;
      }

      await sleep(500);
      var events = parseAccountHistory();
      var analysis = analyzeHistory(events);

      console.log('[PartnerPanel] Events found:', events.length, events);
      console.log('[PartnerPanel] Analysis:', analysis);

      chrome.runtime.sendMessage({
        action: 'partner-panel-result',
        data: {
          success: true,
          account: account,
          passwordChanged: analysis.passwordChanged,
          suspensionDate: analysis.suspensionDate,
          lastPasswordResetDate: analysis.lastPasswordResetDate,
          events: events,
          _debug: { eventCount: events.length, firstEvent: events[0] || null }
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
