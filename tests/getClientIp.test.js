import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp } from '../api/_utils.js';

describe('getClientIp', () => {
  it('extracts first IP from x-forwarded-for with multiple IPs', () => {
    const req = {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    assert.equal(getClientIp(req), '1.2.3.4');
  });

  it('extracts single IP from x-forwarded-for', () => {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    assert.equal(getClientIp(req), '10.0.0.1');
  });

  it('falls back to socket.remoteAddress when header is missing', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '192.168.1.1' },
    };
    assert.equal(getClientIp(req), '192.168.1.1');
  });

  it('returns "unknown" when both are missing', () => {
    const req = {
      headers: {},
      socket: {},
    };
    assert.equal(getClientIp(req), 'unknown');
  });

  it('handles x-forwarded-for with whitespace around commas', () => {
    const req = {
      headers: { 'x-forwarded-for': '  1.2.3.4 , 5.6.7.8' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    assert.equal(getClientIp(req), '1.2.3.4');
  });

  it('falls back to socket.remoteAddress when x-forwarded-for first segment is empty', () => {
    const req = {
      headers: { 'x-forwarded-for': ', 5.6.7.8' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    // Empty string is falsy in JS, so || falls through to socket.remoteAddress
    assert.equal(getClientIp(req), '127.0.0.1');
  });
});
