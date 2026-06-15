import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit } from '../api/_utils.js';

describe('checkRateLimit (in-memory fallback)', () => {
  it('returns false for requests under the limit', async () => {
    // Use a unique IP to avoid interference from other tests
    const ip = 'test-under-limit-' + Date.now();
    for (let i = 0; i < 5; i++) {
      assert.equal(await checkRateLimit(ip), false, `request ${i + 1} should be allowed`);
    }
  });

  it('returns true when limit is exceeded', async () => {
    const ip = 'test-over-limit-' + Date.now();
    // Send 20 requests (the limit)
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(ip);
    }
    // 21st request should be rate-limited
    assert.equal(await checkRateLimit(ip), true);
  });

  it('tracks IPs independently', async () => {
    const ip1 = 'test独立1-' + Date.now();
    const ip2 = 'test独立2-' + Date.now();
    // Exhaust ip1's limit
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(ip1);
    }
    // ip1 should be limited
    assert.equal(await checkRateLimit(ip1), true);
    // ip2 should still be allowed
    assert.equal(await checkRateLimit(ip2), false);
  });
});
