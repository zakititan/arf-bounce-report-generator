import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as rg from '../extension/rg-lib.js';
import * as pure from '../scripts/pure.js';

// End-to-end check of the Domain Check bridge, using the REAL payloads
// captured from the live Abuse Desk status endpoints.
//
// This is the seam that has broken twice in this project: the extension posts
// a reply, the web app's validator silently discards it, and the panel spins
// until its timeout. These tests walk the exact production path — extractors
// in the worker, the payload the content script posts, the web app's
// validator, and the classification the panel renders — so a break anywhere
// in that chain fails here rather than in the browser.

const CAPTURED_DOMAIN_BODY = {
  data: [{
    domain_name: 'flockcloud.tech',
    domain_status: 'active',
    customer_status: 'active',
    customer_email: 'anuj@titan.email',
  }],
};

const CAPTURED_USER_BODY = {
  data: [{
    email: 'test23z@flockcloud.tech',
    user_status: 'active',
    domain_status: 'active',
    customer_status: 'active',
  }],
};

const CAPTURED_SUSPENDED_USER_BODY = {
  data: [{
    email: 'suspended@example.com',
    user_status: 'suspended',
    domain_status: 'suspended',
    customer_status: 'active',
  }],
};

// What extension/background.js does for a domain.
function readDomain(json) {
  const customerStatus = rg.extractAdCustomerStatus(json);
  const domainStatus = rg.extractAdDomainStatus(json);
  return {
    success: true,
    customerStatus,
    domainStatus,
    userStatus: '',
    outcome: rg.resolveDomainOutcome({ customerStatus, domainStatus }),
  };
}

// What extension/background.js does for an email.
function readUser(json) {
  const userStatus = rg.extractAdUserStatus(json);
  const domainStatus = rg.extractAdDomainStatus(json);
  const customerStatus = rg.extractAdCustomerStatus(json);
  return {
    success: true,
    customerStatus,
    domainStatus,
    userStatus,
    outcome: rg.resolveVerifiedOutcome({ badgeStatus: '', apiStatus: userStatus }),
  };
}

// What extension/content-webapp.js posts back to the web app.
function postReply(account, reply) {
  return {
    type: 'REPORT_GENERATOR_DOMAIN_STATUS_RESULT',
    requestId: 'domainstatus-abc-1',
    success: reply.success === true,
    account,
    domainStatus: reply.domainStatus || '',
    customerStatus: reply.customerStatus || '',
    userStatus: reply.userStatus || '',
    outcome: reply.outcome || 'unknown',
    error: reply.error || null,
  };
}

describe('domain status bridge, end to end', () => {
  it('carries a domain reading through to an active verdict', () => {
    const payload = postReply('flockcloud.tech', readDomain(CAPTURED_DOMAIN_BODY));
    assert.equal(pure.validateExtensionResult(payload), true, 'the web app must accept this reply');
    const row = pure.classifyDomainCheck('ad', payload);
    assert.equal(row.state, 'active');
    assert.match(row.detail, /Domain active/);
    assert.equal(pure.summariseDomainChecks({ ad: row }).suspended, false);
  });

  it('reads an email and its domain from a single user-endpoint payload', () => {
    const payload = postReply('test23z@flockcloud.tech', readUser(CAPTURED_USER_BODY));
    assert.equal(pure.validateExtensionResult(payload), true);
    const row = pure.classifyDomainCheck('ad', payload);
    assert.equal(row.state, 'active');
    // The users endpoint carries user_status, domain_status AND customer_status,
    // so one request answers all three questions.
    assert.match(row.detail, /Email active/);
    assert.match(row.detail, /Domain active/);
    assert.match(row.detail, /Customer active/);
  });

  it('reports a suspended mailbox as suspended', () => {
    const payload = postReply('suspended@example.com', readUser(CAPTURED_SUSPENDED_USER_BODY));
    assert.equal(pure.validateExtensionResult(payload), true);
    const row = pure.classifyDomainCheck('ad', payload);
    assert.equal(row.state, 'suspended');
    const summary = pure.summariseDomainChecks({ ad: row });
    assert.equal(summary.suspended, true);
    assert.match(summary.headline, /Suspended/);
  });

  it('reports a failed read as unknown, never as active', () => {
    const payload = postReply('flockcloud.tech', { success: false, error: 'Extension did not respond' });
    assert.equal(pure.validateExtensionResult(payload), true);
    const row = pure.classifyDomainCheck('ad', payload);
    assert.equal(row.state, 'unknown');
    const summary = pure.summariseDomainChecks({ ad: row });
    assert.equal(summary.suspended, null, 'an unreadable reading must not claim the domain is active');
    assert.match(summary.headline, /unknown/i);
  });

  it('accepts every reply shape the worker can produce', () => {
    const payloads = [
      postReply('flockcloud.tech', readDomain(CAPTURED_DOMAIN_BODY)),
      postReply('test23z@flockcloud.tech', readUser(CAPTURED_USER_BODY)),
      postReply('suspended@example.com', readUser(CAPTURED_SUSPENDED_USER_BODY)),
      postReply('flockcloud.tech', { success: false, error: 'boom' }),
    ];
    for (const payload of payloads) {
      assert.equal(pure.validateExtensionResult(payload), true,
        'the web app would discard this reply: ' + JSON.stringify(payload));
    }
  });
});
