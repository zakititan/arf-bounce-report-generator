/**
 * ui.js — Pure UI helpers: toast, theme toggle, copy, field errors.
 * No business logic; no API calls.
 */

// ── Toast ─────────────────────────────────────────────────────────────
// role=status + aria-live=polite ensures screen readers announce toasts.
export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Theme toggle ──────────────────────────────────────────────────────
export function initThemeToggle() {
  const btn = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  let theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);
  setThemeIcon(btn, theme);
  btn && btn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    setThemeIcon(btn, theme);
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
  list.innerHTML = errors.map(e => '<li>' + e.label + '</li>').join('');
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
export function handleDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add('dragover');
}
export function handleDragLeave(e, zoneId) {
  document.getElementById(zoneId).classList.remove('dragover');
}

// ── Drag-and-drop helpers (CSV zone) ──────────────────────────────────
export function handleCsvDragOver(e) {
  e.preventDefault();
  document.getElementById('bounce-csv-zone').classList.add('dragover');
}
export function handleCsvDragLeave() {
  document.getElementById('bounce-csv-zone').classList.remove('dragover');
}
