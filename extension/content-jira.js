// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data directly from chrome.storage.local
// and injects into the JIRA Visual editor.
// Strategy: click Visual tab → find editor → inject HTML with images.

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
    if (!container) return { visualTab: null, textTab: null, container: null };

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

    return { visualTab, textTab, container };
  }

  // Wait for any contenteditable element to appear (the Visual editor)
  function waitForVisualEditor(maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        // 1. TinyMCE
        if (typeof tinymce !== 'undefined' && tinymce.get) {
          const ed = tinymce.get('description');
          if (ed) { clearInterval(poll); resolve({ type: 'tinymce', editor: ed }); return; }
        }
        // 2. Contenteditable div (JIRA Server wiki editor)
        const ce = document.querySelector('#description-wiki-edit div[contenteditable="true"]') ||
                   document.querySelector('#description-field div[contenteditable="true"]') ||
                   document.querySelector('div[contenteditable="true"][id*="description"]');
        if (ce) { clearInterval(poll); resolve({ type: 'contenteditable', element: ce }); return; }
        // 3. Iframe-based editor (some JIRA versions)
        const iframe = document.querySelector('#description-wiki-edit iframe') ||
                       document.querySelector('#description-field iframe');
        if (iframe && iframe.contentDocument) {
          const body = iframe.contentDocument.body;
          if (body) { clearInterval(poll); resolve({ type: 'iframe', element: body }); return; }
        }
        // 4. Any visible contenteditable anywhere
        const all = document.querySelectorAll('[contenteditable="true"]');
        for (const el of all) {
          if (el.offsetParent !== null && el.id && el.id.toLowerCase().includes('description')) {
            clearInterval(poll); resolve({ type: 'contenteditable', element: el }); return;
          }
        }
        if (Date.now() - start > maxMs) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });
  }

  // Inject HTML into the visual editor
  function injectIntoEditor(editorInfo, html, text) {
    const { type } = editorInfo;

    if (type === 'tinymce') {
      const ed = editorInfo.editor;
      ed.setContent(html);
      ed.fire('change');
      ed.fire('input');
      log('Injected via TinyMCE.setContent()');
      return true;
    }

    if (type === 'contenteditable') {
      const el = editorInfo.element;
      el.focus();
      el.innerHTML = html;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      log('Injected via contenteditable.innerHTML');
      return true;
    }

    if (type === 'iframe') {
      const body = editorInfo.element;
      body.innerHTML = html;
      body.dispatchEvent(new Event('input', { bubbles: true }));
      body.dispatchEvent(new Event('change', { bubbles: true }));
      log('Injected via iframe body.innerHTML');
      return true;
    }

    return false;
  }

  // Fallback: inject via clipboard paste simulation
  async function injectViaClipboard(html, text) {
    try {
      // Write HTML to clipboard
      const blob = new Blob([html], { type: 'text/html' });
      const plainBlob = new Blob([text], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blob,
        'text/plain': plainBlob,
      });
      await navigator.clipboard.write([item]);
      log('Wrote HTML to clipboard');

      // Simulate Ctrl+V
      document.execCommand('paste');
      log('Simulated paste');
      return true;
    } catch (err) {
      warn('Clipboard paste failed: ' + err.message);
      return false;
    }
  }

  // Main injection flow
  async function inject() {
    const data = await getReportData();
    if (!data) {
      log('No report data in storage');
      return;
    }

    log('Report found: panel=' + data.panel + ', account=' + data.account);

    // Wait for textarea to exist (it's always present on create page)
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

    // Step 1: Click the Visual tab to activate the rich text editor
    const { visualTab } = findTabs();
    if (visualTab) {
      log('Clicking Visual tab');
      visualTab.click();
      await new Promise(r => setTimeout(r, 500));
      log('Switched to Visual mode');
    } else {
      warn('Visual tab not found');
    }

    // Step 2: Wait for the visual editor to appear
    const editorInfo = await waitForVisualEditor(MAX_WAIT_MS);
    if (editorInfo) {
      log('Found visual editor: ' + editorInfo.type);
      const injected = injectIntoEditor(editorInfo, data.html, data.text);
      if (injected) {
        clearReportData();
        showToast('Report auto-pasted (with images) ✓');
        log('Done!');
        return;
      }
    }

    // Step 3: Fallback — set textarea and let user switch to Visual manually
    warn('Visual editor not found, falling back to textarea');
    ta.value = data.text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    log('Set textarea.value (' + data.text.length + ' chars) — switch to Visual tab to see images');
    clearReportData();
    showToast('Report pasted — switch to Visual tab to see images');
  }

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
