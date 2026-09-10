// rg-lib.js — Pure shared logic for the Report Generator extension (imported by background service worker and unit tests). No DOM / chrome APIs.

export const REASON_TTL_MS = 90000;
export const JIRA_DONE_TRANSITION_ID = '71';

const ACCOUNT_EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const ACCOUNT_DOMAIN_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,60}[A-Za-z0-9])$/;
const REQUEST_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

export function createUnsuspendReasonKey(requestId) {
  return 'unsuspendReason:' + (requestId || 'legacy');
}

export function createPerAccountUnsuspendReasonKey(requestId, account) {
  return createUnsuspendReasonKey(requestId) + ':' + String(account == null ? '' : account).trim().toLowerCase();
}

export function isSafeAppsScriptUrl(value) {
  return isHttpsUrl(value, 'script.google.com', /^\/macros\//) ||
    isHttpsUrl(value, 'script.googleusercontent.com', /^\/macros\//);
}

export function persistUnsuspendReason(storageSet, getLastError, value) {
  return new Promise((resolve, reject) => {
    try {
      storageSet(value, () => {
        const error = getLastError();
        if (error) {
          reject(new Error(error.message || String(error)));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function createUnsuspendVerifyKey(requestId, account) {
  return 'unsuspendVerify:' + (requestId || 'legacy') + ':' + encodeURIComponent(account || '');
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

export function selectJiraUrl(displayed, stored) {
  if (isSafeJiraUrl(displayed)) return displayed;
  return isSafeJiraUrl(stored) ? stored : '';
}

export function isSafeGoogleSheetsUrl(value) {
  return isHttpsUrl(value, 'docs.google.com', /^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/);
}

export function isAllowedWebAppOrigin(origin) {
  if (typeof origin !== 'string') return false;
  return origin === 'http://localhost:3000' ||
    origin === 'https://arf-bounce-report-generator.vercel.app' ||
    /^https:\/\/arf-bounce-report-generator-[a-z0-9-]+\.vercel\.app$/.test(origin);
}

export function isValidAccountIdentifier(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const atIndex = value.indexOf('@');
  if (atIndex === -1) return ACCOUNT_DOMAIN_RE.test(value);
  return atIndex === value.lastIndexOf('@') &&
    atIndex > 0 && atIndex <= 64 &&
    ACCOUNT_EMAIL_LOCAL_RE.test(value.slice(0, atIndex)) &&
    ACCOUNT_DOMAIN_RE.test(value.slice(atIndex + 1));
}

export function normalizeAccountList(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values.flatMap(item => typeof item === 'string' ? item.split(',') : [])
    .map(item => item.trim()).filter(Boolean);
}

export function areValidAccountList(value) {
  const accounts = normalizeAccountList(value);
  return accounts.length > 0 && accounts.every(isValidAccountIdentifier);
}

export function validateWebAppMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return false;
  const hasStrings = (keys) => keys.every(key => typeof message[key] === 'string');
  const hasRequestId = typeof message.requestId === 'string' && REQUEST_ID_RE.test(message.requestId);

  if (message.type === 'REPORT_GENERATOR_PING') return true;
  if (message.type === 'REPORT_GENERATOR_JIRA') {
    return hasRequestId && hasStrings(['panel', 'account']) &&
      (typeof message.text === 'string' || typeof message.html === 'string') &&
      Boolean(message.text || message.html) && normalizeAccountList(message.account).length === 1 &&
      isValidAccountIdentifier(message.account.trim());
  }
  if (message.type === 'REPORT_GENERATOR_UNSUSPEND' || message.type === 'REPORT_GENERATOR_UNSUSPEND_NO_JIRA') {
    const accounts = message.accounts || message.account;
    return hasRequestId && hasStrings(['panel']) && typeof message.text === 'string' &&
      typeof message.html === 'string' && areValidAccountList(accounts);
  }
  if (message.type === 'REPORT_GENERATOR_LOG_SHEET') {
    return hasRequestId && hasStrings(['date', 'zdLink', 'domainEmail', 'reportType', 'reason', 'appsScriptUrl', 'panel']);
  }
  if (message.type === 'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP') {
    return hasRequestId && isValidAccountIdentifier(typeof message.account === 'string' ? message.account.trim() : '');
  }
  return false;
}

export function validateExtensionResult(message) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return false;
  if (message.requestId !== undefined &&
      (typeof message.requestId !== 'string' || !REQUEST_ID_RE.test(message.requestId))) return false;
  if (typeof message.success !== 'boolean' && message.type !== 'PARTNER_PANEL_RESULT') return false;

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
  if (message.type === 'PARTNER_PANEL_RESULT') {
    return Boolean(message.data) && typeof message.data === 'object' &&
      typeof message.data.success === 'boolean';
  }
  return false;
}

let requestSequence = 0;
export function createRequestId(prefix, now = Date.now(), entropy = Math.random()) {
  requestSequence = (requestSequence + 1) % 1000000;
  return prefix + '-' + now.toString(36) + '-' + Math.floor(entropy * 1e9).toString(36) + '-' + requestSequence.toString(36);
}

export function createRequestContextKey(reportId, panel, requestId) {
  return JSON.stringify([reportId || '', panel || '', requestId || '']);
}

export function getScopedJiraUrl(stored, reportId, panel, requestId) {
  if (!stored || typeof stored !== 'object') return '';
  const entry = stored[createRequestContextKey(reportId, panel, requestId)];
  return entry && typeof entry.url === 'string' &&
    /^https:\/\/jira\.directi\.com\/browse\/[A-Z][A-Z0-9]+-\d+$/.test(entry.url) ? entry.url : '';
}

export function analyzeHistory(events) {
  var suspensionIdx = -1;
  var passwordResetAfterSuspension = false;
  var suspensionDate = 'N/A';
  var lastPasswordResetDate = 'N/A';

  for (var i = 0; i < events.length; i++) {
    var action = events[i].action.toLowerCase();
    if (action.indexOf('suspens') !== -1 && action.indexOf('un') === -1 && action.indexOf('removed') === -1) {
      suspensionIdx = i;
      suspensionDate = events[i].date || 'N/A';
      break;
    }
  }

  if (suspensionIdx > 0) {
    for (var j = 0; j < suspensionIdx; j++) {
      var jAction = events[j].action.toLowerCase();
      if (jAction.indexOf('password reset') !== -1 || jAction.indexOf('password changed') !== -1) {
        passwordResetAfterSuspension = true;
        break;
      }
    }
  }

  for (var k = 0; k < events.length; k++) {
    var kAction = events[k].action.toLowerCase();
    if (kAction.indexOf('password reset') !== -1 || kAction.indexOf('password changed') !== -1) {
      lastPasswordResetDate = events[k].date || 'N/A';
      break;
    }
  }

  return {
    passwordChanged: passwordResetAfterSuspension,
    suspensionDate: suspensionDate,
    lastPasswordResetDate: lastPasswordResetDate
  };
}

export function buildJiraIssueBody({ text, panel, account, zdLink }) {
  const typeLabel = panel === 'arf' ? 'ARF' : panel === 'smtpsuspend' ? 'SMTP Compromised' : 'Bounce';
  const label = panel === 'arf' ? 'ARF_unsuspension' : panel === 'smtpsuspend' ? 'SMTP_unsuspension' : 'Bounce_unsuspension';
  const summary = `${typeLabel} unsuspension request: ${account}`;

  return {
    fields: {
      project: { id: "12900" },
      issuetype: { id: "10902" },
      priority: { id: "10000" },
      summary,
      description: text,
      labels: [label],
      ...(zdLink ? { customfield_12211: zdLink } : {})
    }
  };
}

export function extractImagesRegex(html) {
  const images = [];
  const imgRegex = /<img\s+[^>]*src="(data:image\/([^;]+);base64,([^"]+))"[^>]*>/gi;
  let match;
  let index = 0;

  while ((match = imgRegex.exec(html)) !== null) {
    index++;
    const fullSrc = match[1];
    const imageType = match[2];
    const base64Data = match[3];
    const altRegex = /alt="([^"]*)"/i;
    const altMatch = altRegex.exec(match[0]);
    const altText = altMatch ? altMatch[1] : '';
    const filename = altText ? `${altText.replace(/[^a-z0-9]/gi, '_')}.png` : `screenshot-${index}.png`;

    images.push({
      base64: base64Data,
      mimeType: `image/${imageType}`,
      filename,
      dataUrl: fullSrc
    });
  }

  return images;
}

export function buildFallbackJiraUrl({ panel, account, text }) {
  const typeLabel = panel === 'arf' ? 'ARF' : panel === 'smtpsuspend' ? 'SMTP Compromised' : 'Bounce';
  const label = panel === 'arf' ? 'ARF_unsuspension' : panel === 'smtpsuspend' ? 'SMTP_unsuspension' : 'Bounce_unsuspension';
  const summary = encodeURIComponent(typeLabel + ' unsuspension request: ' + account);
  return (
    'https://jira.directi.com/secure/CreateIssueDetails!init.jspa?pid=12900&issuetype=10902&priority=10000&labels=' +
    label + '&summary=' + summary + '&description=' + encodeURIComponent((text || '').substring(0, 2000))
  );
}

export function isReasonFresh(record, now = Date.now()) {
  if (!record || typeof record.reason !== 'string' || record.reason.length === 0) return false;
  if (typeof record.ts !== 'number' || !Number.isFinite(record.ts)) return false;
  return now - record.ts <= REASON_TTL_MS;
}

// Storage safety: chrome.storage.local has a ~10MB quota and writes are never
// cleaned today. A single manual-fallback report with screenshots can exceed
// the whole quota in one write and break every later storage op — so cap what
// we store and sweep what we no longer need.
export const STORAGE_REPORT_HTML_MAX_BYTES = 500 * 1024;
export const REPORT_FALLBACK_TTL_MS = 10 * 60 * 1000;
export const JIRA_URL_TTL_MS = 24 * 60 * 60 * 1000;

export function isStorableReportHtml(html) {
  return typeof html === 'string' && html.length <= STORAGE_REPORT_HTML_MAX_BYTES;
}

function hasExpiredTs(value, field, ttlMs, now) {
  if (!value || typeof value !== 'object') return false;
  const ts = value[field];
  return typeof ts === 'number' && Number.isFinite(ts) && now - ts > ttlMs;
}

export function findStaleStorageKeys(entries, now = Date.now()) {
  const stale = [];
  if (!entries || typeof entries !== 'object') return stale;
  for (const key of Object.keys(entries)) {
    const value = entries[key];
    if (key.indexOf('unsuspendReason:') === 0) {
      if (value && typeof value === 'object' && !isReasonFresh(value, now)) stale.push(key);
    } else if (key.indexOf('unsuspendVerify:') === 0) {
      if (hasExpiredTs(value, 'ts', REASON_TTL_MS, now)) stale.push(key);
    } else if (key.indexOf('reportData:') === 0) {
      if (hasExpiredTs(value, 'timestamp', REPORT_FALLBACK_TTL_MS, now)) stale.push(key);
    } else if (key.indexOf('jiraUrl:') === 0) {
      if (hasExpiredTs(value, 'ts', JIRA_URL_TTL_MS, now)) stale.push(key);
    }
  }
  return stale;
}

export function isSuccessfulResponse(response) {
  return Boolean(response && response.ok === true);
}

export function capInlineImages(images, { maxCount = 10, maxBytesEach = 5 * 1024 * 1024, maxBytesTotal = 10 * 1024 * 1024 } = {}) {
  const list = Array.isArray(images) ? images : [];
  const kept = [];
  let keptBytes = 0;
  let droppedCount = 0;
  let droppedBytes = 0;
  for (const img of list) {
    const len = typeof img?.base64 === 'string' ? img.base64.length : 0;
    const bytes = Math.floor(len * 3 / 4);
    if (kept.length >= maxCount || bytes > maxBytesEach || keptBytes + bytes > maxBytesTotal) {
      droppedCount++;
      droppedBytes += bytes;
    } else {
      kept.push(img);
      keptBytes += bytes;
    }
  }
  return { kept, dropped: { count: droppedCount, bytes: droppedBytes } };
}

export function matchesActiveStatus(text) {
  if (typeof text !== 'string') return false;
  return /\bactive\b/.test(text.trim().toLowerCase());
}

export function createPendingMap() {
  const map = new Map();
  const check = (key) => { if (typeof key !== 'string' || key.length === 0) throw new TypeError('key must be a non-empty string'); };
  return {
    set(key, value) { check(key); map.set(key, value); },
    get(key) { check(key); return map.get(key); },
    has(key) { check(key); return map.has(key); },
    size() { return map.size; },
    resolve(key, result) {
      check(key);
      if (!map.has(key)) return false;
      const entry = map.get(key);
      map.delete(key);
      if (entry && typeof entry.resolve === 'function') entry.resolve(result);
      else if (typeof entry === 'function') entry(result);
      return true;
    },
    reject(key, err) {
      check(key);
      if (!map.has(key)) return false;
      const entry = map.get(key);
      map.delete(key);
      if (entry && typeof entry.reject === 'function') entry.reject(err);
      return true;
    }
  };
}

export function buildJiraTransitionDiscoveryUrl(jiraBase) {
  const base = typeof jiraBase === 'string' ? jiraBase.replace(/\/+$/, '') : '';
  return (issueKey) => base + '/rest/api/2/issue/' + issueKey + '/transitions';
}

export function discoverDoneTransitionId(response) {
  const list = response?.transitions;
  if (!Array.isArray(list)) return null;
  const norm = (v) => typeof v === 'string' ? v.toLowerCase() : '';
  const done = list.find((t) => norm(t?.to?.name) === 'done');
  if (done) return done.id;
  const closed = list.find((t) => norm(t?.to?.name) === 'closed');
  return closed ? closed.id : null;
}

export function isValidJiraCreatePayload({ text, html, account, panel } = {}) {
  if (typeof account !== 'string' || account.trim() === '') return false;
  if (typeof panel !== 'string' || panel.trim() === '') return false;
  if (typeof text === 'string' && text.trim() !== '') return true;
  const images = extractImagesRegex(typeof html === 'string' ? html : '');
  return images.length > 0;
}

export function buildBulkSummary(accounts) {
  const parts = Array.isArray(accounts) ? accounts : typeof accounts === 'string' ? [accounts] : [];
  const seen = new Set();
  const out = [];
  for (const item of parts) {
    if (typeof item !== 'string') continue;
    for (const piece of item.split(',')) {
      const t = piece.trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }
  return out.join(', ');
}
