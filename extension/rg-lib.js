// rg-lib.js — Pure shared logic for the Report Generator extension (imported by background service worker and unit tests). No DOM / chrome APIs.

export const REASON_TTL_MS = 90000;
export const JIRA_DONE_TRANSITION_ID = '71';

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
