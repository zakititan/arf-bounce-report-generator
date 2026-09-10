/**
 * pure.js — Pure functions with no DOM or browser dependencies.
 * Extracted for testability. Import from here in both app.js and tests.
 */

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

export function svgMarkup(inner, attributes = {}) {
  const allowedAttributes = new Set([
    'width', 'height', 'viewBox', 'fill', 'stroke',
    'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'aria-hidden',
  ]);
  const attrs = Object.entries(attributes)
    .filter(([name]) => allowedAttributes.has(name))
    .map(([name, value]) => ` ${name}="${String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))}"`)
    .join('');
  return `<svg${attrs}>${inner}</svg>`;
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

const DOMAIN_IDENTIFIER_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,60}[A-Za-z0-9])$/;
const EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

export function validateAccountIdentifier(value) {
  if (typeof value !== 'string') return false;
  const account = value.trim();
  if (!account || account.length > MAX_ACCOUNT_LEN || /[\s,]/.test(account)) return false;
  const atIndex = account.indexOf('@');
  if (atIndex === -1) return DOMAIN_IDENTIFIER_RE.test(account);
  if (atIndex !== account.lastIndexOf('@')) return false;
  const local = account.slice(0, atIndex);
  const domain = account.slice(atIndex + 1);
  return local.length <= 64 && EMAIL_LOCAL_RE.test(local) && DOMAIN_IDENTIFIER_RE.test(domain);
}

export function parseAccountList(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const accounts = value.split(',').map(account => account.trim());
  return accounts.every(validateAccountIdentifier) ? accounts : null;
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
    origin === 'https://arf-bounce-report-generator.vercel.app' ||
    /^https:\/\/arf-bounce-report-generator-[a-z0-9-]+\.vercel\.app$/.test(origin);
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
  if (message.type === 'REPORT_GENERATOR_ERROR') {
    return typeof message.code === 'string' &&
      (message.code === 'INVALID_MESSAGE' || message.code === 'STORAGE_UNAVAILABLE' || message.code === 'UNKNOWN_TYPE');
  }
  if (typeof message.success !== 'boolean') return false;
  if (message.type === 'REPORT_GENERATOR_JIRA_RESULT') {
    return (!message.error || typeof message.error === 'string') &&
      (!message.success || (typeof message.issueKey === 'string' && isSafeJiraUrl(message.url)));
  }
  if (message.type === 'REPORT_GENERATOR_UNSUSPEND_RESULT') {
    return (!message.issueKey || typeof message.issueKey === 'string') &&
      (!message.url || isSafeJiraUrl(message.url)) &&
      (!message.error || typeof message.error === 'string');
  }
  if (message.type === 'REPORT_GENERATOR_LOG_SHEET_RESULT') {
    return (!message.cellUrl || isSafeGoogleSheetsUrl(message.cellUrl)) &&
      (!message.unverified || typeof message.unverified === 'boolean') &&
      (!message.error || typeof message.error === 'string');
  }
  return false;
}

function isHttpsUrl(value, hostname, pathPattern) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname && pathPattern.test(url.pathname);
  } catch (_) {
    return false;
  }
}

export function isSafeJiraUrl(value) {
  return isHttpsUrl(value, 'jira.directi.com', /^\/browse\/[A-Z][A-Z0-9]+-\d+$/);
}

export function isSafeGoogleSheetsUrl(value) {
  return isHttpsUrl(value, 'docs.google.com', /^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/);
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

export function consumePendingRequest(pending, requestId) {
  if (!requestId || !pending.has(requestId)) return null;
  const request = pending.get(requestId);
  pending.delete(requestId);
  return request;
}

// Pending extension requests must never outlive their safety timeout:
// without the extension installed nothing consumes them, so unanswered
// entries (which retain DOM button references) would grow the map forever.
export const PENDING_REQUEST_TTL_MS = 90_000;

export function registerPendingRequest(pending, requestId, value, now = Date.now()) {
  const cutoff = now - PENDING_REQUEST_TTL_MS;
  for (const [key, entry] of pending) {
    if (!entry || typeof entry.createdAt !== 'number' || entry.createdAt <= cutoff) pending.delete(key);
  }
  pending.set(requestId, { ...value, createdAt: now });
  return pending;
}

// Screenshot caps: FileReader pushes asynchronously, so the check must count
// in-flight reads too — otherwise rapid pastes all see a stale length and
// blow past MAX_SCREENSHOTS with multi-MB dataURLs each.
export const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;

export function screenshotAcceptCount(currentCount, inFlightCount, incomingCount, max) {
  return Math.max(0, Math.min(incomingCount, max - currentCount - inFlightCount));
}

export function isAcceptableScreenshotSize(fileBytes, maxBytes = MAX_SCREENSHOT_BYTES) {
  return typeof fileBytes === 'number' && fileBytes >= 0 && fileBytes <= maxBytes;
}

export function createRequestContextKey(reportId, panel, requestId) {
  return JSON.stringify([reportId || '', panel || '', requestId || '']);
}

export function createUnsuspendRequestId(now = Date.now(), entropy = Math.random()) {
  return 'unsuspend-' + now.toString(36) + '-' + Math.floor(entropy * 1e9).toString(36);
}

let requestSequence = 0;
export function createRequestId(prefix, now = Date.now(), entropy = Math.random()) {
  requestSequence = (requestSequence + 1) % 1000000;
  return prefix + '-' + now.toString(36) + '-' + Math.floor(entropy * 1e9).toString(36) + '-' + requestSequence.toString(36);
}
