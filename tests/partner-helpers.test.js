import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/partner-helpers.js';

const H = globalThis.ReportGenPartnerHelpers;

// ── status-cell matcher ─────────────────────────────────────────────
describe('isActiveStatusCell', () => {
  it('matches a standalone Active status cell', () => {
    assert.equal(H.isActiveStatusCell('Active'), true);
    assert.equal(H.isActiveStatusCell('  Active  '), true);
    assert.equal(H.isActiveStatusCell('Status: Active'), true);
  });

  it('does not match Inactive', () => {
    assert.equal(H.isActiveStatusCell('Inactive'), false);
    assert.equal(H.isActiveStatusCell('Status: Inactive'), false);
  });

  it('does not match substrings without word boundaries', () => {
    assert.equal(H.isActiveStatusCell('ActiveOrders'), false);
    assert.equal(H.isActiveStatusCell('HyperActive'), false);
  });

  it('returns false for non-string input', () => {
    assert.equal(H.isActiveStatusCell(null), false);
    assert.equal(H.isActiveStatusCell(undefined), false);
    assert.equal(H.isActiveStatusCell(''), false);
  });
});

// ── empty/unknown status ────────────────────────────────────────────
describe('isEmptyOrUnknownStatus', () => {
  it('treats empty or whitespace-only cells as unknown', () => {
    assert.equal(H.isEmptyOrUnknownStatus(''), true);
    assert.equal(H.isEmptyOrUnknownStatus('   '), true);
    assert.equal(H.isEmptyOrUnknownStatus(null), true);
    assert.equal(H.isEmptyOrUnknownStatus(undefined), true);
  });

  it('treats cells without a known status token as unknown', () => {
    assert.equal(H.isEmptyOrUnknownStatus('-'), true);
    assert.equal(H.isEmptyOrUnknownStatus('Pending'), true);
  });

  it('treats Active and Inactive cells as known', () => {
    assert.equal(H.isEmptyOrUnknownStatus('Active'), false);
    assert.equal(H.isEmptyOrUnknownStatus('Inactive'), false);
    assert.equal(H.isEmptyOrUnknownStatus('Status: Active'), false);
  });
});

// ── data-URL parser guard ───────────────────────────────────────────
describe('parseDataUrl', () => {
  it('parses mime and base64 from a well-formed data URL', () => {
    assert.deepEqual(H.parseDataUrl('data:image/png;base64,QUJD'), {
      mime: 'image/png',
      base64: 'QUJD',
    });
  });

  it('returns null instead of throwing on malformed data URLs', () => {
    assert.equal(H.parseDataUrl('not-a-data-url'), null);
    assert.equal(H.parseDataUrl('data:image/png;base64'), null);
    assert.equal(H.parseDataUrl('data:;base64,QUJD'), null);
    assert.equal(H.parseDataUrl(''), null);
    assert.equal(H.parseDataUrl(null), null);
    assert.equal(H.parseDataUrl(undefined), null);
  });
});

// ── login-form detector ─────────────────────────────────────────────
describe('isAdminLoginExpired', () => {
  it('returns true when a password field belongs to an admin login form', () => {
    assert.equal(
      H.isAdminLoginExpired({
        hasPasswordField: true,
        formAction: '/login',
        buttonTexts: ['Log In'],
        pathname: '/admin',
      }),
      true
    );
  });

  it('detects login via nearby button text even without a login action', () => {
    assert.equal(
      H.isAdminLoginExpired({
        hasPasswordField: true,
        formAction: '/session',
        buttonTexts: ['Sign In'],
        pathname: '/admin',
      }),
      true
    );
  });

  it('does not trigger on a stray password field outside the login form', () => {
    assert.equal(
      H.isAdminLoginExpired({
        hasPasswordField: true,
        formAction: '/account/change-password',
        buttonTexts: ['Save', 'Cancel'],
        pathname: '/account/settings',
      }),
      false
    );
  });

  it('does not trigger when there is no password field', () => {
    assert.equal(
      H.isAdminLoginExpired({
        hasPasswordField: false,
        formAction: '/login',
        buttonTexts: ['Log In'],
        pathname: '/login',
      }),
      false
    );
  });
});
