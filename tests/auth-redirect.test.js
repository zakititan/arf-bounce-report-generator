import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSafeRedirect, getLoginRedirect } from '../scripts/auth.js';
import middleware from '../middleware.js';

describe('getSafeRedirect', () => {
  it('preserves an internal path with query and hash', () => {
    assert.equal(getSafeRedirect('/reports?tab=bounce#summary'), '/reports?tab=bounce#summary');
  });

  it('rejects absolute and protocol-relative redirects', () => {
    assert.equal(getSafeRedirect('https://evil.example/steal'), null);
    assert.equal(getSafeRedirect('//evil.example/steal'), null);
  });

  it('rejects backslash-based and malformed redirects', () => {
    assert.equal(getSafeRedirect('/\\evil.example/steal'), null);
    assert.equal(getSafeRedirect('not-a-path'), null);
  });

  it('middleware preserves the requested path and query in the login URL', async () => {
    const response = await middleware({
      url: 'https://app.example/reports?tab=bounce&sort=desc',
      headers: new Headers(),
    });

    assert.equal(
      response.headers.get('location'),
      'https://app.example/login?redirect=%2Freports%3Ftab%3Dbounce%26sort%3Ddesc',
    );
  });

  it('login falls back to the home page for an unsafe redirect', () => {
    assert.equal(getLoginRedirect('?redirect=%2Freports%3Ftab%3Darf%23summary'), '/reports?tab=arf#summary');
    assert.equal(getLoginRedirect('?redirect=https%3A%2F%2Fevil.example'), '/');
  });
});
