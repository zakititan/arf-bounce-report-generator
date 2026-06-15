// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data directly from chrome.storage.local
// and injects into the JIRA description editor.
// Strategy: set textarea value → click Visual tab → JIRA renders HTML.

(() => {
  const POLL_INTERVAL = 300;
  const MAX_WAIT_MS = 15000;
  const EXPIRY_MS = 10 * 60 * 1000;

  function log(msg) { console.log('[Report→JIRA] ' + msg); }
  function warn(msg) { console.warn('[Report→JIRA] ' + msg); }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      background: '#1a1a2e',
      color: '#e0e0e0',
      padding: '12px 20px',
      borderRadius: '8px',
      fontSize: '13px',
      fontFamily: 'system-ui, sans-serif',
      zIndex: '999999',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s',
      opacity: '1',
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function getReportData() {
    return new Promise((resolve) => {
      chrome.storage.local.get('reportData', (result) => {
        if (chrome.runtime.lastError) {
          warn('Storage read failed: ' + chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        const data = result.reportData;
        if (!data) { resolve(null); return; }
        if (Date.now() - (data.timestamp || 0) > EXPIRY_MS) {
          log('Report data expired');
          chrome.storage.local.remove('reportData');
          resolve(null);
          return;
        }
        resolve(data);
      });
    });
  }

  function clearReportData() {
    chrome.storage.local.remove('reportData');
  }

  // Find the description textarea (always exists on JIRA create page)
  function findTextarea() {
    return document.querySelector('textarea#description');
  }

  // Find the Visual/Text tab toggle buttons
  function findTabs() {
    const container = document.querySelector('#description-wiki-edit') ||
                      document.querySelector('#description-field') ||
                      document.querySelector('.field-group:has(textarea#description)');
    if (!container) return { visualTab: null, textTab: null };

    const allClickable = container.querySelectorAll('a, button, span, div, li');
    let visualTab = null;
    let textTab = null;

    for (const el of allClickable) {
      const txt = el.textContent.trim().toLowerCase();
      if (txt === 'visual' || txt === 'rich text') visualTab = el;
      if (txt === 'text' || txt === 'wiki' || txt === 'source') textTab = el;
    }

    // Fallback: data-mode attributes
    if (!visualTab) visualTab = container.querySelector('[data-mode="visual"], [data-mode="wysiwyg"]');
    if (!textTab) textTab = container.querySelector('[data-mode="text"], [data-mode="wiki"], [data-mode="source"]');

    return { visualTab, textTab };
  }

  // Build HTML from report text — preserves line breaks, uses monospace
  function buildReportHtml(text) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const lines = escaped.split('\n');
    const htmlLines = lines.map(line => '<p>' + (line || '&nbsp;') + '</p>');
    return htmlLines.join('');
  }

  // Inject report into JIRA description
  async function inject() {
    const data = await getReportData();
    if (!data) {
      log('No report data in storage');
      return;
    }

    log('Report found: panel=' + data.panel + ', account=' + data.account);

    // Wait for textarea to exist
    const ta = await new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const el = findTextarea();
        if (el) { clearInterval(poll); resolve(el); }
        else if (Date.now() - start > MAX_WAIT_MS) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });

    if (!ta) {
      warn('Textarea#description not found');
      showToast('Report ready — paste manually with Ctrl+V');
      return;
    }

    log('Found textarea#description');

    // Set the textarea value (this is what JIRA submits)
    ta.value = data.text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    log('Set textarea.value (' + data.text.length + ' chars)');

    // Now try to switch to Visual mode so the user sees rendered content
    const { visualTab } = findTabs();
    if (visualTab) {
      log('Clicking Visual tab');
      visualTab.click();
      // Wait a moment for JIRA to render the HTML
      await new Promise(r => setTimeout(r, 500));
      log('Switched to Visual mode');
    } else {
      log('Visual tab not found — content is in Text mode');
    }

    clearReportData();
    showToast('Report auto-pasted from Report Generator ✓');
    log('Done!');
  }

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
