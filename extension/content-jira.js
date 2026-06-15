// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data directly from chrome.storage.local
// and injects into the JIRA Visual editor.
// Strategy: click Visual tab → write HTML to clipboard → dispatch paste event
// so JIRA's own paste handler processes images as attachments.

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
      position: 'fixed', bottom: '24px', right: '24px',
      background: '#1a1a2e', color: '#e0e0e0',
      padding: '12px 20px', borderRadius: '8px',
      fontSize: '13px', fontFamily: 'system-ui, sans-serif',
      zIndex: '999999', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s', opacity: '1',
    });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  }

  function getReportData() {
    return new Promise((resolve) => {
      chrome.storage.local.get('reportData', (result) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        const data = result.reportData;
        if (!data) { resolve(null); return; }
        if (Date.now() - (data.timestamp || 0) > EXPIRY_MS) {
          chrome.storage.local.remove('reportData');
          resolve(null); return;
        }
        resolve(data);
      });
    });
  }

  function clearReportData() { chrome.storage.local.remove('reportData'); }

  function findTextarea() { return document.querySelector('textarea#description'); }

  function findTabs() {
    const container = document.querySelector('#description-wiki-edit') ||
                      document.querySelector('#description-field') ||
                      document.querySelector('.field-group:has(textarea#description)');
    if (!container) return { visualTab: null, textTab: null };

    let visualTab = null, textTab = null;
    for (const el of container.querySelectorAll('a, button, span, div, li')) {
      const txt = el.textContent.trim().toLowerCase();
      if (txt === 'visual' || txt === 'rich text') visualTab = el;
      if (txt === 'text' || txt === 'wiki' || txt === 'source') textTab = el;
    }
    if (!visualTab) visualTab = container.querySelector('[data-mode="visual"], [data-mode="wysiwyg"]');
    if (!textTab) textTab = container.querySelector('[data-mode="text"], [data-mode="wiki"], [data-mode="source"]');
    return { visualTab, textTab };
  }

  // Debug: log all contenteditable elements and their parent containers
  function debugDomState() {
    const ces = document.querySelectorAll('[contenteditable]');
    log('Contenteditable elements: ' + ces.length);
    ces.forEach((el, i) => {
      const parent = el.closest('[id]');
      const grandparent = parent?.parentElement?.closest('[id]');
      log('  [' + i + '] ' + el.tagName + '#' + el.id + ' ce=' + el.contentEditable +
        ' visible=' + (el.offsetParent !== null) +
        ' parent=' + (parent ? parent.tagName + '#' + parent.id : 'none') +
        ' grandparent=' + (grandparent ? grandparent.tagName + '#' + grandparent.id : 'none'));
    });
    // Also check description containers
    const descContainers = document.querySelectorAll('[id*="description"]');
    log('Description-related containers: ' + descContainers.length);
    descContainers.forEach((el, i) => {
      const ceInside = el.querySelector('[contenteditable="true"]');
      log('  [' + i + '] ' + el.tagName + '#' + el.id + ' hasContenteditable=' + !!ceInside);
    });
  }

  // Build DataTransfer with HTML + plain text (for synthetic paste event)
  function createPasteDataTransfer(html, text) {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', text);
    return dt;
  }

  // Dispatch a synthetic paste event with HTML data onto an element
  function dispatchPaste(el, html, text) {
    const dt = createPasteDataTransfer(html, text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    const accepted = !el.dispatchEvent(pasteEvent);
    log('Dispatched paste event on ' + el.tagName + '#' + el.id + ' — ' + (accepted ? 'accepted (prevented default)' : 'not handled'));
    return accepted;
  }

  // After clicking Visual, wait for the DESCRIPTION field's contenteditable to appear
  function waitForDescriptionEditor(maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        // 1. Look inside the description field container specifically
        const descContainer = document.querySelector('#description-wiki-edit') ||
                              document.querySelector('#description-field') ||
                              document.querySelector('[id*="description"][class*="field-group"]') ||
                              document.querySelector('.field-group:has(textarea#description)');
        if (descContainer) {
          const ce = descContainer.querySelector('[contenteditable="true"]');
          if (ce && ce.offsetParent !== null) {
            clearInterval(poll);
            resolve(ce);
            return;
          }
        }
        // 2. TinyMCE
        if (typeof tinymce !== 'undefined') {
          const ed = tinymce?.get?.('description');
          if (ed) { clearInterval(poll); resolve(ed); return; }
        }
        // 3. Iframe inside description container
        if (descContainer) {
          const iframe = descContainer.querySelector('iframe');
          if (iframe?.contentDocument?.body) {
            clearInterval(poll);
            resolve(iframe.contentDocument.body);
            return;
          }
        }
        // 4. Any contenteditable whose closest parent has 'description' in its id
        const all = document.querySelectorAll('[contenteditable="true"]');
        for (const el of all) {
          if (el.offsetParent !== null) {
            const ancestor = el.closest('[id*="description"], [class*="description"]');
            if (ancestor) {
              clearInterval(poll);
              resolve(el);
              return;
            }
          }
        }
        if (Date.now() - start > maxMs) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });
  }

  async function inject() {
    const data = await getReportData();
    if (!data) { log('No report data'); return; }

    log('Report found: panel=' + data.panel + ', account=' + data.account);
    log('HTML length: ' + (data.html || '').length + ', Text length: ' + (data.text || '').length);

    // Wait for textarea
    const ta = await new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const el = findTextarea();
        if (el) { clearInterval(poll); resolve(el); }
        else if (Date.now() - start > MAX_WAIT_MS) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });

    if (!ta) { warn('Textarea not found'); showToast('Report ready — paste manually'); return; }
    log('Found textarea#description');

    // Step 1: Click Visual tab
    const { visualTab } = findTabs();
    if (visualTab) {
      log('Clicking Visual tab');
      visualTab.click();
      await new Promise(r => setTimeout(r, 1000));
      log('Switched to Visual mode');
    } else {
      warn('Visual tab not found');
    }

    // Step 2: Debug DOM state
    debugDomState();

    // Step 3: Try to find the DESCRIPTION contenteditable and dispatch paste
    const ce = await waitForDescriptionEditor(5000);
    if (ce) {
      log('Found description editor: ' + ce.tagName + '#' + ce.id + ' class=' + ce.className);
      ce.focus();
      await new Promise(r => setTimeout(r, 200));
      const pasted = dispatchPaste(ce, data.html, data.text);
      if (pasted) {
        clearReportData();
        showToast('Report pasted with images ✓');
        log('Done via paste event on description editor');
        return;
      }
    } else {
      warn('Description contenteditable not found');
    }

    // Step 4: Try dispatching paste on the document body or active element
    log('Trying paste on active element: ' + document.activeElement?.tagName + '#' + document.activeElement?.id);
    const target = document.activeElement || document.body;
    target.focus();
    await new Promise(r => setTimeout(r, 200));
    const pasted = dispatchPaste(target, data.html, data.text);
    if (pasted) {
      clearReportData();
      showToast('Report pasted with images ✓');
      log('Done via paste event on active element');
      return;
    }

    // Step 5: Last resort — try document.execCommand
    log('Trying execCommand insertHTML');
    try {
      const ok = document.execCommand('insertHTML', false, data.html);
      log('execCommand result: ' + ok);
      if (ok) {
        clearReportData();
        showToast('Report pasted with images ✓');
        log('Done via execCommand');
        return;
      }
    } catch (e) {
      warn('execCommand failed: ' + e.message);
    }

    // Step 6: Final fallback — textarea only
    warn('All injection methods failed, falling back to textarea');
    ta.value = data.text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    clearReportData();
    showToast('Report in Text mode — switch to Visual to see');
    log('Done (textarea fallback)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
