import { REASON_TTL_MS, JIRA_DONE_TRANSITION_ID, analyzeHistory, buildJiraIssueBody, extractImagesRegex, isReasonFresh } from './rg-lib.js';

const EXPIRY_MS = 10 * 60 * 1000;
let _partnerPanelPending = null;
const _openAdTabIds = new Set();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForTabLoad(tabId, maxMs) {
  return new Promise(resolve => {
    const listener = function(tabId_, changeInfo) {
      if (tabId_ === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, maxMs);
  });
}

async function openSheetAndLog(rowData) {
  const url = rowData.appsScriptUrl;
  if (!url) {
    console.warn('[Report→Sheet] No appsScriptUrl provided');
    return { success: false, error: 'No appsScriptUrl provided' };
  }

  const payload = JSON.stringify({
    date: rowData.date || '',
    zdTicketId: rowData.zdLink || '',
    jiraLink: rowData.jiraLink || '',
    domainEmail: rowData.domainEmail || '',
    type: rowData.type || '',
    reason: rowData.reason || '',
  });

  let response;
  try {
    console.log('[Report→Sheet] Posting to Apps Script', url);
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  } catch (e) {
    console.warn('[Report→Sheet] Exception:', e.message);
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      return { success: true, unverified: true };
    } catch (e2) {
      return { success: false, error: e2.message };
    }
  }

  let parsed = null;
  try {
    parsed = await response.json();
  } catch (e) {
    parsed = null;
  }
  if (parsed && parsed.status === 'success') {
    return { success: true, row: parsed.row, cellUrl: parsed.cellUrl };
  }
  return { success: false, error: (parsed && parsed.message) || 'Apps Script error' };
}

async function handlePartnerPanelLookup(data, sendResponse) {
  let tab = null;
  try {
    const account = data.account;
    if (!account) {
      sendResponse({ success: false, error: 'No account provided' });
      return;
    }
    const requestId = data.requestId;

    tab = await new Promise(function(resolve) {
      chrome.tabs.create({ url: 'https://admin.titan.email', active: false }, resolve);
    });

    const loaded = await waitForTabLoad(tab.id, 15000);
    if (!loaded) {
      sendResponse({ success: false, error: 'Tab failed to load' });
      return;
    }

    await sleep(3000);

    const result = await new Promise(function(resolve) {
      _partnerPanelPending = { requestId, resolve };
      chrome.tabs.sendMessage(tab.id, { action: 'run-partner-panel-lookup', account, requestId }, function(r) {
        if (chrome.runtime.lastError) {
          console.warn('[PartnerPanel] sendMessage error:', chrome.runtime.lastError.message);
          _partnerPanelPending = null;
          resolve({ success: false, error: chrome.runtime.lastError.message });
        }
      });
      setTimeout(function() {
        if (_partnerPanelPending && _partnerPanelPending.requestId === requestId) {
          _partnerPanelPending = null;
          resolve({ success: false, error: 'Timeout waiting for partner panel result' });
        }
      }, 60000);
    });

    if (result && result.success && Array.isArray(result.events)) {
      const history = analyzeHistory(result.events);
      sendResponse({
        success: true,
        account: result.account,
        passwordChanged: history.passwordChanged,
        suspensionDate: history.suspensionDate,
        lastPasswordResetDate: history.lastPasswordResetDate
      });
    } else {
      sendResponse(result);
    }
  } catch (e) {
    console.warn('[PartnerPanel] Exception:', e.message);
    sendResponse({ success: false, error: e.message });
  } finally {
    if (tab && tab.id != null) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function openAbuseDeskTabs(accounts, region) {
  let opened = 0;
  for (const account of accounts) {
    const url = 'https://abusedesk.ops.titan.email/blocked_users.html?entity=' +
      encodeURIComponent(account) + '&region=' + region;
    const tab = await new Promise(resolve => chrome.tabs.create({ url, active: false }, resolve));
    _openAdTabIds.add(tab.id);
    opened++;
  }
  return opened;
}

const WEBAPP_TAB_MATCHES = [
  'https://arf-bounce-report-generator.vercel.app/*',
  'https://*.vercel.app/*',
  'http://localhost:3000/*'
];

function forwardUnsuspendOutcome(data) {
  chrome.tabs.query({ url: WEBAPP_TAB_MATCHES }, tabs => {
    if (chrome.runtime.lastError || !tabs || !tabs.length) return;
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'unsuspend-outcome', data }, () => {
        void chrome.runtime.lastError; // tab may have navigated — ignore
      });
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'store-report') {
    const reportData = {
      text: message.data.text || '',
      html: message.data.html || '',
      panel: message.data.panel || '',
      account: message.data.account || '',
      timestamp: message.data.timestamp || Date.now(),
    };
    chrome.storage.local.set({ reportData }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'get-report') {
    chrome.storage.local.get('reportData', (result) => {
      const data = result.reportData;
      if (!data) {
        sendResponse({ found: false });
        return;
      }
      if (Date.now() - data.timestamp > EXPIRY_MS) {
        chrome.storage.local.remove('reportData', () => {
          sendResponse({ found: false, reason: 'expired' });
        });
        return;
      }
      chrome.storage.local.remove('reportData', () => {
        sendResponse({ found: true, data });
      });
    });
    return true;
  }

  if (message.action === 'create-jira') {
    handleCreateJira(message.data, false)
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e.message, status: 0 }));
    return true;
  }

  if (message.action === 'log-to-sheet') {
    openSheetAndLog(message.data)
      .then(result => sendResponse(result))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === 'create-jira-and-done') {
    handleCreateJira(message.data, true)
      .then(async result => {
        if (result.success === true) {
          chrome.storage.local.set({
            unsuspendReason: { reason: result.issueUrl, ts: Date.now() }
          });
          const accounts = String(message.data.account || '')
            .split(', ')
            .map(s => s.trim())
            .filter(Boolean);
          try {
            result.opened = await openAbuseDeskTabs(accounts, message.data.region);
          } catch (e) {
            console.warn('[Report→JIRA] opening Abuse Desk tabs failed:', e.message);
          }
        }
        sendResponse(result);
      })
      .catch(e => sendResponse({ success: false, error: e.message, status: 0 }));
    return true;
  }

  if (message.action === 'open-abusedesk-tabs') {
    const d = message.data || {};
    if (!Array.isArray(d.accounts) || d.accounts.length === 0 ||
        !d.accounts.every(a => typeof a === 'string' && a.trim())) {
      sendResponse({ success: false, error: 'Invalid accounts array' });
      return true;
    }
    openAbuseDeskTabs(d.accounts, typeof d.region === 'string' ? d.region : '')
      .then(opened => sendResponse({ success: true, opened }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'partner-panel-lookup') {
    handlePartnerPanelLookup(message.data, sendResponse);
    return true;
  }

  if (message.action === 'ad-user-status') {
    // Fallback verification path: the Abuse Desk page renders its status
    // badge from this API; fetch it directly (host permission granted).
    const account = message.data && message.data.account;
    if (!account) { sendResponse({ success: false, error: 'No account' }); return true; }
    fetch('https://api-abusedesk.ops.titan.email/api/v1/users/status/?email=' + encodeURIComponent(account), { credentials: 'include' })
      .then(r => r.json())
      .then(json => {
        const flat = JSON.stringify(json || {});
        const m = flat.match(/"user_?status"\s*:\s*"([^"]+)"/i);
        const status = m ? m[1] : '';
        sendResponse({ success: !!status, status });
      })
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'ad-tab-done') {
    const tid = sender && sender.tab && sender.tab.id;
    const d = message.data || {};
    const outcome = d.outcome || (d.failed ? 'failed' : 'unknown');
    // Relay the verdict back to the report page so the user gets an explicit
    // confirmation there, not just the transient on-page toast.
    forwardUnsuspendOutcome({ outcome, account: d.account || '' });
    if (typeof tid === 'number' && _openAdTabIds.has(tid)) {
      _openAdTabIds.delete(tid);
      // Let the user read the on-page toast: short on verified, longer otherwise.
      const delay = outcome === 'confirmed' ? 3000 : outcome === 'failed' ? 12000 : 10000;
      setTimeout(() => { chrome.tabs.remove(tid).catch(() => {}); }, delay);
    }
    return;
  }

  if (message.action === 'partner-panel-result') {
    const resultReqId = message.requestId !== undefined
      ? message.requestId
      : (message.data && message.data.requestId);
    if (_partnerPanelPending && resultReqId === _partnerPanelPending.requestId) {
      _partnerPanelPending.resolve(message.data);
      _partnerPanelPending = null;
    }
    return;
  }
});

async function handleCreateJira(data, andDone) {
  try {
    const { text, html, panel, account, zdLink } = data;

    const issueBody = buildJiraIssueBody({ text, panel, account, zdLink });
    const images = extractImagesRegex(html);

    const issueResponse = await fetch('https://jira.directi.com/rest/api/2/issue', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issueBody)
    });

    if (!issueResponse.ok) {
      const errorText = await issueResponse.text();
      return { success: false, error: errorText, status: issueResponse.status };
    }

    const issueData = await issueResponse.json();
    const issueKey = issueData.key;
    const issueUrl = `https://jira.directi.com/browse/${issueKey}`;

    let imagesUploaded = 0;
    for (const image of images) {
      try {
        const binary = atob(image.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: image.mimeType });
        const formData = new FormData();
        formData.append('file', blob, image.filename);

        await fetch(`https://jira.directi.com/rest/api/2/issue/${issueKey}/attachments`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Atlassian-Token': 'no-check' },
          body: formData
        });
        imagesUploaded++;
      } catch (e) {
        // Continue with other images
      }
    }

    const result = {
      success: true,
      issueKey,
      issueUrl,
      imagesUploaded,
      imagesTotal: images.length
    };

    if (andDone) {
      result.unsuspendStatus = await markDone(issueKey);
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message, status: 0 };
  }
}

async function markDone(issueKey) {
  try {
    const transPostResp = await fetch(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/transitions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: JIRA_DONE_TRANSITION_ID } })
      }
    );

    if (!transPostResp.ok) {
      const errText = await transPostResp.text();
      console.warn('[Report→JIRA] transition failed:', transPostResp.status, errText);
      return { done: false, commented: false, error: `Transition failed (${transPostResp.status}): ${errText}` };
    }

    const commentResp = await fetch(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/comment`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Unsuspended' })
      }
    );

    if (!commentResp.ok) {
      const errText = await commentResp.text();
      console.warn('[Report→JIRA] comment failed:', commentResp.status, errText);
      return { done: true, commented: false, error: `Comment failed (${commentResp.status}): ${errText}` };
    }

    return { done: true, commented: true };
  } catch (e) {
    console.warn('[Report→JIRA] markDone failed:', e.message);
    return { done: false, commented: false, error: e.message };
  }
}
