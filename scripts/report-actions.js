/**
 * Pure data preparation for report actions.
 * Keeps sheet and unsuspension payload shaping independent from the DOM.
 */
import { parseAccountList, validateAccountIdentifier } from './pure.js';

export function buildUnsuspendAccounts(account, prefix, otherBlocked, blockedDetail) {
  if (!validateAccountIdentifier(account)) return null;
  const accounts = [account];
  if (prefix === 'bounce' && otherBlocked === 'Yes') {
    const blockedRaw = (blockedDetail || '').trim();
    if (blockedRaw) {
      const blocked = parseAccountList(blockedRaw);
      if (!blocked) return null;
      const uniqueBlocked = blocked.filter(value => value !== account);
      accounts.push(...uniqueBlocked);
    }
  }
  return accounts;
}

export function getSheetReportType(prefix) {
  if (prefix === 'arf') return 'ARF';
  if (prefix === 'smtpsuspend') return 'SMTP';
  if (prefix === 'direct') return 'DIRECT';
  return 'BOUNCE';
}

// Direct panel suspension-type dropdown → Unsuspension Type column value.
// Returns null for anything unselected so callers fail with a warning.
export function getDirectSheetReportType(value) {
  if (value === 'ARF') return 'ARF';
  if (value === 'Bounce') return 'BOUNCE';
  return null;
}

// Extracts every email/domain mentioned anywhere in a JIRA summary — TAE
// tickets always name the account, whatever the surrounding wording.
// Candidates are filtered through validateAccountIdentifier, so prose never
// produces false accounts. Also sniffs a suspension-type prefix for the
// dropdown (null when absent).
const SUMMARY_ACCOUNT_RE = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}/g;

export function parseJiraSummaryAccounts(summary) {
  if (typeof summary !== 'string' || !summary) return null;
  const seen = new Set();
  const accounts = [];
  for (const candidate of summary.match(SUMMARY_ACCOUNT_RE) || []) {
    const clean = candidate.replace(/[.,;:!?)\]]+$/, '');
    if (!validateAccountIdentifier(clean) || seen.has(clean)) continue;
    seen.add(clean);
    accounts.push(clean);
  }
  if (accounts.length === 0) return null;
  const typePatterns = [
    ['ARF', /\barf\b/i],
    ['Bounce', /\bbounce\b/i],
    ['SMTP Compromised', /\bsmtp compromised\b/i],
  ];
  let type = null;
  let typeIdx = Infinity;
  for (const [name, pattern] of typePatterns) {
    const idx = summary.search(pattern);
    if (idx !== -1 && idx < typeIdx) { typeIdx = idx; type = name; }
  }
  return { type, accounts };
}

export function cleanSheetReason(reportText) {
  return reportText
    .split('\n')
    .filter(line => !line.startsWith('#ARF') && !line.startsWith('#Bounce') && !line.startsWith('#SMTP Suspension'))
    .filter(line => !/^── (Screenshots|Assurance Screenshots) ──$/.test(line.trim()))
    .filter(line => !/^\d+\.\s+\S+\.(png|jpg|jpeg|gif|webp)$/i.test(line.trim()))
    .join('\n')
    .trim();
}

// Sheets cells cap at 50k chars — truncate fetched JIRA descriptions with a
// visible marker instead of letting the log call fail server-side.
export function truncateSheetText(value, maxLength = 45000) {
  if (typeof value !== 'string' || !value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + '…[truncated]';
}
