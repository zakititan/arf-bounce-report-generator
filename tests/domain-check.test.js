import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomainCheck, summariseDomainChecks, isSuspendedReading, adRegionParam } from '../scripts/pure.js';

// ── Domain Check panel: the verdict logic ─────────────────────────────────────
//
// Design decision: Abuse Desk is the ONLY authority on whether something is
// suspended. The other checks (WHOIS, website, MX, SPF, DMARC, DKIM, Laravel,
// XML-RPC, WordPress) each report their own finding and contribute to an
// "issues found" count, but they never flip the suspended verdict. A parked
// site is a fact about the site, not proof that the domain is suspended.
//
// These are the pure parts; the DOM rendering lives in scripts/app.js.

describe('adRegionParam', () => {
  // Regression: the panel used to pass the app's internal region token
  // ('na'/'eu') straight to the Abuse Desk status API, which needs the real
  // region name. The API answers a bad region with a perfectly valid but
  // EMPTY body — {"data": []} — so the read silently produced no status and
  // the panel showed a bare "Unknown" with nothing to act on.
  it('maps eu to eu-central-1', () => {
    assert.equal(adRegionParam('eu'), 'eu-central-1');
  });

  it('maps na to us-east-1', () => {
    assert.equal(adRegionParam('na'), 'us-east-1');
  });

  it('is case-insensitive', () => {
    assert.equal(adRegionParam('EU'), 'eu-central-1');
    assert.equal(adRegionParam('Eu'), 'eu-central-1');
  });

  it('defaults to us-east-1 for anything unrecognised', () => {
    assert.equal(adRegionParam(''), 'us-east-1');
    assert.equal(adRegionParam(null), 'us-east-1');
    assert.equal(adRegionParam(undefined), 'us-east-1');
    assert.equal(adRegionParam('us-east-1'), 'us-east-1');
  });
});

describe('isSuspendedReading', () => {
  it('reads a suspended signal from any status field', () => {
    assert.equal(isSuspendedReading({ domainStatus: 'suspended' }), true);
    assert.equal(isSuspendedReading({ customerStatus: 'suspended' }), true);
    assert.equal(isSuspendedReading({ userStatus: 'suspended' }), true);
  });

  it('is case-insensitive', () => {
    assert.equal(isSuspendedReading({ domainStatus: 'Suspended' }), true);
    assert.equal(isSuspendedReading({ domainStatus: 'SUSPENDED' }), true);
  });

  it('is not suspended when everything reads active', () => {
    assert.equal(isSuspendedReading({
      domainStatus: 'active', customerStatus: 'active', userStatus: 'active',
    }), false);
  });

  it('is not suspended when nothing was returned', () => {
    assert.equal(isSuspendedReading({ domainStatus: '', customerStatus: '' }), false);
    assert.equal(isSuspendedReading({}), false);
    assert.equal(isSuspendedReading(null), false);
  });
});

describe('classifyDomainCheck', () => {
  it('marks a suspended domain as suspended', () => {
    const r = classifyDomainCheck('ad', { domainStatus: 'suspended', customerStatus: 'active' });
    assert.equal(r.state, 'suspended');
  });

  it('marks a suspended customer as suspended', () => {
    const r = classifyDomainCheck('ad', { domainStatus: 'active', customerStatus: 'suspended' });
    assert.equal(r.state, 'suspended');
  });

  it('marks a suspended email as suspended', () => {
    const r = classifyDomainCheck('ad', { userStatus: 'suspended' });
    assert.equal(r.state, 'suspended');
  });

  it('marks a fully active reading as active', () => {
    const r = classifyDomainCheck('ad', { domainStatus: 'active', customerStatus: 'active' });
    assert.equal(r.state, 'active');
  });

  it('marks an unreadable reading as unknown, never as active', () => {
    const r = classifyDomainCheck('ad', { domainStatus: '', customerStatus: '' });
    assert.equal(r.state, 'unknown');
  });

  it('marks a failed reading as unknown', () => {
    const r = classifyDomainCheck('ad', { error: 'boom' });
    assert.equal(r.state, 'unknown');
  });

  it('classifies a parked or unreachable website as a warning, not a suspension', () => {
    assert.equal(classifyDomainCheck('website', { verdict: 'No website' }).state, 'warn');
    assert.equal(classifyDomainCheck('website', { verdict: 'Unreachable' }).state, 'warn');
    assert.equal(classifyDomainCheck('website', { verdict: 'Valid Website' }).state, 'ok');
  });

  it('classifies missing SPF and DMARC as warnings', () => {
    assert.equal(classifyDomainCheck('spf', { spf_present: false }).state, 'warn');
    assert.equal(classifyDomainCheck('spf', { spf_present: true }).state, 'ok');
    assert.equal(classifyDomainCheck('dmarc', { dmarc_present: false }).state, 'warn');
    assert.equal(classifyDomainCheck('dmarc', { dmarc_present: true }).state, 'ok');
  });

  it('classifies missing MX as a warning', () => {
    assert.equal(classifyDomainCheck('mx', { mx: [] }).state, 'warn');
    assert.equal(classifyDomainCheck('mx', { mx: ['mx1.titan.email'] }).state, 'ok');
  });

  it('classifies an exposed Laravel .env as an issue', () => {
    assert.equal(classifyDomainCheck('laravel', { vulnerable: true }).state, 'issue');
    assert.equal(classifyDomainCheck('laravel', { vulnerable: false }).state, 'ok');
  });

  it('classifies an accessible xmlrpc.php as an issue', () => {
    assert.equal(classifyDomainCheck('xmlrpc', { vulnerable: true }).state, 'issue');
    assert.equal(classifyDomainCheck('xmlrpc', { vulnerable: false }).state, 'ok');
  });

  it('classifies a detected WordPress install as informational', () => {
    assert.equal(classifyDomainCheck('wordpress', { detected: true }).state, 'info');
    assert.equal(classifyDomainCheck('wordpress', { detected: false }).state, 'ok');
  });

  it('classifies a failed check as unknown', () => {
    assert.equal(classifyDomainCheck('website', { error: 'timeout' }).state, 'unknown');
  });

  // The individual Abuse Desk readings are shown as their own fields.
  it('classifies the domain status field on its own', () => {
    assert.equal(classifyDomainCheck('ad-domain', { domainStatus: 'active' }).state, 'active');
    assert.equal(classifyDomainCheck('ad-domain', { domainStatus: 'suspended' }).state, 'suspended');
    assert.equal(classifyDomainCheck('ad-domain', { domainStatus: '' }).state, 'unknown');
  });

  it('classifies the customer status field on its own', () => {
    assert.equal(classifyDomainCheck('ad-customer', { customerStatus: 'active' }).state, 'active');
    assert.equal(classifyDomainCheck('ad-customer', { customerStatus: 'suspended' }).state, 'suspended');
  });

  it('classifies the email status field on its own', () => {
    assert.equal(classifyDomainCheck('ad-user', { userStatus: 'active' }).state, 'active');
    assert.equal(classifyDomainCheck('ad-user', { userStatus: 'suspended' }).state, 'suspended');
  });

  it('shows the raw value for a status it cannot classify', () => {
    // "inactive" is neither active nor suspended, so the badge says Unknown —
    // but the value itself is still worth showing verbatim.
    const r = classifyDomainCheck('ad-domain', { domainStatus: 'inactive' });
    assert.equal(r.state, 'unknown');
    assert.equal(r.detail, 'inactive');
  });

  it('says "not returned" when a reading is missing entirely', () => {
    const r = classifyDomainCheck('ad-customer', { domainStatus: 'active' });
    assert.equal(r.state, 'unknown');
    assert.equal(r.detail, 'not returned');
  });

  it('reports a failed AD read on every AD field', () => {
    for (const id of ['ad-domain', 'ad-customer', 'ad-user']) {
      const r = classifyDomainCheck(id, { error: 'boom' });
      assert.equal(r.state, 'unknown', id);
      assert.equal(r.detail, 'boom', id);
    }
  });

  it('uses the extension outcome for the overall verdict when present', () => {
    // The extension applies Abuse Desk's own rules, so its verdict is the
    // one the unsuspension flow would reach — the panel must agree with it.
    assert.equal(classifyDomainCheck('ad', { userStatus: 'active', outcome: 'confirmed' }).state, 'active');
    assert.equal(classifyDomainCheck('ad', { userStatus: 'suspended', outcome: 'failed' }).state, 'suspended');
  });

  it('falls back to the raw readings when no outcome is supplied', () => {
    assert.equal(classifyDomainCheck('ad', { domainStatus: 'active', customerStatus: 'active' }).state, 'active');
    assert.equal(classifyDomainCheck('ad', { domainStatus: 'suspended' }).state, 'suspended');
    assert.equal(classifyDomainCheck('ad', { domainStatus: '' }).state, 'unknown');
  });

  it('returns a human-readable detail for every state', () => {
    for (const state of ['suspended', 'active', 'warn', 'issue', 'info', 'ok', 'unknown']) {
      const r = classifyDomainCheck('website', { verdict: 'Valid Website' });
      assert.equal(typeof r.detail, 'string');
      assert.ok(r.detail.length > 0);
    }
  });
});

describe('summariseDomainChecks', () => {
  const ad = (o) => ({ ad: { state: 'active', detail: 'Active', ...o } });

  it('counts issues and warnings across the non-AD checks', () => {
    const s = summariseDomainChecks({
      ad: { state: 'active', detail: 'Active' },
      website: { state: 'warn', detail: 'No website' },
      laravel: { state: 'issue', detail: 'Exposed' },
      spf: { state: 'ok', detail: 'Present' },
    });
    assert.equal(s.suspended, false);
    assert.equal(s.issues, 1);
    assert.equal(s.warnings, 1);
  });

  it('reports suspended when AD says so, regardless of the other checks', () => {
    const s = summariseDomainChecks({
      ad: { state: 'suspended', detail: 'Suspended' },
      website: { state: 'ok', detail: 'Valid Website' },
      spf: { state: 'ok', detail: 'Present' },
    });
    assert.equal(s.suspended, true);
  });

  it('never reports suspended from a non-AD check', () => {
    const s = summariseDomainChecks({
      ad: { state: 'active', detail: 'Active' },
      website: { state: 'warn', detail: 'No website' },
      laravel: { state: 'issue', detail: 'Exposed' },
    });
    assert.equal(s.suspended, false);
  });

  it('is unknown about suspension when AD could not be read', () => {
    const s = summariseDomainChecks({
      ad: { state: 'unknown', detail: 'Could not read' },
      website: { state: 'warn', detail: 'No website' },
    });
    assert.equal(s.suspended, null);
  });

  it('builds a headline that names the suspension state', () => {
    const active = summariseDomainChecks({ ad: { state: 'active', detail: 'Active' } });
    assert.match(active.headline, /active/i);
    const suspended = summariseDomainChecks({ ad: { state: 'suspended', detail: 'Suspended' } });
    assert.match(suspended.headline, /suspended/i);
    const unknown = summariseDomainChecks({ ad: { state: 'unknown', detail: 'x' } });
    assert.match(unknown.headline, /unknown/i);
  });

  it('builds a headline that mentions the issue count', () => {
    const s = summariseDomainChecks({
      ad: { state: 'active', detail: 'Active' },
      laravel: { state: 'issue', detail: 'Exposed' },
    });
    assert.match(s.headline, /1 issue/i);
  });

  it('handles an empty result set without throwing', () => {
    const s = summariseDomainChecks({});
    assert.equal(s.suspended, null);
    assert.equal(s.issues, 0);
    assert.equal(s.warnings, 0);
    assert.equal(typeof s.headline, 'string');
  });

  it('does not count the AD row itself as an issue or warning', () => {
    const s = summariseDomainChecks({ ad: { state: 'unknown', detail: 'x' } });
    assert.equal(s.issues, 0);
    assert.equal(s.warnings, 0);
  });
});
