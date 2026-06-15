// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data directly from chrome.storage.local
// and injects into the JIRA Visual editor.
// Strategy: paste text first, then paste images one by one so JIRA's
// paste handler processes each image as an attachment.

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

  // ── Image extraction ──────────────────────────────────────────────

  function dataUrlToFile(dataUrl, filename) {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    return new File([array], filename, { type: mime });
  }

  function extractImages(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imgs = doc.querySelectorAll('img[src^="data:"]');
    if (imgs.length === 0) return { files: [], textHtml: html };

    const files = [];
    imgs.forEach((img, i) => {
      const filename = img.alt || ('screenshot-' + (i + 1) + '.png');
      const file = dataUrlToFile(img.src, filename);
      files.push(file);
      log('Extracted image: ' + filename + ' (' + file.type + ', ' + file.size + ' bytes)');
      img.remove();
    });

    const textHtml = doc.body.innerHTML;
    return { files, textHtml };
  }

  // ── Paste helpers ─────────────────────────────────────────────────

  function pasteHtml(el, html, text) {
    if (typeof el.dispatchEvent !== 'function') {
      // TinyMCE Editor object — use execCommand fallback
      try { el.execCommand('mceInsertContent', false, html); } catch (_) {}
      return true;
    }
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', text);
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    const accepted = !el.dispatchEvent(evt);
    log('Paste text on ' + el.tagName + '#' + el.id + ' — ' + (accepted ? 'accepted' : 'not handled'));
    return accepted;
  }

  async function pasteImage(el, file) {
    if (typeof el.dispatchEvent !== 'function') {
      warn('Cannot dispatch synthetic paste on TinyMCE editor — attach image manually');
      return false;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    el.focus();
    const accepted = !el.dispatchEvent(evt);
    log('Paste image ' + file.name + ' — ' + (accepted ? 'accepted' : 'not handled'));
    return accepted;
  }

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
    log('HTML length: ' + (data.html || '').length);

    // Step 0: Extract images from HTML
    const html = data.html || '';
    const { files, textHtml } = extractImages(html);
    log('Extracted ' + files.length + ' image(s), text HTML length: ' + textHtml.length);

    // Step 1: Wait for textarea
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

    // Step 2: Click Visual tab
    const { visualTab } = findTabs();
    if (visualTab) {
      log('Clicking Visual tab');
      visualTab.click();
      await new Promise(r => setTimeout(r, 1000));
      log('Switched to Visual mode');
    } else {
      warn('Visual tab not found');
    }

    // Step 3: Debug DOM state
    debugDomState();

    // Step 4: Find description editor
    const ce = await waitForDescriptionEditor(5000);
    if (!ce) {
      warn('Description contenteditable not found');
      // Fallback: try textarea
      ta.value = data.text || textHtml.replace(/<[^>]+>/g, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      clearReportData();
      showToast('Report in Text mode — switch to Visual to see');
      log('Done (textarea fallback — no editor)');
      return;
    }

    log('Found description editor: ' + ce.tagName + '#' + ce.id + ' class=' + ce.className);
    ce.focus();
    await new Promise(r => setTimeout(r, 200));

    // Step 5: Paste text only (no images)
    log('Pasting text only...');
    const textPasted = pasteHtml(ce, textHtml, data.text || '');
    if (!textPasted) {
      warn('Text paste not accepted, trying execCommand');
      try {
        document.execCommand('insertHTML', false, textHtml);
        log('Text inserted via execCommand');
      } catch (e) {
        warn('execCommand failed: ' + e.message);
        // Last resort — textarea
        ta.value = data.text || textHtml.replace(/<[^>]+>/g, '');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        clearReportData();
        showToast('Report in Text mode — switch to Visual to see');
        log('Done (textarea fallback — paste rejected)');
        return;
      }
    }

    // Step 6: Paste images one by one
    if (files.length > 0) {
      log('Pasting ' + files.length + ' image(s) one by one...');
      showToast('Pasting report with ' + files.length + ' image(s)...');
      let imagesPasted = 0;
      for (let i = 0; i < files.length; i++) {
        await new Promise(r => setTimeout(r, 500));
        const ok = await pasteImage(ce, files[i]);
        if (ok) imagesPasted++;
      }
      log('Images pasted: ' + imagesPasted + '/' + files.length);
      clearReportData();
      if (imagesPasted > 0) {
        showToast('Report pasted with ' + imagesPasted + ' image(s)');
      } else {
        showToast('Report pasted — attach images manually');
      }
    } else {
      clearReportData();
      showToast('Report pasted');
    }

    log('Done!');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
