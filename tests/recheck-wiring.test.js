import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { completeUnsuspendResults, selectRecheckAccounts, shouldShowRecheckButton } from '../scripts/pure.js';

// scripts/app.js has no test coverage (no DOM harness in this repo), which is
// how the Recheck button shipped wired to nothing: the pure helpers were tested
// in isolation and all passed, while the call site that feeds them was never
// written. These tests close that gap from the two ends we can reach without a
// browser — the decision chain in pure.js, and the wiring in app.js source.

const APP_JS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'app.js'),
  'utf8'
);

// Extracts a top-level `function name(...) { ... }` body by brace matching.
// Good enough for a straight-line function and deliberately dependency-free.
function functionBody(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + '() not found in scripts/app.js');
  return braceBlock(source, source.indexOf('{', start));
}

// Same brace matching, but anchored on an arbitrary marker — for code assigned
// to an identifier rather than declared as `function name(...)`.
function braceBlock(source, open) {
  assert.notEqual(open, -1, 'opening brace not found');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced braces');
}

describe('recheck decision chain', () => {
  // The composition the run actually performs, pinned end to end: a run that
  // could not confirm an account must yield a visible Recheck button whose
  // targets are exactly the unconfirmed accounts.
  const accounts = ['ok@example.com', 'bad@example.com', 'silent@example.com'];

  it('shows Recheck and targets only unconfirmed accounts after a mixed run', () => {
    const reported = [
      { account: 'ok@example.com', outcome: 'confirmed' },
      { account: 'bad@example.com', outcome: 'failed' },
    ];
    const results = completeUnsuspendResults(accounts, reported);

    assert.equal(shouldShowRecheckButton(results), true, 'button must appear for a mixed run');
    assert.deepEqual(
      selectRecheckAccounts(accounts, results).slice().sort(),
      ['bad@example.com', 'silent@example.com'],
      'only failed/unverified accounts are re-queried'
    );
  });

  it('hides Recheck once every account is confirmed', () => {
    const reported = accounts.map(a => ({ account: a, outcome: 'confirmed' }));
    const results = completeUnsuspendResults(accounts, reported);

    assert.equal(shouldShowRecheckButton(results), false);
    assert.deepEqual(selectRecheckAccounts(accounts, results), []);
  });

  it('treats a silent account as unverified and therefore recheckable', () => {
    const results = completeUnsuspendResults(accounts, []);
    assert.equal(shouldShowRecheckButton(results), true);
    assert.deepEqual(selectRecheckAccounts(accounts, results).slice().sort(), accounts.slice().sort());
  });
});

describe('recheck wiring in scripts/app.js', () => {
  // Regression: finishUnsuspendTracking rendered the verdict chips but never
  // recorded _lastRunVerdicts or updated the button. _lastRunVerdicts therefore
  // stayed undefined forever, recheckStatus() bailed on `if (!snapshot) return`,
  // and its own write-back became unreachable dead code — so the Recheck button
  // never appeared, on ANY panel, for ANY failed run.
  const finish = functionBody(APP_JS, 'finishUnsuspendTracking');

  it('records the run snapshot so recheckStatus has something to read', () => {
    assert.match(
      finish,
      /_lastRunVerdicts\[session\.panel\]\s*=/,
      'finishUnsuspendTracking must write _lastRunVerdicts[session.panel]'
    );
  });

  it('updates the Recheck button from the final results', () => {
    assert.match(
      finish,
      /setRecheckButtonState\(\s*session\.panel\s*,\s*r\s*,/,
      'finishUnsuspendTracking must push the final results into the button state'
    );
  });

  it('assigns the snapshot before the early return for a run with no verdicts', () => {
    // Anchored on the specific `r.length === 0` guard, not on the first
    // `return;` — the `if (!session) return;` guard legitimately comes earlier.
    const write = finish.indexOf('_lastRunVerdicts[session.panel]');
    const earlyReturn = finish.indexOf('if (r.length === 0)');
    assert.ok(write !== -1, 'snapshot write must exist');
    assert.ok(earlyReturn !== -1, 'the r.length === 0 early return must exist');
    assert.ok(write < earlyReturn, 'snapshot must be recorded before the early return, not after it');
  });

  it('does not hide the button before results are known', () => {
    const begin = functionBody(APP_JS, 'beginUnsuspendTracking');
    assert.match(begin, /setRecheckButtonState\(panel, \[\], false\)/);
  });

  it('discards the snapshot when a run is cancelled', () => {
    // An abandoned run must not leave the previous run's recheck targets
    // stranded behind a hidden button.
    const marker = APP_JS.indexOf('_cancelUnsuspendTracking = function (prefix)');
    assert.notEqual(marker, -1, '_cancelUnsuspendTracking assignment not found');
    const cancel = braceBlock(APP_JS, APP_JS.indexOf('{', marker));
    assert.match(cancel, /delete _lastRunVerdicts\[prefix\]/);
    assert.match(cancel, /setRecheckButtonState\(prefix, \[\], false\)/);
  });
});