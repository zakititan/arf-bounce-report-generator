// webapp-helpers.js — Pure decision logic for the web-app content-script bridge.
// Classic script, no imports/exports. No DOM / chrome / window / location access.
// Content script (content-webapp.js) reads via globalThis.RGWebappHelpers;
// node tests import this file for its side effect and read the same global.
(function () {
  var ACCOUNT_EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
  var ACCOUNT_DOMAIN_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,60}[A-Za-z0-9])$/;
  var REQUEST_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

  var HANDLED_WEBAPP_MESSAGE_TYPES = [
    'REPORT_GENERATOR_PING',
    'REPORT_GENERATOR_JIRA',
    'REPORT_GENERATOR_UNSUSPEND',
    'REPORT_GENERATOR_UNSUSPEND_NO_JIRA',
    'REPORT_GENERATOR_LOG_SHEET',
    'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP',
  ];

  var WEBAPP_ERROR_TYPE = 'REPORT_GENERATOR_ERROR';

  function isAllowedWebAppOrigin(origin) {
    if (typeof origin !== 'string') return false;
    return origin === 'http://localhost:3000' ||
      origin === 'https://arf-bounce-report-generator.vercel.app' ||
      /^https:\/\/arf-bounce-report-generator-[a-z0-9-]+\.vercel\.app$/.test(origin);
  }

  function resolveReplyOrigin(senderOrigin, locationOrigin) {
    if (isAllowedWebAppOrigin(senderOrigin)) return senderOrigin;
    if (isAllowedWebAppOrigin(locationOrigin)) return locationOrigin;
    return '*';
  }

  function extractRequestId(data) {
    if (!data || typeof data !== 'object') return undefined;
    return typeof data.requestId === 'string' ? data.requestId : undefined;
  }

  function isKnownReportGeneratorType(type) {
    return typeof type === 'string' && HANDLED_WEBAPP_MESSAGE_TYPES.indexOf(type) !== -1;
  }

  function normalizeAccounts(value) {
    var values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return values.reduce(function (all, item) {
      return all.concat(typeof item === 'string' ? item.split(',') : []);
    }, [])
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function isValidAccount(value) {
    if (typeof value !== 'string' || value.length > 254) return false;
    var atIndex = value.indexOf('@');
    if (atIndex === -1) return ACCOUNT_DOMAIN_RE.test(value);
    return atIndex === value.lastIndexOf('@') && atIndex > 0 && atIndex <= 64 &&
      ACCOUNT_EMAIL_LOCAL_RE.test(value.slice(0, atIndex)) &&
      ACCOUNT_DOMAIN_RE.test(value.slice(atIndex + 1));
  }

  function isValidWebAppMessage(data) {
    if (!data || typeof data.type !== 'string') return false;
    var requestId = typeof data.requestId === 'string' && REQUEST_ID_RE.test(data.requestId);
    if (data.type === 'REPORT_GENERATOR_PING') return true;
    if (data.type === 'REPORT_GENERATOR_JIRA') {
      return requestId && typeof data.panel === 'string' && typeof data.account === 'string' &&
        (typeof data.text === 'string' || typeof data.html === 'string') && Boolean(data.text || data.html) &&
        normalizeAccounts(data.account).length === 1 && isValidAccount(data.account.trim());
    }
    if (data.type === 'REPORT_GENERATOR_UNSUSPEND' || data.type === 'REPORT_GENERATOR_UNSUSPEND_NO_JIRA') {
      var list = normalizeAccounts(data.accounts || data.account);
      return requestId && typeof data.panel === 'string' && typeof data.text === 'string' &&
        typeof data.html === 'string' && list.length > 0 && list.every(isValidAccount);
    }
    if (data.type === 'REPORT_GENERATOR_LOG_SHEET') {
      return requestId && ['date', 'zdLink', 'domainEmail', 'reportType', 'reason', 'appsScriptUrl', 'panel']
        .every(function (key) { return typeof data[key] === 'string'; });
    }
    if (data.type === 'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP') {
      return requestId && isValidAccount(typeof data.account === 'string' ? data.account.trim() : '');
    }
    return false;
  }

  function buildErrorReply(code, requestId) {
    return { type: WEBAPP_ERROR_TYPE, code: code, requestId: requestId };
  }

  function decideEarlyErrorReply(data, storageAvailable) {
    if (!data || typeof data.type !== 'string') return null;
    if (data.type.indexOf('REPORT_GENERATOR_') !== 0) return null;
    // PING owns the PONG handshake and needs no storage; never convert it to an error.
    if (data.type === 'REPORT_GENERATOR_PING') return null;
    if (!storageAvailable) return buildErrorReply('STORAGE_UNAVAILABLE', extractRequestId(data));
    if (isKnownReportGeneratorType(data.type)) {
      return isValidWebAppMessage(data)
        ? null
        : buildErrorReply('INVALID_MESSAGE', extractRequestId(data));
    }
    return buildErrorReply('UNKNOWN_TYPE', extractRequestId(data));
  }

  var api = {
    HANDLED_WEBAPP_MESSAGE_TYPES: HANDLED_WEBAPP_MESSAGE_TYPES,
    WEBAPP_ERROR_TYPE: WEBAPP_ERROR_TYPE,
    isAllowedWebAppOrigin: isAllowedWebAppOrigin,
    resolveReplyOrigin: resolveReplyOrigin,
    extractRequestId: extractRequestId,
    isKnownReportGeneratorType: isKnownReportGeneratorType,
    isValidWebAppMessage: isValidWebAppMessage,
    buildErrorReply: buildErrorReply,
    decideEarlyErrorReply: decideEarlyErrorReply,
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.RGWebappHelpers = api;
  }
  if (typeof window !== 'undefined') {
    window.RGWebappHelpers = api;
  }
})();
