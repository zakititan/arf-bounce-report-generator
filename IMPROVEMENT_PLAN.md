# Code Improvement Plan

Generated: 13 June 2026  
Repo: [arf-bounce-report-generator](https://github.com/zakititan/arf-bounce-report-generator)

This plan covers all improvements identified during a full codebase review,
ordered by priority (High → Medium → Low → Cleanup).

---

## 🔴 HIGH PRIORITY

### 1. Fix IP Extraction — Use First Forwarded IP, Not Last

**Files:** `api/_utils.js`, `api/login.js`  
**Problem:**  
The `X-Forwarded-For` header is read using `.pop()` which returns the **last**
(proxy-added) entry. The real client IP is the **first** (leftmost) entry.
Using the wrong IP means rate limiting can be bypassed by any attacker who
controls an intermediary proxy.

**Fix:**
```js
// Before
req.headers['x-forwarded-for']?.split(',').pop()?.trim()

// After
req.headers['x-forwarded-for']?.split(',')[0]?.trim()
// or: .shift()?.trim()
```

**Applies to:** `withMiddleware()` in `api/_utils.js` and the login handler
in `api/login.js`.

---

## 🟠 MEDIUM PRIORITY

### 2. Align Session Cookie Max-Age with Token Verification Age

**Files:** `api/login.js`, `api/_utils.js`, `middleware.js`  
**Problem:**  
The session cookie is issued with `Max-Age=28800` (8 hours), but `verifyToken`
in both `_utils.js` and `middleware.js` accepts tokens up to **24 hours** old.
A stolen cookie that has already expired in the browser can still pass
server-side validation for up to 16 additional hours.

**Fix:**  
Add a shared constant to `api/config.js`:
```js
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_MAX_AGE_S  = SESSION_MAX_AGE_MS / 1000;
```
Import and use `SESSION_MAX_AGE_MS` in `verifyToken` (both `_utils.js` and
`middleware.js`) and `SESSION_MAX_AGE_S` for the `Max-Age` cookie attribute
in `login.js`. This ensures they can never drift apart.

---

### 3. Upgrade Rate Limiter to a Persistent Store

**File:** `api/config.js`  
**Problem:**  
The `globalRateLimitStore` is an in-memory `Map` that resets on every
serverless cold start and is not shared across concurrent Vercel instances.
An attacker with multiple requests hitting different instances can bypass
rate limits entirely.

**Fix:**  
Replace the in-memory `Map` with **Vercel KV (Redis)**. The pattern is a
simple increment-and-expire:
```js
import { kv } from '@vercel/kv';

export async function checkRateLimit(ip) {
  const key = `rl:${ip}`;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, RATE_LIMIT_WINDOW_MS / 1000);
  return count > RATE_LIMIT_MAX;
}
```
This also eliminates the need for the manual stale-entry pruning loop.

---

### 4. Guard `reader.cancel()` Against Already-Closed Stream

**File:** `api/website-check.js`  
**Problem:**  
After the `while` read loop exits with `done === true` (stream fully consumed),
calling `reader.cancel()` on the already-closed reader throws a `TypeError`
in some runtimes.

**Fix:**
```js
// Before
reader.cancel();

// After
if (!done) reader.cancel().catch(() => {});
```

---

## 🟡 LOW PRIORITY

### 5. Fix TextDecoder Reuse Across Requests

**File:** `api/website-check.js`  
**Problem:**  
The `TextDecoder` is instantiated once at module scope. When used in
`stream: true` mode it holds internal state between `.decode()` calls.
If a request errors mid-stream, leftover state can corrupt the next request.

**Fix:**  
Move `const decoder = new TextDecoder();` inside the request handler function
so each request gets a fresh instance.

---

### 6. Two-Phase DKIM Lookup to Reduce DNS Queries

**File:** `api/dkim-check.js`  
**Problem:**  
Every domain lookup fires 20 parallel DNS queries (2 families × 10 selectors).
In the common case where `titan` or `neo` (base selectors) match, all 18
numbered-selector queries are wasted.

**Fix:**  
Use a two-phase approach:
1. Check only base selectors (`titan`, `neo`) first.
2. If one matches, check only that family's numbered variants (`titan1`–`titan9`
   or `neo1`–`neo9`).
3. If neither matches, report `Not Set` immediately — no numbered queries needed.

This reduces DNS load by ~90% on most real-world domains.

---

### 7. Handle Unix Milliseconds vs Seconds in WHOIS Response

**File:** `api/whois.js`  
**Problem:**  
When `creation_date` is a number, the code always multiplies by 1000,
assuming Unix seconds. If the upstream API ever returns milliseconds,
this will produce dates in the year ~52000.

**Fix:**
```js
// Before
createdAt = new Date(creationRaw * 1000);

// After — if value is already in millisecond range, don't multiply
createdAt = creationRaw > 1e12
  ? new Date(creationRaw)
  : new Date(creationRaw * 1000);
```

---

### 8. Replace Silent Debounce Drop with Proper setTimeout Debounce

**File:** `scripts/app.js`  
**Problem:**  
The lookup debounce compares `Date.now()` against a stored timestamp. If the
user clicks "Lookup" a second time within 1 second, the call is **silently
dropped** — no feedback, no reschedule. This is confusing UX.

**Fix:**  
Use a standard `setTimeout`/`clearTimeout` debounce:
```js
let _lookupTimers = { arf: null, bounce: null };

function lookupDomain(prefix) {
  clearTimeout(_lookupTimers[prefix]);
  _lookupTimers[prefix] = setTimeout(() => _doLookup(prefix), LOOKUP_DEBOUNCE_MS);
}
```
This way the lookup is always scheduled and the last click within the window wins.

---

### 9. Add `.map` to Middleware Static-Asset Bypass

**File:** `middleware.js`  
**Problem:**  
Source map files (`.map`) are not included in the static asset regex, so they
would be blocked by the auth middleware if ever deployed. This causes confusing
errors in browser DevTools.

**Fix:**
```js
// Before
pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/)

// After
pathname.match(/\.(css|js|map|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/)
```

---

### 10. Add AbortSignal Timeout to `scripts/api.js` Client Fetches

**File:** `scripts/api.js`  
**Problem:**  
`apiFetch` sends requests with no timeout. If a Vercel function hangs
(e.g., stuck upstream WHOIS), the browser request hangs indefinitely with
no error shown to the user.

**Fix:**
```js
async function apiFetch(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new Error('Request timed out — please try again.');
    throw new Error('Network error — could not reach the server.');
  }
  // ... rest unchanged
}
```

---

## 🔵 CODE QUALITY / CLEANUP

### 11. Extract `SESSION_MAX_AGE` as a Shared Constant

**Files:** `api/config.js`, `api/login.js`, `api/_utils.js`, `middleware.js`  
As described in fix #2 above — the session age value currently appears in
three separate files. Centralise it in `api/config.js` as a single export.

---

### 12. Extract Duplicate Screenshot-Rendering Logic in `app.js`

**File:** `scripts/app.js`  
`generateARF` and `generateBounce` both contain identical blocks for rendering
inline screenshot grids (~20 lines each). Extract into a shared helper:
```js
function renderInlineScreenshots(outputArea, screenshots, dividerLabel) {
  if (screenshots.length === 0) return;
  const divider = document.createElement('div');
  divider.className = 'output-inline-divider';
  divider.textContent = dividerLabel;
  outputArea.appendChild(divider);
  const grid = document.createElement('div');
  grid.className = 'output-screenshots-inline';
  screenshots.forEach((s, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'output-screenshot-item';
    const img = document.createElement('img');
    img.src = s.dataUrl; img.alt = s.name; img.title = s.name; img.loading = 'lazy';
    const label = document.createElement('span');
    label.className = 'output-screenshot-label';
    label.textContent = (i + 1) + '. ' + s.name;
    wrapper.appendChild(img); wrapper.appendChild(label);
    grid.appendChild(wrapper);
  });
  outputArea.appendChild(grid);
}
```

---

### 13. Use `classifyFetchError` in `api/health.js`

**File:** `api/health.js`  
Both `checkWhoisAPI` and `checkDnsAPI` duplicate the same timeout-detection
block. Import and use the existing `classifyFetchError` helper from `_utils.js`
to keep error classification in one place.

---

### 14. Scope `updateFormProgress` Calls to the Relevant Panel

**File:** `scripts/app.js`  
In `attachPersistListeners`, every field change calls `updateFormProgress`
for **both** panels, even when only one panel's field changed. Pass the field's
owning panel prefix to limit DOM updates:
```js
// Derive panel prefix from field id (all ids start with 'arf-' or 'bounce-')
const panelPrefix = id.startsWith('arf') ? 'arf' : 'bounce';
el.addEventListener('change', () => {
  saveFormState();
  updateFormProgress(panelPrefix);
});
el.addEventListener('input', () => updateFormProgress(panelPrefix));
```

---

## Implementation Order

| Step | Fix(es) | Branch Suggestion |
|------|---------|-------------------|
| 1 | #1 — IP extraction | `fix/ip-extraction` |
| 2 | #2, #11 — Session age alignment + shared constant | `fix/session-age-alignment` |
| 3 | #4, #5 — Stream reader + TextDecoder | `fix/website-check-stream` |
| 4 | #7, #8, #10 — WHOIS date, debounce, client timeout | `fix/client-robustness` |
| 5 | #6 — Two-phase DKIM | `perf/dkim-two-phase` |
| 6 | #9 — Middleware static assets | `fix/middleware-assets` |
| 7 | #12, #13, #14 — Code cleanup | `refactor/cleanup` |
| 8 | #3 — Vercel KV rate limiter (requires infra change) | `feat/kv-rate-limiter` |
