# Remaining Fixes

Generated: 13 June 2026
Branch: `feat/improvement-plan`
Repo: [arf-bounce-report-generator](https://github.com/zakititan/arf-bounce-report-generator)

Three issues remain after the improvement plan commit (`b526a06`) and the KV safety
patch (`36573d5`). Implement them in the order listed. Each fix is self-contained
and touches only the file(s) explicitly named.

---

## Issue 1 — Rate Limiting Is Silently Disabled Until Vercel KV Is Provisioned

**Priority:** High
**File to edit:** `api/_utils.js`

### Context

`checkRateLimit` catches ALL errors (import failure, missing env vars, KV network
error) and silently returns `false` (allow request). This means the login endpoint
has zero rate limiting until an operator manually creates and links a Vercel KV
store. There is no log, no warning, and no fallback.

### Current code (find this exact block in `api/_utils.js`)

```js
export async function checkRateLimit(ip) {
  try {
    const { kv } = await import('@vercel/kv');
    const key = `rl:${ip}`;
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, RATE_LIMIT_WINDOW_MS / 1000);
    return count > RATE_LIMIT_MAX;
  } catch {
    // Fallback: if @vercel/kv is not installed or KV is not configured, allow all
    return false;
  }
}
```

### Replacement code (replace the entire block above with this)

```js
// In-memory fallback store — used when Vercel KV is unavailable.
// Resets on cold start and is not shared across instances, but ensures
// rate limiting is always active even before KV is provisioned.
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

**No other files need to change for this fix.**

---

## Issue 2 — Lookup Button Has Unnecessary 1-Second Delay (Debounce Regression)

**Priority:** Medium
**File to edit:** `scripts/app.js`

### Context

The improvement plan correctly replaced the old timestamp-guard debounce with
`setTimeout`/`clearTimeout`. However, this created a regression: `lookupDomain`
now always waits 1 second before firing, even when the user explicitly clicks the
Lookup button. The button should fire immediately. The debounce is only appropriate
for auto-triggers (paste events, CSV domain detection).

### Change 1 — Remove `async` from `lookupDomain` (it no longer awaits anything)

Find:
```js
async function lookupDomain(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _lookupTimers[prefix] = setTimeout(() => _doLookup(prefix), LOOKUP_DEBOUNCE_MS);
}
```

Replace with:
```js
// Debounced — use for auto-triggers (paste, CSV domain detection)
function lookupDomain(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _lookupTimers[prefix] = setTimeout(() => _doLookup(prefix), LOOKUP_DEBOUNCE_MS);
}

// Immediate — use for explicit Lookup button clicks
function lookupDomainImmediate(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _doLookup(prefix);
}
```

### Change 2 — Wire the Lookup button to the immediate variant

In `initEventDelegation`, find the `'lookup'` case inside the `switch` block:
```js
case 'lookup':
  if (panel) lookupDomain(panel);
  break;
```

Replace with:
```js
case 'lookup':
  if (panel) lookupDomainImmediate(panel);
  break;
```

### What NOT to change

- `processCsv` calls `lookupDomain('bounce')` — leave it as-is (debounced is correct here).
- `initDomainInputs` paste handler calls `lookupDomain(prefix)` — leave it as-is.
- `_doLookup` function — do not touch.

**No other files need to change for this fix.**

---

## Issue 3 — `middleware.js` Has a Hardcoded Session Age That Can Drift

**Priority:** Low
**File to edit:** `middleware.js`

### Context

Fix #2/#11 from the improvement plan centralised the session max-age into
`SESSION_MAX_AGE_MS` in `api/config.js`. This was correctly applied in
`api/_utils.js` and `api/login.js`. However, `middleware.js` still hardcodes
the same value directly because it runs in the Vercel Edge Runtime and cannot
import from `api/config.js` (Node.js-only module).

The value is currently correct (8 hours = both files agree), but if someone
updates `api/config.js` in the future they may not notice `middleware.js` needs
to match — causing silent session validation drift.

### Current code (find this in the `verifyToken` function in `middleware.js`)

```js
const MAX_AGE_MS = 8 * 60 * 60 * 1000;
```

### Replacement code (replace just that one line)

```js
// IMPORTANT: This value MUST match SESSION_MAX_AGE_MS in api/config.js.
// middleware.js runs in the Vercel Edge Runtime and cannot import Node modules,
// so this constant is intentionally duplicated here. Update both files together.
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
```

**No other files need to change for this fix.**

---

## Implementation Order

| Step | Issue | Suggested Branch |
|------|-------|-----------------|
| 1 | Rate limit in-memory fallback | `fix/rate-limit-fallback` |
| 2 | Lookup button debounce split | `fix/lookup-debounce-split` |
| 3 | Middleware session age comment | can be combined with step 1 or 2 |

Issues 1, 2, and 3 are fully independent — they can be implemented in any order
or combined into a single commit.
