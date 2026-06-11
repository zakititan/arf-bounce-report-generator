# ARF & Bounce Report Generator

A lightweight, zero-dependency internal tool for generating structured ARF (Abuse Reporting Format) complaint reports and email bounce unblock reports. Built as a single-page app and deployed on Vercel.

---

## Features

- **ARF Report generation** — captures domain type, complaint count, email content type, screenshots, and assurances
- **Bounce Report generation** — handles CSV bounce list upload, bounce count, domain checks, and assurances
- **Domain Lookup** — auto-fetches WHOIS creation date, domain age, website validity, and DKIM status
- **Website Check** — classifies domain as Legit / Fake / No website via serverless API
- **DKIM Check** — detects common DKIM selectors (titan, neo, google, etc.) via DNS lookup
- **CSV parsing** — drag-and-drop bounce list upload with automatic row count and `< 40` threshold badge
- **Auto-trigger Lookup from CSV** — domain is auto-detected from the CSV and Lookup fires automatically
- **Email → Domain sanitisation** — pasting or typing a full email address in the domain field automatically strips the local-part (e.g. `user@example.com` → `example.com`)
- **Screenshot attachments** — drag-and-drop image upload (max 10) with inline previews in the generated report
- **One-click copy** — copies the formatted report text to clipboard with a "Copied ✓" visual confirmation
- **Keyboard shortcut** — `Ctrl`/`Cmd` + `Enter` generates the report from whichever panel is active
- **Form state persistence** — all field values are saved to `localStorage` and restored on next visit
- **Dark / Light theme** — respects system preference with a manual toggle
- **Login gate** — password-protected access via `login.html` + Vercel Edge middleware with HMAC-signed cookies
- **CORS protection** — all API endpoints restricted to `APP_URL` origin
- **IP rate limiting** — 20 requests/min per IP on all API endpoints
- **Lookup debounce** — 1-second debounce prevents API spam from rapid button clicks or auto-triggers
- **Stale cache invalidation** — changing the domain input immediately clears the cached WHOIS result
- **Required field validation** — Generate button blocked until all required fields are filled
- **Lookup-aware Generate button** — Generate is disabled while a domain lookup is in-flight
- **Vercel Analytics & Speed Insights** — page view tracking and Core Web Vitals monitoring

---

## Project Structure

```
├── index.html            # Main app UI (ARF + Bounce panels)
├── login.html            # Password login page
├── middleware.js         # Vercel Edge middleware (auth gate + HMAC cookie verification)
├── vercel.json           # Vercel config (clean URLs, security headers)
├── .gitignore
└── api/
    ├── _utils.js         # Shared helpers: sanitiseDomain, isRateLimited, signToken, verifyToken
    ├── whois.js          # WHOIS lookup serverless function
    ├── website-check.js  # Website reachability & classification
    ├── dkim-check.js     # DNS DKIM selector check
    └── login.js          # Login handler — validates password, sets signed auth cookie
```

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/whois?domain=` | GET | Returns domain creation date and age |
| `/api/website-check?domain=` | GET | Returns `verdict`: Legit / Fake / No website |
| `/api/dkim-check?domain=` | GET | Returns DKIM status and selectors found |
| `/api/login` | POST | Validates password and sets HMAC-signed auth cookie |

All API endpoints enforce:
- **CORS** — `Origin` must match `APP_URL` env var
- **Rate limiting** — max 20 requests/min per IP (in-memory, per instance)

---

## Environment Variables

Set these in the **Vercel Dashboard → Settings → Environment Variables**:

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | ✅ | Password used to access the tool via `login.html` |
| `AUTH_SECRET` | ✅ | Random secret used to HMAC-sign the auth session cookie |
| `WHOISJSON_API_KEY` | ✅ | API key for [whoisjson.com](https://whoisjson.com) WHOIS lookups |
| `APP_URL` | ✅ | Your deployment URL (e.g. `https://your-app.vercel.app`) — used for CORS |

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
APP_URL=http://localhost:3000
```

> **Note:** Domain lookup, website check, and DKIM check will not work if you open `index.html` directly in a browser — they require the serverless API functions to be running via `vercel dev`.

---

## Usage

### ARF Report
1. Select domain type and fill in complaint details
2. Upload screenshot(s) of the email content (max 10)
3. Enter the sender domain and click **Lookup** to auto-fill WHOIS, website, and DKIM fields
   - You can paste a full email address — the local-part is stripped automatically
4. Select active assurances
5. Click **Generate ARF Report** (or press `Ctrl`/`Cmd` + `Enter`) → copy the output

### Bounce Report
1. Select previous unblock status
2. Upload the bounce list CSV (header row is automatically excluded from the count)
   - Domain is auto-detected from the CSV and Lookup runs immediately
3. Fill in remaining domain details
4. Select active assurances
5. Click **Generate Bounce Report** (or press `Ctrl`/`Cmd` + `Enter`) → copy the output

> **Tip:** All form fields are saved automatically — refreshing the page restores your last session.

---

## Security

- **Auth cookie** is HMAC-SHA256 signed using `AUTH_SECRET` — forgery without the secret is not feasible
- **Edge middleware** re-verifies the cookie signature on every request using Web Crypto API
- **`api/login.js`** uses Node.js `crypto.createHmac` (Node runtime); **`middleware.js`** uses `crypto.subtle` (Edge runtime) — both produce identical signatures
- **CORS** prevents API calls from unauthorized origins
- **Rate limiting** mitigates brute-force and scraping attempts
- **`AUTH_SECRET`** and **`APP_PASSWORD`** are never committed to the repo — always set via environment variables

---

## Changelog

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
