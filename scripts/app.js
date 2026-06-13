/**
 * app.js — Core application logic.
 * Imports API helpers from api.js and UI helpers from ui.js.
 *
 * Improvements applied:
 *  UX:      Auto-trigger lookup from CSV, localStorage persistence, Ctrl/Cmd+Enter
 *           shortcut, "Copied ✓" button feedback, email→domain sanitisation,
 *           inline screenshots in ARF output, full-text copy (incl. screenshot labels).
 *  Quality: Unified `state` object, whoisCache invalidated on domain input change,
 *           try/catch on generate, addEventListener replacing window.* inline handlers
 *           where feasible, debounced Lookup button, per-panel generate-button gating,
 *           lastActivePanel for keyboard shortcut, confirm before clear.
 *           attachPersistListeners called once inside DOMContentLoaded (not twice).
 *  Perf:    10-screenshot cap with warning toast.
 */

import { fetchWhois, fetchWebsiteCheck, fetchDkimCheck } from './api.js';
import {
  showToast, initThemeToggle,
  clearFieldErrors, showValidationErrors,
  handleDragOver, handleDragLeave,
  handleCsvDragOver, handleCsvDragLeave,
  updateStepper, updateFormProgress,
  applyDomainAgeColor, toggleResultCard,
  renderScreenshotEmptyState, getOutputTimestamp
} from './ui.js';

// ── Constants ─────────────────────────────────────────────────────────
const MAX_SCREENSHOTS = 10;
const LOOKUP_DEBOUNCE_MS = 1000;
const LS_KEY = 'arf_bounce_form_state';
const _lookupTimers = { arf: null, bounce: null };

// ── State ─────────────────────────────────────────────────────────────
const state = {
  arf: {
    screenshots: [],
    assuranceScreenshots: [],
    whois: null,
    lookupInFlight: false,
  },
  bounce: {
    csvCount: null,
    assuranceScreenshots: [],
    whois: null,
    lookupInFlight: false,
  },
};
window.__state = state;
let lastActivePanel = null; // tracks which panel the user last interacted with (for Ctrl/Cmd+Enter)

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  restoreFormState();
  initKeyboardShortcuts();
  initDomainInputs();
  initEventDelegation();
  initDragDrop();
  initPasteSupport();
  // attachPersistListeners called exactly once here — do NOT add another
  // DOMContentListener for it elsewhere in this file.
  attachPersistListeners();
  updateFormProgress('arf');
  updateFormProgress('bounce');
  renderPreviews('arf', 'screenshots');
  renderPreviews('arf', 'assuranceScreenshots');
  renderPreviews('bounce', 'assuranceScreenshots');
});

// ── Keyboard shortcuts (Ctrl/Cmd + Enter) ─────────────────────────────
// Uses lastActivePanel (set on field focus) instead of a fragile DOM heuristic.
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
    if (!lastActivePanel) return; // no panel active yet
    if (lastActivePanel === 'arf') generateARF();
    else if (lastActivePanel === 'bounce') generateBounce();
  });
}

// ── Domain input: sanitise email → domain + invalidate cache ──────────
function sanitiseDomainInput(value) {
  let v = value.trim();
  v = v.replace(/^https?:\/\//i, '');
  const atIdx = v.indexOf('@');
  if (atIdx !== -1) v = v.slice(atIdx + 1);
  v = v.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  return v.toLowerCase().trim();
}

function resetWhoisState(prefix) {
  state[prefix].whois = null;
  document.getElementById(prefix + '-domain-result')?.classList.remove('visible', 'error');
}

function initDomainInputs() {
  ['arf', 'bounce'].forEach(prefix => {
    const input = document.getElementById(prefix + '-domain-input');
    if (!input) return;
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      const sanitised = sanitiseDomainInput(pasted);
      input.value = sanitised;
      if (sanitised !== pasted.trim()) showToast('Email stripped → ' + sanitised);
      resetWhoisState(prefix);
      lookupDomain(prefix);
    });
    input.addEventListener('blur', () => {
      const original = input.value;
      const sanitised = sanitiseDomainInput(original);
      if (sanitised !== original.trim()) {
        input.value = sanitised;
        showToast('Email stripped → ' + sanitised);
        resetWhoisState(prefix);
      }
    });
    input.addEventListener('input', () => {
      if (state[prefix].whois) {
        resetWhoisState(prefix);
      }
    });
  });
}

// Account field → auto-fill domain input + trigger lookup
['arf', 'bounce'].forEach(prefix => {
  const accountInput = document.getElementById(prefix + '-account');
  if (!accountInput) return;

  // On paste: keep raw value in Account, push sanitised domain to Domain input
  accountInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    const sanitised = sanitiseDomainInput(pasted);
    accountInput.value = pasted; // preserve full email in account field
    const domainInput = document.getElementById(prefix + '-domain-input');
    if (domainInput) domainInput.value = sanitised;
    resetWhoisState(prefix);
    lookupDomain(prefix);
  });

  // On input: sync sanitised domain and trigger lookup
  accountInput.addEventListener('input', () => {
    const sanitised = sanitiseDomainInput(accountInput.value);
    const domainInput = document.getElementById(prefix + '-domain-input');
    if (domainInput) domainInput.value = sanitised;
    resetWhoisState(prefix);
    lookupDomain(prefix);
  });
});

// ── Mailboards link href updater ─────────────────────────────────────
['arf', 'bounce'].forEach(prefix => {
  const accountInput = document.getElementById(prefix + '-account');
  const mailboardsLink = document.querySelector('#' + prefix + '-panel .btn-mailboards');
  if (!accountInput || !mailboardsLink) return;

  function updateMailboardsHref() {
    const account = accountInput.value.trim();
    if (account) {
      const param = account.includes('@') ? 'email' : 'domain';
      mailboardsLink.href = 'https://mailboards.ops.titan.email/home?' + param + '=' + encodeURIComponent(account) + '&env=prod';
    } else {
      mailboardsLink.href = 'https://mailboards.ops.titan.email/home?env=prod';
    }
  }

  accountInput.addEventListener('input', updateMailboardsHref);
  accountInput.addEventListener('paste', () => setTimeout(updateMailboardsHref, 0));
  updateMailboardsHref();
});

// ── Check ARF count link updater ───────────────────────────────────
(function() {
  const accountInput = document.getElementById('arf-account');
  const arfCountLink = document.querySelector('#arf-panel .btn-abusedesk');
  if (!accountInput || !arfCountLink) return;

  function updateArfCountHref() {
    const account = accountInput.value.trim();
    arfCountLink.href = account
      ? 'https://abusedesk.ops.titan.email/history.html?entity=' + encodeURIComponent(account) + '&region=us-east-1'
      : 'https://abusedesk.ops.titan.email/history.html?entity=&region=us-east-1';
  }

  accountInput.addEventListener('input', updateArfCountHref);
  accountInput.addEventListener('paste', () => setTimeout(updateArfCountHref, 0));
  updateArfCountHref();
})();

// ── Copy with visual button feedback ──────────────────────────────────
function copyOutputWithFeedback(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const outputArea = el.closest('.output-area');
  const text = (outputArea && outputArea.dataset.copyText) || el.textContent;
  if (!text.trim()) return;
  if (!navigator.clipboard) { showToast('Copy not supported in this browser context.', 'warning'); return; }

  const doCopy = (writePromise) => {
    writePromise.then(() => {
      showToast('Copied to clipboard!');
      const btn = outputArea?.querySelector('.copy-btn-wrap button');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied ✓';
        btn.style.color = 'var(--color-success)';
        setTimeout(() => { btn.textContent = original; btn.style.color = ''; }, 2000);
      }
    }).catch(() => showToast('Copy failed — please copy manually.'));
  };

  // Build rich clipboard with embedded screenshots
  const grids = outputArea?.querySelectorAll('.output-screenshots-inline');
  if (grids && grids.length > 0 && typeof ClipboardItem !== 'undefined') {
    // Strip screenshot filename lists from HTML text (images with labels below replace them)
    const textForHtml = text.split('\n── ')[0];
    let html = '<div style="font-family:DM Mono,Courier New,monospace;font-size:12px;line-height:1.9;">';
    html += textForHtml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    html += '</div>';
    let imgCount = 0;
    grids.forEach(grid => {
      const divider = grid.previousElementSibling;
      if (divider && divider.classList.contains('output-inline-divider')) {
        html += '<div style="font-family:DM Mono,Courier New,monospace;font-size:11px;color:#7a7974;margin-top:12px;letter-spacing:0.05em;">';
        html += divider.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += '</div>';
      }
      html += '<div style="margin-top:8px">';
      grid.querySelectorAll('img').forEach(img => {
        imgCount++;
        html += '<div style="margin-bottom:12px">';
        html += '<img src="' + img.src + '" alt="' + img.alt.replace(/"/g, '&quot;') + '" style="max-width:400px;height:auto;border-radius:6px;border:1px solid #d4d1ca;display:block;margin-bottom:4px">';
        html += '<span style="font-family:DM Mono,Courier New,monospace;font-size:11px;color:#7a7974">' + imgCount + '. ' + img.alt.replace(/"/g, '&quot;') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    });
    const item = new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    });
    doCopy(navigator.clipboard.write([item]));
  } else {
    doCopy(navigator.clipboard.writeText(text));
  }
}

// ── Event delegation (replaces inline onclick/onchange handlers) ──────
function initEventDelegation() {
  // Track which panel user last interacted with (for Ctrl/Cmd+Enter shortcut).
  // Runs on every focusin that bubbles from an input or select inside a .panel.
  document.querySelector('.app-shell').addEventListener('focusin', (e) => {
    const panel = e.target.closest('[id$="-panel"]');
    if (!panel) return;
    if (panel.id === 'arf-panel') lastActivePanel = 'arf';
    else if (panel.id === 'bounce-panel') lastActivePanel = 'bounce';
  });

  document.querySelector('.app-shell').addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const panel = target.getAttribute('data-panel');

    switch (action) {
      case 'generate':
        if (panel === 'arf') generateARF();
        else if (panel === 'bounce') generateBounce();
        break;
      case 'clear':
        if (panel === 'arf') clearARF();
        else if (panel === 'bounce') clearBounce();
        break;
      case 'lookup':
        if (panel) lookupDomainImmediate(panel);
        break;
      case 'create-jira':
        createTaeJira(panel);
        break;
      case 'copy': {
        const copyTarget = target.getAttribute('data-target');
        if (copyTarget) copyOutputWithFeedback(copyTarget);
        break;
      }
      case 'clear-csv':
        clearCsv();
        break;
      case 'toggle-assurance':
        if (panel) toggleAssurance(target, panel);
        break;
      case 'toggle-contact-form':
        toggleContactFormAssurance(target);
        break;
      case 'toggle-suboption':
        toggleContactFormSuboption(target);
        break;
      case 'toggle-result-card':
        toggleResultCard(target.closest('.result-card').id.replace('-domain-result', ''));
        break;
      case 'remove-screenshot': {
        const idx = parseInt(target.getAttribute('data-index'), 10);
        if (!isNaN(idx)) removeScreenshot(idx, target.getAttribute('data-panel'), target.getAttribute('data-key'));
        break;
      }
    }
  });

  document.querySelector('.app-shell').addEventListener('change', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'toggle-other-blocked') {
      toggleOtherBlockedField(target.value);
    }
  });

  // File inputs need special handling (change events on file inputs)
  document.getElementById('arf-screenshot-input')?.addEventListener('change', (e) => handleFileSelect(e, 'arf', 'screenshots'));
  document.getElementById('arf-assurance-screenshot-input')?.addEventListener('change', (e) => handleFileSelect(e, 'arf', 'assuranceScreenshots'));
  document.getElementById('bounce-assurance-screenshot-input')?.addEventListener('change', (e) => handleFileSelect(e, 'bounce', 'assuranceScreenshots'));
  document.getElementById('bounce-csv-input')?.addEventListener('change', (e) => handleCsvSelect(e));
}

// ── Drag-and-drop init ───────────────────────────────────────────────
function initDragDrop() {
  const emailZone = document.getElementById('arf-upload-zone');
  if (emailZone) {
    emailZone.addEventListener('dragover', (e) => handleDragOver(e, 'arf-upload-zone'));
    emailZone.addEventListener('dragleave', (e) => handleDragLeave(e, 'arf-upload-zone'));
    emailZone.addEventListener('drop', (e) => handleDrop(e, 'arf', 'screenshots'));
  }
  const arfAssuranceZone = document.getElementById('arf-assurance-upload-zone');
  if (arfAssuranceZone) {
    arfAssuranceZone.addEventListener('dragover', (e) => handleDragOver(e, 'arf-assurance-upload-zone'));
    arfAssuranceZone.addEventListener('dragleave', (e) => handleDragLeave(e, 'arf-assurance-upload-zone'));
    arfAssuranceZone.addEventListener('drop', (e) => handleDrop(e, 'arf', 'assuranceScreenshots'));
  }
  const bounceAssuranceZone = document.getElementById('bounce-assurance-upload-zone');
  if (bounceAssuranceZone) {
    bounceAssuranceZone.addEventListener('dragover', (e) => handleDragOver(e, 'bounce-assurance-upload-zone'));
    bounceAssuranceZone.addEventListener('dragleave', (e) => handleDragLeave(e, 'bounce-assurance-upload-zone'));
    bounceAssuranceZone.addEventListener('drop', (e) => handleDrop(e, 'bounce', 'assuranceScreenshots'));
  }
  const csvZone = document.getElementById('bounce-csv-zone');
  if (csvZone) {
    csvZone.addEventListener('dragover', handleCsvDragOver);
    csvZone.addEventListener('dragleave', handleCsvDragLeave);
    csvZone.addEventListener('drop', handleCsvDrop);
  }
}

// ── Paste images from clipboard ───────────────────────────────────────
let _pasteZone = null; // { prefix, key } of zone under mouse

function initPasteSupport() {
  const zones = [
    { id: 'arf-upload-zone',            prefix: 'arf',   key: 'screenshots' },
    { id: 'arf-assurance-upload-zone',  prefix: 'arf',   key: 'assuranceScreenshots' },
    { id: 'bounce-assurance-upload-zone', prefix: 'bounce', key: 'assuranceScreenshots' },
  ];
  zones.forEach(({ id, prefix, key }) => {
    const zone = document.getElementById(id);
    if (!zone) return;
    zone.addEventListener('mouseenter', () => { _pasteZone = { prefix, key }; });
    zone.addEventListener('mouseleave', () => { if (_pasteZone?.prefix === prefix && _pasteZone?.key === key) _pasteZone = null; });
  });
  document.addEventListener('paste', (e) => {
    if (!_pasteZone) return;
    const images = Array.from(e.clipboardData.items)
      .filter(item => item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (images.length === 0) return;
    e.preventDefault();
    processFiles(images, _pasteZone.prefix, _pasteZone.key);
  });
}

// ── localStorage persistence ──────────────────────────────────────────
const PERSIST_FIELDS = [
  'arf-account', 'arf-domain-type', 'arf-complaints', 'arf-prev-unblock',
  'arf-blocked-lt2', 'arf-email-type', 'arf-website', 'arf-dkim', 'arf-domain-input',
  'bounce-account', 'bounce-prev-unblock', 'bounce-other-blocked', 'bounce-website',
  'bounce-dkim', 'bounce-domain-input', 'bounce-other-blocked-detail',
];

function saveFormState() {
  const saved = {};
  PERSIST_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) saved[id] = el.value; });
  try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch (_) {}
}

function restoreFormState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { return; }
  if (!saved || !Object.keys(saved).some(k => saved[k])) return;
  PERSIST_FIELDS.forEach(id => { const el = document.getElementById(id); if (el && saved[id]) el.value = saved[id]; });
  const otherBlocked = document.getElementById('bounce-other-blocked');
  if (otherBlocked && otherBlocked.value) toggleOtherBlockedField(otherBlocked.value);
  showToast('Form state restored from last session.');
}

function attachPersistListeners() {
  PERSIST_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const panelPrefix = id.startsWith('arf') ? 'arf' : 'bounce';
      el.addEventListener('change', () => { saveFormState(); updateFormProgress(panelPrefix); });
      el.addEventListener('input', () => updateFormProgress(panelPrefix));
    }
  });
}

// ── Generate-button state (per-panel only) ────────────────────────────
// Each panel's generate button is only gated by its own lookup being in
// flight. Previously both were gated by either panel's lookupInFlight,
// which unnecessarily blocked the other panel during an unrelated lookup.
function setGenerateBtnState(prefix) {
  const btn = document.getElementById(prefix + '-generate-btn');
  if (!btn) return;
  const isLocked = state[prefix].lookupInFlight;
  btn.disabled = isLocked;
  const label = isLocked ? 'Lookup in progress…' : (prefix === 'arf' ? 'Generate ARF Report' : 'Generate Bounce Report');
  if (isLocked) {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ' + label;
  } else {
    const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    btn.innerHTML = icon + ' ' + label;
  }
  btn.title = isLocked ? 'Domain lookup is still in progress — please wait' : '';
}

// ── CSV helpers ───────────────────────────────────────────────────────
function parseCsvRow(row) {
  const cols = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function extractDomain(value) {
  return sanitiseDomainInput(value);
}

// ── CSV Bounce List ───────────────────────────────────────────────────
function handleCsvDrop(e) {
  e.preventDefault();
  document.getElementById('bounce-csv-zone').classList.remove('dragover');
  const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.csv') || f.type === 'text/csv');
  if (file) processCsv(file); else showToast('Please drop a .csv file');
}
function handleCsvSelect(e) { const file = e.target.files[0]; if (file) processCsv(file); e.target.value = ''; }
function processCsv(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim() !== '');
    const dataRows = Math.max(0, lines.length - 1);
    state.bounce.csvCount = dataRows;
    document.getElementById('bounce-csv-count').textContent = dataRows + ' bounce' + (dataRows !== 1 ? 's' : '');
    document.getElementById('bounce-csv-name').textContent = file.name;
    const badge = document.getElementById('bounce-lt40-badge');
    if (dataRows < 40) { badge.textContent = '< 40 ✓'; badge.className = 'csv-lt40-badge ok'; }
    else { badge.textContent = '≥ 40 ⚠'; badge.className = 'csv-lt40-badge warn'; }
    document.getElementById('bounce-csv-result').classList.add('visible');
    if (lines.length >= 2) {
      // Domain is taken from the 2nd column (index 1) if it yields a valid
      // domain/email, otherwise falls back to the 3rd column (index 2).
      const cols = parseCsvRow(lines[1]);
      const col2Value = cols[1] || '';
      const col3Value = cols[2] || '';
      const detectedDomain = sanitiseDomainInput(col2Value) || sanitiseDomainInput(col3Value);
      const domainInput = document.getElementById('bounce-domain-input');
      if (detectedDomain && domainInput) {
        domainInput.value = detectedDomain;
        const accountInput = document.getElementById('bounce-account');
        if (accountInput && !accountInput.value.trim()) accountInput.value = detectedDomain;
        showToast('Domain auto-detected: ' + detectedDomain + ' — running lookup…');
        lookupDomain('bounce');
      } else showToast(dataRows + ' bounce rows counted from ' + file.name);
    } else showToast(dataRows + ' bounce rows counted from ' + file.name);
  };
  reader.readAsText(file);
}
function clearCsv() {
  state.bounce.csvCount = null;
  document.getElementById('bounce-csv-result').classList.remove('visible');
  document.getElementById('bounce-csv-count').textContent = '—';
  document.getElementById('bounce-csv-name').textContent = '';
  document.getElementById('bounce-lt40-badge').textContent = '';
  document.getElementById('bounce-csv-input').value = '';
}

// ── Domain Lookup (debounced) ─────────────────────────────────────────
// Debounced — use for auto-triggers (paste, CSV detection)
function lookupDomain(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _lookupTimers[prefix] = setTimeout(() => _doLookup(prefix), LOOKUP_DEBOUNCE_MS);
}

// Immediate — use for explicit user button clicks
function lookupDomainImmediate(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _doLookup(prefix);
}

async function _doLookup(prefix) {
  const input = document.getElementById(prefix + '-domain-input');
  if (input) input.value = sanitiseDomainInput(input.value);
  const domain = input ? input.value.trim() : '';
  if (!domain) { showToast('Please enter a domain name.'); return; }

  const btn = document.getElementById(prefix + '-lookup-btn');
  const card = document.getElementById(prefix + '-domain-result');
  const createdEl = document.getElementById(prefix + '-result-created');
  const ageEl = document.getElementById(prefix + '-result-age');
  const websiteEl = document.getElementById(prefix + '-result-website');
  const dkimEl = document.getElementById(prefix + '-result-dkim');

  state[prefix].lookupInFlight = true;
  setGenerateBtnState(prefix);
  btn.disabled = true;
  btn.textContent = 'Looking up…';
  card.classList.remove('visible', 'error', 'open');
  if (websiteEl) websiteEl.innerHTML = '<div class="skeleton skeleton-sm"></div>';
  if (dkimEl) dkimEl.innerHTML = '<div class="skeleton skeleton-sm"></div>';

  try {
    const data = await fetchWhois(domain);
    state[prefix].whois = { creation_date: data.creation_date, domain_age: data.domain_age };
    createdEl.textContent = data.creation_date;
    ageEl.textContent = data.domain_age || '—';
    card.classList.remove('error');
    card.classList.add('visible', 'open');
    const summaryEl = document.getElementById(prefix + '-result-summary');
    if (summaryEl) summaryEl.textContent = data.domain_age ? data.creation_date + ' — ' + data.domain_age : data.creation_date;
    updateStepper(prefix, '1');
    applyDomainAgeColor(prefix);
    showToast('Domain info fetched! Checking website & DKIM…');
  } catch (err) {
    state[prefix].whois = null;
    createdEl.textContent = err.message || 'Lookup failed';
    ageEl.textContent = '—';
    card.classList.add('visible', 'error', 'open');
    const summaryEl = document.getElementById(prefix + '-result-summary');
    if (summaryEl) summaryEl.textContent = err.message || 'Lookup failed';
    updateStepper(prefix, '1');
    showToast('WHOIS lookup failed — still checking website & DKIM…');
  } finally {
    await Promise.allSettled([
      checkWebsite(prefix, domain),
      checkDkim(prefix, domain),
    ]);
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Lookup';
    state[prefix].lookupInFlight = false;
    setGenerateBtnState(prefix);
  }
}

function mapVerdictToSelect(verdict) {
  if (verdict === 'Valid Website') return 'Valid Website';
  return 'No website';
}

async function checkWebsite(prefix, domain) {
  const websiteEl = document.getElementById(prefix + '-result-website');
  const websiteSelect = document.getElementById(prefix + '-website');
  const hintEl = document.getElementById(prefix + '-website-hint');
  try {
    const data = await fetchWebsiteCheck(domain);
    const verdict = data.verdict || 'No website';
    const reason = data.reason || '';
    const bc = verdict === 'Valid Website' ? 'legit' : 'nosite';
    if (websiteEl) {
      websiteEl.innerHTML = '<span class="website-badge ' + bc + '"></span>';
      websiteEl.firstChild.textContent = verdict;
    }
    if (websiteSelect && websiteSelect.value === '') {
      const mapped = mapVerdictToSelect(verdict);
      websiteSelect.value = mapped;
      if (hintEl) hintEl.textContent = 'Auto-detected: ' + reason;
      updateFormProgress(prefix);
    }
    updateStepper(prefix, '2');
    showToast('Website: ' + verdict);
  } catch { if (websiteEl) websiteEl.innerHTML = '<span class="website-badge nosite">Check failed</span>'; updateStepper(prefix, '2'); }
}

async function checkDkim(prefix, domain) {
  const dkimEl = document.getElementById(prefix + '-result-dkim');
  const dkimSelect = document.getElementById(prefix + '-dkim');
  const hintEl = document.getElementById(prefix + '-dkim-hint');
  try {
    const data = await fetchDkimCheck(domain);
    const status = data.status || 'Not Set';
    const selectors = data.selectors_found || [];
    if (status === 'Set') {
      if (dkimEl) {
        dkimEl.innerHTML = '<span class="dkim-badge set"></span>';
        dkimEl.firstChild.textContent = 'Set — ' + selectors.join(', ');
      }
      if (dkimSelect && dkimSelect.value === '') {
        dkimSelect.value = 'Set';
        if (hintEl) hintEl.textContent = 'Auto-detected via selector: ' + selectors.join(', ');
        updateFormProgress(prefix);
      }
      showToast('DKIM: Set (' + selectors.join(', ') + ')');
    } else {
      if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge notset">Not Set</span>';
      if (dkimSelect && dkimSelect.value === '') {
        dkimSelect.value = 'Not Set';
        if (hintEl) hintEl.textContent = 'Auto-detected: no titan/neo DKIM record found';
        updateFormProgress(prefix);
      }
      showToast('DKIM: Not Set');
    }
    updateStepper(prefix, '3');
  } catch { if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge notset">Check failed</span>'; updateStepper(prefix, '3'); }
}

// ── Screenshots (capped at MAX_SCREENSHOTS) ───────────────────────────
function handleDrop(e, prefix, key) {
  e.preventDefault();
  const zoneId = prefix + (key === 'assuranceScreenshots' ? '-assurance' : '') + '-upload-zone';
  document.getElementById(zoneId).classList.remove('dragover');
  processFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')), prefix, key);
}
function handleFileSelect(e, prefix, key) { processFiles(Array.from(e.target.files), prefix, key); e.target.value = ''; }
function processFiles(files, prefix, key) {
  const target = state[prefix][key];
  const available = MAX_SCREENSHOTS - target.length;
  if (available <= 0) { showToast('Maximum ' + MAX_SCREENSHOTS + ' screenshots allowed.'); return; }
  const toProcess = files.slice(0, available);
  if (files.length > available) showToast('Only ' + available + ' more screenshot(s) allowed (max ' + MAX_SCREENSHOTS + '). ' + (files.length - available) + ' file(s) skipped.');
  toProcess.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => { target.push({ dataUrl: ev.target.result, name: file.name }); renderPreviews(prefix, key); };
    reader.readAsDataURL(file);
  });
}
function renderPreviews(prefix, key) {
  const containerId = prefix + (key === 'assuranceScreenshots' ? '-assurance' : '') + '-previews';
  const container = document.getElementById(containerId);
  if (!container) return;
  const target = state[prefix][key];
  container.innerHTML = '';
  if (target.length === 0) {
    renderScreenshotEmptyState(containerId, prefix + '.' + key);
    return;
  }
  target.forEach((s, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'screenshot-thumb';
    const img = document.createElement('img');
    img.src = s.dataUrl;
    img.alt = s.name;
    img.loading = 'lazy';
    img.width = 72;
    img.height = 72;
    thumb.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.setAttribute('data-action', 'remove-screenshot');
    removeBtn.setAttribute('data-panel', prefix);
    removeBtn.setAttribute('data-key', key);
    removeBtn.setAttribute('data-index', String(i));
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove screenshot');
    removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    thumb.appendChild(removeBtn);
    container.appendChild(thumb);
  });
  if (target.length > 0) {
    const c = document.createElement('span');
    c.className = 'screenshot-count';
    c.textContent = target.length + ' / ' + MAX_SCREENSHOTS + ' screenshot' + (target.length > 1 ? 's' : '') + ' attached';
    container.appendChild(c);
  }
}
function removeScreenshot(idx, prefix, key) { state[prefix][key].splice(idx, 1); renderPreviews(prefix, key); }

function renderInlineScreenshots(outputArea, screenshots, dividerLabel) {
  if (screenshots.length === 0) return;
  const divider = document.createElement('div');
  divider.className = 'output-inline-divider';
  divider.textContent = dividerLabel;
  outputArea.appendChild(divider);
  const grid = document.createElement('div');
  grid.className = 'output-screenshots-inline';
  screenshots.forEach((s, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'output-screenshot-item';
    const img = document.createElement('img');
    img.src = s.dataUrl; img.alt = s.name; img.title = s.name; img.loading = 'lazy';
    const label = document.createElement('span');
    label.className = 'output-screenshot-label';
    label.textContent = (i + 1) + '. ' + s.name;
    wrapper.appendChild(img); wrapper.appendChild(label);
    grid.appendChild(wrapper);
  });
  outputArea.appendChild(grid);
}

// ── Conditional fields ────────────────────────────────────────────────
function toggleOtherBlockedField(val) {
  const wrap = document.getElementById('bounce-other-blocked-detail-wrap');
  if (val === 'Yes') wrap.classList.add('visible');
  else { wrap.classList.remove('visible'); document.getElementById('bounce-other-blocked-detail').value = ''; }
}
function toggleAssurance(btn, prefix) {
  btn.classList.toggle('active');
  btn.setAttribute('aria-pressed', btn.classList.contains('active'));
  if (btn.getAttribute('data-value') === 'Other') {
    const f = document.getElementById(prefix + '-other-field');
    if (btn.classList.contains('active')) { f.classList.add('visible'); document.getElementById(prefix + '-other-text').focus(); }
    else { f.classList.remove('visible'); document.getElementById(prefix + '-other-text').value = ''; }
  }
}

// ── Contact Form Assurance ────────────────────────────────────────────
function toggleContactFormAssurance(btn) {
  btn.classList.toggle('active');
  btn.setAttribute('aria-pressed', btn.classList.contains('active'));
  const panel = document.getElementById('bounce-contact-form-suboptions');
  if (btn.classList.contains('active')) panel.classList.add('visible');
  else { panel.classList.remove('visible'); panel.querySelectorAll('.website-suboption-btn').forEach(b => b.classList.remove('active')); }
}
function toggleContactFormSuboption(btn) { btn.classList.toggle('active'); btn.setAttribute('aria-pressed', btn.classList.contains('active')); }
function getActiveContactFormSuboptions() {
  const vals = [];
  document.querySelectorAll('#bounce-contact-form-suboptions .website-suboption-btn.active').forEach(b => vals.push(b.getAttribute('data-value')));
  return vals;
}
function getActiveAssurances(prefix) {
  const vals = [];
  document.querySelectorAll('[id^="' + prefix + '-assurance-btns-"] .assurance-btn.active, [id="' + prefix + '-assurance-btns"] .assurance-btn.active').forEach(b => {
    const dataVal = b.getAttribute('data-value');
    if (dataVal === 'Other') { const t = document.getElementById(prefix + '-other-text').value.trim(); vals.push(t || 'Other'); }
    else if (dataVal === 'Contact Form' && prefix === 'bounce') { const subs = getActiveContactFormSuboptions(); vals.push(subs.length > 0 ? 'Contact Form (' + subs.join(', ') + ')' : 'Contact Form'); }
    else vals.push(dataVal);
  });
  return vals;
}
function clearAssurances(prefix) {
  document.querySelectorAll('[id^="' + prefix + '-assurance-btns-"] .assurance-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(prefix + '-other-field').classList.remove('visible');
  const ot = document.getElementById(prefix + '-other-text'); if (ot) ot.value = '';
  if (prefix === 'bounce') {
    const panel = document.getElementById('bounce-contact-form-suboptions');
    if (panel) { panel.classList.remove('visible'); panel.querySelectorAll('.website-suboption-btn').forEach(b => b.classList.remove('active')); }
  }
}

// ── Validation ────────────────────────────────────────────────────────
function v(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function validateARF() {
  const fieldIds = ['arf-account','arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim'];
  clearFieldErrors(fieldIds);
  const errors = [];
  if (!v('arf-account')) errors.push({ id: 'arf-account', label: 'Account' });
  if (!v('arf-domain-type'))  errors.push({ id: 'arf-domain-type',  label: 'Domain Type' });
  if (!v('arf-complaints'))   errors.push({ id: 'arf-complaints',   label: 'No. of ARF Complaints' });
  if (!v('arf-prev-unblock')) errors.push({ id: 'arf-prev-unblock', label: 'Previous Unblock Request' });
  if (!v('arf-blocked-lt2'))  errors.push({ id: 'arf-blocked-lt2',  label: 'Blocked Email Accounts < 2' });
  if (!v('arf-email-type'))   errors.push({ id: 'arf-email-type',   label: 'Email Content Type' });
  if (!v('arf-website'))      errors.push({ id: 'arf-website',      label: 'Valid Website' });
  if (!v('arf-dkim'))         errors.push({ id: 'arf-dkim',         label: 'DKIM Status' });
  const arfAssurances = getActiveAssurances('arf');
  if (arfAssurances.length === 0)
    errors.push({ id: null, label: 'Assurances (select at least one)' });
  return errors;
}

function validateBounce() {
  const fieldIds = ['bounce-account','bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-other-blocked-detail'];
  clearFieldErrors(fieldIds);
  const errors = [];
  if (!v('bounce-account')) errors.push({ id: 'bounce-account', label: 'Account' });
  if (!v('bounce-prev-unblock'))  errors.push({ id: 'bounce-prev-unblock',  label: 'Previous Unblock Request' });
  if (state.bounce.csvCount === null) errors.push({ id: null,               label: 'Bounce List CSV (upload a CSV file)' });
  if (!v('bounce-other-blocked')) errors.push({ id: 'bounce-other-blocked', label: 'Other Blocked Email in Domain' });
  if (v('bounce-other-blocked') === 'Yes' && !v('bounce-other-blocked-detail'))
    errors.push({ id: 'bounce-other-blocked-detail', label: 'Blocked Email Account(s) in Same Domain' });
  if (!v('bounce-website'))       errors.push({ id: 'bounce-website',       label: 'Valid Website' });
  if (!v('bounce-dkim'))          errors.push({ id: 'bounce-dkim',          label: 'DKIM Status' });
  const bounceAssurances = getActiveAssurances('bounce');
  if (bounceAssurances.length === 0)
    errors.push({ id: null, label: 'Assurances (select at least one)' });
  return errors;
}

// ── ARF Generate / Clear ──────────────────────────────────────────────
function generateARF() {
  try {
    const errors = validateARF();
    if (showValidationErrors('arf', errors)) return;
    document.getElementById('arf-validation-banner').classList.remove('visible');

    const assurances = getActiveAssurances('arf');
    const whois = state.arf.whois;
    const hasScreenshots = state.arf.screenshots.length > 0;
    const hasAssuranceSs = state.arf.assuranceScreenshots.length > 0;

    const lines = [
      '#ARF',
      'Domain: ' + (v('arf-domain-type') || '-'),
      'No of ARF complaints = ' + (v('arf-complaints') || '-'),
      'No previous unblock request for the domain name : ' + (v('arf-prev-unblock') || '-'),
      'No. of blocked email accounts < 2 : ' + (v('arf-blocked-lt2') || '-'),
      'Email Content Type: ' + (v('arf-email-type') || '-'),
      'Screenshot of the Email Content: ' + (hasScreenshots ? state.arf.screenshots.length + ' screenshot(s) attached (see below)' : '-'),
      'Domain Creation Date : ' + (whois ? whois.creation_date : '-'),
      'Domain Age : ' + (whois ? whois.domain_age : '-'),
      'Valid Website or not : ' + (v('arf-website') || '-'),
      'DKIM: ' + (v('arf-dkim') || '-'),
      'Assurances : ' + (assurances.length > 0 ? assurances.join(', ') : '-'),
    ];

    const copyLines = [...lines];
    if (hasScreenshots) {
      copyLines.push('');
      copyLines.push('── Screenshots ──');
      state.arf.screenshots.forEach((s, i) => copyLines.push((i + 1) + '. ' + s.name));
    }
    if (hasAssuranceSs) {
      copyLines.push('');
      copyLines.push('── Assurance Screenshots ──');
      state.arf.assuranceScreenshots.forEach((s, i) => copyLines.push((i + 1) + '. ' + s.name));
    }
    const fullCopyText = copyLines.join('\n\n');

    const outputSection = document.getElementById('arf-output-section');
    const outputArea = outputSection.querySelector('.output-area');

    const copyBtn = outputArea.querySelector('.copy-btn-wrap');
    outputArea.innerHTML = '';
    if (copyBtn) outputArea.appendChild(copyBtn);

    outputArea.dataset.copyText = fullCopyText;

    const ts = document.getElementById('arf-output-timestamp');
    if (ts) ts.textContent = 'Generated: ' + getOutputTimestamp();

    const pre = document.createElement('pre');
    pre.id = 'arf-output-text';
    pre.className = 'output-text';
    pre.textContent = lines.join('\n');
    outputArea.appendChild(pre);

    renderInlineScreenshots(outputArea, state.arf.screenshots, '── Screenshots ──');
    renderInlineScreenshots(outputArea, state.arf.assuranceScreenshots, '── Assurance Screenshots ──');

    outputSection.style.display = 'block';
    outputSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('ARF report generated!');
  } catch (err) {
    showToast('Failed to generate report — please try again.');
    console.error('generateARF error:', err);
  }
}

// clearARF: confirm before destroying form data
function clearARF() {
  if (!confirm('Clear all ARF form data? This cannot be undone.')) return;

  ['arf-account','arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim','arf-domain-input']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  state.arf.screenshots.length = 0;
  state.arf.assuranceScreenshots.length = 0;
  renderPreviews('arf', 'screenshots');
  renderPreviews('arf', 'assuranceScreenshots');
  clearAssurances('arf');
  state.arf.whois = null;
  document.getElementById('arf-domain-result').classList.remove('visible', 'error');
  ['arf-website-hint','arf-dkim-hint'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  const outputSection = document.getElementById('arf-output-section');
  outputSection.style.display = 'none';
  const outputArea = outputSection.querySelector('.output-area');
  const copyBtn = outputArea.querySelector('.copy-btn-wrap');
  outputArea.innerHTML = '';
  delete outputArea.dataset.copyText;
  if (copyBtn) outputArea.appendChild(copyBtn);
  const pre = document.createElement('pre');
  pre.id = 'arf-output-text';
  pre.className = 'output-text';
  outputArea.appendChild(pre);
  document.getElementById('arf-validation-banner').classList.remove('visible');
  clearFieldErrors(['arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim']);
  updateStepper('arf', '0');
  updateFormProgress('arf');
  saveFormState();
}

// ── Bounce Generate / Clear ───────────────────────────────────────────
function generateBounce() {
  try {
    const errors = validateBounce();
    if (showValidationErrors('bounce', errors)) return;
    document.getElementById('bounce-validation-banner').classList.remove('visible');

    const count = state.bounce.csvCount;
    const otherBlocked = v('bounce-other-blocked');
    const lt40 = count !== null ? (count < 40 ? 'Yes' : 'No') : '-';
    const countDisplay = count !== null ? ' (' + count + ')' : '';
    const assurances = getActiveAssurances('bounce');
    const whois = state.bounce.whois;
    const hasAssuranceSs = state.bounce.assuranceScreenshots.length > 0;
    const lines = [
      '#Bounce',
      'Previous unblock request for the same account : ' + (v('bounce-prev-unblock') || '-'),
      'Total bounce count at the time of last block < 40 : ' + lt40 + countDisplay,
      'Other blocked email account in the same domain : ' + (otherBlocked || '-'),
    ];
    if (otherBlocked === 'Yes') lines.push('Blocked account(s) in same domain : ' + (v('bounce-other-blocked-detail') || '-'));
    lines.push(
      'Domain Creation Date : ' + (whois ? whois.creation_date : '-'),
      'Domain Age : ' + (whois ? whois.domain_age : '-'),
      'Valid Website or not : ' + (v('bounce-website') || '-'),
      'DKIM: ' + (v('bounce-dkim') || '-'),
      'Assurances : ' + (assurances.length > 0 ? assurances.join(', ') : '-')
    );

    const copyLines = [...lines];
    if (hasAssuranceSs) {
      copyLines.push('');
      copyLines.push('── Assurance Screenshots ──');
      state.bounce.assuranceScreenshots.forEach((s, i) => copyLines.push((i + 1) + '. ' + s.name));
    }
    const fullCopyText = copyLines.join('\n\n');

    const outputSection = document.getElementById('bounce-output-section');
    const outputArea = outputSection.querySelector('.output-area');

    const copyBtn = outputArea.querySelector('.copy-btn-wrap');
    outputArea.innerHTML = '';
    if (copyBtn) outputArea.appendChild(copyBtn);

    outputArea.dataset.copyText = fullCopyText;

    const ts = document.getElementById('bounce-output-timestamp');
    if (ts) ts.textContent = 'Generated: ' + getOutputTimestamp();

    const pre = document.createElement('pre');
    pre.id = 'bounce-output-text';
    pre.className = 'output-text';
    pre.textContent = lines.join('\n');
    outputArea.appendChild(pre);

    renderInlineScreenshots(outputArea, state.bounce.assuranceScreenshots, '── Assurance Screenshots ──');

    outputSection.style.display = 'block';
    outputSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast('Bounce report generated!');
  } catch (err) {
    showToast('Failed to generate report — please try again.');
    console.error('generateBounce error:', err);
  }
}

// clearBounce: confirm before destroying form data
function clearBounce() {
  if (!confirm('Clear all Bounce form data? This cannot be undone.')) return;

  ['bounce-account','bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-domain-input','bounce-other-blocked-detail']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  clearCsv();
  state.bounce.assuranceScreenshots.length = 0;
  renderPreviews('bounce', 'assuranceScreenshots');
  toggleOtherBlockedField('');
  clearAssurances('bounce');
  state.bounce.whois = null;
  document.getElementById('bounce-domain-result').classList.remove('visible', 'error');
  ['bounce-website-hint','bounce-dkim-hint'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  const outputEl = document.getElementById('bounce-output-text');
  outputEl.textContent = '';
  delete outputEl.closest('.output-area').dataset.copyText;
  document.getElementById('bounce-output-section').style.display = 'none';
  document.getElementById('bounce-validation-banner').classList.remove('visible');
  clearFieldErrors(['bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-other-blocked-detail']);
  updateStepper('bounce', '0');
  updateFormProgress('bounce');
  saveFormState();
}

// ── JIRA integration ──────────────────────────────────────────────
function createTaeJira(prefix) {
  const outputSection = document.getElementById(prefix + '-output-section');
  if (!outputSection || outputSection.style.display === 'none') {
    showToast('Please generate the report first.', 'warning');
    return;
  }

  copyOutputWithFeedback(prefix + '-output-text');

  const account = document.getElementById(prefix + '-account')?.value.trim() || '';
  const typeLabel = prefix === 'arf' ? 'ARF' : 'Bounce';
  const summary = encodeURIComponent(typeLabel + ' unsuspension request: ' + account);
  const label = prefix === 'arf' ? 'ARF_unsuspension' : 'Bounce_unsuspension';
  const jiraUrl = 'https://jira.directi.com/secure/CreateIssueDetails!init.jspa?pid=12900&issuetype=10902&priority=10000&labels=' + label + '&summary=' + summary;

  window.open(jiraUrl, '_blank');
  showToast('JIRA opened! Press Ctrl+V in the Description field to paste the report & screenshots.', 'success');
}
