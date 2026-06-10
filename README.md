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
- **Screenshot attachments** — drag-and-drop image upload with inline previews in the generated report
- **One-click copy** — copies the formatted report text to clipboard
- **Dark / Light theme** — respects system preference with a manual toggle
- **Login gate** — password-protected access via `login.html` + Vercel Edge middleware with HMAC-signed cookies
- **CORS protection** — all API endpoints restricted to `APP_URL` origin
- **IP rate limiting** — 20 requests/min per IP on all API endpoints
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
2. Upload screenshot(s) of the email content
3. Enter the sender domain and click **Lookup** to auto-fill WHOIS, website, and DKIM fields
4. Select active assurances
5. Click **Generate ARF Report** → copy the output

### Bounce Report
1. Select previous unblock status
2. Upload the bounce list CSV (header row is automatically excluded from the count)
3. Fill in domain details and click **Lookup**
4. Select active assurances
5. Click **Generate Bounce Report** → copy the output

---

## Security

- **Auth cookie** is HMAC-SHA256 signed using `AUTH_SECRET` — forgery without the secret is not feasible
- **Edge middleware** re-verifies the cookie signature on every request using Web Crypto API
- **`api/login.js`** uses Node.js `crypto.createHmac` (Node runtime); **`middleware.js`** uses `crypto.subtle` (Edge runtime) — both produce identical signatures
- **CORS** prevents API calls from unauthorized origins
- **Rate limiting** mitigates brute-force and scraping attempts
- **`AUTH_SECRET`** and **`APP_PASSWORD`** are never committed to the repo — always set via environment variables

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks, no build step)
- **Backend:** Vercel Serverless Functions (Node.js 18+)
- **Auth:** Vercel Edge Middleware with HMAC-SHA256 signed session cookie
- **Fonts:** Inter + DM Mono via Google Fonts
- **Hosting:** Vercel
- **Analytics:** Vercel Analytics + Speed Insights
