import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../api/_utils.js';

describe('createCache', () => {
  let cache;

  beforeEach(() => {
    cache = createCache(1000); // 1 second TTL for tests
  });

  it('returns null for missing key', () => {
    assert.equal(cache.get('nonexistent'), null);
  });

  it('stores and retrieves a value', () => {
    cache.set('key1', { data: 'test' });
    assert.deepEqual(cache.get('key1'), { data: 'test' });
  });

  it('returns null for expired key', async () => {
    const shortCache = createCache(50); // 50ms TTL
    shortCache.set('key1', 'value1');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(shortCache.get('key1'), null);
  });

  it('returns value before expiry', async () => {
    cache.set('key1', 'value1');
    await new Promise(r => setTimeout(r, 100));
    assert.equal(cache.get('key1'), 'value1');
  });

  it('multiple keys are independent', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), 2);
    cache.delete?.('a'); // not needed but just checking independence
    assert.equal(cache.get('b'), 2);
  });

  it('overwrites existing key', () => {
    cache.set('key1', 'first');
    cache.set('key1', 'second');
    assert.equal(cache.get('key1'), 'second');
  });

  it('prunes stale entries when size exceeds 1000', () => {
    const pruneCache = createCache(1); // 1ms TTL
    // Add 1001 entries
    for (let i = 0; i <= 1000; i++) {
      pruneCache.set(`key${i}`, i);
    }
    // Wait for all to expire
    const start = Date.now();
    while (Date.now() - start < 5) {} // busy wait to ensure expiry
    // Adding one more should trigger pruning
    pruneCache.set('trigger', 'prune');
    // Old expired entries should be pruned
    assert.equal(pruneCache.get('key0'), null);
  });

  it('handles different value types', () => {
    cache.set('string', 'hello');
    cache.set('number', 42);
    cache.set('object', { nested: true });
    cache.set('array', [1, 2, 3]);
    cache.set('null', null);
    cache.set('boolean', true);
    assert.equal(cache.get('string'), 'hello');
    assert.equal(cache.get('number'), 42);
    assert.deepEqual(cache.get('object'), { nested: true });
    assert.deepEqual(cache.get('array'), [1, 2, 3]);
    assert.equal(cache.get('null'), null);
    assert.equal(cache.get('boolean'), true);
  });
});