import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../extension/timeout.js';

describe('fetchWithTimeout', () => {
  it('uses an AbortController fallback when AbortSignal.timeout is unavailable', async () => {
    let aborted = false;
    const controller = {
      signal: { name: 'fallback-signal' },
      abort() { aborted = true; rejectFetch(new Error('aborted')); },
    };
    let rejectFetch;
    const fetchImpl = () => new Promise((resolve, reject) => {
      rejectFetch = reject;
    });
    const timers = [];
    const setTimeoutImpl = (callback) => {
      timers.push(callback);
      return 1;
    };
    const clearTimeoutImpl = () => {};

    const request = fetchWithTimeout('/test', {}, 10, {
      fetchImpl,
      AbortSignalImpl: {},
      AbortControllerImpl: class { constructor() { return controller; } },
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    timers[0]();

    await assert.rejects(request, /aborted/);
    assert.equal(aborted, true);
  });
});
