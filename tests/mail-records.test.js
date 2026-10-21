import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { lookupMxRecords, lookupTxtRecord } from '../api/mail-records.js';
import { TIMEOUT_MAIL_RECORDS_MS } from '../api/config.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Builds a stub fetch response that resolves to the given JSON payload. */
function jsonResponse(payload, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload };
}

/** Builds a stub fetch response for an HTTP-level failure. */
function errorResponse() {
  return { ok: false, status: 500, json: async () => ({}) };
}

/** Minimal mock Vercel request object. */
function mockReq(method, query, ip) {
  return {
    method,
    query: query || {},
    headers: { 'x-forwarded-for': ip || '127.0.0.1' },
    socket: { remoteAddress: ip || '127.0.0.1' },
  };
}

/** Minimal mock Vercel response object with assertion helpers. */
function mockRes() {
  const headers = {};
  let statusCode = 200;
  let body = null;
  let ended = false;

  return {
    _headers: headers,
    _status: () => statusCode,
    _body: () => body,
    _ended: () => ended,

    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(obj) {
      body = obj;
      ended = true;
      return this;
    },
    end() {
      ended = true;
      return this;
    },
  };
}

// Every handler request gets its own IP so the shared rate limiter
// (20 requests/minute/IP) never interferes with the tests.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `mail-records-test-${Date.now()}-${ipCounter}`;
}

// ── lookupMxRecords ─────────────────────────────────────────────────

describe('lookupMxRecords', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses MX records, stripping the priority prefix and trailing dot', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 15, data: '10 mx1.titan.email.' }],
    });

    const result = await lookupMxRecords('example.com');
    assert.deepEqual(result, ['mx1.titan.email']);
  });

  it('returns every MX record in answer order', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [
        { type: 15, data: '10 mx1.titan.email.' },
        { type: 15, data: '20 mx0101.titan.email.' },
        { type: 15, data: '30 mx3.titan.email.' },
      ],
    });

    const result = await lookupMxRecords('example.com');
    assert.deepEqual(result, ['mx1.titan.email', 'mx0101.titan.email', 'mx3.titan.email']);
  });

  it('returns an empty array when there is no Answer array', async () => {
    globalThis.fetch = async () => jsonResponse({ Status: 0 });

    const result = await lookupMxRecords('example.com');
    assert.deepEqual(result, []);
  });

  it('returns an empty array when the DNS status is non-zero', async () => {
    globalThis.fetch = async () => jsonResponse({ Status: 3, Answer: undefined });

    const result = await lookupMxRecords('example.com');
    assert.deepEqual(result, []);
  });

  it('returns an empty array on HTTP error', async () => {
    globalThis.fetch = async () => errorResponse();

    const result = await lookupMxRecords('example.com');
    assert.deepEqual(result, []);
  });

  it('returns an empty array on network error', async () => {
    globalThis.fetch = async () => {
      throw new Error('network error');
    };

    const result = await lookupMxRecords('example.com');
    assert.deepEqual(result, []);
  });

  it('returns an empty array on timeout', async () => {
    globalThis.fetch = async () => {
      const err = new Error('timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    const result = await lookupMxRecords('example.com');
    assert.deepEqual(result, []);
  });

  it('queries the DNS-over-HTTPS endpoint with type=MX', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ Status: 3 });
    };

    await lookupMxRecords('test.com');
    assert.equal(capturedUrl, 'https://dns.google/resolve?name=test.com&type=MX');
  });
});

// ── lookupTxtRecord ─────────────────────────────────────────────────

describe('lookupTxtRecord', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the TXT record when it starts with the expected prefix', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 16, data: '"v=spf1 include:_spf.titan.email -all"' }],
    });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, 'v=spf1 include:_spf.titan.email -all');
  });

  it('matches the prefix case-insensitively', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 16, data: '"v=DMARC1; p=none"' }],
    });

    const result = await lookupTxtRecord('_dmarc.example.com', 'v=dmarc1');
    assert.equal(result, 'v=DMARC1; p=none');
  });

  it('returns null when no record matches the prefix', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 16, data: 'some other TXT record' }],
    });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, null);
  });

  it('joins TXT records split across quoted segments', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 16, data: '"v=spf1 " "include:x -all"' }],
    });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, 'v=spf1 include:x -all');
  });

  it('joins DMARC records split across quoted segments', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 16, data: '"v=DMARC1; " "p=none; rua=mailto:a@example.com"' }],
    });

    const result = await lookupTxtRecord('_dmarc.example.com', 'v=DMARC1');
    assert.equal(result, 'v=DMARC1; p=none; rua=mailto:a@example.com');
  });

  it('ignores a TXT record that does not start with the expected prefix', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 16, data: '"v=DKIM1; k=rsa; p=abc123"' }],
    });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, null);
  });

  it('ignores a DMARC record returned for an SPF query', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [{ type: 16, data: '"v=DMARC1; p=reject"' }],
    });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, null);
  });

  it('picks the matching TXT record when several are returned', async () => {
    globalThis.fetch = async () => jsonResponse({
      Status: 0,
      Answer: [
        { type: 16, data: '"google-site-verification=abc123"' },
        { type: 16, data: '"v=spf1 -all"' },
      ],
    });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, 'v=spf1 -all');
  });

  it('returns null when the DNS status is non-zero', async () => {
    globalThis.fetch = async () => jsonResponse({ Status: 3, Answer: undefined });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, null);
  });

  it('returns null when there is no Answer array', async () => {
    globalThis.fetch = async () => jsonResponse({ Status: 0 });

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, null);
  });

  it('returns null on HTTP error', async () => {
    globalThis.fetch = async () => errorResponse();

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, null);
  });

  it('returns null on network error', async () => {
    globalThis.fetch = async () => {
      throw new Error('network error');
    };

    const result = await lookupTxtRecord('example.com', 'v=spf1');
    assert.equal(result, null);
  });

  it('queries the DNS-over-HTTPS endpoint with type=TXT', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ Status: 3 });
    };

    await lookupTxtRecord('_dmarc.test.com', 'v=DMARC1');
    assert.equal(capturedUrl, 'https://dns.google/resolve?name=_dmarc.test.com&type=TXT');
  });
});

// ── Handler ──────────────────────────────────────────────────────────

describe('mail-records handler', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 400 for a missing domain parameter', async () => {
    const res = mockRes();
    await handler(mockReq('GET', {}, uniqueIp()), res);

    assert.equal(res._status(), 400);
    assert.deepEqual(res._body(), { error: 'Invalid or missing domain parameter' });
  });

  it('returns 400 for an invalid domain parameter', async () => {
    const res = mockRes();
    await handler(mockReq('GET', { domain: 'not a domain' }, uniqueIp()), res);

    assert.equal(res._status(), 400);
    assert.deepEqual(res._body(), { error: 'Invalid or missing domain parameter' });
  });

  it('returns 200 with MX, SPF and DMARC records', async () => {
    const requested = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      requested.push(u);
      if (u.includes('type=MX')) {
        return jsonResponse({
          Status: 0,
          Answer: [
            { type: 15, data: '10 mx1.titan.email.' },
            { type: 15, data: '20 mx0101.titan.email.' },
          ],
        });
      }
      if (u.includes('_dmarc.')) {
        return jsonResponse({
          Status: 0,
          Answer: [{ type: 16, data: '"v=DMARC1; p=none; rua=mailto:a@example.com"' }],
        });
      }
      return jsonResponse({
        Status: 0,
        Answer: [{ type: 16, data: '"v=spf1 include:_spf.titan.email -all"' }],
      });
    };

    const domain = 'handler-ok.example.com';
    const res = mockRes();
    await handler(mockReq('GET', { domain }, uniqueIp()), res);

    assert.equal(res._status(), 200);
    assert.deepEqual(res._body(), {
      mx: ['mx1.titan.email', 'mx0101.titan.email'],
      spf: 'v=spf1 include:_spf.titan.email -all',
      dmarc: 'v=DMARC1; p=none; rua=mailto:a@example.com',
      spf_present: true,
      dmarc_present: true,
    });
    assert.ok(
      requested.some(u => u.includes(`name=_dmarc.${domain}`)),
      'DMARC is looked up at _dmarc.<domain>'
    );
    assert.ok(
      requested.some(u => u.includes(`name=${domain}&type=TXT`)),
      'SPF is looked up on the apex domain'
    );
  });

  it('reports SPF and DMARC even when the domain has no MX records', async () => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('type=MX')) return jsonResponse({ Status: 0, Answer: undefined });
      if (u.includes('_dmarc.')) return jsonResponse({ Status: 3 });
      return jsonResponse({ Status: 0, Answer: [{ type: 16, data: '"v=spf1 -all"' }] });
    };

    const res = mockRes();
    await handler(mockReq('GET', { domain: 'no-mx.example.com' }, uniqueIp()), res);

    assert.equal(res._status(), 200);
    assert.deepEqual(res._body(), {
      mx: [],
      spf: 'v=spf1 -all',
      dmarc: null,
      spf_present: true,
      dmarc_present: false,
    });
  });

  it('reports null SPF and DMARC when the records are absent', async () => {
    globalThis.fetch = async () => jsonResponse({ Status: 3 });

    const res = mockRes();
    await handler(mockReq('GET', { domain: 'no-records.example.com' }, uniqueIp()), res);

    assert.equal(res._status(), 200);
    assert.deepEqual(res._body(), {
      mx: [],
      spf: null,
      dmarc: null,
      spf_present: false,
      dmarc_present: false,
    });
  });

  it('rejects non-GET methods with 405', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { domain: 'method.example.com' }, uniqueIp()), res);

    assert.equal(res._status(), 405);
    assert.deepEqual(res._body(), { error: 'Method not allowed' });
  });

  it('caches the result per domain', async () => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls += 1;
      const u = String(url);
      if (u.includes('type=MX')) {
        return jsonResponse({ Status: 0, Answer: [{ type: 15, data: '10 mx1.titan.email.' }] });
      }
      return jsonResponse({ Status: 3 });
    };

    const ip = uniqueIp();
    const domain = 'cached.example.com';

    const first = mockRes();
    await handler(mockReq('GET', { domain }, ip), first);
    assert.equal(calls, 3, 'MX, SPF and DMARC are looked up once');

    const second = mockRes();
    await handler(mockReq('GET', { domain }, ip), second);
    assert.equal(calls, 3, 'the cached result is reused');
    assert.equal(second._status(), 200);
    assert.deepEqual(second._body(), first._body());
  });
});

// ── Config integrity ────────────────────────────────────────────────

describe('mail-records config', () => {
  it('TIMEOUT_MAIL_RECORDS_MS is a positive number', () => {
    assert.ok(typeof TIMEOUT_MAIL_RECORDS_MS === 'number');
    assert.ok(TIMEOUT_MAIL_RECORDS_MS > 0);
    assert.ok(TIMEOUT_MAIL_RECORDS_MS <= 30000);
  });
});
