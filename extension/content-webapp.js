(function () {
  // Note: this script deliberately renders NO toasts of its own. The web app
  // (app.js) owns all on-page notifications - extension toasts used to stack on
  // top of the app toast in the bottom-right corner and overlap it.


  // Service worker relays per-account unsuspension verdicts here; forward
  // them into the page so app.js can aggregate and confirm to the user.
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.action === 'unsuspend-outcome' && msg.data) {
      window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_OUTCOME', outcome: msg.data }, '*');
    }
  });

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data) return;
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.warn('[Report→JIRA] chrome.storage not available — is the extension installed?');
      return;
    }

    if (event.data.type === 'REPORT_GENERATOR_JIRA') {
      var data = event.data;
      var text = data.text;
      var html = data.html;
      var panel = data.panel;
      var account = data.account;
      var zdLink = data.zdLink;

      if (!text && !html) return;

      chrome.runtime.sendMessage(
        { action: 'create-jira', data: { text: text, html: html, panel: panel, account: account, zdLink: zdLink } },
        function (response) {
          if (chrome.runtime.lastError) {
            window.postMessage({ type: 'REPORT_GENERATOR_JIRA_RESULT', success: false }, '*');
            fallbackToStorage(text, html, panel, account);
            return;
          }

          if (response && response.success === true) {
            var jiraUrl = response.issueUrl;
            window.postMessage({ type: 'REPORT_GENERATOR_JIRA_RESULT', success: true, issueKey: response.issueKey, url: jiraUrl, imagesUploaded: response.imagesUploaded, imagesTotal: response.imagesTotal }, '*');

            chrome.storage.local.set({ lastJiraUrl: jiraUrl });
          } else {
            window.postMessage({ type: 'REPORT_GENERATOR_JIRA_RESULT', success: false }, '*');
            fallbackToStorage(text, html, panel, account);
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
          region: unsuspendData.region || ''
        }},
        function (response) {
          if (chrome.runtime.lastError || !response || !response.success) {
            var err = (response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'JIRA creation failed';
            window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', success: false, issueKey: (response && response.issueKey) || null, url: null, unsuspendStatus: (response && response.unsuspendStatus) || null, error: err }, '*');
            return;
          }

          var jiraUrl = response.issueUrl;
          chrome.storage.local.set({ lastJiraUrl: jiraUrl });
          window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', success: true, issueKey: response.issueKey || null, url: jiraUrl || null, unsuspendStatus: response.unsuspendStatus || null }, '*');
        }
      );
    }

    if (event.data.type === 'REPORT_GENERATOR_UNSUSPEND_NO_JIRA') {
      var noJiraData = event.data;
      var noJiraAccounts = noJiraData.accounts || [noJiraData.account];

      var reasonPayload = noJiraData.reason || 'Password Changed';
      chrome.storage.local.set({ unsuspendReason: { reason: reasonPayload, ts: Date.now() } }, function () {
        if (chrome.runtime.lastError) {
          window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', success: false, error: chrome.runtime.lastError.message }, '*');
          return;
        }
        var region = noJiraData.region;
        var accounts = noJiraAccounts;
        chrome.runtime.sendMessage({ action: 'open-abusedesk-tabs', data: { accounts: accounts, region: region } }, function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.success) {
            window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', success: false, error: (resp && resp.error) || chrome.runtime.lastError?.message || 'Failed opening Abuse Desk tabs' }, '*');
            return;
          }
          window.postMessage({ type: 'REPORT_GENERATOR_UNSUSPEND_RESULT', success: true, opened: resp.opened }, '*');
        });
      });
    }

    if (event.data.type === 'REPORT_GENERATOR_LOG_SHEET') {
      var logData = event.data;

      chrome.storage.local.get('lastJiraUrl', function(result) {
        var jiraLink = result.lastJiraUrl || '';

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
          }
        }, function(response) {
          var ok = !!(response && response.success);
          window.postMessage({ type: 'REPORT_GENERATOR_LOG_SHEET_RESULT', success: !!(response && response.success), cellUrl: (response && response.cellUrl) || null, unverified: !!(response && response.unverified), error: (response && response.error) || null }, '*');
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
      var requestId = 'pp_' + Date.now();

      chrome.runtime.sendMessage({
        action: 'partner-panel-lookup',
        data: { account: lookupAccount, requestId: requestId }
      }, function(response) {
        if (chrome.runtime.lastError || !response) {
          window.postMessage({ type: 'PARTNER_PANEL_RESULT', data: { success: false, error: chrome.runtime.lastError?.message || 'No response' } }, '*');
          return;
        }
        window.postMessage({ type: 'PARTNER_PANEL_RESULT', data: response }, '*');
      });
    }
  });

  function fallbackToStorage(text, html, panel, account) {
    var reportData = { text: text, html: html, panel: panel, account: account, timestamp: Date.now() };

    chrome.storage.local.set({ reportData: reportData }, function () {
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
      label + '&summary=' + summary + '&description=' + desc;
    window.open(jiraUrl, '_blank');
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    window.postMessage({
      type: 'REPORT_GENERATOR_PONG',
      version: chrome.runtime.getManifest().version
    }, '*');
  }
})();
