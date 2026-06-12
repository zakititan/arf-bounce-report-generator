# ARF & Bounce Report Generator

A lightweight, zero-dependency internal tool for generating structured ARF (Abuse Reporting Format) complaint reports and email bounce unblock reports. Built as a single-page app and deployed on Vercel.

---

## Features

### Report Generation
- **ARF Report** — captures domain type, complaint count, email content type, screenshots, and assurances
- **Bounce Report** — handles CSV bounce list upload, bounce count, domain checks, and assurances
- **Inline screenshots** — attached images are rendered directly inside the ARF output section and included as labelled filenames in the clipboard copy
- **One-click copy** — copies the full formatted report (including screenshot labels) to clipboard with a "Copied ✓" visual confirmation
- **Keyboard shortcut** — `Ctrl`/`Cmd` + `Enter` generates the report for whichever panel is currently active
- **Confirm before clear** — clearing either panel requires confirmation to prevent accidental data loss

### Domain Lookup
- **Auto WHOIS lookup** — fetches domain creation date and age via [whoisjson.com](https://whoisjson.com)
- **Website Check** — classifies the domain as *Valid Website* or *No website* via a serverless function
- **DKIM Check** — detects common DKIM selectors (titan, neo, google, etc.) via DNS lookup
- **Lookup debounce** — 1-second debounce prevents API spam from rapid button clicks or CSV auto-triggers
- **Stale cache invalidation** — editing the domain input immediately clears the cached WHOIS result and hides the result card
- **Per-panel generate gating** — the Generate button is disabled only while *that panel’s own* lookup is in-flight; the other panel remains unaffected

### CSV (Bounce Panel)
- **Drag-and-drop or file picker** upload of `.csv` bounce lists
- **Automatic row count** with a `< 40` / `≥ 40` threshold badge
- **Auto-detect domain from CSV** — domain is read from the 2nd column (index 1) of the first data row, falling back to the 3rd column (index 2); lookup fires automatically
- Header row is always excluded from the bounce count

### UX & Polish
- **Email → domain sanitisation** — pasting or typing a full email address (`user@example.com`) in the domain field automatically strips the local-part to `example.com`; also strips `http(s)://`, trailing paths, and ports
- **Form state persistence** — all 14 field values are saved to `localStorage` on every change and restored on next visit
- **Dark / Light theme** — respects system preference with a manual toggle; preference is persisted to `localStorage`
- **Required field validation** — all required fields are highlighted with inline error messages before generation is allowed
- **Error resilience** — generate functions are wrapped in `try/catch` so unexpected errors surface as a user-facing toast instead of silently failing
- **10-screenshot cap** — excess files are skipped with a descriptive toast
- **Vercel Analytics & Speed Insights** — page view tracking and Core Web Vitals monitoring

### Security
- **Login gate** — password-protected access via `login.html` + Vercel Edge middleware with HMAC-SHA256 signed cookies
- **Constant-time password comparison** — login handler uses an XOR loop to prevent timing attacks
- **CORS** — all API endpoints restrict `Origin` to `APP_ORIGIN` env var; `Vary: Origin` header is set correctly
- **Rate limiting** — max 20 requests/min per IP on all API endpoints; rate-limit map prunes stale entries above 10,000 to prevent memory leaks
- **Hostname validation** — domain input regex rejects consecutive dots and hyphen-leading labels

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
│   ├── _utils.js                   # Shared helpers: sanitiseDomain, isRateLimited (with map pruning), signToken, verifyToken, CORS headers
│   ├── config.js                   # Centralised API config (allowed origins, rate-limit settings, DKIM selectors via Array.from)
│   ├── whois.js                    # WHOIS lookup serverless function
│   ├── website-check.js            # Website reachability & classification (TextDecoder at module scope)
│   ├── dkim-check.js               # DNS DKIM selector check
│   ├── health.js                   # Health-check endpoint
│   └── login.js                    # Login handler — constant-time password check, sets signed auth cookie
├── scripts/
│   ├── app.js                      # Core app logic (ARF + Bounce generate, domain lookup, CSV, unified state)
│   ├── api.js                      # Frontend API helpers (fetchWhois, fetchWebsiteCheck, fetchDkimCheck — throws on non-2xx)
│   └── ui.js                       # UI helpers (showToast, theme toggle with localStorage, drag events, validation display)
├── styles/
│   └── main.css                    # All styles (light/dark theme, layout, components)
└── tests/
    └── sanitiseDomain.test.js      # Unit tests for domain sanitisation logic
```

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/whois?domain=` | GET | Returns domain creation date and age |
| `/api/website-check?domain=` | GET | Returns `verdict`: Valid Website / No website + `reason` |
| `/api/dkim-check?domain=` | GET | Returns DKIM `status` and `selectors_found` array |
| `/api/login` | POST | Validates password and sets HMAC-signed auth cookie |
| `/api/health` | GET | Health-check — returns `{ ok: true }` |

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

This project is deployed on **Vercel** with no build step — it’s served as static HTML with serverless API functions.

### Deploy your own

1. Fork or clone this repo
2. Import into [Vercel](https://vercel.com)
3. Set all four **Environment Variables** listed above
4. Enable **Vercel Analytics** in your project’s Analytics tab
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
4. Select active assurances
5. Click **Generate ARF Report** (or press `Ctrl`/`Cmd` + `Enter`) → screenshots appear inline; click **Copy** to copy the full report

### Bounce Report
1. Select previous unblock status
2. Upload the bounce list CSV (header row is automatically excluded from the count)
   - Domain is auto-detected from the 2nd or 3rd CSV column and Lookup runs immediately
3. Fill in remaining domain details
4. Select active assurances
5. Click **Generate Bounce Report** (or press `Ctrl`/`Cmd` + `Enter`) → copy the output

> **Tip:** All form fields are saved automatically — refreshing the page restores your last session.

---

## Security

- **Auth cookie** is HMAC-SHA256 signed using `AUTH_SECRET` — forgery without the secret is not feasible
- **Edge middleware** re-verifies the cookie signature on every request using Web Crypto API
- **`api/login.js`** uses Node.js `crypto.createHmac` (Node runtime); **`middleware.js`** uses `crypto.subtle` (Edge runtime) — both produce identical signatures
- **Constant-time comparison** in `api/login.js` prevents timing-based password inference
- **CORS** prevents API calls from unauthorised origins; `Vary: Origin` is set to avoid cache poisoning
- **Rate limiting** mitigates brute-force and scraping; stale entries are pruned to prevent memory leaks
- **`AUTH_SECRET`** and **`APP_PASSWORD`** are never committed to the repo — always set via environment variables

---

## Changelog

### 2026-06-12
- **Security: constant-time password comparison** — `api/login.js` now uses an XOR loop (`safeEqual()`) to prevent timing attacks
- **Security: CORS wildcard removed** — `Access-Control-Allow-Origin` now reads from `APP_ORIGIN` env var; `Vary: Origin` added to all API responses
- **Security: rate-limit memory leak fixed** — `api/_utils.js` prunes the IP map when it exceeds 10,000 entries
- **Security: hostname regex tightened** — domain validation now rejects consecutive dots and hyphen-leading labels
- **Fix: duplicate `attachPersistListeners`** — removed a second `DOMContentLoaded` listener that was doubling up `change` event handlers
- **Fix: `fetchWebsiteCheck` / `fetchDkimCheck` error handling** — frontend API helpers now throw on non-2xx HTTP responses instead of silently returning partial data
- **Fix: `TextDecoder` in `website-check.js`** — moved to module scope (avoid re-instantiation per request) and stream is now flushed after `reader.cancel()`
- **Fix: dead variable removed** — unused `bodyLower` variable removed from `website-check.js`
- **Fix: DKIM map/filter refactor** — `forEach`+`push` replaced with `map`+`filter` in `dkim-check.js`
- **Fix: `DKIM_INDEXED_RANGE` uses `Array.from`** — cleaner array construction in `api/config.js`
- **Theme persistence** — light/dark preference now saved to `localStorage` and restored on page load
- **CSV domain detection** — domain is read from the 2nd column (index 1) of the first data row, falling back to the 3rd column (index 2)
- **Middleware comment** — added explanation for intentional `verifyToken` duplication across Edge and Node runtimes
- **Rate-limit caveat documented** — `api/config.js` now notes that per-process rate limiting does not cover multiple serverless instances
- **Env var renamed** — `APP_URL` renamed to `APP_ORIGIN` for clarity; update this in your Vercel dashboard

### 2026-06-11
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

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks, no build step)
- **Backend:** Vercel Serverless Functions (Node.js 18+)
- **Auth:** Vercel Edge Middleware with HMAC-SHA256 signed session cookie
- **Fonts:** Inter + DM Mono via Google Fonts
- **Hosting:** Vercel
- **Analytics:** Vercel Analytics + Speed Insights
