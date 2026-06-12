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

// ── State ─────────────────────────────────────────────────────────────
const state = {
  arf: {
    screenshots: [],
    whois: null,
    lookupInFlight: false,
    lookupLastFired: 0,
  },
  bounce: {
    csvCount: null,
    whois: null,
    lookupInFlight: false,
    lookupLastFired: 0,
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
  // attachPersistListeners called exactly once here — do NOT add another
  // DOMContentListener for it elsewhere in this file.
  attachPersistListeners();
  updateFormProgress('arf');
  updateFormProgress('bounce');
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
      state[prefix].whois = null;
      document.getElementById(prefix + '-domain-result')?.classList.remove('visible', 'error');
    });
    input.addEventListener('blur', () => {
      const original = input.value;
      const sanitised = sanitiseDomainInput(original);
      if (sanitised !== original.trim()) {
        input.value = sanitised;
        showToast('Email stripped → ' + sanitised);
        state[prefix].whois = null;
        document.getElementById(prefix + '-domain-result')?.classList.remove('visible', 'error');
      }
    });
    input.addEventListener('input', () => {
      if (state[prefix].whois) {
        state[prefix].whois = null;
        document.getElementById(prefix + '-domain-result')?.classList.remove('visible', 'error');
      }
    });
  });
}

// ── Copy with visual button feedback ──────────────────────────────────
function copyOutputWithFeedback(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const outputArea = el.closest('.output-area');
  const text = (outputArea && outputArea.dataset.copyText) || el.textContent;
  if (!text.trim()) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
    const btn = outputArea?.querySelector('.copy-btn-wrap button');
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied ✓';
      btn.style.color = 'var(--color-success)';
      setTimeout(() => { btn.textContent = original; btn.style.color = ''; }, 2000);
    }
  }).catch(() => showToast('Copy failed — please copy manually.'));
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
        if (panel) lookupDomain(panel);
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
        if (!isNaN(idx)) removeScreenshot(idx);
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
  document.getElementById('arf-screenshot-input')?.addEventListener('change', (e) => handleFileSelect(e, 'arf'));
  document.getElementById('bounce-csv-input')?.addEventListener('change', (e) => handleCsvSelect(e));
}

// ── Drag-and-drop init ───────────────────────────────────────────────
function initDragDrop() {
  const arfZone = document.getElementById('arf-upload-zone');
  if (arfZone) {
    arfZone.addEventListener('dragover', (e) => handleDragOver(e, 'arf-upload-zone'));
    arfZone.addEventListener('dragleave', (e) => handleDragLeave(e, 'arf-upload-zone'));
    arfZone.addEventListener('drop', (e) => handleDrop(e, 'arf'));
  }
  const csvZone = document.getElementById('bounce-csv-zone');
  if (csvZone) {
    csvZone.addEventListener('dragover', handleCsvDragOver);
    csvZone.addEventListener('dragleave', handleCsvDragLeave);
    csvZone.addEventListener('drop', handleCsvDrop);
  }
}

// ── localStorage persistence ──────────────────────────────────────────
const PERSIST_FIELDS = [
  'arf-domain-type', 'arf-complaints', 'arf-prev-unblock',
  'arf-blocked-lt2', 'arf-email-type', 'arf-website', 'arf-dkim', 'arf-domain-input',
  'bounce-prev-unblock', 'bounce-other-blocked', 'bounce-website',
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
      el.addEventListener('change', () => { saveFormState(); updateFormProgress('arf'); updateFormProgress('bounce'); });
      el.addEventListener('input', () => { updateFormProgress('arf'); updateFormProgress('bounce'); });
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
  if (!value) return '';
  const atIdx = value.indexOf('@');
  return atIdx !== -1 ? value.slice(atIdx + 1).toLowerCase().trim() : value.toLowerCase().trim();
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
      const detectedDomain = extractDomain(col2Value) || extractDomain(col3Value);
      const domainInput = document.getElementById('bounce-domain-input');
      if (detectedDomain && domainInput) {
        domainInput.value = detectedDomain;
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
async function lookupDomain(prefix) {
  const now = Date.now();
  if (now - state[prefix].lookupLastFired < LOOKUP_DEBOUNCE_MS) return;
  state[prefix].lookupLastFired = now;

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
  if (websiteEl) websiteEl.innerHTML = '<span class="website-badge checking">checking…</span>';
  if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge checking">checking…</span>';

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
    // Always run website & DKIM checks regardless of WHOIS outcome
    checkWebsite(prefix, domain);
    checkDkim(prefix, domain);
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
    if (websiteEl) websiteEl.innerHTML = '<span class="website-badge ' + bc + '">' + verdict + '</span>';
    if (websiteSelect && websiteSelect.value === '') {
      const mapped = mapVerdictToSelect(verdict);
      websiteSelect.value = mapped;
      if (hintEl) hintEl.textContent = 'Auto-detected: ' + reason;
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
      if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge set">Set — ' + selectors.join(', ') + '</span>';
      if (dkimSelect && dkimSelect.value === '') {
        dkimSelect.value = 'Set';
        if (hintEl) hintEl.textContent = 'Auto-detected via selector: ' + selectors.join(', ');
      }
      showToast('DKIM: Set (' + selectors.join(', ') + ')');
    } else {
      if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge notset">Not Set</span>';
      if (dkimSelect && dkimSelect.value === '') {
        dkimSelect.value = 'Not Set';
        if (hintEl) hintEl.textContent = 'Auto-detected: no titan/neo DKIM record found';
      }
      showToast('DKIM: Not Set');
    }
    updateStepper(prefix, '3');
  } catch { if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge notset">Check failed</span>'; updateStepper(prefix, '3'); }
}

// ── Screenshots (capped at MAX_SCREENSHOTS) ───────────────────────────
function handleDrop(e, prefix) {
  e.preventDefault();
  document.getElementById(prefix + '-upload-zone').classList.remove('dragover');
  processFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')), prefix);
}
function handleFileSelect(e, prefix) { processFiles(Array.from(e.target.files), prefix); e.target.value = ''; }
function processFiles(files, prefix) {
  if (prefix !== 'arf') return;
  const screenshots = state.arf.screenshots;
  const available = MAX_SCREENSHOTS - screenshots.length;
  if (available <= 0) { showToast('Maximum ' + MAX_SCREENSHOTS + ' screenshots allowed.'); return; }
  const toProcess = files.slice(0, available);
  if (files.length > available) showToast('Only ' + available + ' more screenshot(s) allowed (max ' + MAX_SCREENSHOTS + '). ' + (files.length - available) + ' file(s) skipped.');
  toProcess.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => { screenshots.push({ dataUrl: ev.target.result, name: file.name }); renderPreviews(); };
    reader.readAsDataURL(file);
  });
}
function renderPreviews() {
  const container = document.getElementById('arf-previews');
  container.innerHTML = '';
  if (state.arf.screenshots.length === 0) {
    renderScreenshotEmptyState('arf');
    return;
  }
  state.arf.screenshots.forEach((s, i) => {
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
    removeBtn.setAttribute('data-index', String(i));
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove screenshot');
    removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    thumb.appendChild(removeBtn);
    container.appendChild(thumb);
  });
  if (state.arf.screenshots.length > 0) {
    const c = document.createElement('span');
    c.className = 'screenshot-count';
    c.textContent = state.arf.screenshots.length + ' / ' + MAX_SCREENSHOTS + ' screenshot' + (state.arf.screenshots.length > 1 ? 's' : '') + ' attached';
    container.appendChild(c);
  }
}
function removeScreenshot(idx) { state.arf.screenshots.splice(idx, 1); renderPreviews(); }

// ── Conditional fields ────────────────────────────────────────────────
function toggleOtherBlockedField(val) {
  const wrap = document.getElementById('bounce-other-blocked-detail-wrap');
  if (val === 'Yes') wrap.classList.add('visible');
  else { wrap.classList.remove('visible'); document.getElementById('bounce-other-blocked-detail').value = ''; }
}
function toggleAssurance(btn, prefix) {
  btn.classList.toggle('active');
  if (btn.getAttribute('data-value') === 'Other') {
    const f = document.getElementById(prefix + '-other-field');
    if (btn.classList.contains('active')) { f.classList.add('visible'); document.getElementById(prefix + '-other-text').focus(); }
    else { f.classList.remove('visible'); document.getElementById(prefix + '-other-text').value = ''; }
  }
}

// ── Contact Form Assurance ────────────────────────────────────────────
function toggleContactFormAssurance(btn) {
  btn.classList.toggle('active');
  const panel = document.getElementById('bounce-contact-form-suboptions');
  if (btn.classList.contains('active')) panel.classList.add('visible');
  else { panel.classList.remove('visible'); panel.querySelectorAll('.website-suboption-btn').forEach(b => b.classList.remove('active')); }
}
function toggleContactFormSuboption(btn) { btn.classList.toggle('active'); }
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
  const fieldIds = ['arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim'];
  clearFieldErrors(fieldIds);
  const errors = [];
  if (!v('arf-domain-type'))  errors.push({ id: 'arf-domain-type',  label: 'Domain Type' });
  if (!v('arf-complaints'))   errors.push({ id: 'arf-complaints',   label: 'No. of ARF Complaints' });
  if (!v('arf-prev-unblock')) errors.push({ id: 'arf-prev-unblock', label: 'Previous Unblock Request' });
  if (!v('arf-blocked-lt2'))  errors.push({ id: 'arf-blocked-lt2',  label: 'Blocked Email Accounts < 2' });
  if (!v('arf-email-type'))   errors.push({ id: 'arf-email-type',   label: 'Email Content Type' });
  if (!v('arf-website'))      errors.push({ id: 'arf-website',      label: 'Valid Website' });
  if (!v('arf-dkim'))         errors.push({ id: 'arf-dkim',         label: 'DKIM Status' });
  return errors;
}

function validateBounce() {
  const fieldIds = ['bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-other-blocked-detail'];
  clearFieldErrors(fieldIds);
  const errors = [];
  if (!v('bounce-prev-unblock'))  errors.push({ id: 'bounce-prev-unblock',  label: 'Previous Unblock Request' });
  if (state.bounce.csvCount === null) errors.push({ id: null,               label: 'Bounce List CSV (upload a CSV file)' });
  if (!v('bounce-other-blocked')) errors.push({ id: 'bounce-other-blocked', label: 'Other Blocked Email in Domain' });
  if (v('bounce-other-blocked') === 'Yes' && !v('bounce-other-blocked-detail'))
    errors.push({ id: 'bounce-other-blocked-detail', label: 'Blocked Email Account(s) in Same Domain' });
  if (!v('bounce-website'))       errors.push({ id: 'bounce-website',       label: 'Valid Website' });
  if (!v('bounce-dkim'))          errors.push({ id: 'bounce-dkim',          label: 'DKIM Status' });
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

    if (hasScreenshots) {
      const divider = document.createElement('div');
      divider.className = 'output-inline-divider';
      divider.textContent = '── Screenshots ──';
      outputArea.appendChild(divider);

      const grid = document.createElement('div');
      grid.className = 'output-screenshots-inline';
      state.arf.screenshots.forEach((s, i) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'output-screenshot-item';
        const img = document.createElement('img');
        img.src = s.dataUrl;
        img.alt = s.name;
        img.title = s.name;
        img.loading = 'lazy';
        const label = document.createElement('span');
        label.className = 'output-screenshot-label';
        label.textContent = (i + 1) + '. ' + s.name;
        wrapper.appendChild(img);
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
      });
      outputArea.appendChild(grid);
    }

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

  ['arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim','arf-domain-input']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  state.arf.screenshots.length = 0;
  renderPreviews();
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
    const fullText = lines.join('\n\n');
    const outputEl = document.getElementById('bounce-output-text');
    outputEl.textContent = fullText;
    outputEl.closest('.output-area').dataset.copyText = fullText;
    const section = document.getElementById('bounce-output-section');
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const ts = document.getElementById('bounce-output-timestamp');
    if (ts) ts.textContent = 'Generated: ' + getOutputTimestamp();
    showToast('Bounce report generated!');
  } catch (err) {
    showToast('Failed to generate report — please try again.');
    console.error('generateBounce error:', err);
  }
}

// clearBounce: confirm before destroying form data
function clearBounce() {
  if (!confirm('Clear all Bounce form data? This cannot be undone.')) return;

  ['bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-domain-input']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  clearCsv();
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
  saveFormState();
}
