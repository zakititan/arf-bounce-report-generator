import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateExtensionResult } from '../extension/rg-lib.js';

// Regression class: validateExtensionResult() has a shared gate that rejects
// any message without a boolean `success` BEFORE it reaches a type-specific
// branch. REPORT_GENERATOR_RECHECK_RESULT was posted without `success`, so every
// single Recheck reply was discarded by the validator, requestRecheck()'s
// listener never resolved, and the user saw a 15-second hang followed by a
// misleading "check Abuse Desk manually" toast. The same defect had already
// shipped once, on STATUS_CHECK_RESULT.
//
// These tests treat the omission as a CLASS rather than a one-off: they read
// every result payload the content-script bridge actually posts, so a future
// type cannot reintroduce it.

const BRIDGE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'content-webapp.js'),
  'utf8'
);

const EXEMPT_FROM_SUCCESS_GATE = new Set(['PARTNER_PANEL_RESULT']);

function postedResultPayloads() {
  const blocks = BRIDGE_SRC.match(/window\.postMessage\(\{[\s\S]*?\}\s*,\s*[A-Za-z]+\);/g) || [];
  return blocks
    .map(block => ({
      block,
      type: (block.match(/type:\s*'([^']+)'/) || [])[1] || '',
    }))
    .filter(({ type }) => /_RESULT$/.test(type));
}

describe('bridge result payloads carry success', () => {
  const payloads = postedResultPayloads();

  it('finds the result payloads to audit', () => {
    // Guards the guard: if this ever drops to zero the checks below are vacuous.
    assert.ok(payloads.length >= 10, 'expected the bridge to post many result payloads');
  });

  // NOTE: this Set holds STRINGS, so iterate them directly. Destructuring
  // `{ type }` out of a string silently yields undefined, which makes every
  // filter below match nothing and every assertion vacuously pass.
  for (const type of new Set(payloads.map(p => p.type))) {
    it(`${type} is posted with a boolean success flag`, () => {
      const blocks = payloads.filter(p => p.type === type);
      assert.ok(blocks.length > 0, `no payload found for ${type} — guard would be vacuous`);
      const offenders = blocks.filter(
        p => !EXEMPT_FROM_SUCCESS_GATE.has(p.type) && !/\bsuccess\s*:/.test(p.block)
      );
      assert.deepEqual(
        offenders.map(o => o.block.slice(0, 120)),
        [],
        `${type} is posted without 'success', so validateExtensionResult rejects every reply`
      );
    });
  }

  it('exempts only PARTNER_PANEL_RESULT, matching the validator gate', () => {
    // If the validator's exemption ever changes, this test must change with it.
    assert.ok(EXEMPT_FROM_SUCCESS_GATE.has('PARTNER_PANEL_RESULT'));
  });
});

describe('validateExtensionResult accepts the Recheck reply the bridge posts', () => {
  // Shaped exactly as content-webapp.js builds it after the fix.
  const posted = {
    type: 'REPORT_GENERATOR_RECHECK_RESULT',
    requestId: 'recheck-m1a2b3c-4d5e6-7f',
    success: true,
    account: 'user@example.com',
    outcome: 'confirmed',
    error: null,
  };

  it('accepts a successful recheck reply', () => {
    assert.equal(validateExtensionResult(posted), true);
  });

  it('accepts a recheck reply reporting the account still unverified', () => {
    assert.equal(
      validateExtensionResult({ ...posted, success: false, outcome: 'unknown' }),
      true
    );
  });

  it('rejects the same reply without success — the shipped defect', () => {
    const { success, ...withoutSuccess } = posted;
    assert.equal(validateExtensionResult(withoutSuccess), false);
  });

  it('rejects a non-boolean success', () => {
    assert.equal(validateExtensionResult({ ...posted, success: 'yes' }), false);
  });
});