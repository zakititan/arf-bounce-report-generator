# Remaining Fixes

Generated: 13 June 2026  
Branch: `feat/improvement-plan`  
Repo: [arf-bounce-report-generator](https://github.com/zakititan/arf-bounce-report-generator)

This document covers two issues that remain after the improvement plan was implemented and
the KV safety patch was applied. Implement them in the order listed.

---

## Issue 1 — Rate Limiting Is Silently Disabled Until Vercel KV Is Provisioned

**Priority:** High  
**File:** `api/_utils.js`

### Problem

The current `checkRateLimit` falls back to `return false` (allow all) whenever
`@vercel/kv` throws for any reason — including the most common production case
where the package is installed but the Vercel KV store has not been created and
linked (missing `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars). This means
the login endpoint has **zero rate limiting** until an operator manually provisions
KV. There is no log, no warning, and no in-memory fallback.

Current code (`api/_utils.js`, `checkRateLimit` function):

```js
export async function checkRateLimit(ip) {
  try {
    const { kv } = await import('@vercel/kv');
    const key = `rl:${ip}`;
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, RATE_LIMIT_WINDOW_MS / 1000);
    return count > RATE_LIMIT_MAX;
  } catch {
    // KV not available — silently allows all requests
    return false;
  }
}
```

### Fix

Add an **in-memory Map fallback** that activates whenever KV is unavailable.
This restores the same sliding-window logic that existed before the improvement
plan, so rate limiting is always active regardless of whether KV is provisioned.
Also add a `console.warn` on the first KV failure so operators know KV is not
configured.

Replace the entire `checkRateLimit` function in `api/_utils.js` with:

```js
// In-memory fallback store used when Vercel KV is unavailable.
const _rateLimitFallbackStore = new Map();
let _kvWarnedOnce = false;

export async function checkRateLimit(ip) {
  try {
    const { kv } = await import('@vercel/kv');
    const key = `rl:${ip}`;
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, RATE_LIMIT_WINDOW_MS / 1000);
    return count > RATE_LIMIT_MAX;
  } catch {
    if (!_kvWarnedOnce) {
      console.warn('[rate-limit] @vercel/kv unavailable — falling back to in-memory store. Configure KV_REST_API_URL and KV_REST_API_TOKEN to enable persistent rate limiting.');
      _kvWarnedOnce = true;
    }
    return _checkRateLimitInMemory(ip);
  }
}

function _checkRateLimitInMemory(ip) {
  const now = Date.now();
  const entry = _rateLimitFallbackStore.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitFallbackStore.set(ip, { count: 1, windowStart: now });
    // Prune stale entries to prevent unbounded memory growth
    if (_rateLimitFallbackStore.size > 10_000) {
      const cutoff = now - RATE_LIMIT_WINDOW_MS;
      for (const [k, v] of _rateLimitFallbackStore) {
        if (v.windowStart < cutoff) _rateLimitFallbackStore.delete(k);
      }
    }
    return false;
  }
  entry.count += 1;
  _rateLimitFallbackStore.set(ip, entry);
  return entry.count > RATE_LIMIT_MAX;
}
```

### No other files need to change for this fix.

---

## Issue 2 — `lookupDomain` Debounce Regression Breaks CSV Auto-Lookup

**Priority:** Medium  
**File:** `scripts/app.js`

### Problem

The debounce was refactored from a timestamp-guard into `setTimeout`/`clearTimeout`.
This is correct for user-typed input (fix #8 from the improvement plan), but it
introduced a regression: `lookupDomain` now returns **immediately** without waiting
for the lookup to finish — it only schedules a timer.

The CSV auto-detection code in `processCsv` calls `lookupDomain('bounce')` and
implicitly relied on it being awaitable. Because `lookupDomain` now returns a
`Promise<void>` that resolves before the actual lookup runs, callers that depend on
the lookup being complete (e.g. any post-lookup state checks) will silently see
stale data.

More critically: when a user **clicks the Lookup button** (`data-action="lookup"`),
they expect the lookup to fire immediately (no 1-second wait). The button path goes
through `lookupDomain`, which now adds an unnecessary 1-second delay on explicit
button clicks.

Current code (`scripts/app.js`):

```js
async function lookupDomain(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _lookupTimers[prefix] = setTimeout(() => _doLookup(prefix), LOOKUP_DEBOUNCE_MS);
}
```

### Fix

Split into two separate call paths:

1. **`lookupDomain(prefix)`** — debounced, used by `paste` and `processCsv` (auto-triggers).
2. **`lookupDomainImmediate(prefix)`** — no debounce, used by the Lookup button click.

In `scripts/app.js`:

**Step 1** — Update `lookupDomain` to keep the debounce (no change to its body):

```js
// Debounced — use for auto-triggers (paste, CSV detection)
function lookupDomain(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _lookupTimers[prefix] = setTimeout(() => _doLookup(prefix), LOOKUP_DEBOUNCE_MS);
}
```

Note: remove the `async` keyword since it no longer `await`s anything.

**Step 2** — Add a new immediate variant below `lookupDomain`:

```js
// Immediate — use for explicit user button clicks
function lookupDomainImmediate(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _doLookup(prefix);
}
```

**Step 3** — In `initEventDelegation`, change the `'lookup'` action handler
to call `lookupDomainImmediate` instead of `lookupDomain`:

```js
// Before
case 'lookup':
  if (panel) lookupDomain(panel);
  break;

// After
case 'lookup':
  if (panel) lookupDomainImmediate(panel);
  break;
```

`processCsv` and the `paste` event listener in `initDomainInputs` should
continue calling `lookupDomain(prefix)` (the debounced version) — no change needed
there.

### No other files need to change for this fix.

---

## Implementation Order

| Step | Issue | Branch Suggestion |
|------|-------|-------------------|
| 1 | Rate limit in-memory fallback | `fix/rate-limit-fallback` |
| 2 | Lookup debounce button regression | `fix/lookup-debounce-split` |

Both fixes are independent and can be implemented in either order or in the same commit.
