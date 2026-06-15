import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lookupDkim } from '../api/dkim-check.js';
import { DKIM_FAMILIES, DKIM_INDEXED_RANGE, DKIM_SELECTORS, TIMEOUT_DKIM_MS } from '../api/config.js';

// ── lookupDkim ──────────────────────────────────────────────────────

describe('lookupDkim', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns DKIM record when found', async () => {
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ data: '"v=DKIM1; k=rsa; p=MIGfMA0GCSq..."' }],
      }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, 'v=DKIM1; k=rsa; p=MIGfMA0GCSq...');
  });

  it('strips surrounding quotes from TXT record', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ data: '"v=DKIM1; p=abc123"' }],
      }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, 'v=DKIM1; p=abc123');
  });

  it('handles split TXT records (quoted strings)', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ data: '"v=DKIM1; " "k=rsa; " "p=abc"' }],
      }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, 'v=DKIM1; k=rsa; p=abc');
  });

  it('returns null when DNS status is non-zero', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ Status: 3, Answer: undefined }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, null);
  });

  it('returns null when no Answer array', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ Status: 0 }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, null);
  });

  it('returns null when no DKIM record in answers', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ data: 'some other TXT record' }],
      }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, null);
  });

  it('returns null on HTTP error', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, null);
  });

  it('returns null on network error', async () => {
    globalThis.fetch = async () => {
      throw new Error('network error');
    };

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, null);
  });

  it('returns null on timeout', async () => {
    globalThis.fetch = async () => {
      const err = new Error('timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    const result = await lookupDkim('titan', 'example.com');
    assert.equal(result, null);
  });

  it('constructs correct DNS-over-HTTPS URL', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ Status: 3 }),
      };
    };

    await lookupDkim('neo', 'test.com');
    assert.equal(capturedUrl, 'https://dns.google/resolve?name=neo._domainkey.test.com&type=TXT');
  });

  it('matches records containing v=DKIM1', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ data: '"v=DKIM1; h=sha256; k=rsa; p=KEY"' }],
      }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.ok(result.includes('v=DKIM1'));
  });

  it('matches records containing p= (without v=DKIM1)', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ data: '"k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ"' }],
      }),
    });

    const result = await lookupDkim('titan', 'example.com');
    assert.ok(result.includes('p='));
  });
});

// ── Config integrity ────────────────────────────────────────────────

describe('DKIM config', () => {
  it('DKIM_FAMILIES contains base selectors', () => {
    assert.ok(DKIM_FAMILIES.includes('titan'));
    assert.ok(DKIM_FAMILIES.includes('neo'));
  });

  it('DKIM_INDEXED_RANGE is 1-9', () => {
    assert.equal(DKIM_INDEXED_RANGE.length, 9);
    assert.equal(DKIM_INDEXED_RANGE[0], 1);
    assert.equal(DKIM_INDEXED_RANGE[8], 9);
  });

  it('DKIM_SELECTORS includes base + indexed for each family', () => {
    // titan, titan1..titan9, neo, neo1..neo9 = 20 total
    assert.equal(DKIM_SELECTORS.length, 20);
    assert.ok(DKIM_SELECTORS.includes('titan'));
    assert.ok(DKIM_SELECTORS.includes('titan5'));
    assert.ok(DKIM_SELECTORS.includes('neo'));
    assert.ok(DKIM_SELECTORS.includes('neo9'));
  });

  it('TIMEOUT_DKIM_MS is a positive number', () => {
    assert.ok(typeof TIMEOUT_DKIM_MS === 'number');
    assert.ok(TIMEOUT_DKIM_MS > 0);
    assert.ok(TIMEOUT_DKIM_MS <= 30000);
  });

  it('no empty strings in DKIM_SELECTORS', () => {
    assert.ok(DKIM_SELECTORS.every(s => s.length > 0));
  });

  it('all selectors are lowercase', () => {
    assert.ok(DKIM_SELECTORS.every(s => s === s.toLowerCase()));
  });
});
