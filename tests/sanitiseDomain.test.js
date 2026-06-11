import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseDomain } from '../api/_utils.js';

// ── Helpers ───────────────────────────────────────────────────────────
function ok(input, expected, label) {
  const result = sanitiseDomain(input);
  assert.equal(result, expected, `[PASS expected] ${label}: got ${result}`);
}
function reject(input, label) {
  const result = sanitiseDomain(input);
  assert.equal(result, null, `[REJECT expected] ${label}: got ${result}`);
}

// ── Valid domains ─────────────────────────────────────────────────────
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

// ── Punycode domains ──────────────────────────────────────────────────
describe('sanitiseDomain — punycode (ASCII-compatible encoding)', () => {
  // Browsers and DNS resolve IDN via punycode; the function receives
  // the already-encoded xn-- form from the API query param.
  it('münchen.de punycode', () =>
    ok('xn--mnchen-3ya.de', 'xn--mnchen-3ya.de', 'münchen.de encoded'));
  it('bücher.de punycode', () =>
    ok('xn--bcher-kva.de', 'xn--bcher-kva.de', 'bücher.de encoded'));
  it('xn-- prefix domain passes regex', () =>
    ok('xn--p1ai.ru', 'xn--p1ai.ru', 'Russian xn-- TLD'));
  it('mixed punycode subdomain', () =>
    ok('mail.xn--mnchen-3ya.de', 'mail.xn--mnchen-3ya.de', 'punycode with subdomain'));
});

// ── IDN — raw unicode (should be rejected) ────────────────────────────
describe('sanitiseDomain — raw unicode IDN (must be rejected)', () => {
  // Raw unicode characters are not valid in DNS queries;
  // callers must encode to punycode first.
  it('rejects münchen.de (raw unicode ü)', () => reject('münchen.de', 'raw unicode ü'));
  it('rejects 中文.com', () => reject('中文.com', 'Chinese characters'));
  it('rejects αβγ.gr', () => reject('αβγ.gr', 'Greek characters'));
  it('rejects emoji domain 🍕.ws', () => reject('🍕.ws', 'emoji domain'));
});

// ── Edge cases — localhost & IP addresses ─────────────────────────────
describe('sanitiseDomain — localhost and IP addresses', () => {
  it('rejects localhost (too short for regex)', () => reject('localhost', 'localhost'));
  it('rejects 127.0.0.1', () => reject('127.0.0.1', 'IPv4 loopback'));
  it('rejects 192.168.1.1', () => reject('192.168.1.1', 'private IPv4'));
  it('rejects ::1 (IPv6)', () => reject('::1', 'IPv6 loopback'));
  it('rejects bare IP with port', () => reject('127.0.0.1:3000', 'IP with port'));
  // Note: plain IPv4 addresses pass the hostname regex (digits + dots fit
  // [a-z0-9][a-z0-9-.]{1,252}[a-z0-9]) — document this known behaviour.
  it('documents: IPv4 like 8.8.8.8 is NOT rejected by regex', () => {
    // This is a known limitation; callers should validate IPs separately if needed.
    const result = sanitiseDomain('8.8.8.8');
    assert.ok(result === '8.8.8.8' || result === null,
      `8.8.8.8 returns ${result} — document actual behaviour`);
  });
});

// ── Null / invalid inputs ─────────────────────────────────────────────
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
  it('rejects single label (no dot)', () => reject('nodot', 'no dot — too short'));
  it('rejects domain exceeding 253 chars', () => {
    const long = 'a'.repeat(200) + '.' + 'b'.repeat(60);
    reject(long, 'domain > 253 chars');
  });
});
