import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { persistUnsuspendReason } from '../extension/rg-lib.js';

describe('persistUnsuspendReason', () => {
  it('opens tabs only after the request-scoped reason is stored', async () => {
    const events = [];
    const storageSet = (_value, callback) => {
      events.push('storage-start');
      setTimeout(() => {
        events.push('storage-complete');
        callback();
      }, 0);
    };
    const openTabs = async () => {
      events.push('tabs-open');
      return 2;
    };

    await persistUnsuspendReason(
      storageSet,
      () => null,
      { reason: 'https://jira.directi.com/browse/ARF-1', ts: 1 }
    );
    const opened = await openTabs();

    assert.equal(opened, 2);
    assert.deepEqual(events, ['storage-start', 'storage-complete', 'tabs-open']);
  });

  it('reports storage failure without opening tabs', async () => {
    let opened = false;
    const storageError = new Error('storage unavailable');
    const storageSet = (_value, callback) => {
      setTimeout(() => callback(), 0);
    };

    await assert.rejects(
      (async () => {
        await persistUnsuspendReason(
          storageSet,
          () => storageError,
          { reason: 'https://jira.directi.com/browse/ARF-1', ts: 1 }
        );
        opened = true;
      })(),
      storageError
    );
    assert.equal(opened, false);
  });
});
