/**
 * ui.js — Pure UI helpers: toast, theme toggle, copy, field errors.
 * No business logic; no API calls.
 */

// ── Toast ─────────────────────────────────────────────────────────────
// role=status + aria-live=polite ensures screen readers announce toasts.
// opts.html allows HTML content (default textContent); opts.durationMs overrides hide delay.
const ICONS = {
  success: '<polyline points="20 6 9 17 4 12"/>',
  error: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
};
let _toastTimer = null;
export function showToast(msg, type, { html = false, durationMs = 2500 } = {}) {
  const t = document.getElementById('toast');
  const type_ = type || 'info';
  const icSpan = document.createElement('span');
  icSpan.className = 'toast-ic';
  icSpan.setAttribute('aria-hidden', 'true');
  icSpan.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[type_] || ICONS.info) + '</svg>';
  const wrap = document.createElement('span');
  if (html) wrap.innerHTML = msg;
  else wrap.textContent = msg;
  t.replaceChildren(icSpan, wrap);
  t.setAttribute('data-type', type_);
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), durationMs);
}

// ── Theme toggle ──────────────────────────────────────────────────────
export function initThemeToggle() {
  const btn = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  // Restore persisted preference, fall back to OS preference
  let theme = localStorage.getItem('theme') ||
    (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', theme);
  setThemeIcon(btn, theme);
  btn && btn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.classList.add('theme-transitioning');
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    setThemeIcon(btn, theme);
    setTimeout(() => root.classList.remove('theme-transitioning'), 300);
  });
}

function setThemeIcon(btn, theme) {
  if (!btn) return;
  btn.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
  btn.innerHTML = theme === 'dark'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

// ── Field error styling ───────────────────────────────────────────────
export function clearFieldErrors(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('field-error');
  });
}

export function showValidationErrors(prefix, errors) {
  const banner = document.getElementById(prefix + '-validation-banner');
  const list = document.getElementById(prefix + '-validation-list');
  if (!errors.length) {
    banner.classList.remove('visible');
    list.innerHTML = '';
    return false;
  }
  list.innerHTML = '';
  const focusField = id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };
  errors.forEach(e => {
    const li = document.createElement('li');
    li.textContent = e.label;
    if (e.id) {
      li.dataset.targetId = e.id;
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.addEventListener('click', () => focusField(e.id));
      li.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          focusField(e.id);
        }
      });
    }
    list.appendChild(li);
  });
  banner.classList.add('visible');
  errors.forEach(e => {
    if (e.id) {
      const el = document.getElementById(e.id);
      if (el) el.classList.add('field-error');
    }
  });
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return true;
}

// ── Drag-and-drop helpers (screenshot zones) ──────────────────────────
const _dropZoneCache = new Map();
function _getDropZone(zoneId) {
  let el = _dropZoneCache.get(zoneId);
  if (!el) { el = document.getElementById(zoneId); if (el) _dropZoneCache.set(zoneId, el); }
  return el;
}
export function handleDragOver(e, zoneId) {
  e.preventDefault();
  _getDropZone(zoneId)?.classList.add('dragover');
}
export function handleDragLeave(e, zoneId) {
  _getDropZone(zoneId)?.classList.remove('dragover');
}

// ── Drag-and-drop helpers (CSV zone) ──────────────────────────────────
let _csvZone = null;
function _getCsvZone() { if (!_csvZone) _csvZone = document.getElementById('bounce-csv-zone'); return _csvZone; }
export function handleCsvDragOver(e) {
  e.preventDefault();
  _getCsvZone()?.classList.add('dragover');
}
export function handleCsvDragLeave() {
  _getCsvZone()?.classList.remove('dragover');
}

// ── Progress stepper ──────────────────────────────────────────────
export function updateStepper(prefix, step) {
  const steps = document.querySelectorAll('#' + prefix + '-stepper .stepper-step');
  const stepNum = step === 'done' ? Infinity : parseInt(step, 10);
  let nextActive = false;
  const currentMaxDone = Array.from(steps).reduce((max, s) => {
    return s.classList.contains('done') ? Math.max(max, parseInt(s.getAttribute('data-step'), 10)) : max;
  }, 0);
  const effectiveStep = stepNum === 0 ? 0 : Math.max(stepNum, currentMaxDone);
  steps.forEach(s => {
    const sStep = parseInt(s.getAttribute('data-step'), 10);
    if (sStep <= effectiveStep) {
      s.classList.add('done');
      s.classList.remove('active');
    } else if (!nextActive) {
      s.classList.remove('done');
      s.classList.add('active');
      nextActive = true;
    } else {
      s.classList.remove('done', 'active');
    }
  });

  const connectors = document.querySelectorAll('#' + prefix + '-stepper .stepper-connector');
  connectors.forEach(c => {
    const before = parseInt(c.getAttribute('data-before'), 10);
    if (before <= effectiveStep) c.classList.add('done');
    else c.classList.remove('done');
  });
}

// ── Domain age color ──────────────────────────────────────────────
export function parseAgeToDays(text) {
  const years = text.match(/(\d+)\s*years?/i);
  const months = text.match(/(\d+)\s*months?/i);
  const days = text.match(/(\d+)\s*days?/i);
  let total = 0;
  if (years) total += parseInt(years[1], 10) * 365;
  if (months) total += parseInt(months[1], 10) * 30;
  if (days) total += parseInt(days[1], 10);
  if (total > 0) return total;
  const plain = text.match(/(\d+)/);
  return plain ? parseInt(plain[1], 10) : null;
}

export function applyDomainAgeColor(prefix) {
  const el = document.getElementById(prefix + '-result-age');
  if (!el || !el.textContent || el.textContent === '—') return;
  const days = parseAgeToDays(el.textContent);
  if (days === null) return;
  el.classList.remove('age-recent', 'age-moderate', 'age-established');
  if (days < 30) el.classList.add('age-recent');
  else if (days < 180) el.classList.add('age-moderate');
  else el.classList.add('age-established');
}

// ── Collapsible result card toggle ────────────────────────────────
export function toggleResultCard(prefix) {
  const card = document.getElementById(prefix + '-domain-result');
  if (card) card.classList.toggle('open');
}

// ── Screenshot empty state ────────────────────────────────────────
export function renderScreenshotEmptyState(containerId, count) {
  const previews = document.getElementById(containerId);
  if (!previews) return;
  const max = 10;
  previews.innerHTML = '<div class="screenshot-empty"><div class="screenshot-empty-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div><span class="screenshot-empty-text">No screenshots attached</span><span class="screenshot-empty-count">' + count + ' / ' + max + '</span></div>';
}

// ── Generate timestamp for output ─────────────────────────────────
export function getOutputTimestamp() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
}
