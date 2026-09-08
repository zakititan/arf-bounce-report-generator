(function() {
  if (window.__reportGenPartnerPanelLoaded) return;
  window.__reportGenPartnerPanelLoaded = true;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getHelpers() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.ReportGenPartnerHelpers) return globalThis.ReportGenPartnerHelpers;
      if (typeof window !== 'undefined' && window.ReportGenPartnerHelpers) return window.ReportGenPartnerHelpers;
    } catch (_) {}
    return null;
  }

  function isActiveStatusCell(text) {
    var h = getHelpers();
    if (h && typeof h.isActiveStatusCell === 'function') {
      try { return h.isActiveStatusCell(text); } catch (_) {}
    }
    if (typeof text !== 'string') return false;
    return /\bActive\b/.test(text);
  }

  function isEmptyOrUnknownStatus(text) {
    var h = getHelpers();
    if (h && typeof h.isEmptyOrUnknownStatus === 'function') {
      try { return h.isEmptyOrUnknownStatus(text); } catch (_) {}
    }
    if (typeof text !== 'string') return true;
    var t = text.trim();
    if (!t) return true;
    if (/\bActive\b/.test(t)) return false;
    if (/\bInactive\b/.test(t)) return false;
    return true;
  }

  function isAdminLoginExpiredFromDom() {
    var pwField = document.querySelector('input[type="password"]');
    var hasPasswordField = !!pwField;
    if (!hasPasswordField) return false;
    var form = null;
    try { form = pwField.closest('form'); } catch (_) { form = null; }
    var formAction = '';
    var buttonTexts = [];
    try {
      if (form) {
        formAction = form.getAttribute('action') || form.action || '';
        var btns = form.querySelectorAll('button, input[type="submit"], a');
        for (var i = 0; i < btns.length; i++) {
          var label = (btns[i].textContent || btns[i].value || '').trim();
          if (label) buttonTexts.push(label);
        }
      } else {
        var allBtns = document.querySelectorAll('button, a');
        for (var j = 0; j < allBtns.length; j++) {
          var txt = (allBtns[j].textContent || '').trim();
          if (txt) buttonTexts.push(txt);
        }
      }
    } catch (_) {}
    var desc = {
      hasPasswordField: hasPasswordField,
      formAction: formAction || '',
      buttonTexts: buttonTexts,
      pathname: (location && location.pathname) || '',
    };
    var h = getHelpers();
    if (h && typeof h.isAdminLoginExpired === 'function') {
      try { return h.isAdminLoginExpired(desc); } catch (_) {}
    }
    if (/login/i.test(desc.formAction)) return true;
    if (/login/i.test(desc.pathname)) return true;
    for (var k = 0; k < desc.buttonTexts.length; k++) {
      if (/log\s*in/i.test(desc.buttonTexts[k]) || /sign\s*in/i.test(desc.buttonTexts[k])) return true;
    }
    return false;
  }

  function waitForCondition(predicate, timeout, interval) {
    return new Promise(function(resolve) {
      var start = Date.now();
      var step = interval || 250;
      var maxMs = timeout || 10000;
      var check = function() {
        var ok = false;
        try { ok = !!predicate(); } catch (_) { ok = false; }
        if (ok) { resolve(true); return; }
        if (Date.now() - start >= maxMs) { resolve(false); return; }
        setTimeout(check, step);
      };
      check();
    });
  }

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
                       line.indexOf('Password changed') !== -1 ||
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

  async function runPartnerPanelLookup(account, currentRequestId) {
    try {
      if (isAdminLoginExpiredFromDom()) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: 'Partner Panel session expired — log in to admin.titan.email and retry' } });
        return;
      }

      var input = document.querySelector('input[name="domainName"], input.dashboard-input, input[type="text"]');
      if (!input) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: 'Input field not found' } });
        return;
      }

      input.value = account;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForCondition(function() {
        var btn = document.querySelector('button[name="btndashBoard"], button.dashboard-button, button.button-primary');
        return !!btn && !btn.disabled;
      }, 5000, 250);

      var getInfoBtn = document.querySelector('button[name="btndashBoard"], button.dashboard-button, button.button-primary');
      if (!getInfoBtn) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: 'Get Info button not found' } });
        return;
      }
      getInfoBtn.click();

      var found = await waitForTextInBody('Orders for domain', 10000);
      if (!found) {
        var errorMsg = document.querySelector('.error, .dashboard-error');
        var errText = errorMsg ? errorMsg.textContent.trim() : '';
        chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: errText || 'No orders found for this account' } });
        return;
      }

      await waitForCondition(function() {
        var rows = document.querySelectorAll('tr, [class*="row"], [class*="Row"]');
        if (rows.length === 0) return false;
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim() === 'View') return true;
        }
        return false;
      }, 10000, 300);

      var viewBtns = document.querySelectorAll('button');
      var activeViewBtn = null;
      var allRows = document.querySelectorAll('tr, [class*="row"], [class*="Row"]');

      for (var r = 0; r < allRows.length; r++) {
        var rowText = allRows[r].textContent;
        if (isActiveStatusCell(rowText)) {
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
        for (var fr = 0; fr < allRows.length; fr++) {
          var fallbackRowText = allRows[fr].textContent;
          if (!isEmptyOrUnknownStatus(fallbackRowText)) continue;
          var fallbackBtns = allRows[fr].querySelectorAll('button');
          for (var fb = 0; fb < fallbackBtns.length; fb++) {
            if (fallbackBtns[fb].textContent.trim() === 'View') {
              activeViewBtn = fallbackBtns[fb];
              break;
            }
          }
          if (activeViewBtn) break;
        }
      }

      if (!activeViewBtn) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: 'No active order found' } });
        return;
      }

      activeViewBtn.click();
      await waitForTextInBody('EMAIL INFORMATION', 10000);
      await waitForCondition(function() {
        var els = document.querySelectorAll('button, a');
        for (var i = 0; i < els.length; i++) {
          if ((els[i].textContent || '').trim().indexOf('View Account History') !== -1) return true;
        }
        return false;
      }, 10000, 300);

      var viewHistoryBtn = null;
      var allBtns = document.querySelectorAll('button, a');
      for (var h = 0; h < allBtns.length; h++) {
        if (allBtns[h].textContent.trim().indexOf('View Account History') !== -1) {
          viewHistoryBtn = allBtns[h];
          break;
        }
      }

      if (!viewHistoryBtn) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: 'View Account History button not found' } });
        return;
      }

      viewHistoryBtn.click();
      await waitForTextInBody('Action History', 10000);

      var historyReady = await waitForCondition(function() {
        return document.querySelectorAll('td.action-history-time').length > 0;
      }, 10000, 300);

      if (!historyReady) {
        chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: 'Action History rows did not load' } });
        return;
      }

      await waitForCondition(function() {
        try { return parseAccountHistory().length > 0; } catch (_) { return false; }
      }, 5000, 300);
      var events = parseAccountHistory();

      chrome.runtime.sendMessage({
        action: 'partner-panel-result',
        requestId: currentRequestId,
        data: { success: true, account: account, events: events }
      });

    } catch (e) {
      chrome.runtime.sendMessage({ action: 'partner-panel-result', requestId: currentRequestId, data: { success: false, error: e.message } });
    }
  }

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'run-partner-panel-lookup') {
      sendResponse({ received: true });
      runPartnerPanelLookup(message.account, message.requestId);
      return true;
    }
  });
})();
