import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseDomain, checkRateLimit, classifyFetchError, signToken, verifyToken } from '../api/_utils.js';

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal(await checkRateLimit('test-under-' + i), false, `request ${i + 1} allowed`);
    }
  });

  it('rejects requests over the limit', async () => {
    const ip = 'test-over-' + Date.now();
    for (let i = 0; i < 22; i++) await checkRateLimit(ip);
    assert.equal(await checkRateLimit(ip), true, '23rd request blocked');
  });

  it('tracks different IPs independently', async () => {
    const ip1 = 'test-ip1-' + Date.now();
    const ip2 = 'test-ip2-' + Date.now();
    for (let i = 0; i < 22; i++) await checkRateLimit(ip1);
    assert.equal(await checkRateLimit(ip2), false, 'different IP not blocked');
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
  after(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = ORIGINAL_SECRET;
  });

  it('signs and verifies a token', () => {
    const payload = JSON.stringify({ sub: 'authenticated', iat: Date.now() });
    const token = signToken(payload);
    assert.ok(token.includes('.'));
    assert.equal(verifyToken(token), true);
  });

  it('rejects a tampered token', () => {
    const payload = JSON.stringify({ sub: 'authenticated', iat: Date.now() });
    const token = signToken(payload);
    const parts = token.split('.');
    const tampered = 'hacked.' + parts[1];
    assert.equal(verifyToken(tampered), false);
  });

  it('rejects a token with invalid format', () => {
    assert.equal(verifyToken('no-dot'), false);
    assert.equal(verifyToken(''), false);
    assert.equal(verifyToken(null), false);
  });

  it('rejects token with non-JSON payload', () => {
    const token = signToken('plain-text');
    assert.equal(verifyToken(token), false, 'non-JSON payload rejected');
  });

  it('rejects token with missing sub field', () => {
    const token = signToken(JSON.stringify({ iat: Date.now() }));
    assert.equal(verifyToken(token), false, 'missing sub');
  });

  it('rejects token with wrong sub value', () => {
    const token = signToken(JSON.stringify({ sub: 'admin', iat: Date.now() }));
    assert.equal(verifyToken(token), false, 'wrong sub');
  });

  it('rejects expired token', () => {
    const expiredIat = Date.now() - 9 * 60 * 60 * 1000;
    const token = signToken(JSON.stringify({ sub: 'authenticated', iat: expiredIat }));
    assert.equal(verifyToken(token), false, 'expired token');
  });

  it('fails gracefully if AUTH_SECRET is missing', () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    const payload = JSON.stringify({ sub: 'authenticated', iat: Date.now() });
    assert.throws(() => signToken(payload), /AUTH_SECRET/);
    assert.equal(verifyToken('anything.anything'), false);
    process.env.AUTH_SECRET = saved;
  });

  it('rejects token with wrong-length signature', () => {
    const payload = JSON.stringify({ sub: 'authenticated', iat: Date.now() });
    const token = signToken(payload);
    const truncated = token.slice(0, -5);
    assert.equal(verifyToken(truncated), false, 'truncated signature');
  });

  it('rejects token with wrong-length signature (extra char)', () => {
    const payload = JSON.stringify({ sub: 'authenticated', iat: Date.now() });
    const token = signToken(payload);
    const padded = token + '0';
    assert.equal(verifyToken(padded), false, 'padded signature');
  });

  it('handles very long payload without crashing', () => {
    const longPayload = JSON.stringify({ sub: 'authenticated', iat: Date.now(), extra: 'x'.repeat(10_000) });
    const token = signToken(longPayload);
    assert.equal(verifyToken(token), true, 'long payload round-trips');
  });
});
