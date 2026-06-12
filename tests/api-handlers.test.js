import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseDomain, checkRateLimit, classifyFetchError, signToken, verifyToken } from '../api/_utils.js';

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) {
      assert.equal(checkRateLimit(store, '1.2.3.4'), false, `request ${i + 1} allowed`);
    }
  });

  it('rejects requests over the limit', () => {
    const store = new Map();
    // RATE_LIMIT_MAX = 20, so we need 22 calls to hit the limit
    for (let i = 0; i < 22; i++) checkRateLimit(store, '5.6.7.8');
    assert.equal(checkRateLimit(store, '5.6.7.8'), true, '23rd request blocked');
  });

  it('resets after window expires', () => {
    const store = new Map();
    const originalNow = Date.now;
    const t0 = Date.now();
    checkRateLimit(store, '9.9.9.9');
    checkRateLimit(store, '9.9.9.9');
    mock.method(Date, 'now', () => t0 + 60_001);
    assert.equal(checkRateLimit(store, '9.9.9.9'), false, 'reset after window');
    mock.restoreAll();
    Date.now = originalNow;
  });

  it('tracks different IPs independently', () => {
    const store = new Map();
    for (let i = 0; i < 22; i++) checkRateLimit(store, '10.0.0.1');
    assert.equal(checkRateLimit(store, '10.0.0.2'), false, 'different IP not blocked');
  });

  it('prunes stale entries when store exceeds limit', () => {
    const store = new Map();
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      store.set(`old-${i}`, { count: 1, windowStart: t0 - 120_000 });
    }
    for (let i = 0; i < 5; i++) {
      store.set(`current-${i}`, { count: 1, windowStart: t0 });
    }
    assert.equal(checkRateLimit(store, 'fresh-ip'), false, 'fresh IP allowed with mixed-age store');
  });
});

describe('classifyFetchError', () => {
  it('classifies AbortError as timeout', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 504);
    assert.match(result.error, /timed out/);
    assert.equal(result.reason, 'timeout');
  });

  it('classifies ENOTFOUND as nxdomain', () => {
    const err = new Error('getaddrinfo ENOTFOUND example.com');
    err.code = 'ENOTFOUND';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'nxdomain');
  });

  it('classifies ENOTFOUND in message string', () => {
    const err = new Error('ENOTFOUND example.com');
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'nxdomain');
  });

  it('classifies ECONNREFUSED', () => {
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'connrefused');
  });

  it('falls through for unknown errors', () => {
    const err = new Error('Something unexpected happened');
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'unknown');
  });

  it('includes the error message for unknown errors', () => {
    const err = new Error('Service is down');
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.ok(result.error.includes('Service is down'));
  });

  it('classifies TimeoutError as timeout', () => {
    const err = new Error('Timed out');
    err.name = 'TimeoutError';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 504);
    assert.match(result.error, /timed out/);
    assert.equal(result.reason, 'timeout');
  });

  it('classifies ECONNRESET as unknown', () => {
    const err = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'unknown');
  });

  it('classifies ETIMEDOUT as unknown', () => {
    const err = new Error('connection ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'unknown');
  });

  it('classifies EAI_AGAIN as unknown', () => {
    const err = new Error('EAI_AGAIN temporary DNS failure');
    err.code = 'EAI_AGAIN';
    const result = classifyFetchError(err, 'TestService', 5000);
    assert.equal(result.status, 502);
    assert.equal(result.reason, 'unknown');
  });

  it('includes context in error message', () => {
    const err = new Error('Something broke');
    const result = classifyFetchError(err, 'MyService', 5000);
    assert.ok(result.error.includes('MyService'));
    assert.ok(result.error.includes('Something broke'));
  });
});

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

  it('verifies token with dots in payload', () => {
    const token = signToken('a.b.c');
    assert.equal(verifyToken(token), true, 'payload with dots');
  });

  it('verifies token with empty payload', () => {
    const token = signToken('');
    assert.equal(verifyToken(token), true, 'empty payload');
  });

  it('rejects token with wrong-length signature', () => {
    const token = signToken('test');
    const truncated = token.slice(0, -5);
    assert.equal(verifyToken(truncated), false, 'truncated signature');
  });

  it('rejects token with wrong-length signature (extra char)', () => {
    const token = signToken('test');
    const padded = token + '0';
    assert.equal(verifyToken(padded), false, 'padded signature');
  });

  it('handles very long payload without crashing', () => {
    const longPayload = 'x'.repeat(10_000);
    const token = signToken(longPayload);
    assert.equal(verifyToken(token), true, 'long payload round-trips');
  });
});
