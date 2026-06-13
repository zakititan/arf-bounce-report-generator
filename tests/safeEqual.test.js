import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeEqual } from '../api/_utils.js';

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    assert.equal(safeEqual('hello', 'hello'), true);
  });

  it('returns false for different strings', () => {
    assert.equal(safeEqual('hello', 'world'), false);
  });

  it('returns false for different lengths', () => {
    assert.equal(safeEqual('short', 'much longer string'), false);
  });

  it('returns true for empty strings', () => {
    assert.equal(safeEqual('', ''), true);
  });

  it('returns false for empty vs non-empty', () => {
    assert.equal(safeEqual('', 'a'), false);
  });

  it('returns false for non-string inputs', () => {
    assert.equal(safeEqual(null, 'a'), false);
    assert.equal(safeEqual('a', null), false);
    assert.equal(safeEqual(undefined, 'a'), false);
    assert.equal(safeEqual(123, '123'), false);
    assert.equal(safeEqual({}, '{}'), false);
  });

  it('returns true for single character strings', () => {
    assert.equal(safeEqual('a', 'a'), true);
  });

  it('returns false for single char different', () => {
    assert.equal(safeEqual('a', 'b'), false);
  });

  it('handles strings differing only in last character', () => {
    assert.equal(safeEqual('abcde', 'abcdf'), false);
  });

  it('handles very long strings', () => {
    const long = 'x'.repeat(10000);
    assert.equal(safeEqual(long, long), true);
    assert.equal(safeEqual(long, long + 'y'), false);
  });
});