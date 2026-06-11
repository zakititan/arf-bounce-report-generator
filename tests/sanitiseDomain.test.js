import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseDomain } from '../api/_utils.js';

function ok(input, expected, label) {
  const result = sanitiseDomain(input);
  assert.equal(result, expected, `[PASS expected] ${label}: got ${result}`);
}
function reject(input, label) {
  const result = sanitiseDomain(input);
  assert.equal(result, null, `[REJECT expected] ${label}: got ${result}`);
}

describe('sanitiseDomain — valid inputs', () => {
  it('bare domain', () => ok('example.com', 'example.com', 'bare domain'));
  it('strips http://', () => ok('http://example.com', 'example.com', 'http prefix'));
  it('strips https://', () => ok('https://example.com', 'example.com', 'https prefix'));
  it('strips path', () => ok('https://example.com/some/path', 'example.com', 'with path'));
  it('strips query string', () => ok('example.com?foo=bar', 'example.com', 'with query'));
  it('strips hash', () => ok('example.com#section', 'example.com', 'with hash'));
  it('strips port', () => ok('example.com:8080', 'example.com', 'with port'));
  it('lowercases input', () => ok('EXAMPLE.COM', 'example.com', 'uppercase input'));
  it('trims whitespace', () => ok('  example.com  ', 'example.com', 'padded whitespace'));
  it('subdomain', () => ok('mail.example.com', 'mail.example.com', 'subdomain'));
  it('deep subdomain', () => ok('a.b.c.example.com', 'a.b.c.example.com', 'deep subdomain'));
  it('hyphenated label', () => ok('my-domain.com', 'my-domain.com', 'hyphen in label'));
  it('numeric TLD', () => ok('example.123', 'example.123', 'numeric TLD'));
  it('two-char TLD', () => ok('example.io', 'example.io', 'short TLD'));
});

describe('sanitiseDomain — email stripping', () => {
  it('strips email user part', () => ok('admin@example.com', 'example.com', 'admin@example.com'));
  it('strips email with http', () => ok('http://user@example.com/path', 'example.com', 'http + email'));
  it('strips email with port', () => ok('user@example.com:8080', 'example.com', 'email + port'));
});

describe('sanitiseDomain — punycode (ASCII-compatible encoding)', () => {
  it('münchen.de punycode', () =>
    ok('xn--mnchen-3ya.de', 'xn--mnchen-3ya.de', 'münchen.de encoded'));
  it('bücher.de punycode', () =>
    ok('xn--bcher-kva.de', 'xn--bcher-kva.de', 'bücher.de encoded'));
  it('xn-- prefix domain passes regex', () =>
    ok('xn--p1ai.ru', 'xn--p1ai.ru', 'Russian xn-- TLD'));
  it('mixed punycode subdomain', () =>
    ok('mail.xn--mnchen-3ya.de', 'mail.xn--mnchen-3ya.de', 'punycode with subdomain'));
});

describe('sanitiseDomain — raw unicode IDN (must be rejected)', () => {
  it('rejects münchen.de (raw unicode ü)', () => reject('münchen.de', 'raw unicode ü'));
  it('rejects 中文.com', () => reject('中文.com', 'Chinese characters'));
  it('rejects αβγ.gr', () => reject('αβγ.gr', 'Greek characters'));
  it('rejects emoji domain 🍕.ws', () => reject('🍕.ws', 'emoji domain'));
});

describe('sanitiseDomain — localhost and IP addresses', () => {
  it('rejects localhost', () => reject('localhost', 'localhost'));
  it('rejects 127.0.0.1', () => reject('127.0.0.1', 'IPv4 loopback'));
  it('rejects 192.168.1.1', () => reject('192.168.1.1', 'private IPv4'));
  it('rejects ::1 (bare IPv6)', () => reject('::1', 'IPv6 loopback'));
  it('rejects [::1] (bracketed IPv6)', () => reject('[::1]', 'bracketed IPv6 loopback'));
  it('rejects 2001:db8::1 (IPv6)', () => reject('2001:db8::1', 'IPv6 address'));
  it('rejects bare IP with port', () => reject('127.0.0.1:3000', 'IP with port'));
  it('rejects 8.8.8.8 (bare IPv4)', () => reject('8.8.8.8', 'Google DNS IPv4'));
  it('rejects 10.0.0.1 (private IPv4)', () => reject('10.0.0.1', 'private IPv4 range'));
  it('rejects 255.255.255.255 (broadcast)', () => reject('255.255.255.255', 'broadcast IPv4'));
  it('rejects 0.0.0.0', () => reject('0.0.0.0', 'zero IPv4'));
  it('rejects ip6-localhost', () => reject('ip6-localhost', 'ip6-localhost'));
  it('rejects ip6-loopback', () => reject('ip6-loopback', 'ip6-loopback'));
});

describe('sanitiseDomain — null and invalid inputs', () => {
  it('rejects null', () => reject(null, 'null'));
  it('rejects undefined', () => reject(undefined, 'undefined'));
  it('rejects empty string', () => reject('', 'empty string'));
  it('rejects whitespace only', () => reject('   ', 'whitespace only'));
  it('rejects number type', () => reject(12345, 'number input'));
  it('rejects object type', () => reject({}, 'object input'));
  it('rejects domain with space', () => reject('exa mple.com', 'space in domain'));
  it('rejects leading hyphen label', () => reject('-example.com', 'leading hyphen'));
  it('rejects trailing hyphen label', () => reject('example-.com', 'trailing hyphen'));
  it('rejects single label (no dot)', () => reject('nodot', 'no dot'));
  it('rejects domain exceeding 253 chars', () => {
    const long = 'a'.repeat(200) + '.' + 'b'.repeat(60);
    reject(long, 'domain > 253 chars');
  });
});
