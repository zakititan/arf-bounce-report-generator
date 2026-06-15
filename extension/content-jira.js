// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data and injects into the JIRA description editor.
// Supports JIRA Cloud (ProseMirror), JIRA Server 7.x (TinyMCE + Visual/Text tabs),
// and generic contenteditable / textarea editors.

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

  function findEditor() {
    // 1. JIRA Cloud — ProseMirror
    let el = document.querySelector('.ProseMirror[contenteditable="true"]');
    if (el) return { type: 'prosemirror', element: el };

    // 2. JIRA Server 7.x — TinyMCE visual editor
    if (typeof tinymce !== 'undefined' && tinymce.get) {
      const ed = tinymce.get('description');
      if (ed) return { type: 'tinymce', editor: ed };
    }

    // 3. JIRA Server — visible textarea (Text mode already active)
    const ta = document.querySelector('textarea#description');
    if (ta && ta.offsetParent !== null) return { type: 'textarea', element: ta };

    // 4. JIRA Server — hidden textarea (Visual mode active, need to switch)
    if (ta) return { type: 'textarea-hidden', element: ta };

    // 5. Generic contenteditable
    el = document.querySelector('[data-field-id="description"][contenteditable="true"]');
    if (el) return { type: 'contenteditable', element: el };

    el = document.querySelector('#description-val[contenteditable="true"]');
    if (el) return { type: 'contenteditable', element: el };

    el = document.querySelector('#description-wiki-edit .user-input-block');
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

  function switchToTextMode() {
    // JIRA Server: click the "Text" tab to switch from Visual to wiki markup
    const tabs = document.querySelectorAll('#description-wiki-edit .tabs a, #description-wiki-edit .tab, .wiki-edit-renderer');
    for (const tab of tabs) {
      if (tab.textContent.trim().toLowerCase() === 'text') {
        tab.click();
        return true;
      }
    }
    // Fallback: try data-mode attribute
    const textTab = document.querySelector('#description-wiki-edit a[data-mode="text"], #description-wiki-edit [data-mode="wiki"]');
    if (textTab) { textTab.click(); return true; }
    return false;
  }

  function injectReport(editorInfo, html, text) {
    const { type } = editorInfo;

    if (type === 'tinymce') {
      // JIRA Server TinyMCE — use API to set content
      const ed = editorInfo.editor;
      ed.setContent(text);
      ed.fire('change');
    } else if (type === 'textarea') {
      // Text mode — set value directly
      editorInfo.element.value = text;
      editorInfo.element.dispatchEvent(new Event('input', { bubbles: true }));
      editorInfo.element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (type === 'textarea-hidden') {
      // Visual mode active — switch to Text mode first
      switchToTextMode();
      // Wait for mode switch, then set value
      setTimeout(() => {
        const ta = document.querySelector('textarea#description');
        if (ta) {
          ta.value = text;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 200);
    } else if (type === 'prosemirror') {
      // JIRA Cloud — set innerHTML
      editorInfo.element.focus();
      editorInfo.element.innerHTML = html;
      editorInfo.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    } else {
      // Generic contenteditable
      editorInfo.element.focus();
      editorInfo.element.innerHTML = html;
      editorInfo.element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function run() {
    chrome.runtime.sendMessage({ action: 'get-report' }, async (response) => {
      if (chrome.runtime.lastError) return;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
