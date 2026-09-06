export function fetchWithTimeout(url, options = {}, timeoutMs = 30_000, environment = {}) {
  const fetchImpl = environment.fetchImpl || globalThis.fetch;
  const AbortSignalImpl = environment.AbortSignalImpl || globalThis.AbortSignal;
  const AbortControllerImpl = environment.AbortControllerImpl || globalThis.AbortController;
  const setTimeoutImpl = environment.setTimeoutImpl || globalThis.setTimeout;
  const clearTimeoutImpl = environment.clearTimeoutImpl || globalThis.clearTimeout;
  let timer = null;
  let signal = options.signal;

  if (!signal && AbortSignalImpl && typeof AbortSignalImpl.timeout === 'function') {
    signal = AbortSignalImpl.timeout(timeoutMs);
  } else if (!signal && typeof AbortControllerImpl === 'function') {
    const controller = new AbortControllerImpl();
    signal = controller.signal;
    timer = setTimeoutImpl(() => controller.abort(), timeoutMs);
  }

  return fetchImpl(url, { ...options, signal }).finally(() => {
    if (timer !== null) clearTimeoutImpl(timer);
  });
}
