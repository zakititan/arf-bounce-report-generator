// partner-helpers.js — Pure shared logic for content scripts (classic script, no imports).
// No browser dependencies (no document/chrome). Loaded as a classic script;
// content scripts call it via globalThis.ReportGenPartnerHelpers with local fallback.
(function () {
  function isActiveStatusCell(text) {
    if (typeof text !== 'string') return false;
    return /\bActive\b/.test(text);
  }

  function isEmptyOrUnknownStatus(text) {
    if (typeof text !== 'string') return true;
    var trimmed = text.trim();
    if (!trimmed) return true;
    if (/\bActive\b/.test(trimmed)) return false;
    if (/\bInactive\b/.test(trimmed)) return false;
    return true;
  }

  function parseDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    var comma = dataUrl.indexOf(',');
    if (comma === -1) return null;
    var header = dataUrl.slice(0, comma);
    var base64 = dataUrl.slice(comma + 1);
    if (!base64) return null;
    var m = header.match(/:(.*?);/);
    if (!m || !m[1]) return null;
    return { mime: m[1], base64: base64 };
  }

  function isAdminLoginExpired(desc) {
    if (!desc || desc.hasPasswordField !== true) return false;
    var formAction = typeof desc.formAction === 'string' ? desc.formAction : '';
    var pathname = typeof desc.pathname === 'string' ? desc.pathname : '';
    var buttons = Array.isArray(desc.buttonTexts) ? desc.buttonTexts : [];
    if (/login/i.test(formAction)) return true;
    if (/login/i.test(pathname)) return true;
    for (var i = 0; i < buttons.length; i++) {
      var t = buttons[i];
      if (typeof t !== 'string') continue;
      if (/log\s*in/i.test(t) || /sign\s*in/i.test(t)) return true;
    }
    return false;
  }

  var api = {
    isActiveStatusCell: isActiveStatusCell,
    isEmptyOrUnknownStatus: isEmptyOrUnknownStatus,
    parseDataUrl: parseDataUrl,
    isAdminLoginExpired: isAdminLoginExpired,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.ReportGenPartnerHelpers = api;
  }
  if (typeof window !== 'undefined') {
    window.ReportGenPartnerHelpers = api;
  }
})();
