// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data directly from chrome.storage.local
// and injects into the JIRA description editor.
// Supports JIRA Cloud (ProseMirror), JIRA Server 7.x (TinyMCE / wiki markup),
// and generic contenteditable / textarea editors.

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

  // Read report data directly from chrome.storage.local
  function getReportData() {
    return new Promise((resolve) => {
      chrome.storage.local.get('reportData', (result) => {
        if (chrome.runtime.lastError) {
          warn('Storage read failed: ' + chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        const data = result.reportData;
        if (!data) {
          resolve(null);
          return;
        }
        // Check expiry
        if (Date.now() - (data.timestamp || 0) > EXPIRY_MS) {
          log('Report data expired, discarding');
          chrome.storage.local.remove('reportData');
          resolve(null);
          return;
        }
        resolve(data);
      });
    });
  }

  // Delete report data from storage (one-shot)
  function clearReportData() {
    chrome.storage.local.remove('reportData');
  }

  function findEditor() {
    // 1. JIRA Server — TinyMCE visual editor
    if (typeof tinymce !== 'undefined' && tinymce.get) {
      const ed = tinymce.get('description');
      if (ed) { log('Found TinyMCE editor'); return { type: 'tinymce', editor: ed }; }
    }

    // 2. JIRA Server — visible textarea (Text mode active)
    const ta = document.querySelector('textarea#description');
    if (ta && ta.offsetParent !== null) {
      log('Found visible textarea (Text mode)');
      return { type: 'textarea', element: ta };
    }

    // 3. JIRA Server — hidden textarea (Visual mode active)
    if (ta) {
      log('Found hidden textarea (Visual mode)');
      return { type: 'textarea-hidden', element: ta };
    }

    // 4. JIRA Cloud — ProseMirror
    let el = document.querySelector('.ProseMirror[contenteditable="true"]');
    if (el) { log('Found ProseMirror editor'); return { type: 'prosemirror', element: el }; }

    // 5. Any visible contenteditable
    const edits = document.querySelectorAll('[contenteditable="true"]');
    for (const e of edits) {
      if (e.offsetParent !== null && e.id && e.id.toLowerCase().includes('description')) {
        log('Found contenteditable: #' + e.id);
        return { type: 'contenteditable', element: e };
      }
    }

    // 6. Generic contenteditable fallback
    el = document.querySelector('#description-val[contenteditable="true"]');
    if (el) { log('Found #description-val'); return { type: 'contenteditable', element: el }; }

    return null;
  }

  function waitForEditor() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const editor = findEditor();
        if (editor) {
          clearInterval(poll);
          resolve(editor);
        } else if (Date.now() - start > MAX_WAIT_MS) {
          clearInterval(poll);
          // Last resort: dump DOM info for debugging
          const textareas = document.querySelectorAll('textarea');
          const editables = document.querySelectorAll('[contenteditable]');
          warn('Editor not found. Textareas: ' + textareas.length + ', contenteditables: ' + editables.length);
          textareas.forEach(t => warn('  textarea: #' + t.id + ' class=' + t.className));
          editables.forEach(e => warn('  contenteditable: #' + e.id + ' class=' + e.className));
          reject(new Error('Editor not found within timeout'));
        }
      }, POLL_INTERVAL);
    });
  }

  function switchToTextMode() {
    // JIRA Server: find and click the "Text" tab near the description field
    const container = document.querySelector('#description-wiki-edit') ||
                      document.querySelector('#description-field');
    if (!container) {
      warn('No description container found for tab switching');
      return false;
    }

    // Look for tab links inside the container
    const allLinks = container.querySelectorAll('a, button, span, div');
    for (const el of allLinks) {
      const txt = el.textContent.trim().toLowerCase();
      if (txt === 'text' || txt === 'wiki' || txt === 'source') {
        log('Clicking tab: ' + el.textContent.trim());
        el.click();
        return true;
      }
    }

    // Fallback: try data-mode attributes
    const modeTab = container.querySelector('[data-mode="text"], [data-mode="wiki"], [data-mode="source"]');
    if (modeTab) {
      log('Clicking data-mode tab');
      modeTab.click();
      return true;
    }

    warn('Could not find Text tab to click');
    return false;
  }

  function injectReport(editorInfo, text) {
    const { type } = editorInfo;

    if (type === 'tinymce') {
      const ed = editorInfo.editor;
      ed.setContent('<p>' + text.replace(/\n/g, '</p><p>') + '</p>');
      ed.fire('change');
      ed.fire('input');
      log('Injected via TinyMCE.setContent()');
    } else if (type === 'textarea') {
      editorInfo.element.value = text;
      editorInfo.element.dispatchEvent(new Event('input', { bubbles: true }));
      editorInfo.element.dispatchEvent(new Event('change', { bubbles: true }));
      log('Injected via textarea.value');
    } else if (type === 'textarea-hidden') {
      const switched = switchToTextMode();
      if (switched) {
        setTimeout(() => {
          const ta = document.querySelector('textarea#description');
          if (ta) {
            ta.value = text;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            log('Injected via textarea after mode switch');
          }
        }, 300);
      } else {
        // Can't switch — try setting hidden textarea directly
        editorInfo.element.value = text;
        editorInfo.element.dispatchEvent(new Event('change', { bubbles: true }));
        log('Set hidden textarea value (mode switch failed)');
      }
    } else if (type === 'prosemirror') {
      const html = '<p>' + text.replace(/\n/g, '</p><p>') + '</p>';
      editorInfo.element.innerHTML = html;
      editorInfo.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      log('Injected via ProseMirror innerHTML');
    } else if (type === 'contenteditable') {
      const html = '<p>' + text.replace(/\n/g, '</p><p>') + '</p>';
      editorInfo.element.innerHTML = html;
      editorInfo.element.dispatchEvent(new Event('input', { bubbles: true }));
      log('Injected via contenteditable innerHTML');
    }
  }

  async function run() {
    log('Content script loaded on: ' + window.location.href);

    const data = await getReportData();
    if (!data) {
      log('No report data found in storage');
      return;
    }

    log('Report data found (panel=' + data.panel + ', account=' + data.account + ')');

    try {
      const editorInfo = await waitForEditor();
      injectReport(editorInfo, data.text);
      clearReportData();
      showToast('Report auto-pasted from Report Generator ✓');
      log('Done!');
    } catch (err) {
      warn(err.message);
      showToast('Report ready — paste manually with Ctrl+V');
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
