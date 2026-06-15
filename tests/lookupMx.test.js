import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lookupMx } from '../scripts/api.js';

describe('lookupMx', () => {
  afterEach(() => {
    globalThis.fetch = undefined;
  });

  it('returns na when MX is mx1.titan.email', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Answer: [{ type: 15, data: '10 mx1.titan.email' }]
      })
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('returns eu when MX is mx0101.titan.email', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Answer: [{ type: 15, data: '10 mx0101.titan.email' }]
      })
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'eu' });
  });

  it('strips trailing dot from DNS response', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Answer: [{ type: 15, data: '10 mx0101.titan.email.' }]
      })
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'eu' });
  });

  it('strips MX priority prefix', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Answer: [{ type: 15, data: '20 mx1.titan.email' }]
      })
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('returns na when no MX records found', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({})
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('returns na when MX is unknown', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Answer: [{ type: 15, data: '10 mx.otherprovider.com' }]
      })
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('returns na on network error', async () => {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('returns na on timeout', async () => {
    globalThis.fetch = async () => {
      const err = new DOMException('The operation was aborted.', 'AbortError');
      throw err;
    };
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('returns na on HTTP error', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({})
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('returns na when DNS response has no Answer array', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ Status: 0 })
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'na' });
  });

  it('handles multiple MX records and picks the titan one', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Answer: [
          { type: 15, data: '10 mx.other.com' },
          { type: 15, data: '20 mx0101.titan.email' },
          { type: 15, data: '30 mx1.titan.email' }
        ]
      })
    });
    const result = await lookupMx('example.com');
    assert.deepStrictEqual(result, { region: 'eu' });
  });
});
