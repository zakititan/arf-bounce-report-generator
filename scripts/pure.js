/**
 * pure.js — Pure functions with no DOM or browser dependencies.
 * Extracted for testability. Import from here in both app.js and tests.
 */

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

export function sanitiseDomainInput(value) {
  let v = value.trim();
  v = v.replace(/^https?:\/\//i, '');
  const atIdx = v.indexOf('@');
  if (atIdx !== -1) v = v.slice(atIdx + 1);
  v = v.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  return v.toLowerCase().trim();
}

const MAX_ACCOUNT_LEN = 254;

export function sanitiseAccountInput(value) {
  let v = (value || '').trim();
  if (v.length > MAX_ACCOUNT_LEN) v = v.slice(0, MAX_ACCOUNT_LEN);
  // If it contains @, treat as email — keep as-is (no stripping)
  if (v.includes('@')) return v;
  // Domain-only: strip protocols, HTML tags, javascript:, paths, control chars
  v = v.replace(/<[^>]*>/g, '');            // 1. strip HTML tags
  v = v.replace(/javascript\s*:/gi, '');     // 2. strip javascript: protocol
  v = v.replace(/^https?:\/\//i, '');        // 3. strip http(s)://
  v = v.split('/')[0].split('?')[0].split('#')[0].split(':')[0]; // 4. strip paths/query/fragment/port
  v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // 5. strip control chars
  return v;
}

export function parseCsvRow(row) {
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
