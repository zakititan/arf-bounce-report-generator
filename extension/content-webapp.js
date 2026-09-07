(function () {
  // Note: this script deliberately renders NO toasts of its own. The web app
  // (app.js) owns all on-page notifications - extension toasts used to stack on
  // top of the app toast in the bottom-right corner and overlap it.

  var ACCOUNT_EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
  var ACCOUNT_DOMAIN_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,60}[A-Za-z0-9])$/;
  var REQUEST_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

  function isAllowedOrigin(origin) {
    return origin === 'http://localhost:3000' ||
      origin === 'https://arf-bounce-report-generator.vercel.app' ||
      /^https:\/\/arf-bounce-report-generator-[a-z0-9-]+\.vercel\.app$/.test(origin);
  }

  function accounts(value) {
    var values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return values.reduce(function (all, item) {
      return all.concat(typeof item === 'string' ? item.split(',') : []);
    }, []).map(function (item) { return item.trim(); }).filter(Boolean);
  }

  function validAccount(value) {
    if (typeof value !== 'string' || value.length > 254) return false;
    var atIndex = value.indexOf('@');
    if (atIndex === -1) return ACCOUNT_DOMAIN_RE.test(value);
    return atIndex === value.lastIndexOf('@') && atIndex > 0 && atIndex <= 64 &&
      ACCOUNT_EMAIL_LOCAL_RE.test(value.slice(0, atIndex)) &&
      ACCOUNT_DOMAIN_RE.test(value.slice(atIndex + 1));
  }

  function validMessage(data) {
    if (!data || typeof data.type !== 'string') return false;
    var requestId = typeof data.requestId === 'string' && REQUEST_ID_RE.test(data.requestId);
    if (data.type === 'REPORT_GENERATOR_PING') return true;
    if (data.type === 'REPORT_GENERATOR_JIRA') {
      return requestId && typeof data.panel === 'string' && typeof data.account === 'string' &&
        (typeof data.text === 'string' || typeof data.html === 'string') && Boolean(data.text || data.html) &&
        accounts(data.account).length === 1 && validAccount(data.account.trim());
    }
    if (data.type === 'REPORT_GENERATOR_UNSUSPEND' || data.type === 'REPORT_GENERATOR_UNSUSPEND_NO_JIRA') {
      var list = accounts(data.accounts || data.account);
      return requestId && typeof data.panel === 'string' && typeof data.text === 'string' &&
        typeof data.html === 'string' && list.length > 0 && list.every(validAccount);
    }
    if (data.type === 'REPORT_GENERATOR_LOG_SHEET') {
      return requestId && ['date', 'zdLink', 'domainEmail', 'reportType', 'reason', 'appsScriptUrl', 'panel']
        .every(function (key) { return typeof data[key] === 'string'; });
    }
    if (data.type === 'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP') {
      return requestId && validAccount(typeof data.account === 'string' ? data.account.trim() : '');
    }
    return false;
  }

  function requestContextKey(reportId, panel, requestId) {
    return JSON.stringify([reportId || '', panel || '', requestId || '']);
  }

  function scopedJiraUrl(stored, reportId, panel, requestId) {
    var entry = stored && stored[requestContextKey(reportId, panel, requestId)];
    return entry && typeof entry.url === 'string' &&
      /^https:\/\/jira\.directi\.com\/browse\/[A-Z][A-Z0-9]+-\d+$/.test(entry.url) ? entry.url : '';
  }

  function jiraStorageKey(reportId, panel, requestId) {
    return 'jiraUrl:' + requestContextKey(reportId, panel, requestId);
  }

  function unsuspendReasonKey(requestId) {
    return 'unsuspendReason:' + (requestId || 'legacy');
  }

  function safeJiraUrl(value) {
    return typeof value === 'string' && /^https:\/\/jira\.directi\.com\/browse\/[A-Z][A-Z0-9]+-\d+$/.test(value);
  }

  function selectJiraUrl(displayed, stored) {
    return safeJiraUrl(displayed) ? displayed : (safeJiraUrl(stored) ? stored : '');
  }

  function safeSheetsUrl(value) {
    return typeof value === 'string' && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit(?:$|[?#])/.test(value);
  }


  // Service worker relays per-account unsuspension verdicts here; forward
  // them into the page so app.js can aggregate and confirm to the user.
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.action === 'unsuspend-outcome' && msg.data) {
      window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_OUTCOME', outcome: msg.data }, '*');
    }
  });

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!isAllowedOrigin(event.origin)) return;
    if (!event.data) return;
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.warn('[Report→JIRA] chrome.storage not available — is the extension installed?');
      return;
    }

    if (!validMessage(event.data)) return;
    if (event.data.type === 'REPORT_GENERATOR_JIRA') {
      var data = event.data;
      var text = data.text;
      var html = data.html;
      var panel = data.panel;
      var account = data.account;
      var zdLink = data.zdLink;

      if (!text && !html) return;

      chrome.runtime.sendMessage(
        { action: 'create-jira', data: { text: text, html: html, panel: panel, account: account, zdLink: zdLink, requestId: data.requestId, reportId: data.reportId } },
        function (response) {
          if (chrome.runtime.lastError) {
            window.postMessage({ type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: data.requestId, success: false, error: chrome.runtime.lastError.message }, '*');
            fallbackToStorage(text, html, panel, account, data.reportId, data.requestId);
            return;
          }

          if (response && response.success === true && safeJiraUrl(response.issueUrl)) {
            var jiraUrl = response.issueUrl;
            window.postMessage({ type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: data.requestId, success: true, issueKey: response.issueKey, url: jiraUrl, imagesUploaded: response.imagesUploaded, imagesTotal: response.imagesTotal }, '*');

            chrome.storage.local.set({ [jiraStorageKey(data.reportId, panel, data.requestId)]: { url: jiraUrl } });
          } else {
            window.postMessage({ type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: data.requestId, success: false }, '*');
            fallbackToStorage(text, html, panel, account, data.reportId, data.requestId);
          }
        }
      );
    }

    if (event.data.type === 'REPORT_GENERATOR_UNSUSPEND') {
      var unsuspendData = event.data;
      var accounts = unsuspendData.accounts || [unsuspendData.account];

      chrome.runtime.sendMessage(
        { action: 'create-jira-and-done', data: {
          text: unsuspendData.text || '',
          html: unsuspendData.html || '',
          panel: unsuspendData.panel || '',
          account: accounts.join(', '),
          zdLink: unsuspendData.zdLink || '',
          region: unsuspendData.region || '',
          requestId: unsuspendData.requestId || '',
          reportId: unsuspendData.reportId || ''
        }},
        function (response) {
          if (chrome.runtime.lastError || !response || !response.success) {
            var err = (response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'JIRA creation failed';
            window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', requestId: unsuspendData.requestId, success: false, issueKey: (response && response.issueKey) || null, url: null, unsuspendStatus: (response && response.unsuspendStatus) || null, error: err }, '*');
            return;
          }

          var jiraUrl = response.issueUrl;
          if (!safeJiraUrl(jiraUrl)) {
            window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', requestId: unsuspendData.requestId, success: false, error: 'Invalid JIRA result URL' }, '*');
            return;
          }
          chrome.storage.local.set({ [jiraStorageKey(unsuspendData.reportId, unsuspendData.panel, unsuspendData.requestId)]: { url: jiraUrl } });
          window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', requestId: unsuspendData.requestId, success: true, issueKey: response.issueKey || null, url: jiraUrl || null, unsuspendStatus: response.unsuspendStatus || null }, '*');
        }
      );
    }

    if (event.data.type === 'REPORT_GENERATOR_UNSUSPEND_NO_JIRA') {
      var noJiraData = event.data;
      var noJiraAccounts = noJiraData.accounts || [noJiraData.account];

      var reasonPayload = noJiraData.reason || 'Password Changed';
      chrome.storage.local.set({ [unsuspendReasonKey(noJiraData.requestId)]: { reason: reasonPayload, ts: Date.now() } }, function () {
        if (chrome.runtime.lastError) {
          window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', requestId: noJiraData.requestId, success: false, error: chrome.runtime.lastError.message }, '*');
          return;
        }
        var region = noJiraData.region;
        var accounts = noJiraAccounts;
        chrome.runtime.sendMessage({ action: 'open-abusedesk-tabs', data: { accounts: accounts, region: region, requestId: noJiraData.requestId } }, function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.success) {
            window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', requestId: noJiraData.requestId, success: false, error: (resp && resp.error) || chrome.runtime.lastError?.message || 'Failed opening Abuse Desk tabs' }, '*');
            return;
          }
          window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', requestId: noJiraData.requestId, success: true, opened: resp.opened }, '*');
        });
      });
    }

    if (event.data.type === 'REPORT_GENERATOR_LOG_SHEET') {
      var logData = event.data;

      var jiraKey = jiraStorageKey(logData.reportId, logData.panel, logData.jiraRequestId);
      chrome.storage.local.get(jiraKey, function(result) {
        var storedJiraLink = scopedJiraUrl({ [requestContextKey(logData.reportId, logData.panel, logData.jiraRequestId)]: result[jiraKey] }, logData.reportId, logData.panel, logData.jiraRequestId);
        var jiraLink = selectJiraUrl(logData.jiraLink, storedJiraLink);

        chrome.runtime.sendMessage({
          action: 'log-to-sheet',
          data: {
            date:        logData.date,
            zdLink:      logData.zdLink,
            jiraLink:    jiraLink,
            domainEmail: logData.domainEmail,
            type:        logData.reportType,
            reason:      logData.reason,
            appsScriptUrl: logData.appsScriptUrl || '',
            requestId: logData.requestId,
          }
        }, function(response) {
          var ok = !!(response && response.success);
          var cellUrl = response && safeSheetsUrl(response.cellUrl) ? response.cellUrl : null;
          window.postMessage({ type: 'REPORT_GENERATOR_LOG_SHEET_RESULT', requestId: logData.requestId, success: !!(response && response.success) && (!response.cellUrl || !!cellUrl), cellUrl: cellUrl, unverified: !!(response && response.unverified), error: (response && response.error) || null }, '*');
          if (chrome.runtime.lastError || !ok) {
            console.warn('[Report→Sheet] Failed:', chrome.runtime.lastError?.message);
          }
        });
      });
    }

    if (event.data.type === 'REPORT_GENERATOR_PING') {
      var manifest = chrome.runtime.getManifest();
      window.postMessage({
        type: 'REPORT_GENERATOR_PONG',
        version: manifest.version
      }, '*');
    }

    if (event.data.type === 'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP') {
      var lookupAccount = event.data.account;
      var requestId = event.data.requestId;

      chrome.runtime.sendMessage({
        action: 'partner-panel-lookup',
        data: { account: lookupAccount, requestId: requestId }
      }, function(response) {
        if (chrome.runtime.lastError || !response) {
          window.postMessage({ type: 'PARTNER_PANEL_RESULT', requestId: requestId, data: { success: false, error: chrome.runtime.lastError?.message || 'No response' } }, '*');
          return;
        }
        window.postMessage({ type: 'PARTNER_PANEL_RESULT', requestId: requestId, data: response }, '*');
      });
    }
  });

  function fallbackToStorage(text, html, panel, account, reportId, requestId) {
    var reportData = { text: text, html: html, panel: panel, account: account, reportId: reportId, requestId: requestId, timestamp: Date.now() };

    chrome.storage.local.set({ ['reportData:' + requestContextKey(reportId, panel, requestId)]: reportData }, function () {
      if (chrome.runtime.lastError) {
        console.warn('[Report→JIRA] Storage write failed:', chrome.runtime.lastError.message);
      }
    });

    var label = panel === 'arf' ? 'ARF_unsuspension' : panel === 'smtpsuspend' ? 'SMTP_unsuspension' : 'Bounce_unsuspension';
    var typeLabel = panel === 'arf' ? 'ARF' : panel === 'smtpsuspend' ? 'SMTP Compromised' : 'Bounce';
    var summary = encodeURIComponent(typeLabel + ' unsuspension request: ' + account);
    var desc = encodeURIComponent((text || '').substring(0, 2000));
    var jiraUrl =
      'https://jira.directi.com/secure/CreateIssueDetails!init.jspa?pid=12900&issuetype=10902&priority=10000&labels=' +
      label + '&summary=' + summary + '&description=' + desc + '&rgReportId=' + encodeURIComponent(reportId || '') +
      '&rgRequestId=' + encodeURIComponent(requestId || '') + '&rgPanel=' + encodeURIComponent(panel || '');
    window.open(jiraUrl, '_blank');
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    window.postMessage({
      type: 'REPORT_GENERATOR_PONG',
      version: chrome.runtime.getManifest().version
    }, '*');
  }
})();
