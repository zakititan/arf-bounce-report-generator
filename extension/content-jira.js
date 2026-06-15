// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data and injects into the JIRA description editor.
// Supports JIRA Cloud (ProseMirror), JIRA Server (textarea/wiki markup),
// and generic contenteditable editors.

(() => {
  const POLL_INTERVAL = 200;
  const MAX_WAIT_MS = 15000;

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

  // Try multiple selectors to find the description editor
  function findEditor() {
    // 1. JIRA Cloud — ProseMirror editor
    let el = document.querySelector('.ProseMirror[contenteditable="true"]');
    if (el) return { type: 'prosemirror', element: el };

    // 2. JIRA Server — wiki markup textarea
    el = document.querySelector('textarea#description');
    if (el) return { type: 'textarea', element: el };

    // 3. JIRA Server — rich text editor wrapper
    el = document.querySelector('#description-wiki-edit .user-input-block');
    if (el) return { type: 'contenteditable', element: el };

    // 4. Generic — data-field attribute
    el = document.querySelector('[data-field-id="description"][contenteditable="true"]');
    if (el) return { type: 'contenteditable', element: el };

    // 5. JIRA Server — Atlassian editor in ADF mode
    el = document.querySelector('.ak-editor-content-area .ProseMirror');
    if (el) return { type: 'prosemirror', element: el };

    // 6. Any contenteditable inside the description field area
    el = document.querySelector('#description-val[contenteditable="true"]');
    if (el) return { type: 'contenteditable', element: el };

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
          reject(new Error('Editor not found within timeout'));
        }
      }, POLL_INTERVAL);
    });
  }

  function injectReport(editorInfo, html, text) {
    const { type, element } = editorInfo;

    if (type === 'textarea') {
      // JIRA Server wiki markup — set value and dispatch events
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (type === 'prosemirror') {
      // JIRA Cloud / ADF — set innerHTML and dispatch InputEvent
      element.focus();
      element.innerHTML = html;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    } else {
      // Generic contenteditable — set innerHTML and dispatch events
      element.focus();
      element.innerHTML = html;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function run() {
    chrome.runtime.sendMessage({ action: 'get-report' }, async (response) => {
      if (chrome.runtime.lastError) {
        // Extension context invalidated or no response — do nothing
        return;
      }
      if (!response || !response.found || !response.data) return;

      try {
        const editorInfo = await waitForEditor();
        injectReport(editorInfo, response.data.html, response.data.text);
        showToast('Report auto-pasted from Report Generator ✓');
      } catch (err) {
        console.warn('[Report→JIRA]', err.message);
        showToast('Report ready — paste manually with Ctrl+V');
      }
    });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
