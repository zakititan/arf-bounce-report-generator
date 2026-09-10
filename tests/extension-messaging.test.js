import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/webapp-helpers.js';

const {
  isAllowedWebAppOrigin,
  resolveReplyOrigin,
  extractRequestId,
  isKnownReportGeneratorType,
  isValidWebAppMessage,
  buildErrorReply,
  decideEarlyErrorReply,
  isOutboundReportGeneratorType,
  shouldAnswerPing,
} = globalThis.RGWebappHelpers;

// ── isAllowedWebAppOrigin ───────────────────────────────────────────────
describe('isAllowedWebAppOrigin', () => {
  it('accepts localhost, production and preview origins', () => {
    assert.equal(isAllowedWebAppOrigin('http://localhost:3000'), true);
    assert.equal(isAllowedWebAppOrigin('https://arf-bounce-report-generator.vercel.app'), true);
    assert.equal(
      isAllowedWebAppOrigin('https://arf-bounce-report-generator-git-test-abc123-zaki-titans-projects.vercel.app'),
      true
    );
  });

  it('rejects untrusted, empty and non-string origins', () => {
    assert.equal(isAllowedWebAppOrigin('https://evil.example'), false);
    assert.equal(isAllowedWebAppOrigin('https://preview-123.vercel.app'), false);
    assert.equal(isAllowedWebAppOrigin('null'), false);
    assert.equal(isAllowedWebAppOrigin(''), false);
    assert.equal(isAllowedWebAppOrigin(null), false);
    assert.equal(isAllowedWebAppOrigin(undefined), false);
    assert.equal(isAllowedWebAppOrigin(42), false);
  });
});

// ── resolveReplyOrigin ──────────────────────────────────────────────────
describe('resolveReplyOrigin', () => {
  it('returns the validated sender origin for replies', () => {
    assert.equal(
      resolveReplyOrigin('https://arf-bounce-report-generator.vercel.app', 'https://arf-bounce-report-generator.vercel.app'),
      'https://arf-bounce-report-generator.vercel.app'
    );
    assert.equal(
      resolveReplyOrigin('http://localhost:3000', 'https://arf-bounce-report-generator.vercel.app'),
      'http://localhost:3000'
    );
  });

  it('falls back to location.origin when the sender is not allowed', () => {
    assert.equal(
      resolveReplyOrigin('https://evil.example', 'https://arf-bounce-report-generator.vercel.app'),
      'https://arf-bounce-report-generator.vercel.app'
    );
    assert.equal(
      resolveReplyOrigin('', 'http://localhost:3000'),
      'http://localhost:3000'
    );
  });

  it('returns "*" only when neither sender nor location is trusted (initial PONG beacon)', () => {
    assert.equal(resolveReplyOrigin('https://evil.example', 'https://evil.example'), '*');
    assert.equal(resolveReplyOrigin('', ''), '*');
    assert.equal(resolveReplyOrigin(null, null), '*');
    assert.equal(resolveReplyOrigin(undefined, undefined), '*');
  });

  it('supports the beacon case with no sender origin', () => {
    assert.equal(
      resolveReplyOrigin(null, 'https://arf-bounce-report-generator.vercel.app'),
      'https://arf-bounce-report-generator.vercel.app'
    );
    assert.equal(resolveReplyOrigin(null, 'https://evil.example'), '*');
  });
});

// ── extractRequestId ────────────────────────────────────────────────────
describe('extractRequestId', () => {
  it('returns the string requestId when present', () => {
    assert.equal(extractRequestId({ type: 'REPORT_GENERATOR_JIRA', requestId: 'jira_123' }), 'jira_123');
  });

  it('returns undefined for missing, non-string or nullish input', () => {
    assert.equal(extractRequestId({ type: 'REPORT_GENERATOR_JIRA' }), undefined);
    assert.equal(extractRequestId({ type: 'REPORT_GENERATOR_JIRA', requestId: 42 }), undefined);
    assert.equal(extractRequestId({ type: 'REPORT_GENERATOR_JIRA', requestId: null }), undefined);
    assert.equal(extractRequestId(null), undefined);
    assert.equal(extractRequestId(undefined), undefined);
    assert.equal(extractRequestId('nope'), undefined);
  });
});

// ── echo-storm immunity ─────────────────────────────────────────────────
describe('isOutboundReportGeneratorType', () => {
  it('flags our own outbound types so echoes never get replies', () => {
    for (const type of [
      'REPORT_GENERATOR_PONG',
      'REPORT_GENERATOR_ERROR',
      'REPORT_GENERATOR_JIRA_RESULT',
      'REPORT_GENERATOR_UNSUSPEND_RESULT',
      'REPORT_GENERATOR_LOG_SHEET_RESULT',
      'PARTNER_PANEL_RESULT',
      'REPORT_GENERATOR_UNSUSPEND_OUTCOME',
    ]) {
      assert.equal(isOutboundReportGeneratorType(type), true, type);
    }
  });

  it('does not flag inbound request types', () => {
    for (const type of [
      'REPORT_GENERATOR_PING',
      'REPORT_GENERATOR_JIRA',
      'REPORT_GENERATOR_UNSUSPEND',
      'REPORT_GENERATOR_NOPE',
      null,
      undefined,
    ]) {
      assert.equal(isOutboundReportGeneratorType(type), false, String(type));
    }
  });
});

describe('decideEarlyErrorReply echo immunity', () => {
  it('returns null for our own outbound types instead of error replies', () => {
    assert.equal(decideEarlyErrorReply({ type: 'REPORT_GENERATOR_PONG', version: '4.7' }, true), null);
    assert.equal(decideEarlyErrorReply({ type: 'REPORT_GENERATOR_JIRA_RESULT', requestId: 'jira_1', success: true }, true), null);
    assert.equal(decideEarlyErrorReply({ type: 'REPORT_GENERATOR_ERROR', code: 'UNKNOWN_TYPE' }, true), null);
  });
});

describe('shouldAnswerPing', () => {
  it('answers the first PING and throttles repeats to one per second', () => {
    assert.equal(shouldAnswerPing(undefined, 1000), true);
    assert.equal(shouldAnswerPing(0, 1000), true);
    assert.equal(shouldAnswerPing(1000, 1500), false);
    assert.equal(shouldAnswerPing(1000, 2000), true);
    assert.equal(shouldAnswerPing(1000, 2001), true);
  });
});

// ── isKnownReportGeneratorType ──────────────────────────────────────────
describe('isKnownReportGeneratorType', () => {
  it('recognises every handled REPORT_GENERATOR_* type', () => {
    for (const type of [
      'REPORT_GENERATOR_PING',
      'REPORT_GENERATOR_JIRA',
      'REPORT_GENERATOR_UNSUSPEND',
      'REPORT_GENERATOR_UNSUSPEND_NO_JIRA',
      'REPORT_GENERATOR_LOG_SHEET',
      'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP',
    ]) {
      assert.equal(isKnownReportGeneratorType(type), true, type);
    }
  });

  it('rejects unknown REPORT_GENERATOR_* types and unrelated types', () => {
    assert.equal(isKnownReportGeneratorType('REPORT_GENERATOR_NOPE'), false);
    assert.equal(isKnownReportGeneratorType('REPORT_GENERATOR_JIRA_RESULT'), false);
    assert.equal(isKnownReportGeneratorType('PARTNER_PANEL_RESULT'), false);
    assert.equal(isKnownReportGeneratorType(''), false);
    assert.equal(isKnownReportGeneratorType(null), false);
    assert.equal(isKnownReportGeneratorType(undefined), false);
  });
});

// ── isValidWebAppMessage ────────────────────────────────────────────────
describe('isValidWebAppMessage', () => {
  it('accepts PING without a requestId', () => {
    assert.equal(isValidWebAppMessage({ type: 'REPORT_GENERATOR_PING' }), true);
  });

  it('requires typed JIRA payload fields before forwarding', () => {
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_JIRA', text: 'report', panel: 'arf',
        account: 'user@example.com', requestId: 'jira_123',
      }),
      true
    );
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_JIRA', text: '', html: '', panel: 'arf',
        account: 'user@example.com', requestId: 'jira_123',
      }),
      false
    );
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_JIRA', text: 'report', panel: 'arf',
        account: 'not an account', requestId: 'jira_123',
      }),
      false
    );
  });

  it('rejects JIRA messages with a malformed requestId', () => {
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_JIRA', text: 'report', panel: 'arf',
        account: 'user@example.com', requestId: 'bad id',
      }),
      false
    );
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_JIRA', text: 'report', panel: 'arf',
        account: 'user@example.com',
      }),
      false
    );
  });

  it('validates unsuspend payloads including comma-separated accounts', () => {
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_UNSUSPEND', accounts: ['one@example.com', 'two.example.com'],
        text: 'report', html: '', panel: 'bounce', requestId: 'unsuspend_123',
      }),
      true
    );
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_UNSUSPEND', accounts: ['one@example.com', 'bad account'],
        text: 'report', html: '', panel: 'bounce', requestId: 'unsuspend_123',
      }),
      false
    );
  });

  it('validates log-sheet and partner-lookup shapes', () => {
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_LOG_SHEET', date: '2024-01-01', zdLink: 'z', domainEmail: 'd',
        reportType: 't', reason: 'r', appsScriptUrl: 'u', panel: 'arf', requestId: 'sheet_1',
      }),
      true
    );
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_LOG_SHEET', date: '2024-01-01', requestId: 'sheet_1',
      }),
      false
    );
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP', account: 'user@example.com', requestId: 'partner_1',
      }),
      true
    );
    assert.equal(
      isValidWebAppMessage({
        type: 'REPORT_GENERATOR_PARTNER_PANEL_LOOKUP', account: 'bad account', requestId: 'partner_1',
      }),
      false
    );
  });

  it('rejects unknown types and non-objects', () => {
    assert.equal(isValidWebAppMessage({ type: 'REPORT_GENERATOR_NOPE', requestId: 'x1' }), false);
    assert.equal(isValidWebAppMessage(null), false);
    assert.equal(isValidWebAppMessage({}), false);
  });
});

// ── buildErrorReply ─────────────────────────────────────────────────────
describe('buildErrorReply', () => {
  it('builds a typed REPORT_GENERATOR_ERROR payload echoing requestId', () => {
    assert.deepEqual(buildErrorReply('INVALID_MESSAGE', 'req_1'), {
      type: 'REPORT_GENERATOR_ERROR',
      code: 'INVALID_MESSAGE',
      requestId: 'req_1',
    });
    assert.deepEqual(buildErrorReply('STORAGE_UNAVAILABLE', 'req_2'), {
      type: 'REPORT_GENERATOR_ERROR',
      code: 'STORAGE_UNAVAILABLE',
      requestId: 'req_2',
    });
    assert.deepEqual(buildErrorReply('UNKNOWN_TYPE', 'req_3'), {
      type: 'REPORT_GENERATOR_ERROR',
      code: 'UNKNOWN_TYPE',
      requestId: 'req_3',
    });
  });

  it('preserves an undefined requestId when the input had none', () => {
    assert.deepEqual(buildErrorReply('INVALID_MESSAGE', undefined), {
      type: 'REPORT_GENERATOR_ERROR',
      code: 'INVALID_MESSAGE',
      requestId: undefined,
    });
  });
});

// ── decideEarlyErrorReply ───────────────────────────────────────────────
describe('decideEarlyErrorReply', () => {
  it('ignores non-protocol messages so unrelated postMessages stay silent', () => {
    assert.equal(decideEarlyErrorReply(null, true), null);
    assert.equal(decideEarlyErrorReply({ type: 'SOMETHING_ELSE' }, true), null);
    assert.equal(decideEarlyErrorReply({ type: 'PARTNER_PANEL_RESULT' }, true), null);
    assert.equal(decideEarlyErrorReply({}, true), null);
  });

  it('returns null for PING so the caller can still send PONG (handshake keeps working)', () => {
    assert.equal(decideEarlyErrorReply({ type: 'REPORT_GENERATOR_PING' }, true), null);
    assert.equal(decideEarlyErrorReply({ type: 'REPORT_GENERATOR_PING' }, false), null);
  });

  it('returns null for valid handled messages so normal processing continues', () => {
    assert.equal(
      decideEarlyErrorReply({
        type: 'REPORT_GENERATOR_JIRA', text: 'report', panel: 'arf',
        account: 'user@example.com', requestId: 'jira_123',
      }, true),
      null
    );
  });

  it('returns STORAGE_UNAVAILABLE when chrome.storage is missing, echoing requestId', () => {
    assert.deepEqual(
      decideEarlyErrorReply({
        type: 'REPORT_GENERATOR_JIRA', text: 'report', panel: 'arf',
        account: 'user@example.com', requestId: 'jira_123',
      }, false),
      { type: 'REPORT_GENERATOR_ERROR', code: 'STORAGE_UNAVAILABLE', requestId: 'jira_123' }
    );
  });

  it('returns INVALID_MESSAGE for a known type with a bad shape', () => {
    assert.deepEqual(
      decideEarlyErrorReply({
        type: 'REPORT_GENERATOR_JIRA', text: '', html: '', panel: 'arf',
        account: 'user@example.com', requestId: 'jira_123',
      }, true),
      { type: 'REPORT_GENERATOR_ERROR', code: 'INVALID_MESSAGE', requestId: 'jira_123' }
    );
  });

  it('returns UNKNOWN_TYPE for unrecognised REPORT_GENERATOR_* types', () => {
    assert.deepEqual(
      decideEarlyErrorReply({ type: 'REPORT_GENERATOR_NOPE', requestId: 'req_9' }, true),
      { type: 'REPORT_GENERATOR_ERROR', code: 'UNKNOWN_TYPE', requestId: 'req_9' }
    );
  });

  it('prefers STORAGE_UNAVAILABLE over shape errors when storage is missing', () => {
    assert.deepEqual(
      decideEarlyErrorReply({ type: 'REPORT_GENERATOR_NOPE', requestId: 'req_9' }, false),
      { type: 'REPORT_GENERATOR_ERROR', code: 'STORAGE_UNAVAILABLE', requestId: 'req_9' }
    );
    assert.deepEqual(
      decideEarlyErrorReply({ type: 'REPORT_GENERATOR_JIRA', requestId: 'bad id' }, false),
      { type: 'REPORT_GENERATOR_ERROR', code: 'STORAGE_UNAVAILABLE', requestId: 'bad id' }
    );
  });

  it('echoes an undefined requestId when the input has none', () => {
    assert.deepEqual(
      decideEarlyErrorReply({ type: 'REPORT_GENERATOR_NOPE' }, true),
      { type: 'REPORT_GENERATOR_ERROR', code: 'UNKNOWN_TYPE', requestId: undefined }
    );
  });

  it('exposes the helpers namespace for classic-script globals', () => {
    assert.equal(typeof globalThis.RGWebappHelpers.isAllowedWebAppOrigin, 'function');
    assert.equal(typeof globalThis.RGWebappHelpers.decideEarlyErrorReply, 'function');
  });
});
