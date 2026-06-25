const EXPIRY_MS = 10 * 60 * 1000;
const DEFAULT_SHEET_ID = '10YgqLp3L66K27jx2KNumtfwe5sKl1VjFzXwQX5pGE3k';
var _partnerPanelResolver = null;

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
  try {
    var url = rowData.appsScriptUrl;
    if (!url) {
      console.warn('[Report→Sheet] No appsScriptUrl provided');
      return false;
    }
    console.log('[Report→Sheet] Posting to Apps Script', url);
    var response = await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: rowData.date || '',
        zdTicketId: rowData.zdLink || '',
        jiraLink: rowData.jiraLink || '',
        domainEmail: rowData.domainEmail || '',
        type: rowData.type || '',
        reason: rowData.reason || '',
      })
    });
    console.log('[Report→Sheet] Sent (opaque response)');
    return true;
  } catch (e) {
    console.warn('[Report→Sheet] Exception:', e.message);
    return false;
  }
}

async function handlePartnerPanelLookup(data, sendResponse) {
  try {
    var account = data.account;
    if (!account) {
      sendResponse({ success: false, error: 'No account provided' });
      return;
    }

    var tab = await new Promise(function(resolve) {
      chrome.tabs.create({ url: 'https://admin.titan.email', active: false }, resolve);
    });

    var loaded = await waitForTabLoad(tab.id, 15000);
    if (!loaded) {
      sendResponse({ success: false, error: 'Tab failed to load' });
      return;
    }

    await sleep(3000);

    var result = await new Promise(function(resolve) {
      _partnerPanelResolver = resolve;
      chrome.tabs.sendMessage(tab.id, { action: 'run-partner-panel-lookup', account: account }, function(r) {
        if (chrome.runtime.lastError) {
          console.warn('[PartnerPanel] sendMessage error:', chrome.runtime.lastError.message);
          _partnerPanelResolver = null;
          resolve({ success: false, error: chrome.runtime.lastError.message });
        }
      });
      setTimeout(function() {
        if (_partnerPanelResolver) {
          _partnerPanelResolver = null;
          resolve({ success: false, error: 'Timeout waiting for partner panel result' });
        }
      }, 60000);
    });

    sendResponse(result);
  } catch (e) {
    console.warn('[PartnerPanel] Exception:', e.message);
    sendResponse({ success: false, error: e.message });
  }
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
    handleCreateJira(message.data, sendResponse);
    return true;
  }

  if (message.action === 'log-to-sheet') {
    openSheetAndLog(message.data)
      .then(success => sendResponse({ success }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === 'create-jira-and-done') {
    handleCreateJiraAndDone(message.data, sendResponse);
    return true;
  }

  if (message.action === 'partner-panel-lookup') {
    handlePartnerPanelLookup(message.data, sendResponse);
    return true;
  }

  if (message.action === 'partner-panel-result') {
    if (_partnerPanelResolver) {
      _partnerPanelResolver(message.data);
      _partnerPanelResolver = null;
    }
    return;
  }
});

async function handleCreateJira(data, sendResponse) {
  try {
    const { text, html, panel, account, zdLink } = data;
    const typeLabel = panel === 'arf' ? 'ARF' : panel === 'smtpsuspend' ? 'SMTP Compromised' : 'Bounce';
    const label = panel === 'arf' ? 'ARF_unsuspension' : panel === 'smtpsuspend' ? 'SMTP_unsuspension' : 'Bounce_unsuspension';
    const summary = `${typeLabel} unsuspension request: ${account}`;

    const images = extractImages(html);

    const issueBody = {
      fields: {
        project: { id: "12900" },
        issuetype: { id: "10902" },
        priority: { id: "10000" },
        summary,
        description: text,
        labels: [label],
        ...(zdLink ? { customfield_12211: zdLink } : {})
      }
    };

    const issueResponse = await fetch('https://jira.directi.com/rest/api/2/issue', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issueBody)
    });

    if (!issueResponse.ok) {
      const errorText = await issueResponse.text();
      sendResponse({ success: false, error: errorText, status: issueResponse.status });
      return;
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

    sendResponse({
      success: true,
      issueKey,
      issueUrl,
      imagesUploaded,
      imagesTotal: images.length
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message, status: 0 });
  }
}

async function handleCreateJiraAndDone(data, sendResponse) {
  try {
    const { text, html, panel, account, zdLink } = data;
    const typeLabel = panel === 'arf' ? 'ARF' : panel === 'smtpsuspend' ? 'SMTP Compromised' : 'Bounce';
    const label = panel === 'arf' ? 'ARF_unsuspension' : panel === 'smtpsuspend' ? 'SMTP_unsuspension' : 'Bounce_unsuspension';
    const summary = `${typeLabel} unsuspension request: ${account}`;

    const images = extractImages(html);

    const issueBody = {
      fields: {
        project: { id: "12900" },
        issuetype: { id: "10902" },
        priority: { id: "10000" },
        summary,
        description: text,
        labels: [label],
        ...(zdLink ? { customfield_12211: zdLink } : {})
      }
    };

    const issueResponse = await fetch('https://jira.directi.com/rest/api/2/issue', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issueBody)
    });

    if (!issueResponse.ok) {
      const errorText = await issueResponse.text();
      sendResponse({ success: false, error: errorText, status: issueResponse.status });
      return;
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

    await markDone(issueKey);

    sendResponse({
      success: true,
      issueKey,
      issueUrl,
      imagesUploaded,
      imagesTotal: images.length
    });
  } catch (error) {
    sendResponse({ success: false, error: error.message, status: 0 });
  }
}

async function markDone(issueKey) {
  try {
    const transResp = await fetch(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/transitions`,
      { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }
    );
    if (!transResp.ok) return;
    const transData = await transResp.json();
    const transitions = transData.transitions;

    const doneTransition = transitions.find(t => t.id === '71');

    if (!doneTransition) return;

    const transPostResp = await fetch(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/transitions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: '71' } })
      }
    );

    if (transPostResp.ok) {
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
        const err = await commentResp.text();
        console.warn('[Report→JIRA] comment failed:', commentResp.status, err);
      }
    }
  } catch (e) {
    console.warn('[Report→JIRA] markDone failed:', e.message);
  }
}

function extractImages(html) {
  const images = [];
  const imgRegex = /<img\s+[^>]*src="(data:image\/([^;]+);base64,([^"]+))"[^>]*>/gi;
  let match;
  let index = 0;

  while ((match = imgRegex.exec(html)) !== null) {
    index++;
    const fullSrc = match[1];
    const imageType = match[2];
    const base64Data = match[3];
    const altRegex = /alt="([^"]*)"/i;
    const altMatch = altRegex.exec(match[0]);
    const altText = altMatch ? altMatch[1] : '';
    const filename = altText ? `${altText.replace(/[^a-z0-9]/gi, '_')}.png` : `screenshot-${index}.png`;

    images.push({
      base64: base64Data,
      mimeType: `image/${imageType}`,
      filename,
      dataUrl: fullSrc
    });
  }

  return images;
}