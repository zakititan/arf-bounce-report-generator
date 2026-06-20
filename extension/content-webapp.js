(function () {
  function showToast(html) {
    var existing = document.getElementById('rg-jira-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'rg-jira-toast';
    toast.innerHTML = html;
    toast.style.cssText =
      'position:fixed;bottom:24px;right:24px;background:#1a1a2e;color:#e0e0e0;' +
      'padding:12px 20px;border-radius:8px;font-size:13px;font-family:system-ui,sans-serif;' +
      'z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 300ms ease;';
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 300);
    }, 6000);
  }

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
            fallbackToStorage(text, html, panel, account);
            return;
          }

          if (response && response.success === true) {
            var jiraUrl = response.issueUrl;
            var msg = '<span>JIRA <a href="' + jiraUrl + '" target="_blank" style="color:#5b9bd5;text-decoration:underline;">' + response.issueKey + '</a> created</span>';
            if (response.imagesUploaded < response.imagesTotal) {
              msg += ' — ' + response.imagesUploaded + '/' + response.imagesTotal + ' images attached';
            }
            showToast(msg);

            chrome.storage.local.set({ lastJiraUrl: jiraUrl });
          } else {
            fallbackToStorage(text, html, panel, account);
          }
        }
      );
    }

    if (event.data.type === 'REPORT_GENERATOR_UNSUSPEND') {
      var unsuspendData = event.data;

      chrome.runtime.sendMessage(
        { action: 'create-jira-and-done', data: {
          text: unsuspendData.text || '',
          html: unsuspendData.html || '',
          panel: unsuspendData.panel || '',
          account: unsuspendData.account || '',
          zdLink: unsuspendData.zdLink || ''
        }},
        function (response) {
          if (chrome.runtime.lastError || !response || !response.success) {
            var err = (response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'JIRA creation failed';
            showToast('Failed to create JIRA: ' + err);
            return;
          }

          var jiraUrl = response.issueUrl;

          var abuseDeskUrl = 'https://abusedesk.ops.titan.email/blocked_users.html?entity=' +
            encodeURIComponent(unsuspendData.account) + '&region=' + unsuspendData.region;

          chrome.storage.local.set({
            unsuspendReason: jiraUrl,
            unsuspendAccount: unsuspendData.account
          }, function () {
            window.open(abuseDeskUrl, '_blank');
            var msg = '<span>JIRA <a href="' + jiraUrl + '" target="_blank" style="color:#5b9bd5;text-decoration:underline;">' + response.issueKey + '</a> created — opening Abuse Desk</span>';
            showToast(msg);
          });
        }
      );
    }

    if (event.data.type === 'REPORT_GENERATOR_LOG_SHEET') {
      var logData = event.data;

      chrome.storage.local.get('lastJiraUrl', function(result) {
        var jiraLink = result.lastJiraUrl || logData.fallbackJiraLink;

        chrome.runtime.sendMessage({
          action: 'log-to-sheet',
          data: {
            date:        logData.date,
            zdLink:      logData.zdLink,
            jiraLink:    jiraLink,
            domainEmail: logData.domainEmail,
            type:        logData.reportType,
            reason:      logData.reason,
            sheetId:     logData.sheetId || '',
          }
        }, function(response) {
          if (chrome.runtime.lastError || !response || !response.success) {
            console.warn('[Report→Sheet] Failed:', chrome.runtime.lastError?.message);
          }
        });
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

    var label = panel === 'arf' ? 'ARF_unsuspension' : 'Bounce_unsuspension';
    var typeLabel = panel === 'arf' ? 'ARF' : 'Bounce';
    var summary = encodeURIComponent(typeLabel + ' unsuspension request: ' + account);
    var jiraUrl =
      'https://jira.directi.com/secure/CreateIssueDetails!init.jspa?pid=12900&issuetype=10902&priority=10000&labels=' +
      label + '&summary=' + summary;
    window.open(jiraUrl, '_blank');

    showToast('API unavailable — opening JIRA page instead');
  }
})();
