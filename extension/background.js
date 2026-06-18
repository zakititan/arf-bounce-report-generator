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
    const { text, html, panel, account } = data;
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
        labels: [label]
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