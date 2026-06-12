# ARF & Bounce Report Generator

A lightweight, zero-dependency internal tool for generating structured ARF (Abuse Reporting Format) complaint reports and email bounce unblock reports. Built as a single-page app and deployed on Vercel.

---

## Features

### Report Generation
- **ARF Report** — captures domain type, complaint count, email content type, screenshots, and assurances
- **Bounce Report** — handles CSV bounce list upload, bounce count, domain checks, and assurances
- **Inline screenshots** — attached images are rendered directly inside the ARF output section and included as labelled filenames in the clipboard copy
- **Assurance screenshots** — separate screenshot upload zones for ARF and Bounce assurance evidence, rendered inline in the output alongside email screenshots
- **Paste screenshots on hover** — hover over any upload zone and press `Ctrl+V` to paste clipboard images directly into that zone; no click-to-focus required
- **One-click copy** — copies the full formatted report (including screenshot labels) to clipboard with a "Copied ✓" visual confirmation
- **Rich clipboard with images** — when screenshots are attached, `Ctrl+C` writes both `text/plain` and `text/html` with embedded `<img>` tags so pasting into email clients, Word, or Google Docs renders images inline
- **Bottom copy button** — an additional Copy to Clipboard button at the end of the output area for convenience
- **Report type pill + timestamp** — each generated report shows a coloured report type badge (ARF/Bounce) and a "Generated:" timestamp
- **Keyboard shortcut** — `Ctrl`/`Cmd` + `Enter` generates the report for whichever panel is currently active
- **Confirm before clear** — clearing either panel requires confirmation to prevent accidental data loss

### Domain Lookup
- **Auto WHOIS lookup** — fetches domain creation date and age via [whoisjson.com](https://whoisjson.com)
- **Website Check** — classifies the domain as *Valid Website* or *No website* via a serverless function; supports SPA shell detection for JS-heavy sites
- **DKIM Check** — detects common DKIM selectors (titan, neo, google, etc.) via DNS lookup
- **Lookup debounce** — 1-second debounce prevents API spam from rapid button clicks or CSV auto-triggers
- **Stale cache invalidation** — editing the domain input immediately clears the cached WHOIS result and hides the result card
- **Per-panel generate gating** — the Generate button is disabled only while *that panel's own* lookup is in-flight; the other panel remains unaffected
- **Progress stepper** — numbered steps (1/2/3) with pulse animation, checkmark on completion, and shine effect on connectors
- **Domain age color coding** — age display is colour-coded: red for <30 days, amber for 30–180 days, green for 180+ days
- **Collapsible result card** — domain lookup results show a summary line by default; click to expand/collapse details
- **Skeleton shimmer** — pulsing placeholder bars replace "checking…" text while website/DKIM results load

### CSV (Bounce Panel)
- **Drag-and-drop or file picker** upload of `.csv` bounce lists
- **Automatic row count** with a `< 40` / `≥ 40` threshold badge
- **Auto-detect domain from CSV** — domain is read from the 2nd column (index 1) of the first data row, falling back to the 3rd column (index 2); lookup fires automatically
- Header row is always excluded from the bounce count

### UX & Polish
- **Email → domain sanitisation** — pasting or typing a full email address (`user@example.com`) in the domain field automatically strips the local-part to `example.com`; also strips `http(s)://`, trailing paths, and ports
- **Auto-lookup on paste** — pasting a domain or email into either panel's domain field automatically fires the WHOIS/Website/DKIM lookup without needing to click the Lookup button
- **Form state persistence** — all 14 field values are saved to `localStorage` on every change and restored on next visit
- **Dark / Light theme** — respects system preference with a manual toggle; preference is persisted to `localStorage` with a smooth 250ms crossfade transition
- **Required field validation** — all required fields are highlighted with inline error messages before generation is allowed
- **Error resilience** — generate functions are wrapped in `try/catch` so unexpected errors surface as a user-facing toast instead of silently failing
- **10-screenshot cap** — excess files are skipped with a descriptive toast
- **Toast type differentiation** — toasts carry a `data-type` attribute (success, error, warning, info) for coloured styling
- **Form completion progress bar** — a thin progress bar under each panel header fills as required fields are completed
- **Assurance button subgroups** — assurance buttons are grouped into Email Hygiene and Technical sections with labelled headers
- **Stepper/Progress reset on clear** — clicking Clear resets the stepper to step 1 and the progress bar to 0%
- **Progress bar updates on auto-fill** — form progress updates when website/DKIM fields are auto-populated from a CSV-triggered lookup
- **Reduced motion support** — respects `prefers-reduced-motion: reduce` by disabling all animations
- **Sticky generate button** — the generate button row sticks to the bottom of the panel on scroll with a frosted-glass backdrop blur
- **Mobile layout** — full-width lookup buttons and vertical stepper on narrow screens
- **Vercel Analytics & Speed Insights** — page view tracking and Core Web Vitals monitoring

### JIRA Integration
- **Create TAE JIRA** — a "Create TAE JIRA" button appears next to the Copy button in both ARF and Bounce output sections
- **Prefilled fields** — clicking the button opens JIRA's create issue page with Project (TAE), Issue Type (Task), Priority (P3), and Summary pre-filled from the report
- **Dynamic labels** — ARF reports get the `ARF_unsuspension` label; Bounce reports get `Bounce_unsuspension`
- **Rich clipboard paste** — the full report text and embedded screenshots are copied to the clipboard before opening JIRA, so pressing `Ctrl+V` in the Description field pastes everything inline
- **Safety gate** — the button shows a warning if no report has been generated yet

### Testing
- **105 unit tests across 4 files** — covers `sanitiseDomain` (38 edge cases), `checkRateLimit`/`classifyFetchError`/token helpers (25 test cases including expiry, missing claims, non-JSON payload), website-check helpers (~38 test cases), and `withMiddleware` CORS/rate-limit middleware (8 test cases)
- **Config integrity checks** — all keyword/pattern arrays are verified at test time for empty strings and lowercase consistency

### Security
- **Login gate** — password-protected access via `login.html` + Vercel Edge middleware with HMAC-SHA256 signed cookies
- **No default password** — `APP_PASSWORD` environment variable must be set; no fallback `'changeme'` default
- **Constant-time password comparison** — login handler uses an XOR loop (`safeEqual()`) to prevent timing attacks
- **Login rate limiting** — the `/api/login` endpoint uses the shared rate-limit store to prevent brute-force attacks
- **CORS** — all API endpoints restrict `Origin` to `APP_ORIGIN` env var; `Vary: Origin` header is set correctly
- **Rate limiting** — max 20 requests/min per IP on all API endpoints; rate-limit map prunes stale entries above 10,000 to prevent memory leaks
- **Session token expiry** — auth cookies carry a 24-hour expiry enforced during signature verification; leaked tokens are automatically rejected after 24h
- **Hardened auth cookie** — `__Host-` cookie prefix enforces `Path=/` + `Secure` at the browser level, preventing subdomain cookie overwrite
- **Rate-limit spoofing prevention** — IP extraction uses the last address in `X-Forwarded-For` (untrusted proxies append on the left), preventing attackers from rotating the first IP to bypass rate limits
- **Hostname validation** — domain input regex rejects IPv4/IPv6 addresses, localhost variants, `.localhost`/`.local`/`.internal` TLDs, consecutive dots, and hyphen-leading labels; `@` stripping prevents email-based bypass
- **CSP hardening** — Content-Security-Policy includes `base-uri 'self'`, `form-action 'none'`, and `object-src 'none'` to prevent injection via `<base>`, form-jacking, and plugin attacks
- **HSTS** — `Strict-Transport-Security` header enforces HTTPS with `max-age=31536000; includeSubDomains; preload`
- **Middleware URL matching** — public path check uses exact match or subpath prefix (`pathname === p || pathname.startsWith(p + '/')`) to prevent `/api/login-staging` from bypassing auth
- **XSS prevention** — API response values (verdict, DKIM selectors) are set via `textContent` instead of `innerHTML` to prevent HTML injection
- **Login redirect removed** — successful login always redirects to `/`; the `redirect` query parameter is no longer accepted, preventing open redirect and `javascript:` injection
- **API error resilience** — all fetch calls are wrapped in a centralized `apiFetch()` helper that safely handles network errors and non-JSON responses instead of crashing

---

## Project Structure

```
├── index.html                      # Main app UI (ARF + Bounce panels)
├── login.html                      # Password login page
├── favicon.svg                     # App favicon
├── middleware.js                   # Vercel Edge middleware (auth gate + HMAC cookie verification)
├── vercel.json                     # Vercel config (clean URLs, security headers)
├── package.json                    # Node deps (used for local dev / tests)
├── .gitignore
├── api/
│   ├── _utils.js                   # Shared helpers: sanitiseDomain, checkRateLimit (with map pruning), signToken, verifyToken, CORS headers, classifyFetchError
│   ├── config.js                   # Centralised API config (rate limits, DKIM selectors, website-check patterns, parked keywords)
│   ├── whois.js                    # WHOIS lookup serverless function
│   ├── website-check.js            # Website reachability & classification (SPA detection, parked/placeholder detection, redirect analysis)
│   ├── dkim-check.js               # DNS DKIM selector check
│   ├── health.js                   # Health-check endpoint (probes WhoisJSON + Google DNS)
│   └── login.js                    # Login handler — constant-time password check, rate limited, sets signed auth cookie
├── scripts/
│   ├── app.js                      # Core app logic (ARF + Bounce generate, domain lookup, CSV, unified state, event delegation)
│   ├── api.js                      # Frontend API helpers (fetchWhois, fetchWebsiteCheck, fetchDkimCheck — throws on non-2xx)
│   └── ui.js                       # UI helpers (showToast with types, theme toggle with transition, stepper, form progress, age colors, validation display, drag-and-drop)
├── styles/
│   └── main.css                    # All styles (light/dark theme tokens, layout, stepper, skeleton shimmer, toast types, responsive)
└── tests/
    ├── sanitiseDomain.test.js      # Unit tests for domain sanitisation logic
    ├── api-handlers.test.js        # Tests for checkRateLimit, classifyFetchError, signToken/verifyToken
    ├── website-check.test.js       # Tests for website classification helpers + config integrity
    └── withMiddleware.test.js       # Tests for CORS, rate limiting, and method guard middleware
```

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/whois?domain=` | GET | Returns domain creation date and age |
| `/api/website-check?domain=` | GET | Returns `verdict`: Valid Website / No website + `reason` |
| `/api/dkim-check?domain=` | GET | Returns DKIM `status` and `selectors_found` array |
| `/api/login` | POST | Validates password and sets HMAC-signed auth cookie |
| `/api/health` | GET | Health-check — probes WhoisJSON and Google DNS, returns `{ status: "ok"|"degraded" }` |

All API endpoints enforce:
- **CORS** — `Origin` must match `APP_ORIGIN` env var; `Vary: Origin` is set
- **Rate limiting** — max 20 requests/min per IP (in-memory, per serverless instance)

> **Note on rate limiting:** Because Vercel spins up multiple serverless instances, rate-limit state is per-process, not global. For strict enforcement across all instances, replace the in-memory map in `api/_utils.js` with [Vercel KV](https://vercel.com/docs/storage/vercel-kv).

---

## Environment Variables

Set these in the **Vercel Dashboard → Settings → Environment Variables**:

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | ✅ | Password used to access the tool via `login.html` |
| `AUTH_SECRET` | ✅ | Random secret used to HMAC-sign the auth session cookie |
| `WHOISJSON_API_KEY` | ✅ | API key for [whoisjson.com](https://whoisjson.com) WHOIS lookups |
| `APP_ORIGIN` | ✅ | Your deployment URL (e.g. `https://your-app.vercel.app`) — used for CORS |

> **Generating `AUTH_SECRET`:** Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` or use [generate-secret.vercel.app](https://generate-secret.vercel.app/32).

> **After adding or changing env vars**, trigger a manual redeploy in Vercel for them to take effect.

---

## Deployment

This project is deployed on **Vercel** with no build step — it's served as static HTML with serverless API functions.

### Deploy your own

1. Fork or clone this repo
2. Import into [Vercel](https://vercel.com)
3. Set all four **Environment Variables** listed above
4. Enable **Vercel Analytics** in your project's Analytics tab
5. Deploy — no build command or output directory needed

---

## Local Development

The API functions require the Vercel CLI to run locally:

```bash
npm i -g vercel
vercel dev
```

Then open [http://localhost:3000](http://localhost:3000).

Create a `.env.local` file in the project root:

```
APP_PASSWORD=yourpassword
AUTH_SECRET=your-random-hex-secret
WHOISJSON_API_KEY=your-api-key
APP_ORIGIN=http://localhost:3000
```

> **Note:** Domain lookup, website check, and DKIM check will not work if you open `index.html` directly in a browser — they require the serverless API functions to be running via `vercel dev`.

---

## Usage

### ARF Report
1. Select domain type and fill in complaint details
2. Upload screenshot(s) of the email content (max 10) via drag-and-drop or file picker
3. Enter the sender domain and click **Lookup** to auto-fill WHOIS, website, and DKIM fields
   - You can paste a full email address — the local-part is stripped automatically
   - The progress stepper (1 → 2 → 3) tracks WHOIS, Website, and DKIM completion
   - Domain age is colour-coded (red <30d, amber 30–180d, green 180d+)
4. Select active assurances (organised into Email Hygiene and Technical subgroups)
5. Click **Generate ARF Report** (or press `Ctrl`/`Cmd` + `Enter`) → screenshots appear inline; click **Copy** or the bottom **Copy to Clipboard** button to copy the full report

### Bounce Report
1. Select previous unblock status
2. Upload the bounce list CSV (header row is automatically excluded from the count)
   - Domain is auto-detected from the 2nd or 3rd CSV column and Lookup runs immediately
   - A `< 40` / `>= 40` badge shows the row count threshold
3. Fill in remaining domain details (website and DKIM are auto-populated from the lookup)
4. Select active assurances
5. Click **Generate Bounce Report** (or press `Ctrl`/`Cmd` + `Enter`) → copy the output

> **Tip:** All form fields are saved automatically — refreshing the page restores your last session.

---

## Security

- **Auth cookie** is HMAC-SHA256 signed using `AUTH_SECRET` — forgery without the secret is not feasible
- **Session token expiry** — auth tokens carry a `sub` and `iat` claim; verified tokens expire after 24 hours
- **`__Host-` cookie prefix** — prevents subdomain cookie overwrite; also enforces `Path=/` and `Secure` at the browser level
- **Edge middleware** re-verifies the cookie signature on every request using Web Crypto API
- **`api/login.js`** uses Node.js `crypto.createHmac` (Node runtime); **`middleware.js`** uses `crypto.subtle` (Edge runtime) — both produce identical signatures with identical claim validation
- **Constant-time comparison** in `api/login.js` prevents timing-based password inference
- **Login rate limiting** prevents brute-force password guessing
- **Rate-limit spoofing prevention** — IP extraction uses the last address in `X-Forwarded-For` (untrusted proxies append on the left)
- **No default password** — `APP_PASSWORD` must be set as an environment variable; the server returns a 500 error if it's missing
- **CORS** prevents API calls from unauthorised origins; `Vary: Origin` is set to avoid cache poisoning
- **Rate limiting** mitigates brute-force and scraping; stale entries are pruned to prevent memory leaks
- **CSP** includes `base-uri 'self'`, `form-action 'none'`, and `object-src 'none'` directives
- **HSTS** enforces HTTPS with `max-age=31536000; includeSubDomains; preload`
- **Middleware URL matching** uses exact path or subpath prefix to prevent `/api/login-staging` from bypassing auth
- **`AUTH_SECRET`** and **`APP_PASSWORD`** are never committed to the repo — always set via environment variables
- **Hostname validation** rejects IPv4/IPv6 addresses, localhost names, `.localhost`/`.local`/`.internal` TLDs (SSRF prevention), consecutive dots, hyphen-leading labels, and email local-parts

---

## Changelog

### 2026-06-12
- **JIRA integration: Create TAE JIRA button** — new button in both ARF and Bounce output sections; copies the full report + images to clipboard, then opens a pre-filled JIRA create-issue URL with project/issue type/priority/summary/labels ([`f75fdeb`](https://github.com/zakititan/arf-bounce-report-generator/commit/f75fdeb), [`79b6334`](https://github.com/zakititan/arf-bounce-report-generator/commit/79b6334))
- **JIRA: pre-filled priority** — default priority set to P3 (ID `10000`) in the JIRA create-issue URL ([`3ef1c48`](https://github.com/zakititan/arf-bounce-report-generator/commit/3ef1c48))
- **JIRA: dynamic labels** — ARF reports labelled `ARF_unsuspension`, Bounce reports labelled `Bounce_unsuspension` via the `labels` query parameter ([`79b6334`](https://github.com/zakititan/arf-bounce-report-generator/commit/79b6334))
- **Security: session token expiry** — auth tokens now carry `{ sub: 'authenticated', iat: timestamp }` claims; both Node and Edge `verifyToken()` reject tokens older than 24 hours or with missing/invalid claims ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: `__Host-` cookie prefix** — `auth_session` renamed to `__Host-auth_session` in both `login.js` and `middleware.js`; browsers enforce `Path=/` + `Secure`, preventing subdomain cookie overwrite ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: rate-limit spoofing prevention** — IP extraction changed from `X-Forwarded-For` first address to last address, preventing attackers from rotating the first IP to bypass rate limits ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: SSRF `.localhost` bypass blocked** — `sanitiseDomain()` now rejects hostnames ending in `.localhost`, `.local`, or `.internal` to prevent SSRF via TLDs that resolve to loopback ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: CSP hardened** — added `base-uri 'self'`, `form-action 'none'`, and `object-src 'none'` directives to prevent injection via `<base>`, form-jacking, and plugins ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: HSTS header added** — `Strict-Transport-Security` with `max-age=31536000; includeSubDomains; preload` forces HTTPS ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: middleware URL matching fixed** — `/api/login-staging` no longer bypasses auth; public path check now uses exact match or subpath prefix ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: XSS via innerHTML fixed** — `checkWebsite()` and `checkDkim()` set API response text via `textContent` instead of interpolating into `innerHTML` ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: login redirect removed** — `window.location.href` no longer reads the `redirect` query parameter, preventing open redirect and `javascript:` injection ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Security: API error handling hardened** — centralized `apiFetch()` wrapper safely handles network errors, non-JSON responses, and non-2xx status codes instead of crashing with `SyntaxError` ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Fix: race condition in domain lookup** — `checkWebsite()` and `checkDkim()` are now awaited via `Promise.allSettled()` before clearing `lookupInFlight`, preventing stale results from overwriting a fresh lookup ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Fix: test env leak** — `after()` hook in `api-handlers.test.js` now correctly handles `ORIGINAL_SECRET === undefined` by deleting the env var instead of setting it to the string `'undefined'` ([`09d3d33`](https://github.com/zakititan/arf-bounce-report-generator/commit/09d3d33))
- **Auto-lookup on paste (Bounce)** — pasting a domain or email into the Bounce domain field now also fires the WHOIS/Website/DKIM lookup, matching the ARF panel behaviour ([`4efa868`](https://github.com/zakititan/arf-bounce-report-generator/commit/4efa868))
- **Test coverage expanded to 105 test cases** — added `withMiddleware.test.js` (8 CORS/rate-limit/method-guard tests), fixed rate-limit tests to match 2-arg function signature, added 13 `sanitiseDomain` edge cases, 5 classifyFetchError error types, 4 signToken/verifyToken edge cases, 16 website-check helper tests, and config integrity checks for `PARKED_TITLE_KEYWORDS`/`PARKED_DOMAIN_PATTERNS`/`SPA_ROOT_PATTERNS` ([`3b25306`](https://github.com/zakititan/arf-bounce-report-generator/commit/3b25306), [`bd46a6d`](https://github.com/zakititan/arf-bounce-report-generator/commit/bd46a6d))
- **Rich clipboard copy with embedded images** — `copyOutputWithFeedback()` uses `navigator.clipboard.write()` with `ClipboardItem` (`text/plain` + `text/html`) when screenshots are present; HTML embeds `<img src="data:...">` tags for inline image rendering in email clients, Word, and Google Docs ([`70bd834`](https://github.com/zakititan/arf-bounce-report-generator/commit/70bd834))
- **Assurance screenshot sections** — separate upload zones for ARF and Bounce assurance evidence; `assuranceScreenshots: []` in both panel states; `processFiles`, `renderPreviews`, `removeScreenshot`, `handleDrop` generalised to accept prefix + key; output includes `── Assurance Screenshots ──` divider with inline images ([`65c2813`](https://github.com/zakititan/arf-bounce-report-generator/commit/65c2813))
- **Auto-lookup on paste (ARF)** — pasting a domain or email into the ARF domain field automatically fires the WHOIS/Website/DKIM lookup; the 1-second debounce prevents rapid re-triggers ([`a48ff2a`](https://github.com/zakititan/arf-bounce-report-generator/commit/a48ff2a))
- **Paste images on hover** — `initPasteSupport()` uses document-level paste listener + `mouseenter`/`mouseleave` tracking per upload zone; `_pasteZone` variable routes `Ctrl+V` to the hovered zone without requiring a click to focus ([`480cb86`](https://github.com/zakititan/arf-bounce-report-generator/commit/480cb86), [`cc94992`](https://github.com/zakititan/arf-bounce-report-generator/commit/cc94992))
- **Fix: HTML clipboard uses `<br>` for line spacing** — newlines converted to `<br>` tags instead of relying on `white-space: pre-wrap` for universal paste-target compatibility ([`3544c94`](https://github.com/zakititan/arf-bounce-report-generator/commit/3544c94))
- **Fix: screenshot filename list stripped from HTML clipboard text** — `text.split('\n── ')[0]` removes duplicate filename info from the HTML portion since images with labels below already carry that information; `text/plain` keeps the full text ([`f04f9bf`](https://github.com/zakititan/arf-bounce-report-generator/commit/f04f9bf))
- **Fix: `godaddy` false positive in PARKED_KEYWORDS** — replaced bare `'godaddy'` with `'godaddy parking'` and `'godaddy default page'`; prevents legitimate sites that mention GoDaddy as a partner (e.g. titan.email) from being misclassified as parked ([`ca06f1a`](https://github.com/zakititan/arf-bounce-report-generator/commit/ca06f1a))
- **Fix: skeleton shimmer contrast** — shimmer highlight now uses `color-mix(in oklch, var(--color-text) 8%, transparent)` so the sweeping highlight is visible in both light and dark themes ([`6b90b08`](https://github.com/zakititan/arf-bounce-report-generator/commit/6b90b08))
- **Fix: progress bar updates on auto-fill** — form progress correctly updates when website/DKIM selects are auto-populated from CSV-triggered domain lookup ([`13b9752`](https://github.com/zakititan/arf-bounce-report-generator/commit/13b9752))
- **Fix: stepper reset on clear** — clicking Clear now resets the progress stepper to step 1; forward-only guard bypassed when `step = '0'` ([`84bf84f`](https://github.com/zakititan/arf-bounce-report-generator/commit/84bf84f), [`5dcfe5b`](https://github.com/zakititan/arf-bounce-report-generator/commit/5dcfe5b))
- **Fix: progress bar reset on clear** — form progress bar resets to 0% when a panel is cleared ([`84bf84f`](https://github.com/zakititan/arf-bounce-report-generator/commit/84bf84f))
- **Fix: dark mode button text** — inverted text on coloured buttons uses near-black (`#11110f`) for readability ([`3072ee4`](https://github.com/zakititan/arf-bounce-report-generator/commit/3072ee4))
- **Fix: domain age color parsing** — `parseAgeToDays()` correctly handles "years", "months", and "days" text from the WHOIS API ([`cde84d1`](https://github.com/zakititan/arf-bounce-report-generator/commit/cde84d1))
- **Fix: sticky generate button** — panel action buttons use `position: sticky; bottom: 0` with `overflow: clip` and `backdrop-filter: blur(12px)` ([`8ca3286`](https://github.com/zakititan/arf-bounce-report-generator/commit/8ca3286))
- **Skeleton shimmer** — pulsing placeholder bars replace "checking…" text during domain website/DKIM lookups ([`2610811`](https://github.com/zakititan/arf-bounce-report-generator/commit/2610811))
- **Theme transition** — toggling dark/light mode applies a smooth 250ms crossfade via `.theme-transitioning` class ([`2610811`](https://github.com/zakititan/arf-bounce-report-generator/commit/2610811))
- **Reduced motion support** — `prefers-reduced-motion: reduce` disables all animation and transition durations for accessibility ([`2610811`](https://github.com/zakititan/arf-bounce-report-generator/commit/2610811))
- **Dark mode polish** — background changed to near-black (`#0c0c0b`); adjusted palette for improved contrast ([`6ccc8a2`](https://github.com/zakititan/arf-bounce-report-generator/commit/6ccc8a2))
- **Progress stepper UI** — larger numbered dots (28px), pulse animation on active step, checkmark (`✓`) animation on completion, shine effect on completed connectors ([`31b4652`](https://github.com/zakititan/arf-bounce-report-generator/commit/31b4652), [`904047f`](https://github.com/zakititan/arf-bounce-report-generator/commit/904047f))
- **Collapsible result card** — domain lookup results show a summary line; click to expand/collapse creation date, age, website, and DKIM details ([`9930271`](https://github.com/zakititan/arf-bounce-report-generator/commit/9930271))
- **Form progress bar** — thin animated bar under each panel header fills as required fields are completed ([`904047f`](https://github.com/zakititan/arf-bounce-report-generator/commit/904047f))
- **Assurance subgroups** — buttons group into "Email Hygiene" and "Technical" subsections with labelled headers ([`904047f`](https://github.com/zakititan/arf-bounce-report-generator/commit/904047f))
- **Output enhancements** — report type pill (coloured ARF/Bounce badge), generation timestamp, and a bottom Copy to Clipboard button ([`904047f`](https://github.com/zakititan/arf-bounce-report-generator/commit/904047f))
- **Screenshot empty state** — when no screenshots are attached, shows centred icon + "No screenshots attached" + live `0 / 10` counter ([`904047f`](https://github.com/zakititan/arf-bounce-report-generator/commit/904047f))
- **Toast type differentiation** — `showToast()` accepts a `type` parameter; CSS styles distinguish success/error/warning/info toasts ([`904047f`](https://github.com/zakititan/arf-bounce-report-generator/commit/904047f))
- **Mobile layout** — lookup buttons go full-width, stepper becomes vertical, single-column form fields on screens under 600px ([`904047f`](https://github.com/zakititan/arf-bounce-report-generator/commit/904047f))

### 2026-06-11
- **Security: constant-time password comparison** — `api/login.js` now uses an XOR loop (`safeEqual()`) to prevent timing attacks ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Security: CORS wildcard removed** — `Access-Control-Allow-Origin` now reads from `APP_ORIGIN` env var; `Vary: Origin` added to all API responses ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Security: rate-limit memory leak fixed** — `api/_utils.js` prunes the IP map when it exceeds 10,000 entries ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Security: hostname regex tightened** — domain validation now rejects IPv4/IPv6, localhost, consecutive dots, and hyphen-leading labels ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Security: login rate limiting + no default password** — `/api/login` uses `checkRateLimit` with `globalRateLimitStore`; `APP_PASSWORD` env var is required ([`3d20dd0`](https://github.com/zakititan/arf-bounce-report-generator/commit/3d20dd0))
- **Fix: `classifyFetchError` status restored** — `whois.js` was receiving `undefined` instead of `504`/`502`; field added back to return object ([`3d20dd0`](https://github.com/zakititan/arf-bounce-report-generator/commit/3d20dd0))
- **Fix: false positive reduction in parked detection** — removed overly generic keywords (`"powered by"`, `"buy now"`, etc.) from `PARKED_KEYWORDS` and `PARKED_TITLE_KEYWORDS` ([`3d20dd0`](https://github.com/zakititan/arf-bounce-report-generator/commit/3d20dd0))
- **Fix: `extractMetaRobots` handles reversed attribute order** — now matches `<meta content="noindex" name="robots">` in addition to the standard order ([`3d20dd0`](https://github.com/zakititan/arf-bounce-report-generator/commit/3d20dd0))
- **Fix: `isImageOnlyPage` accepts `bodyLength` instead of raw HTML** — eliminates redundant tag-stripping ([`3d20dd0`](https://github.com/zakititan/arf-bounce-report-generator/commit/3d20dd0))
- **Fix: XSS in `renderPreviews()`** — changed from `innerHTML` concat to safe DOM API (`createElement`, `img.alt = s.name`) ([`3d20dd0`](https://github.com/zakititan/arf-bounce-report-generator/commit/3d20dd0))
- **Fix: inline styles moved to CSS** — `style=` attributes removed from `<pre>` and copy buttons; `.copy-btn-wrap .btn` CSS class added ([`3d20dd0`](https://github.com/zakititan/arf-bounce-report-generator/commit/3d20dd0))
- **Fix: duplicate `attachPersistListeners`** — removed a second `DOMContentLoaded` listener that was doubling up `change` event handlers ([`cf8fabe`](https://github.com/zakititan/arf-bounce-report-generator/commit/cf8fabe))
- **Fix: `fetchWebsiteCheck` / `fetchDkimCheck` error handling** — frontend API helpers now throw on non-2xx HTTP responses instead of silently returning partial data ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Fix: `TextDecoder` in `website-check.js`** — moved to module scope (avoid re-instantiation per request); stream flushed after `reader.cancel()` ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Fix: dead variable removed** — unused `bodyLower` variable removed from `website-check.js` ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Fix: DKIM map/filter refactor** — `forEach`+`push` replaced with `map`+`filter` in `dkim-check.js` ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Fix: `DKIM_INDEXED_RANGE` uses `Array.from`** — cleaner array construction in `api/config.js` ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Theme persistence** — light/dark preference now saved to `localStorage` and restored on page load ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **CSV domain detection** — domain read from 2nd column (index 1) falling back to 3rd column (index 2); header row excluded ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Middleware comment** — added explanation for intentional `verifyToken` duplication across Edge and Node runtimes ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Rate-limit caveat documented** — `api/config.js` now notes that per-process rate limiting does not cover multiple serverless instances ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Env var renamed** — `APP_URL` renamed to `APP_ORIGIN` for clarity; update this in your Vercel dashboard ([`8657c1e`](https://github.com/zakititan/arf-bounce-report-generator/commit/8657c1e))
- **Website verdict simplified** — dropped Fake/Legit/Parked/Placeholder; only "Valid Website" or "No website" ([`961cb52`](https://github.com/zakititan/arf-bounce-report-generator/commit/961cb52))
- **SPA shell detection** — pages with JS bundles + root mount element (`#root`, `#app`, etc.) + clean title classified as Valid Website despite low visible text ([`258102c`](https://github.com/zakititan/arf-bounce-report-generator/commit/258102c))
- **Mailchimp/Sendgrid added to Bounce panel** — assurance buttons mirror ARF panel ([`84639fc`](https://github.com/zakititan/arf-bounce-report-generator/commit/84639fc))

### 2026-06-10
- **Email → domain sanitisation** — domain inputs now strip email local-parts on paste, blur, and before every Lookup call; also strips `http(s)://`, trailing paths, ports ([`4e43623`](https://github.com/zakititan/arf-bounce-report-generator/commit/4e436230420ef1ff0670e60a91f069570127b529))
- **Auto-trigger Lookup from CSV** — after domain auto-detection from a CSV upload, Lookup fires automatically instead of requiring a manual click ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **Form state persistence** — all 14 form fields saved to `localStorage` on change and restored on `DOMContentLoaded` ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **`Ctrl`/`Cmd` + `Enter` shortcut** — generates the report for whichever panel is active ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **"Copied ✓" button feedback** — copy button briefly shows green confirmation text instead of only a toast ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **Unified `state` object** — consolidated all per-panel state (screenshots, whois cache, in-flight flags) into a single `state` object ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **Stale cache invalidation** — editing the domain input immediately clears the cached WHOIS result and hides the result card ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **`try/catch` on generate functions** — unexpected errors surface as a user-facing toast instead of silently failing ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **10-screenshot cap** — excess files are skipped with a descriptive toast ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **Lookup debounce** — 1-second debounce prevents API spam from rapid clicks or auto-triggers ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **Screenshot remove button** — replaced bare `x` text with an SVG cross icon ([`2ae864f`](https://github.com/zakititan/arf-bounce-report-generator/commit/2ae864fa09326fbb53dd3d57442117adb0ff10ab))
- **Inline screenshots in output** — attached images render directly in the generated ARF report section with labelled filenames ([`f855511`](https://github.com/zakititan/arf-bounce-report-generator/commit/f855511))
- **Website & DKIM checks on WHOIS failure** — domain website/DKIM checks run even when WHOIS lookup fails ([`2838e22`](https://github.com/zakititan/arf-bounce-report-generator/commit/2838e22))
- **Domain lookup removed as required field** — website and DKIM selects are manually selectable without a lookup ([`43b2f3c`](https://github.com/zakititan/arf-bounce-report-generator/commit/43b2f3c))

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks, no build step)
- **Backend:** Vercel Serverless Functions (Node.js 18+)
- **Auth:** Vercel Edge Middleware with HMAC-SHA256 signed session cookie
- **Fonts:** Inter + DM Mono via Google Fonts
- **Hosting:** Vercel
- **Analytics:** Vercel Analytics + Speed Insights
