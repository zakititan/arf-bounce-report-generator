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
- **DKIM Check** — detects Titan and Neo DKIM selectors (`titan`, `titan1`–`titan9`, `neo`, `neo1`–`neo9`) via DNS lookup; returns `"Set"` when any selector matches and `"Not Set"` when none do
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
- **Account auto-fill** — the Account field is pre-filled with the raw column 2 value (email or domain) if all rows share the same column 2 value; otherwise falls back to the sanitised domain
- Header row is always excluded from the bounce count

### UX & Polish
- **Email → domain sanitisation** — pasting or typing a full email address (`user@example.com`) in the domain field automatically strips the local-part to `example.com`; also strips `http(s)://`, trailing paths, and ports
- **Auto-lookup on paste** — pasting a domain or email into either panel's domain field automatically fires the WHOIS/Website/DKIM lookup without needing to click the Lookup button
- **Form state persistence** — all 16 field values are saved to `localStorage` on every change and restored on next visit
- **Dark / Light theme** — respects system preference with a manual toggle; preference is persisted to `localStorage` with a smooth 250ms crossfade transition
- **Required field validation** — all required fields are highlighted with inline error messages before generation is allowed
- **Error resilience** — generate functions are wrapped in `try/catch` so unexpected errors surface as a user-facing toast instead of silently failing
- **10-screenshot cap** — excess files are skipped with a descriptive toast
- **Toast type differentiation** — toasts carry a `data-type` attribute (success, error, warning, info) for coloured styling
- **Accessible assurance buttons** — assurance toggle buttons use `aria-pressed` to reflect active state for screen readers
- **Decorative SVG hiding** — all decorative icons carry `aria-hidden="true"` to prevent screen reader noise
- **Required field markup** — 13 form fields include `aria-required="true"` for assistive technology
- **XSS-safe validation** — validation error messages use `textContent` instead of `innerHTML` to prevent HTML injection
- **Clipboard API guard** — shows a warning toast if `navigator.clipboard` is unavailable (non-HTTPS or insecure context)
- **Combined age calculation** — `parseAgeToDays` accumulates all units (years + months + days) instead of returning only the first non-null match
- **Print stylesheet** — hides UI chrome (topbar, buttons, upload zones, stepper) when printing, showing only the output areas
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

### Mailboards Integration
- **Mailboards button** — a "Mailboards" link sits below the Account field in both ARF and Bounce panels, linking to [mailboards.ops.titan.email](https://mailboards.ops.titan.email)
- **Smart parameter selection** — if the Account field contains an email address (`@` present), the URL uses `?email=`; otherwise it uses `?domain=`; falls back to bare `?env=prod` when the Account field is empty
- **Dynamic href updates** — the link URL updates in real-time as the Account field is typed or pasted into; no report generation required

### Abuse Desk Quick Link
- **Check ARF count** — a "Check on AD" button sits in a 50/50 split row alongside the ARF Complaints field, linking to the Abuse Desk history page (`abusedesk.ops.titan.email/history.html`) with the Account name as the `entity` parameter and `region=us-east-1`
- **Dynamic href** — the link URL updates in real-time as the Account field is typed or pasted into

### Testing
- **105 unit tests across 4 files** — covers `sanitiseDomain` (38 edge cases), `checkRateLimit`/`classifyFetchError`/token helpers (25 test cases including expiry, missing claims, non-JSON payload), website-check helpers (~38 test cases), and `withMiddleware` CORS/rate-limit middleware (8 test cases)
- **Config integrity checks** — all keyword/pattern arrays are verified at test time for empty strings and lowercase consistency

### Security
- **Login gate** — password-protected access via `login.html` + Vercel Edge middleware with HMAC-SHA256 signed cookies
- **No default password** — `APP_PASSWORD` environment variable must be set; no fallback `'changeme'` default; trailing whitespace is trimmed automatically
- **Constant-time password comparison** — login handler uses an XOR loop (`safeEqual()`) to prevent timing attacks
- **Login rate limiting** — the `/api/login` endpoint uses the shared rate-limit store to prevent brute-force attacks
- **CORS** — all API endpoints restrict `Origin` to `APP_ORIGIN` env var; `Vary: Origin` header is set correctly; no wildcard fallback when `APP_ORIGIN` is empty
- **Rate limiting** — max 20 requests/min per IP on all API endpoints; rate-limit map prunes stale entries above 10,000 to prevent memory leaks
- **Session token expiry** — auth cookies carry an 8-hour expiry enforced during signature verification; leaked tokens are automatically rejected after 8 hours
- **Hardened auth cookie** — `__Host-` cookie prefix enforces `Path=/` + `Secure` at the browser level, preventing subdomain cookie overwrite
- **Rate-limit spoofing prevention** — IP is taken from the first entry in `X-Forwarded-For` (set by Vercel's trusted edge); falls back to `req.socket.remoteAddress`
- **Hostname validation** — domain input regex rejects IPv4/IPv6 addresses, localhost variants, `.localhost`/`.local`/`.internal` TLDs, consecutive dots, and hyphen-leading labels; `@` stripping prevents email-based bypass
- **CSP hardening** — Content-Security-Policy includes `base-uri 'self'`, `form-action 'none'`, and `object-src 'none'` to prevent injection via `<base>`, form-jacking, and plugin attacks
- **HSTS** — `Strict-Transport-Security` header enforces HTTPS with `max-age=31536000; includeSubDomains; preload`
- **Middleware URL matching** — public path check uses exact match or subpath prefix (`pathname === p || pathname.startsWith(p + '/')`) to prevent `/api/login-staging` from bypassing auth
- **XSS prevention** — API response values (verdict, DKIM selectors) and validation error labels are set via `textContent` instead of `innerHTML` to prevent HTML injection
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
│   ├── _utils.js                   # Shared helpers: sanitiseDomain, checkRateLimit (with KV + in-memory fallback), signToken, verifyToken, CORS headers, classifyFetchError
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
- **Rate limiting** — max 20 requests/min per IP; uses Vercel KV when available, falls back to in-memory per-instance store

> **Note on rate limiting:** The in-memory fallback is per-process, not shared across Vercel instances. For strict global enforcement, provision a [Vercel KV](https://vercel.com/docs/storage/vercel-kv) store and set `KV_REST_API_URL` + `KV_REST_API_TOKEN` in your environment variables.

---

## Environment Variables

Set these in the **Vercel Dashboard → Settings → Environment Variables**:

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | ✅ | Password used to access the tool via `login.html` |
| `AUTH_SECRET` | ✅ | Random secret used to HMAC-sign the auth session cookie |
| `WHOISJSON_API_KEY` | ✅ | API key for [whoisjson.com](https://whoisjson.com) WHOIS lookups |
| `APP_ORIGIN` | ✅ | Your deployment URL (e.g. `https://your-app.vercel.app`) — used for CORS |
| `KV_REST_API_URL` | ⭐ | Vercel KV endpoint for persistent cross-instance rate limiting (optional but recommended) |
| `KV_REST_API_TOKEN` | ⭐ | Vercel KV token (required if `KV_REST_API_URL` is set) |

> **Generating `AUTH_SECRET`:** Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` or use [generate-secret.vercel.app](https://generate-secret.vercel.app/32).

> **After adding or changing env vars**, trigger a manual redeploy in Vercel for them to take effect.

---

## Deployment

This project is deployed on **Vercel** with no build step — it's served as static HTML with serverless API functions.

### Deploy your own

1. Fork or clone this repo
2. Import into [Vercel](https://vercel.com)
3. Set all four required **Environment Variables** listed above
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
- **Session token expiry** — auth tokens carry a `sub` and `iat` claim; verified tokens expire after 8 hours
- **`__Host-` cookie prefix** — prevents subdomain cookie overwrite; also enforces `Path=/` and `Secure` at the browser level
- **Edge middleware** re-verifies the cookie signature on every request using Web Crypto API
- **`api/login.js`** uses Node.js `crypto.createHmac` (Node runtime); **`middleware.js`** uses `crypto.subtle` (Edge runtime) — both produce identical signatures with identical claim validation
- **Constant-time comparison** in `api/login.js` prevents timing-based password inference
- **Login rate limiting** prevents brute-force password guessing
- **IP extraction** — uses the first entry in `X-Forwarded-For` (set by Vercel's trusted edge proxy); falls back to `req.socket.remoteAddress`
- **No default password** — `APP_PASSWORD` must be set as an environment variable; the server returns a 500 error if it's missing
- **CORS** prevents API calls from unauthorised origins; `Vary: Origin` is set to avoid cache poisoning
- **Rate limiting** mitigates brute-force and scraping; uses Vercel KV when available with an in-memory fallback; stale entries are pruned to prevent memory leaks
- **CSP** includes `base-uri 'self'`, `form-action 'none'`, and `object-src 'none'` directives
- **HSTS** enforces HTTPS with `max-age=31536000; includeSubDomains; preload`
- **Middleware URL matching** uses exact path or subpath prefix to prevent `/api/login-staging` from bypassing auth
- **`AUTH_SECRET`** and **`APP_PASSWORD`** are never committed to the repo — always set via environment variables
- **Hostname validation** rejects IPv4/IPv6 addresses, localhost names, `.localhost`/`.local`/`.internal` TLDs (SSRF prevention), consecutive dots, hyphen-leading labels, and email local-parts

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks, no build step)
- **Backend:** Vercel Serverless Functions (Node.js 18+)
- **Auth:** Vercel Edge Middleware with HMAC-SHA256 signed session cookie
- **Fonts:** Inter + DM Mono via Google Fonts
- **Hosting:** Vercel
- **Analytics:** Vercel Analytics + Speed Insights
