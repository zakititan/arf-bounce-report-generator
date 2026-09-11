import { REASON_TTL_MS, JIRA_DONE_TRANSITION_ID, analyzeHistory, buildJiraIssueBody, extractImagesRegex, isReasonFresh, isSuccessfulResponse, areValidAccountList, normalizeAccountList, createUnsuspendReasonKey, createPerAccountUnsuspendReasonKey, persistUnsuspendReason, isSafeJiraUrl, isSafeGoogleSheetsUrl, isSafeAppsScriptUrl, createPendingMap, capInlineImages, isValidJiraCreatePayload, discoverDoneTransitionId, buildBulkSummary, findStaleStorageKeys, buildAbuseDeskUrl } from './rg-lib.js';
import { fetchWithTimeout } from './timeout.js';

const EXPIRY_MS = 10 * 60 * 1000;
// Outstanding partner-panel lookups keyed by requestId — concurrent lookups
// no longer clobber each other the way a single global slot did.
const _partnerPanelPending = createPendingMap();
const _openAdTabIds = new Set();

// Storage keys are write-only during runs (reasons, verify markers, fallback
// reports, JIRA links) — sweep expired ones at startup so a long-lived
// profile can't grow chrome.storage.local toward its quota forever.
try {
  chrome.storage.local.get(null, (all) => {
    try {
      if (chrome.runtime.lastError || !all) return;
      const stale = findStaleStorageKeys(all, Date.now());
      if (stale.length) chrome.storage.local.remove(stale, () => { void chrome.runtime.lastError; });
    } catch (_) {}
  });
} catch (_) {}

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

  // Google Apps Script never returns CORS headers for extension origins —
  // skip the CORS attempt (which always fails) and go straight to no-cors.
  // Only allowlist-approved logging URLs are ever fetched.
  if (!isSafeAppsScriptUrl(url)) {
    return { success: false, error: 'Apps Script URL not allowlisted' };
  }
  const isGas = /script\.google\.com/i.test(url);
  if (!isGas) {
    let response;
    try {
      console.log('[Report→Sheet] Posting to Apps Script', url);
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      let parsed = null;
      try { parsed = await response.json(); } catch (_) { parsed = null; }
      if (parsed && parsed.status === 'success') {
        return isSafeGoogleSheetsUrl(parsed.cellUrl)
          ? { success: true, row: parsed.row, cellUrl: parsed.cellUrl }
          : { success: false, error: 'Invalid Sheets cell URL' };
      }
      return { success: false, error: (parsed && parsed.message) || 'Apps Script error' };
    } catch (e) {
      console.warn('[Report→Sheet] CORS fetch failed:', e.message);
    }
  }

  // no-cors fallback — opaque response, can't read body
  try {
    console.log('[Report→Sheet] Posting (no-cors)', url);
    await fetchWithTimeout(url, {
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

async function handlePartnerPanelLookup(data, sendResponse) {
  let tab = null;
  try {
    const account = data.account;
    if (!areValidAccountList(account)) {
      sendResponse({ success: false, error: 'No account provided' });
      return;
    }
    const requestId = data.requestId;

    tab = await new Promise(function(resolve) {
      chrome.tabs.create({ url: 'https://admin.titan.email', active: false }, resolve);
    });
    if (!tab || tab.id == null) {
      const err = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Tab creation failed';
      console.warn('[PartnerPanel] tabs.create failed:', err);
      sendResponse({ success: false, error: err });
      return;
    }

    const loaded = await waitForTabLoad(tab.id, 15000);
    if (!loaded) {
      sendResponse({ success: false, error: 'Tab failed to load' });
      return;
    }

    await sleep(3000);

    const result = await new Promise(function(resolve) {
      _partnerPanelPending.set(requestId, { resolve });
      chrome.tabs.sendMessage(tab.id, { action: 'run-partner-panel-lookup', account, requestId }, function(r) {
        if (chrome.runtime.lastError) {
          console.warn('[PartnerPanel] sendMessage error:', chrome.runtime.lastError.message);
          _partnerPanelPending.resolve(requestId, { success: false, error: chrome.runtime.lastError.message });
        }
      });
      setTimeout(function() {
        if (_partnerPanelPending.has(requestId)) {
          _partnerPanelPending.resolve(requestId, { success: false, error: 'Timeout waiting for partner panel result' });
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

async function openAbuseDeskTabs(accounts, region, requestId) {
  if (!areValidAccountList(accounts)) throw new Error('Invalid account or email domain');
  let opened = 0;
  for (const account of accounts) {
    const url = buildAbuseDeskUrl(account, region, requestId);
    const tab = await new Promise(resolve => chrome.tabs.create({ url, active: false }, resolve));
    if (!tab || tab.id == null) {
      console.warn('[Report→AbuseDesk][' + (requestId || 'legacy') + '] tabs.create failed for ' + account + ':',
        (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'unknown error');
      continue;
    }
    _openAdTabIds.add(tab.id);
    opened++;
  }
  return opened;
}

// Domain verdicts are read in a fresh tab (the AD page is janky on reload
// for domain lookups). The sender tab already saved and has nothing left to
// do, so it is swapped out: untracked and closed, verdict comes from the
// fresh tab through the normal ad-tab-done path.
async function openVerifyTabInBackground(account, region, requestId, senderTabId) {
  const url = buildAbuseDeskUrl(account, region, requestId);
  const tab = await new Promise(resolve => chrome.tabs.create({ url, active: false }, resolve));
  if (!tab || tab.id == null) {
    throw new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Tab creation failed');
  }
  _openAdTabIds.add(tab.id);
  if (typeof senderTabId === 'number') {
    _openAdTabIds.delete(senderTabId);
    chrome.tabs.remove(senderTabId).catch(() => {});
  }
  return tab.id;
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
    if (!message.data || !areValidAccountList(message.data.account)) {
      sendResponse({ success: false, error: 'Invalid account or email domain' });
      return true;
    }
    handleCreateJira(message.data, true)
      .then(async result => {
        if (result.success === true) {
          // Store the shared per-request key plus one per-account key so slow
          // bulk tabs can still find a fresh reason under their own account.
          const accounts = normalizeAccountList(message.data.account);
          const reasonRecord = { reason: result.issueUrl, ts: Date.now() };
          const reasonValue = { [createUnsuspendReasonKey(message.data.requestId)]: reasonRecord };
          for (const account of accounts) {
            reasonValue[createPerAccountUnsuspendReasonKey(message.data.requestId, account)] = reasonRecord;
          }
          await persistUnsuspendReason(
            (value, callback) => chrome.storage.local.set(value, callback),
            () => chrome.runtime.lastError,
            reasonValue
          );
          try {
            result.opened = await openAbuseDeskTabs(accounts, message.data.region, message.data.requestId);
          } catch (e) {
            console.warn('[Report→JIRA][' + (message.data.requestId || 'legacy') + '] opening Abuse Desk tabs failed:', e.message);
          }
        }
        sendResponse(result);
      })
      .catch(e => sendResponse({ success: false, error: e.message, status: 0 }));
    return true;
  }

  if (message.action === 'open-abusedesk-tabs') {
    const d = message.data || {};
    const accounts = normalizeAccountList(d.accounts);
    if (!areValidAccountList(accounts)) {
      sendResponse({ success: false, error: 'Invalid accounts array' });
      return true;
    }
    openAbuseDeskTabs(accounts, typeof d.region === 'string' ? d.region : '', d.requestId)
      .then(opened => sendResponse({ success: true, opened }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'open-verify-tab') {
    const d = message.data || {};
    const tid = sender && sender.tab && sender.tab.id;
    if (!areValidAccountList(d.account)) {
      sendResponse({ success: false, error: 'Invalid account or email domain' });
      return true;
    }
    openVerifyTabInBackground(d.account, typeof d.region === 'string' ? d.region : '', d.requestId, tid)
      .then(tabId => sendResponse({ success: true, tabId }))
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
    if (!areValidAccountList(account)) { sendResponse({ success: false, error: 'Invalid account or email domain' }); return true; }
    fetchWithTimeout('https://api-abusedesk.ops.titan.email/api/v1/users/status/?email=' + encodeURIComponent(account), { credentials: 'include' })
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
    const requestId = d.requestId || 'legacy';
    console.log('[Report→AbuseDesk][' + requestId + '] tab done for ' + (d.account || 'unknown') + ': ' + outcome);
    // Relay the verdict back to the report page so the user gets an explicit
    // confirmation there, not just the transient on-page toast. The cause
    // (when present) travels with it for the verdict chip tooltip.
    forwardUnsuspendOutcome({ outcome, account: d.account || '', requestId: d.requestId, cause: d.cause || '' });
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
    // Unknown/stale keys are ignored (resolve returns false) instead of
    // clobbering another lookup's slot.
    if (typeof resultReqId === 'string') _partnerPanelPending.resolve(resultReqId, message.data);
    return;
  }
});

async function handleCreateJira(data, andDone) {
  try {
    const { text, html, panel, account, zdLink } = data;
    if (!areValidAccountList(account)) return { success: false, error: 'Invalid account or email domain', status: 400 };
    if (!isValidJiraCreatePayload({ text, html, account, panel })) {
      return { success: false, error: 'Empty report: nothing to file (no text and no images)', status: 400 };
    }
    const requestId = data.requestId || 'legacy';
    const cleanAccount = buildBulkSummary(account);
    console.log('[Report→JIRA][' + requestId + '] creating issue for ' + cleanAccount);

    const issueBody = buildJiraIssueBody({ text, panel, account: cleanAccount, zdLink });
    const capped = capInlineImages(extractImagesRegex(html));
    const images = capped.kept;

    const issueResponse = await fetchWithTimeout('https://jira.directi.com/rest/api/2/issue', {
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
    if (!isSafeJiraUrl(issueUrl)) return { success: false, error: 'Invalid JIRA result URL', status: 502 };

    let imagesUploaded = 0;
    const attachmentFailures = [];
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

        const attachmentResponse = await fetchWithTimeout(`https://jira.directi.com/rest/api/2/issue/${issueKey}/attachments`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Atlassian-Token': 'no-check' },
          body: formData
        });
        if (isSuccessfulResponse(attachmentResponse)) {
          imagesUploaded++;
        } else {
          const errorText = await attachmentResponse.text().catch(() => '');
          const failure = { filename: image.filename, status: attachmentResponse.status, error: errorText };
          attachmentFailures.push(failure);
          console.warn('[Report→JIRA][' + requestId + '] attachment failed:', failure);
        }
      } catch (e) {
        attachmentFailures.push({ filename: image.filename, status: 0, error: e.message });
        console.warn('[Report→JIRA][' + requestId + '] attachment failed:', image.filename, e.message);
      }
    }

    const result = {
      success: true,
      issueKey,
      issueUrl,
      imagesUploaded,
      imagesTotal: images.length,
      imagesDropped: capped.dropped.count,
      imagesFailed: attachmentFailures.length,
      attachmentFailures
    };

    if (andDone) {
      result.unsuspendStatus = await markDone(issueKey, requestId, cleanAccount);
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message, status: 0 };
  }
}

async function markDone(issueKey, requestId = 'legacy', context = '') {
  try {
    // Discover the Done transition instead of assuming the hardcoded id —
    // fall back to JIRA_DONE_TRANSITION_ID when discovery fails.
    let transitionId = JIRA_DONE_TRANSITION_ID;
    try {
      const transGetResp = await fetchWithTimeout(
        `https://jira.directi.com/rest/api/2/issue/${issueKey}/transitions`,
        { credentials: 'include', headers: { 'Accept': 'application/json' } }
      );
      if (transGetResp.ok) {
        const discovered = discoverDoneTransitionId(await transGetResp.json());
        if (discovered) transitionId = discovered;
      }
    } catch (e) {
      console.warn('[Report→JIRA][' + requestId + '] transition discovery failed, using default:', e.message);
    }
    const transPostResp = await fetchWithTimeout(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/transitions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: transitionId } })
      }
    );

    if (!transPostResp.ok) {
      const errText = await transPostResp.text();
      console.warn('[Report→JIRA][' + requestId + '] transition failed:', transPostResp.status, errText);
      return { done: false, commented: false, error: `Transition failed (${transPostResp.status}): ${errText}` };
    }

    const commentResp = await fetchWithTimeout(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/comment`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: context ? 'Unsuspended ' + context : 'Unsuspended' })
      }
    );

    if (!commentResp.ok) {
      const errText = await commentResp.text();
      console.warn('[Report→JIRA][' + requestId + '] comment failed:', commentResp.status, errText);
      return { done: true, commented: false, error: `Comment failed (${commentResp.status}): ${errText}` };
    }

    return { done: true, commented: true };
  } catch (e) {
    console.warn('[Report→JIRA][' + requestId + '] markDone failed:', e.message);
    return { done: false, commented: false, error: e.message };
  }
}
