// ── Content script: JIRA create issue page ────────────────────────────
// Reads stored report data directly from chrome.storage.local
// and injects into the JIRA create issue page.
// Strategy: upload images via attachment dropzone → inject text with !filename! refs.

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

  // Extract images from HTML, return { files, textWithRefs }
  function extractImages(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imgs = doc.querySelectorAll('img[src^="data:"]');
    if (imgs.length === 0) return { files: [], textWithRefs: html };

    const files = [];
    const imgMap = new Map(); // old src → new filename

    imgs.forEach((img, i) => {
      const filename = img.alt || ('screenshot-' + (i + 1) + '.png');
      const file = dataUrlToFile(img.src, filename);
      files.push(file);
      imgMap.set(img.src, filename);
      log('Extracted image: ' + filename + ' (' + file.type + ', ' + file.size + ' bytes)');
    });

    // Replace <img src="data:..."> with !filename! wiki markup references
    let textWithRefs = html;
    for (const [src, filename] of imgMap) {
      // Replace both <img> tags and any stray data: references
      const escapedSrc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      textWithRefs = textWithRefs.replace(
        new RegExp('<img[^>]*src="' + escapedSrc + '"[^>]*/?>', 'gi'),
        '![' + filename + ']!'
      );
    }

    return { files, textWithRefs };
  }

  // ── Attachment dropzone ───────────────────────────────────────────

  function findAttachmentDropzone() {
    // Look for the attachment drop zone on the JIRA create page
    // Common selectors for JIRA Server 7.x
    const selectors = [
      '#attachmentmodule .attachment-drop-zone',
      '#attachmentmodule .drop-zone',
      '.attachment-dropzone',
      '#dropzone',
      '.file-drop-zone',
      'div[data-dropzone="attachment"]',
      // Fallback: the attachment module itself
      '#attachmentmodule',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { log('Found attachment dropzone: ' + sel); return el; }
    }
    // Last resort: find by text content
    const allDivs = document.querySelectorAll('div, section');
    for (const el of allDivs) {
      if (el.textContent.includes('Drop files to attach') && el.offsetParent !== null) {
        log('Found attachment dropzone by text content');
        return el;
      }
    }
    return null;
  }

  function findFileInput() {
    return document.querySelector('#attachmentmodule input[type="file"]') ||
           document.querySelector('input[type="file"][name*="attachment"]') ||
           document.querySelector('input[name="attachment"]');
  }

  async function uploadImagesViaDropzone(files) {
    if (files.length === 0) return true;

    const dropzone = findAttachmentDropzone();
    const fileInput = findFileInput();

    // Method 1: Try setting files on the hidden input
    if (fileInput) {
      log('Uploading via file input (' + files.length + ' files)');
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // Method 2: Simulate drop event on the dropzone
    if (dropzone) {
      log('Uploading via drop event on dropzone (' + files.length + ' files)');
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));

      // Activate the dropzone
      dropzone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
      dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      // Drop
      dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      return true;
    }

    warn('No attachment dropzone or file input found');
    return false;
  }

  async function waitForAttachmentUploads(expectedCount, maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        // Look for attachment items in the attachment list
        const attachments = document.querySelectorAll(
          '#attachmentmodule .attachment-content li, ' +
          '#attachmentmodule .attachment-list li, ' +
          '#file_attachments .attachment-content li, ' +
          '.attachment-thumb, ' +
          '#attachmentmodule .attachment-title'
        );
        if (attachments.length >= expectedCount) {
          clearInterval(poll);
          log('Attachments uploaded: ' + attachments.length);
          resolve(true);
          return;
        }
        if (Date.now() - start > maxMs) {
          clearInterval(poll);
          warn('Attachment upload timed out (found ' + attachments.length + '/' + expectedCount + ')');
          resolve(false);
        }
      }, POLL_INTERVAL);
    });
  }

  // ── Description editor ────────────────────────────────────────────

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

  function waitForDescriptionEditor(maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const descContainer = document.querySelector('#description-wiki-edit') ||
                              document.querySelector('#description-field') ||
                              document.querySelector('[id*="description"][class*="field-group"]') ||
                              document.querySelector('.field-group:has(textarea#description)');
        if (descContainer) {
          const ce = descContainer.querySelector('[contenteditable="true"]');
          if (ce && ce.offsetParent !== null) { clearInterval(poll); resolve(ce); return; }
        }
        if (typeof tinymce !== 'undefined') {
          const ed = tinymce?.get?.('description');
          if (ed) { clearInterval(poll); resolve(ed); return; }
        }
        if (descContainer) {
          const iframe = descContainer.querySelector('iframe');
          if (iframe?.contentDocument?.body) { clearInterval(poll); resolve(iframe.contentDocument.body); return; }
        }
        const all = document.querySelectorAll('[contenteditable="true"]');
        for (const el of all) {
          if (el.offsetParent !== null) {
            const ancestor = el.closest('[id*="description"], [class*="description"]');
            if (ancestor) { clearInterval(poll); resolve(el); return; }
          }
        }
        if (Date.now() - start > maxMs) { clearInterval(poll); resolve(null); }
      }, POLL_INTERVAL);
    });
  }

  // Build plain-text description with !filename! references
  function buildDescriptionText(text) {
    // text already has !filename! references from extractImages
    // Convert HTML line breaks to newlines for plain text
    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '') // strip remaining HTML tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Inject text into the description editor via synthetic paste
  function injectText(editorEl, text) {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt,
    });
    editorEl.focus();
    return editorEl.dispatchEvent(pasteEvent);
  }

  // ── Main flow ─────────────────────────────────────────────────────

  async function inject() {
    const data = await getReportData();
    if (!data) { log('No report data'); return; }

    log('Report found: panel=' + data.panel + ', account=' + data.account);
    log('HTML length: ' + (data.html || '').length);

    // Step 1: Extract images from HTML
    const { files, textWithRefs } = extractImages(data.html);
    log('Extracted ' + files.length + ' image(s)');

    // Step 2: Upload images to JIRA attachment dropzone
    if (files.length > 0) {
      showToast('Uploading ' + files.length + ' image(s) to JIRA...');
      const uploaded = await uploadImagesViaDropzone(files);
      if (uploaded) {
        // Wait for uploads to complete
        const done = await waitForAttachmentUploads(files.length, MAX_WAIT_MS);
        if (done) {
          log('All images uploaded as attachments');
        } else {
          warn('Some images may not have uploaded');
        }
      } else {
        warn('Could not find attachment dropzone — images will be missing');
      }
    }

    // Step 3: Build description text with !filename! references
    const descriptionText = buildDescriptionText(textWithRefs);
    log('Description text length: ' + descriptionText.length);

    // Step 4: Wait for textarea
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

    // Step 5: Click Visual tab
    const { visualTab } = findTabs();
    if (visualTab) {
      log('Clicking Visual tab');
      visualTab.click();
      await new Promise(r => setTimeout(r, 1000));
      log('Switched to Visual mode');
    }

    // Step 6: Find description editor and inject text
    const ce = await waitForDescriptionEditor(5000);
    if (ce) {
      log('Found description editor: ' + ce.tagName + '#' + ce.id);
      ce.focus();
      await new Promise(r => setTimeout(r, 200));

      // Try paste event first
      const pasted = injectText(ce, descriptionText);
      if (pasted) {
        log('Injected via paste event');
      } else {
        // Fallback: set innerHTML
        const plainHtml = descriptionText
          .split('\n')
          .map(line => '<p>' + (line || '&nbsp;') + '</p>')
          .join('');
        ce.innerHTML = plainHtml;
        ce.dispatchEvent(new Event('input', { bubbles: true }));
        log('Injected via innerHTML');
      }

      clearReportData();
      showToast('Report pasted with ' + files.length + ' image(s) ✓');
      log('Done!');
      return;
    }

    // Step 7: Fallback to textarea
    warn('Visual editor not found, falling back to textarea');
    ta.value = descriptionText;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
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
