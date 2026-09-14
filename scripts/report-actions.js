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

// Parses tool-written JIRA summaries ("<Type> unsuspension request: <accounts>")
// back into their suspension type and account list. Returns null for foreign
// summaries or when no valid account remains.
export function parseJiraSummaryAccounts(summary) {
  if (typeof summary !== 'string' || !summary) return null;
  const match = /^(ARF|Bounce|SMTP Compromised) unsuspension request:\s*(.+)$/i.exec(summary.trim());
  if (!match) return null;
  const accounts = match[2].split(',').map(entry => entry.trim()).filter(validateAccountIdentifier);
  if (accounts.length === 0) return null;
  return { type: match[1], accounts };
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
