import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWhois, fetchWebsiteCheck, fetchDkimCheck, getCached, setCache, describeReason } from '../scripts/api.js';

// ── describeReason ──────────────────────────────────────────────────

describe('describeReason', () => {
  it('returns mapped message for known reasons', () => {
    assert.ok(describeReason('timeout').includes('timed out'));
    assert.ok(describeReason('auth').includes('invalid'));
    assert.ok(describeReason('misconfigured').includes('not configured'));
    assert.ok(describeReason('upstream_rate_limit').includes('rate limit'));
    assert.ok(describeReason('upstream_error').includes('unavailable'));
    assert.ok(describeReason('network').includes('Could not reach'));
  });

  it('returns fallback for unknown reason', () => {
    assert.equal(describeReason('unknown', 'fallback msg'), 'fallback msg');
  });

  it('returns fallback when reason is null', () => {
    assert.equal(describeReason(null, 'default'), 'default');
  });
});

// ── getCached / setCache ────────────────────────────────────────────

describe('client-side cache', () => {
  it('returns null for missing key', () => {
    assert.equal(getCached('nonexistent-' + Date.now()), null);
  });

  it('stores and retrieves value', () => {
    const key = 'test-key-' + Date.now();
    setCache(key, { foo: 'bar' });
    assert.deepEqual(getCached(key), { foo: 'bar' });
  });
});

// ── fetchWhois ──────────────────────────────────────────────────────

describe('fetchWhois', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns data on success', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ creation_date: '2010-01-01', domain_age: '14 years' }),
    });

    const data = await fetchWhois('whois-test-' + Date.now() + '.com');
    assert.equal(data.creation_date, '2010-01-01');
  });

  it('throws when creation_date is missing', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ domain_age: '14 years' }),
    });

    await assert.rejects(
      () => fetchWhois('whois-nodate-' + Date.now() + '.com'),
      { message: /No creation date/ }
    );
  });

  it('throws on HTTP error with reason', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limited', reason: 'upstream_rate_limit' }),
    });

    await assert.rejects(
      () => fetchWhois('whois-429-' + Date.now() + '.com'),
      { message: /rate limit/i }
    );
  });

  it('throws on network error', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    await assert.rejects(
      () => fetchWhois('whois-neterr-' + Date.now() + '.com'),
      { message: /Network error/ }
    );
  });

  it('throws on timeout', async () => {
    globalThis.fetch = async () => {
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      throw err;
    };

    await assert.rejects(
      () => fetchWhois('whois-timeout-' + Date.now() + '.com'),
      { message: /timed out/ }
    );
  });

  it('throws on non-JSON response', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    await assert.rejects(
      () => fetchWhois('whois-nonjson-' + Date.now() + '.com'),
      { message: /Unexpected response/ }
    );
  });
});

// ── fetchWebsiteCheck ───────────────────────────────────────────────

describe('fetchWebsiteCheck', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns data on success', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ verdict: 'Valid Website', reason: 'Has content' }),
    });

    const data = await fetchWebsiteCheck('ws-test-' + Date.now() + '.com');
    assert.equal(data.verdict, 'Valid Website');
  });

  it('throws on error response', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal error' }),
    });

    await assert.rejects(
      () => fetchWebsiteCheck('ws-err-' + Date.now() + '.com'),
      { message: /Internal error/ }
    );
  });
});

// ── fetchDkimCheck ──────────────────────────────────────────────────

describe('fetchDkimCheck', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns data on success', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ status: 'Set', selectors_found: ['titan'] }),
    });

    const data = await fetchDkimCheck('dkim-test-' + Date.now() + '.com');
    assert.equal(data.status, 'Set');
    assert.deepEqual(data.selectors_found, ['titan']);
  });

  it('throws on error response', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid domain' }),
    });

    await assert.rejects(
      () => fetchDkimCheck('dkim-err-' + Date.now() + '.com'),
      { message: /Invalid domain/ }
    );
  });
});
