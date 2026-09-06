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

export function isAllowedWebAppOrigin(origin) {
  return origin === 'http://localhost:3000' ||
    origin === 'https://arf-bounce-report-generator.vercel.app';
}

const REQUEST_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

export function validateExtensionResult(message) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return false;
  if (message.requestId !== undefined &&
      (typeof message.requestId !== 'string' || !REQUEST_ID_RE.test(message.requestId))) return false;
  if (message.type === 'PARTNER_PANEL_RESULT') {
    return Boolean(message.data) && typeof message.data === 'object' &&
      typeof message.data.success === 'boolean';
  }
  if (typeof message.success !== 'boolean') return false;
  if (message.type === 'REPORT_GENERATOR_JIRA_RESULT') {
    return (!message.error || typeof message.error === 'string') &&
      (!message.success || (typeof message.issueKey === 'string' && typeof message.url === 'string'));
  }
  if (message.type === 'REPORT_GENERATOR_UNSUSPEND_RESULT') {
    return (!message.issueKey || typeof message.issueKey === 'string') &&
      (!message.url || typeof message.url === 'string') &&
      (!message.error || typeof message.error === 'string');
  }
  if (message.type === 'REPORT_GENERATOR_LOG_SHEET_RESULT') {
    return (!message.cellUrl || typeof message.cellUrl === 'string') &&
      (!message.unverified || typeof message.unverified === 'boolean') &&
      (!message.error || typeof message.error === 'string');
  }
  return false;
}

export function validateUnsuspendOutcome(outcome) {
  return Boolean(outcome) && typeof outcome === 'object' &&
    typeof outcome.account === 'string' &&
    typeof outcome.outcome === 'string' &&
    (outcome.requestId === undefined || (typeof outcome.requestId === 'string' && REQUEST_ID_RE.test(outcome.requestId)));
}

export function shouldFinishUnsuspendTracking({ resultCount, expected, now, deadline }) {
  return resultCount >= expected || now >= deadline;
}

export function completeUnsuspendResults(accounts, results) {
  const reported = new Set(results.map(result => result.account));
  return results.concat(
    accounts
      .filter(account => !reported.has(account))
      .map(account => ({ account, outcome: 'unverified' })),
  );
}

export function matchesUnsuspendRequest(activeRequestId, responseRequestId) {
  return !activeRequestId || responseRequestId === activeRequestId;
}

// Legacy result messages had no ID. They remain usable only before a new
// request is active; an active request must never consume an uncorrelated reply.
export function matchesRequest(activeRequestId, responseRequestId) {
  return !activeRequestId || responseRequestId === activeRequestId;
}

export function createUnsuspendRequestId(now = Date.now(), entropy = Math.random()) {
  return 'unsuspend-' + now.toString(36) + '-' + Math.floor(entropy * 1e9).toString(36);
}

let requestSequence = 0;
export function createRequestId(prefix, now = Date.now(), entropy = Math.random()) {
  requestSequence = (requestSequence + 1) % 1000000;
  return prefix + '-' + now.toString(36) + '-' + Math.floor(entropy * 1e9).toString(36) + '-' + requestSequence.toString(36);
}
