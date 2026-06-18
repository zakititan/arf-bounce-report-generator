const EXPIRY_MS = 10 * 60 * 1000;

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
});

async function handleCreateJira(data, sendResponse) {
  try {
    const { text, html, panel, account, zdLink } = data;
    const typeLabel = panel === 'arf' ? 'ARF' : 'Bounce';
    const label = panel === 'arf' ? 'ARF_unsuspension' : 'Bounce_unsuspension';
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
    console.log('[Report→JIRA] markDone transitions:', JSON.stringify(transitions.map(t => ({ id: t.id, name: t.name, toName: t.to?.name }))));

    // Match by name first to avoid picking "Duplicate" / "Won't Fix"
    const doneTransition = transitions.find(
      t => t.name === 'Done' || t.name === 'Close' || t.name === 'Close Issue'
    ) || transitions.find(
      t => t.to?.statusCategory?.key === 'done' && !/duplicate|won.t fix|cannot reproduce/i.test(t.name)
    );

    if (!doneTransition) {
      console.log('[Report→JIRA] markDone: no Done transition found');
      return;
    }
    console.log('[Report→JIRA] markDone: using transition', doneTransition.id, doneTransition.name);

    await fetch(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/transitions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: doneTransition.id } })
      }
    );

    // Add comment separately (transition endpoint may not support update.comment)
    await fetch(
      `https://jira.directi.com/rest/api/2/issue/${issueKey}/comment`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Unsuspended' })
      }
    );
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