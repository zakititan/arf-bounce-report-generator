/**
 * Pure data preparation for report actions.
 * Keeps sheet and unsuspension payload shaping independent from the DOM.
 */

export function buildUnsuspendAccounts(account, prefix, otherBlocked, blockedDetail) {
  const accounts = [account];
  if (prefix === 'bounce' && otherBlocked === 'Yes') {
    const blockedRaw = (blockedDetail || '').trim();
    if (blockedRaw) {
      const blocked = blockedRaw.split(',').map(value => value.trim()).filter(value => value && value !== account);
      accounts.push(...blocked);
    }
  }
  return accounts;
}

export function getSheetReportType(prefix) {
  return prefix === 'arf' ? 'ARF' : prefix === 'smtpsuspend' ? 'SMTP' : 'BOUNCE';
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
