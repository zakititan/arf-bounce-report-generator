import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseDomain, isRateLimited, classifyFetchError, signToken, verifyToken } from '../api/_utils.js';

// ── isRateLimited ─────────────────────────────────────────────────────
describe('isRateLimited', () => {
  it('allows requests under the limit', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) {
      assert.equal(isRateLimited(store, '1.2.3.4', 10, 60_000), false, `request ${i + 1} allowed`);
    }
  });

  it('rejects requests over the limit', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) isRateLimited(store, '5.6.7.8', 3, 60_000);
    assert.equal(isRateLimited(store, '5.6.7.8', 3, 60_000), true, '6th request blocked');
  });

  it('resets after window expires', () => {
    const store = new Map();
    isRateLimited(store, '9.9.9.9', 2, 100);
    isRateLimited(store, '9.9.9.9', 2, 100);
    return new Promise(resolve => {
      setTimeout(() => {
        assert.equal(isRateLimited(store, '9.9.9.9', 2, 100), false, 'reset after window');
        resolve();
      }, 110);
    });
  });

  it('tracks different IPs independently', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) isRateLimited(store, '10.0.0.1', 3, 60_000);
    assert.equal(isRateLimited(store, '10.0.0.2', 3, 60_000), false, 'different IP not blocked');
  });
});

// ── classifyFetchError ────────────────────────────────────────────────
describe('classifyFetchError', () => {
  it('classifies AbortError as timeout', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 504);
    assert.match(result.error, /timed out/);
    assert.equal(result.reason, 'timeout');
  });

  it('classifies timeout message', () => {
    const err = new Error('Operation timed out after 5000ms');
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 504);
    assert.equal(result.reason, 'timeout');
  });

  it('classifies upstream 401 as auth error', () => {
    const err = new Error('WhoisJSON upstream 401');
    const result = classifyFetchError(err, 'WHOIS', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'auth');
  });

  it('classifies upstream 429 as rate limit', () => {
    const err = new Error('WhoisJSON upstream 429');
    const result = classifyFetchError(err, 'WHOIS', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'upstream_rate_limit');
  });

  it('classifies upstream 503 as upstream error', () => {
    const err = new Error('WhoisJSON upstream 503');
    const result = classifyFetchError(err, 'WHOIS', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'upstream_error');
  });

  it('classifies network errors', () => {
    const err = new Error('fetch failed: ENOTFOUND example.com');
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'network');
  });

  it('classifies misconfigured errors', () => {
    const err = new Error('API key is not set');
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 500);
    assert.equal(result.reason, 'misconfigured');
  });

  it('falls through for unknown errors', () => {
    const err = new Error('Something unexpected happened');
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'unknown');
  });
});

// ── signToken / verifyToken ───────────────────────────────────────────
describe('signToken / verifyToken', () => {
  const ORIGINAL_SECRET = process.env.AUTH_SECRET;

  before(() => { process.env.AUTH_SECRET = 'test-secret-12345'; });
  after(() => { process.env.AUTH_SECRET = ORIGINAL_SECRET; });

  it('signs and verifies a token', () => {
    const token = signToken('authenticated');
    assert.ok(token.includes('.'));
    assert.equal(verifyToken(token), true);
  });

  it('rejects a tampered token', () => {
    const token = signToken('authenticated');
    const parts = token.split('.');
    const tampered = 'hacked.' + parts[1];
    assert.equal(verifyToken(tampered), false);
  });

  it('rejects a token with invalid format', () => {
    assert.equal(verifyToken('no-dot'), false);
    assert.equal(verifyToken(''), false);
    assert.equal(verifyToken(null), false);
  });

  it('fails gracefully if AUTH_SECRET is missing', () => {
    delete process.env.AUTH_SECRET;
    assert.throws(() => signToken('test'), /AUTH_SECRET/);
    assert.equal(verifyToken('anything.anything'), false);
    process.env.AUTH_SECRET = 'test-secret-12345';
  });
});
