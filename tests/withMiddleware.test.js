import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { withMiddleware } from '../api/_utils.js';

/**
 * Create a minimal mock Vercel request object.
 */
function mockReq(method, headers, remoteAddress) {
  return {
    method,
    headers: headers || {},
    socket: { remoteAddress: remoteAddress || '127.0.0.1' },
  };
}

/**
 * Create a minimal mock Vercel response object with assertion helpers.
 */
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

describe('withMiddleware', () => {
  const ORIGINAL_ORIGIN = process.env.APP_ORIGIN;
  const ORIGINAL_SECRET = process.env.AUTH_SECRET;

  afterEach(() => {
    if (ORIGINAL_ORIGIN === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = ORIGINAL_ORIGIN;
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = ORIGINAL_SECRET;
  });

  it('sets CORS headers on all responses', async () => {
    process.env.APP_ORIGIN = 'https://example.com';
    const handler = async (req, res) => res.status(200).json({ ok: true });
    const wrapped = withMiddleware(handler);

    const req = mockReq('GET');
    const res = mockRes();
    await wrapped(req, res);

    assert.equal(res._headers['Access-Control-Allow-Origin'], 'https://example.com');
    assert.equal(res._headers['Access-Control-Allow-Methods'], 'GET,OPTIONS');
    assert.equal(res._headers['Access-Control-Allow-Headers'], 'Content-Type');
    assert.equal(res._headers['Vary'], 'Origin');
  });

  it('handles OPTIONS preflight without reaching handler', async () => {
    process.env.APP_ORIGIN = 'https://example.com';
    let handlerCalled = false;
    const handler = async (req, res) => { handlerCalled = true; return res.status(200).json({ ok: true }); };
    const wrapped = withMiddleware(handler);

    const req = mockReq('OPTIONS');
    const res = mockRes();
    await wrapped(req, res);

    assert.equal(res._status(), 204);
    assert.ok(res._ended());
    assert.equal(handlerCalled, false);
  });

  it('rejects non-GET methods with 405', async () => {
    let handlerCalled = false;
    const handler = async (req, res) => { handlerCalled = true; return res.status(200).json({ ok: true }); };
    const wrapped = withMiddleware(handler);

    const req = mockReq('POST');
    const res = mockRes();
    await wrapped(req, res);

    assert.equal(res._status(), 405);
    assert.deepEqual(res._body(), { error: 'Method not allowed' });
    assert.equal(handlerCalled, false);
  });

  it('blocks requests exceeding rate limit with 429', async () => {
    const handler = async (req, res) => res.status(200).json({ ok: true });
    const wrapped = withMiddleware(handler);

    const ip = 'rl-test-' + Date.now();
    const req = mockReq('GET', { 'x-forwarded-for': ip });
    for (let i = 0; i < 20; i++) {
      const r = mockRes();
      await wrapped(req, r);
      assert.equal(r._status(), 200, `request ${i + 1} should succeed`);
    }
    const blocked = mockRes();
    await wrapped(req, blocked);
    assert.equal(blocked._status(), 429);
    assert.deepEqual(blocked._body(), { error: 'Too many requests — please slow down.' });
  });

  it('passes request to handler under rate limit', async () => {
    const handler = async (req, res) => res.status(200).json({ ok: true, domain: req.headers['x-forwarded-for'] });
    const wrapped = withMiddleware(handler);

    const req = mockReq('GET', { 'x-forwarded-for': '5.6.7.8-' + Date.now() });
    const res = mockRes();
    await wrapped(req, res);

    assert.equal(res._status(), 200);
  });

  it('extracts IP from x-forwarded-for header', async () => {
    let capturedIp = null;
    const handler = async (req, res) => {
      capturedIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
      return res.status(200).json({ ok: true });
    };
    const wrapped = withMiddleware(handler);

    const req = mockReq('GET', { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' });
    const res = mockRes();
    await wrapped(req, res);

    assert.equal(capturedIp, '10.0.0.1');
    assert.equal(res._status(), 200);
  });

  it('falls back to socket.remoteAddress when x-forwarded-for is missing', async () => {
    const handler = async (req, res) => res.status(200).json({ ok: true });
    const wrapped = withMiddleware(handler);

    const ip = 'socket-test-' + Date.now();
    const req = mockReq('GET', {}, ip);
    for (let i = 0; i < 22; i++) {
      const r = mockRes();
      await wrapped(req, r);
    }
    const blocked = mockRes();
    await wrapped(req, blocked);
    assert.equal(blocked._status(), 429, 'should be rate-limited via socket.remoteAddress');
  });

  it('sets empty CORS when APP_ORIGIN is missing', async () => {
    const saved = process.env.APP_ORIGIN;
    delete process.env.APP_ORIGIN;
    const handler = async (req, res) => res.status(200).json({ ok: true });
    const wrapped = withMiddleware(handler);

    const req = mockReq('GET');
    const res = mockRes();
    await wrapped(req, res);

    assert.equal(res._headers['Access-Control-Allow-Origin'], '');
    assert.equal(res._headers['Vary'], undefined);
    if (saved !== undefined) process.env.APP_ORIGIN = saved;
  });
});
