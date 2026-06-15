// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data and injects into the ProseMirror description editor.

(() => {
  const POLL_INTERVAL = 200;
  const MAX_WAIT_MS = 10000;

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

  function waitForEditor() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
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

  function injectReport(editor, html) {
    editor.innerHTML = html;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function run() {
    chrome.runtime.sendMessage({ action: 'get-report' }, async (response) => {
      if (chrome.runtime.lastError) {
        // Extension context invalidated or no response — do nothing
        return;
      }
      if (!response || !response.found || !response.data) return;

      try {
        const editor = await waitForEditor();
        injectReport(editor, response.data.html || response.data.text);
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
