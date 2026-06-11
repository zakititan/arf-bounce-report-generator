import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseDomain, checkRateLimit, classifyFetchError, signToken, verifyToken } from '../api/_utils.js';

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) {
      assert.equal(checkRateLimit(store, '1.2.3.4', 10, 60_000), false, `request ${i + 1} allowed`);
    }
  });

  it('rejects requests over the limit', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) checkRateLimit(store, '5.6.7.8', 3, 60_000);
    assert.equal(checkRateLimit(store, '5.6.7.8', 3, 60_000), true, '6th request blocked');
  });

  it('resets after window expires', () => {
    const store = new Map();
    checkRateLimit(store, '9.9.9.9', 2, 100);
    checkRateLimit(store, '9.9.9.9', 2, 100);
    return new Promise(resolve => {
      setTimeout(() => {
        assert.equal(checkRateLimit(store, '9.9.9.9', 2, 100), false, 'reset after window');
        resolve();
      }, 110);
    });
  });

  it('tracks different IPs independently', () => {
    const store = new Map();
    for (let i = 0; i < 5; i++) checkRateLimit(store, '10.0.0.1', 3, 60_000);
    assert.equal(checkRateLimit(store, '10.0.0.2', 3, 60_000), false, 'different IP not blocked');
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
});
