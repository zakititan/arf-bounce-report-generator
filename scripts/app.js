/**
 * app.js — Core application logic.
 * Imports API helpers from api.js and UI helpers from ui.js.
 */

import { fetchWhois, fetchWebsiteCheck, fetchDkimCheck } from './api.js';
import {
  showToast, copyOutput, initThemeToggle,
  clearFieldErrors, showValidationErrors,
  handleDragOver, handleDragLeave,
  handleCsvDragOver, handleCsvDragLeave
} from './ui.js';

// Expose helpers needed by inline HTML event attributes
Object.assign(window, {
  lookupDomain, generateARF, clearARF, generateBounce, clearBounce,
  copyOutput, toggleAssurance, toggleOtherBlockedField,
  toggleContactFormAssurance, toggleContactFormSuboption,
  handleDragOver, handleDragLeave, handleDrop, handleFileSelect,
  handleCsvDragOver, handleCsvDragLeave, handleCsvDrop, handleCsvSelect,
  removeScreenshot, clearCsv
});

// ── State ─────────────────────────────────────────────────────────────
const lookupInFlight = { arf: false, bounce: false };
const whoisCache = {};
const arfScreenshots = [];
let bounceCsvCount = null;

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initThemeToggle);

// ── Generate-button state ─────────────────────────────────────────────
function setGenerateBtnState(prefix) {
  const btn = document.getElementById(prefix + '-generate-btn');
  if (!btn) return;
  btn.disabled = lookupInFlight[prefix];
  btn.title = lookupInFlight[prefix] ? 'Domain lookup is still in progress — please wait' : '';
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
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
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
function handleCsvSelect(e) {
  const file = e.target.files[0];
  if (file) processCsv(file);
  e.target.value = '';
}
function processCsv(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim() !== '');
    const dataRows = Math.max(0, lines.length - 1);
    bounceCsvCount = dataRows;
    document.getElementById('bounce-csv-count').textContent = dataRows + ' bounce' + (dataRows !== 1 ? 's' : '');
    document.getElementById('bounce-csv-name').textContent = file.name;
    const badge = document.getElementById('bounce-lt40-badge');
    if (dataRows < 40) { badge.textContent = '< 40 ✓'; badge.className = 'csv-lt40-badge ok'; }
    else { badge.textContent = '≥ 40 ⚠'; badge.className = 'csv-lt40-badge warn'; }
    document.getElementById('bounce-csv-result').classList.add('visible');
    if (lines.length >= 2) {
      const col3Value = parseCsvRow(lines[1])[2] || '';
      const detectedDomain = extractDomain(col3Value);
      const domainInput = document.getElementById('bounce-domain-input');
      if (detectedDomain && domainInput) {
        domainInput.value = detectedDomain;
        showToast('Domain auto-detected: ' + detectedDomain + ' — click Lookup to verify');
      } else {
        showToast(dataRows + ' bounce rows counted from ' + file.name);
      }
    } else {
      showToast(dataRows + ' bounce rows counted from ' + file.name);
    }
  };
  reader.readAsText(file);
}
function clearCsv() {
  bounceCsvCount = null;
  document.getElementById('bounce-csv-result').classList.remove('visible');
  document.getElementById('bounce-csv-count').textContent = '—';
  document.getElementById('bounce-csv-name').textContent = '';
  document.getElementById('bounce-lt40-badge').textContent = '';
  document.getElementById('bounce-csv-input').value = '';
}

// ── Domain Lookup ─────────────────────────────────────────────────────
async function lookupDomain(prefix) {
  const input = document.getElementById(prefix + '-domain-input');
  const domain = input ? input.value.trim() : '';
  if (!domain) { showToast('Please enter a domain name.'); return; }

  const btn = document.getElementById(prefix + '-lookup-btn');
  const card = document.getElementById(prefix + '-domain-result');
  const createdEl = document.getElementById(prefix + '-result-created');
  const ageEl = document.getElementById(prefix + '-result-age');
  const websiteEl = document.getElementById(prefix + '-result-website');
  const dkimEl = document.getElementById(prefix + '-result-dkim');

  lookupInFlight[prefix] = true;
  setGenerateBtnState(prefix);
  btn.disabled = true;
  btn.textContent = 'Looking up…';
  card.classList.remove('visible', 'error');
  if (websiteEl) websiteEl.innerHTML = '<span class="website-badge checking">checking…</span>';
  if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge checking">checking…</span>';

  try {
    const data = await fetchWhois(domain);
    whoisCache[prefix] = { creation_date: data.creation_date, domain_age: data.domain_age };
    createdEl.textContent = data.creation_date;
    ageEl.textContent = data.domain_age || '—';
    card.classList.remove('error');
    card.classList.add('visible');
    showToast('Domain info fetched! Checking website & DKIM…');
    checkWebsite(prefix, domain);
    checkDkim(prefix, domain);
  } catch (err) {
    whoisCache[prefix] = null;
    createdEl.textContent = err.message || 'Lookup failed';
    ageEl.textContent = '—';
    if (websiteEl) websiteEl.innerHTML = '—';
    if (dkimEl) dkimEl.innerHTML = '—';
    card.classList.add('visible', 'error');
    showToast('Lookup failed: ' + (err.message || 'unknown error'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Lookup';
    lookupInFlight[prefix] = false;
    setGenerateBtnState(prefix);
  }
}

async function checkWebsite(prefix, domain) {
  const websiteEl = document.getElementById(prefix + '-result-website');
  const websiteSelect = document.getElementById(prefix + '-website');
  const hintEl = document.getElementById(prefix + '-website-hint');
  try {
    const data = await fetchWebsiteCheck(domain);
    const verdict = data.verdict || 'Unknown';
    const reason = data.reason || '';
    let bc = 'legit';
    if (verdict === 'Fake') bc = 'fake';
    else if (verdict === 'No website' || verdict === 'Unreachable') bc = 'nosite';
    if (websiteEl) websiteEl.innerHTML = '<span class="website-badge ' + bc + '">' + verdict + '</span>';
    if (websiteSelect && websiteSelect.value === '') {
      const map = { Legit: 'Legit', Fake: 'Fake', 'No website': 'No website', Unreachable: 'No website' };
      const mapped = map[verdict];
      if (mapped) { websiteSelect.value = mapped; if (hintEl) hintEl.textContent = 'Auto-detected: ' + reason; }
    }
    showToast('Website: ' + verdict);
  } catch {
    if (websiteEl) websiteEl.innerHTML = '<span class="website-badge nosite">Check failed</span>';
  }
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
  } catch {
    if (dkimEl) dkimEl.innerHTML = '<span class="dkim-badge notset">Check failed</span>';
  }
}

// ── Screenshots ───────────────────────────────────────────────────────
function handleDrop(e, prefix) {
  e.preventDefault();
  document.getElementById(prefix + '-upload-zone').classList.remove('dragover');
  processFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')), prefix);
}
function handleFileSelect(e, prefix) {
  processFiles(Array.from(e.target.files), prefix);
  e.target.value = '';
}
function processFiles(files, prefix) {
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      if (prefix === 'arf') {
        arfScreenshots.push({ dataUrl: ev.target.result, name: file.name });
        renderPreviews();
      }
    };
    reader.readAsDataURL(file);
  });
}
function renderPreviews() {
  const container = document.getElementById('arf-previews');
  container.innerHTML = '';
  arfScreenshots.forEach((s, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'screenshot-thumb';
    thumb.innerHTML = '<img src="' + s.dataUrl + '" alt="' + s.name + '" loading="lazy" width="72" height="72"><button class="remove-btn" onclick="removeScreenshot(' + i + ')" title="Remove" aria-label="Remove screenshot">x</button>';
    container.appendChild(thumb);
  });
  if (arfScreenshots.length > 0) {
    const c = document.createElement('span');
    c.className = 'screenshot-count';
    c.textContent = arfScreenshots.length + ' screenshot' + (arfScreenshots.length > 1 ? 's' : '') + ' attached';
    container.appendChild(c);
  }
}
function removeScreenshot(idx) {
  arfScreenshots.splice(idx, 1);
  renderPreviews();
}

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
  if (btn.classList.contains('active')) {
    panel.classList.add('visible');
  } else {
    panel.classList.remove('visible');
    panel.querySelectorAll('.website-suboption-btn').forEach(b => b.classList.remove('active'));
  }
}
function toggleContactFormSuboption(btn) {
  btn.classList.toggle('active');
}
function getActiveContactFormSuboptions() {
  const vals = [];
  document.querySelectorAll('#bounce-contact-form-suboptions .website-suboption-btn.active').forEach(b => {
    vals.push(b.getAttribute('data-value'));
  });
  return vals;
}

function getActiveAssurances(prefix) {
  const vals = [];
  document.querySelectorAll('#' + prefix + '-assurance-btns .assurance-btn.active').forEach(b => {
    const dataVal = b.getAttribute('data-value');
    if (dataVal === 'Other') {
      const t = document.getElementById(prefix + '-other-text').value.trim();
      vals.push(t || 'Other');
    } else if (dataVal === 'Contact Form' && prefix === 'bounce') {
      const subs = getActiveContactFormSuboptions();
      vals.push(subs.length > 0 ? 'Contact Form (' + subs.join(', ') + ')' : 'Contact Form');
    } else {
      vals.push(dataVal);
    }
  });
  return vals;
}
function clearAssurances(prefix) {
  document.querySelectorAll('#' + prefix + '-assurance-btns .assurance-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(prefix + '-other-field').classList.remove('visible');
  const ot = document.getElementById(prefix + '-other-text');
  if (ot) ot.value = '';
  if (prefix === 'bounce') {
    const panel = document.getElementById('bounce-contact-form-suboptions');
    if (panel) {
      panel.classList.remove('visible');
      panel.querySelectorAll('.website-suboption-btn').forEach(b => b.classList.remove('active'));
    }
  }
}

// ── Validation ────────────────────────────────────────────────────────
function v(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function validateARF() {
  const fieldIds = ['arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim','arf-domain-input'];
  clearFieldErrors(fieldIds);
  const errors = [];
  if (!v('arf-domain-type'))   errors.push({ id: 'arf-domain-type',   label: 'Domain Type' });
  if (!v('arf-complaints'))    errors.push({ id: 'arf-complaints',    label: 'No. of ARF Complaints' });
  if (!v('arf-prev-unblock'))  errors.push({ id: 'arf-prev-unblock',  label: 'Previous Unblock Request' });
  if (!v('arf-blocked-lt2'))   errors.push({ id: 'arf-blocked-lt2',   label: 'Blocked Email Accounts < 2' });
  if (!v('arf-email-type'))    errors.push({ id: 'arf-email-type',    label: 'Email Content Type' });
  if (!v('arf-domain-input'))  errors.push({ id: 'arf-domain-input',  label: 'Domain Lookup (domain name required)' });
  if (!whoisCache['arf'])      errors.push({ id: 'arf-domain-input',  label: 'Domain Lookup (run Lookup first)' });
  if (!v('arf-website'))       errors.push({ id: 'arf-website',       label: 'Valid Website' });
  if (!v('arf-dkim'))          errors.push({ id: 'arf-dkim',          label: 'DKIM Status' });
  return errors;
}

function validateBounce() {
  const fieldIds = ['bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-domain-input','bounce-other-blocked-detail'];
  clearFieldErrors(fieldIds);
  const errors = [];
  if (!v('bounce-prev-unblock'))  errors.push({ id: 'bounce-prev-unblock',  label: 'Previous Unblock Request' });
  if (bounceCsvCount === null)    errors.push({ id: null,                   label: 'Bounce List CSV (upload a CSV file)' });
  if (!v('bounce-other-blocked')) errors.push({ id: 'bounce-other-blocked', label: 'Other Blocked Email in Domain' });
  if (v('bounce-other-blocked') === 'Yes' && !v('bounce-other-blocked-detail'))
    errors.push({ id: 'bounce-other-blocked-detail', label: 'Blocked Email Account(s) in Same Domain' });
  if (!v('bounce-website'))       errors.push({ id: 'bounce-website',       label: 'Valid Website' });
  if (!v('bounce-domain-input'))  errors.push({ id: 'bounce-domain-input',  label: 'Domain Lookup (domain name required)' });
  if (!whoisCache['bounce'])      errors.push({ id: 'bounce-domain-input',  label: 'Domain Lookup (run Lookup first)' });
  if (!v('bounce-dkim'))          errors.push({ id: 'bounce-dkim',          label: 'DKIM Status' });
  return errors;
}

// ── ARF Generate / Clear ──────────────────────────────────────────────
function generateARF() {
  const errors = validateARF();
  if (showValidationErrors('arf', errors)) return;
  document.getElementById('arf-validation-banner').classList.remove('visible');

  const screenshotLine = arfScreenshots.length > 0 ? arfScreenshots.length + ' screenshot(s) attached (see below)' : '-';
  const assurances = getActiveAssurances('arf');
  const whois = whoisCache['arf'];
  const lines = [
    '#ARF',
    'Domain: ' + (v('arf-domain-type') || '-'),
    'No of ARF complaints = ' + (v('arf-complaints') || '-'),
    'No previous unblock request for the domain name : ' + (v('arf-prev-unblock') || '-'),
    'No. of blocked email accounts < 2 : ' + (v('arf-blocked-lt2') || '-'),
    'Email Content Type: ' + (v('arf-email-type') || '-'),
    'Screenshot of the Email Content: ' + screenshotLine,
    'Domain Creation Date : ' + (whois ? whois.creation_date : '-'),
    'Domain Age : ' + (whois ? whois.domain_age : '-'),
    'Valid Website or not : ' + (v('arf-website') || '-'),
    'DKIM: ' + (v('arf-dkim') || '-'),
    'Assurances : ' + (assurances.length > 0 ? assurances.join(', ') : '-'),
  ];
  document.getElementById('arf-output-text').textContent = lines.join('\n');
  const imgContainer = document.getElementById('arf-output-images');
  imgContainer.innerHTML = '';
  if (arfScreenshots.length > 0) {
    const label = document.createElement('div');
    label.className = 'output-screenshots-label';
    label.textContent = '-- Screenshots --';
    imgContainer.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'output-screenshots';
    arfScreenshots.forEach(s => {
      const img = document.createElement('img');
      img.src = s.dataUrl; img.alt = s.name; img.title = s.name;
      img.loading = 'lazy'; img.width = 120; img.height = 120;
      grid.appendChild(img);
    });
    imgContainer.appendChild(grid);
  }
  const section = document.getElementById('arf-output-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showToast('ARF report generated!');
}

function clearARF() {
  ['arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim','arf-domain-input']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  arfScreenshots.length = 0;
  renderPreviews();
  clearAssurances('arf');
  whoisCache['arf'] = null;
  document.getElementById('arf-domain-result').classList.remove('visible', 'error');
  ['arf-website-hint','arf-dkim-hint'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  document.getElementById('arf-output-section').style.display = 'none';
  document.getElementById('arf-output-text').textContent = '';
  document.getElementById('arf-output-images').innerHTML = '';
  document.getElementById('arf-validation-banner').classList.remove('visible');
  clearFieldErrors(['arf-domain-type','arf-complaints','arf-prev-unblock','arf-blocked-lt2','arf-email-type','arf-website','arf-dkim','arf-domain-input']);
}

// ── Bounce Generate / Clear ───────────────────────────────────────────
function generateBounce() {
  const errors = validateBounce();
  if (showValidationErrors('bounce', errors)) return;
  document.getElementById('bounce-validation-banner').classList.remove('visible');

  const count = bounceCsvCount !== null ? bounceCsvCount : null;
  const otherBlocked = v('bounce-other-blocked');
  const lt40 = count !== null ? (count < 40 ? 'Yes' : 'No') : '-';
  const countDisplay = count !== null ? ' (' + count + ')' : '';
  const assurances = getActiveAssurances('bounce');
  const whois = whoisCache['bounce'];
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
  document.getElementById('bounce-output-text').textContent = lines.join('\n');
  const section = document.getElementById('bounce-output-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showToast('Bounce report generated!');
}

function clearBounce() {
  ['bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-domain-input']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  clearCsv();
  toggleOtherBlockedField('');
  clearAssurances('bounce');
  whoisCache['bounce'] = null;
  document.getElementById('bounce-domain-result').classList.remove('visible', 'error');
  ['bounce-website-hint','bounce-dkim-hint'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  document.getElementById('bounce-output-section').style.display = 'none';
  document.getElementById('bounce-output-text').textContent = '';
  document.getElementById('bounce-validation-banner').classList.remove('visible');
  clearFieldErrors(['bounce-prev-unblock','bounce-other-blocked','bounce-website','bounce-dkim','bounce-domain-input','bounce-other-blocked-detail']);
}
