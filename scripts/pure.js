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
  if (message.type === 'REPORT_GENERATOR_JIRA_DESCRIPTION_RESULT') {
    return (!message.issueKey || typeof message.issueKey === 'string') &&
      (!message.description || typeof message.description === 'string') &&
      (!message.summary || typeof message.summary === 'string') &&
      (!message.error || typeof message.error === 'string');
  }
  if (message.type === 'REPORT_GENERATOR_JIRA_DONE_RESULT') {
    return (!message.issueKey || typeof message.issueKey === 'string') &&
      (!message.done || typeof message.done === 'boolean') &&
      (!message.commented || typeof message.commented === 'boolean') &&
      (!message.error || typeof message.error === 'string');
  }
  if (message.type === 'REPORT_GENERATOR_RECHECK_RESULT') {
    return (!message.account || typeof message.account === 'string') &&
      (!message.outcome || typeof message.outcome === 'string') &&
      (!message.error || typeof message.error === 'string');
  }
  if (message.type === 'REPORT_GENERATOR_DOMAIN_STATUS_RESULT') {
    return (!message.account || typeof message.account === 'string') &&
      (!message.domainStatus || typeof message.domainStatus === 'string') &&
      (!message.customerStatus || typeof message.customerStatus === 'string') &&
      (!message.userStatus || typeof message.userStatus === 'string') &&
      (!message.outcome || typeof message.outcome === 'string') &&
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

// ── Domain Check panel ────────────────────────────────────────────────────────
//
// Abuse Desk is the ONLY authority on whether a domain or email is suspended.
// The other checks each report their own finding and feed an "issues found"
// count, but they never flip the suspended verdict: a parked website is a fact
// about the site, not proof that the domain is suspended.

// True when any of the Abuse Desk status readings says "suspended".
export function isSuspendedReading(reading) {
  if (!reading || typeof reading !== 'object') return false;
  return ['domainStatus', 'customerStatus', 'userStatus'].some(key => {
    const value = reading[key];
    return typeof value === 'string' && value.trim().toLowerCase().indexOf('suspend') !== -1;
  });
}

// Turns one check's raw payload into a state + a human-readable detail line.
//
// States:
//   suspended — Abuse Desk says it is suspended (the only case that suspends)
//   active    — Abuse Desk says it is active
//   issue     — a genuine exposure (Laravel .env, open xmlrpc.php)
//   warn      — noteworthy but not an exposure (no website, no MX/SPF/DMARC)
//   info      — informational only (WordPress detected)
//   ok        — fine
//   unknown   — the check could not be read
export function classifyDomainCheck(check, data) {
  const d = (data && typeof data === 'object') ? data : {};

  if (check === 'ad') {
    if (d.error) return { state: 'unknown', detail: d.error };
    if (isSuspendedReading(d)) {
      const which = d.userStatus && String(d.userStatus).toLowerCase().indexOf('suspend') !== -1
        ? 'Email suspended'
        : (d.domainStatus && String(d.domainStatus).toLowerCase().indexOf('suspend') !== -1
            ? 'Domain suspended'
            : 'Customer suspended');
      return { state: 'suspended', detail: which };
    }
    const active = ['userStatus', 'domainStatus', 'customerStatus']
      .some(key => typeof d[key] === 'string' && d[key].trim().toLowerCase() === 'active');
    if (!active) return { state: 'unknown', detail: 'Abuse Desk did not report a status' };
    const parts = [];
    if (d.userStatus) parts.push('Email ' + d.userStatus);
    if (d.domainStatus) parts.push('Domain ' + d.domainStatus);
    if (d.customerStatus) parts.push('Customer ' + d.customerStatus);
    return { state: 'active', detail: parts.join(' · ') || 'Active' };
  }

  if (d.error) return { state: 'unknown', detail: d.error };

  if (check === 'website') {
    const verdict = d.verdict || '';
    if (verdict === 'Valid Website') return { state: 'ok', detail: verdict };
    if (!verdict) return { state: 'unknown', detail: 'No verdict returned' };
    return { state: 'warn', detail: verdict + (d.reason ? ' — ' + d.reason : '') };
  }

  if (check === 'mx') {
    const hosts = Array.isArray(d.mx) ? d.mx : [];
    if (!hosts.length) return { state: 'warn', detail: 'No MX records' };
    return { state: 'ok', detail: hosts.join(', ') };
  }

  if (check === 'spf') {
    if (!d.spf_present) return { state: 'warn', detail: 'No SPF record' };
    return { state: 'ok', detail: d.spf || 'SPF present' };
  }

  if (check === 'dmarc') {
    if (!d.dmarc_present) return { state: 'warn', detail: 'No DMARC record' };
    return { state: 'ok', detail: d.dmarc || 'DMARC present' };
  }

  if (check === 'dkim') {
    if (d.status === 'Set') {
      const sel = Array.isArray(d.selectors_found) ? d.selectors_found : [];
      return { state: 'ok', detail: sel.length ? 'Set — ' + sel.join(', ') : 'Set' };
    }
    if (d.status === 'Not Set') return { state: 'warn', detail: 'Not Set' };
    return { state: 'unknown', detail: 'No DKIM status returned' };
  }

  if (check === 'laravel') {
    if (d.vulnerable) return { state: 'issue', detail: d.reason || '.env exposed' };
    return { state: 'ok', detail: 'No exposed .env' };
  }

  if (check === 'xmlrpc') {
    if (d.vulnerable) return { state: 'issue', detail: d.reason || 'xmlrpc.php accessible' };
    return { state: 'ok', detail: 'Not accessible' };
  }

  if (check === 'wordpress') {
    if (d.detected) return { state: 'info', detail: d.reason || 'WordPress detected' };
    return { state: 'ok', detail: 'Not detected' };
  }

  if (check === 'whois') {
    if (d.creation_date) {
      return { state: 'ok', detail: d.creation_date + (d.domain_age ? ' — ' + d.domain_age : '') };
    }
    return { state: 'unknown', detail: 'No WHOIS data' };
  }

  return { state: 'unknown', detail: 'Unknown check' };
}

// Rolls the classified checks into one summary.
//
// `suspended` is tri-state on purpose:
//   true  — Abuse Desk says it is suspended
//   false — Abuse Desk says it is active
//   null  — Abuse Desk could not be read, so the state is genuinely unknown
export function summariseDomainChecks(checks) {
  const rows = (checks && typeof checks === 'object') ? checks : {};
  const ad = rows.ad || null;

  let suspended = null;
  if (ad && ad.state === 'suspended') suspended = true;
  else if (ad && ad.state === 'active') suspended = false;

  let issues = 0;
  let warnings = 0;
  for (const [key, row] of Object.entries(rows)) {
    if (key === 'ad' || !row) continue;
    if (row.state === 'issue') issues++;
    else if (row.state === 'warn') warnings++;
  }

  let headline;
  if (suspended === true) headline = 'Suspended';
  else if (suspended === false) headline = 'Active';
  else headline = 'Suspension status unknown';

  const extra = [];
  if (issues) extra.push(issues + (issues === 1 ? ' issue' : ' issues'));
  if (warnings) extra.push(warnings + (warnings === 1 ? ' warning' : ' warnings'));
  if (extra.length) headline += ' — ' + extra.join(', ');

  return { suspended, issues, warnings, headline };
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

// Recheck re-queries only what the last run could not confirm, so anything
// that did not report (or reported blank) is unknown rather than confirmed.
export function selectRecheckAccounts(accounts, results) {
  if (!Array.isArray(accounts) || !Array.isArray(results)) return [];
  const confirmed = new Set();
  for (const result of results) {
    if (!result || typeof result.account !== 'string') continue;
    const account = result.account.trim();
    if (account && result.outcome === 'confirmed') confirmed.add(account);
  }
  const selected = [];
  const seen = new Set();
  for (const account of accounts) {
    if (typeof account !== 'string') continue;
    const trimmed = account.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (!confirmed.has(trimmed)) selected.push(trimmed);
  }
  return selected;
}

export function shouldShowRecheckButton(results) {
  if (!Array.isArray(results) || results.length === 0) return false;
  return results.some(result => !result || result.outcome !== 'confirmed');
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
