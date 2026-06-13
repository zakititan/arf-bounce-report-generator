import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMetaRobots, hasNoindex, isImageOnlyPage, isSpaShell } from '../api/website-check.js';

// ── extractMetaRobots ─────────────────────────────────────────────────
describe('extractMetaRobots', () => {
  it('extracts robots content from standard meta tag', () => {
    const html = '<html><head><meta name="robots" content="noindex"></head></html>';
    assert.equal(extractMetaRobots(html), 'noindex');
  });

  it('extracts robots content with reversed attribute order', () => {
    const html = '<html><head><meta content="noindex, nofollow" name="robots"></head></html>';
    assert.equal(extractMetaRobots(html), 'noindex, nofollow');
  });

  it('returns empty string when no robots meta tag', () => {
    const html = '<html><head><title>Test</title></head></html>';
    assert.equal(extractMetaRobots(html), '');
  });

  it('handles uppercase robots tag', () => {
    const html = '<META NAME="robots" CONTENT="noindex">';
    assert.equal(extractMetaRobots(html), 'noindex');
  });

  it('returns lowercase content', () => {
    const html = '<meta name="robots" content="NOINDEX">';
    assert.equal(extractMetaRobots(html), 'noindex');
  });
});

// ── hasNoindex ────────────────────────────────────────────────────────
describe('hasNoindex', () => {
  it('returns true when robots contains noindex', () => {
    const html = '<meta name="robots" content="noindex">';
    assert.equal(hasNoindex(html), true);
  });

  it('returns true for noindex among other directives', () => {
    const html = '<meta name="robots" content="noindex, nofollow">';
    assert.equal(hasNoindex(html), true);
  });

  it('returns false when robots does not contain noindex', () => {
    const html = '<meta name="robots" content="follow">';
    assert.equal(hasNoindex(html), false);
  });

  it('returns false when no robots meta tag', () => {
    const html = '<html><head><title>Test</title></head></html>';
    assert.equal(hasNoindex(html), false);
  });
});

// ── isImageOnlyPage ───────────────────────────────────────────────────
describe('isImageOnlyPage', () => {
  it('returns true when text/bytes ratio is below threshold', () => {
    // 100 chars of text, 20000 bytes => ratio 0.005 < 0.01
    assert.equal(isImageOnlyPage(100, 20000), true);
  });

  it('returns false when text/bytes ratio is above threshold', () => {
    // 500 chars, 20000 bytes => ratio 0.025 > 0.01
    assert.equal(isImageOnlyPage(500, 20000), false);
  });

  it('returns false when bodyBytes is 0', () => {
    assert.equal(isImageOnlyPage(0, 0), false);
  });

  it('returns true for very low text ratio', () => {
    // 1 char, 10000 bytes => ratio 0.0001
    assert.equal(isImageOnlyPage(1, 10000), true);
  });

  it('returns false for high text ratio', () => {
    // 10000 chars, 10000 bytes => ratio 1.0
    assert.equal(isImageOnlyPage(10000, 10000), false);
  });
});

// ── isSpaShell ────────────────────────────────────────────────────────
describe('isSpaShell', () => {
  it('detects SPA with JS bundle and root mount', () => {
    const html = '<html><head><script src="app.js"></script></head><body><div id="root"></div></body></html>';
    assert.equal(isSpaShell(html), true);
  });

  it('detects SPA with app mount', () => {
    const html = '<html><head><script src="bundle.js"></script></head><body><div id="app"></div></body></html>';
    assert.equal(isSpaShell(html), true);
  });

  it('detects SPA with __next root', () => {
    const html = '<html><head><script src="main.js"></script></head><body><div id="__next"></div></body></html>';
    assert.equal(isSpaShell(html), true);
  });

  it('returns false when no JS bundle', () => {
    const html = '<html><head></head><body><div id="root"></div></body></html>';
    assert.equal(isSpaShell(html), false);
  });

  it('returns false when no SPA root element', () => {
    const html = '<html><head><script src="app.js"></script></head><body><div id="content"></div></body></html>';
    assert.equal(isSpaShell(html), false);
  });

  it('returns false when title looks parked', () => {
    const html = '<html><head><title>Domain is parked</title><script src="app.js"></script></head><body><div id="root"></div></body></html>';
    assert.equal(isSpaShell(html), false);
  });

  it('returns false for plain HTML page', () => {
    const html = '<html><head><title>My Site</title></head><body><h1>Hello</h1></body></html>';
    assert.equal(isSpaShell(html), false);
  });
});
