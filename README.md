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
- **Login gate** — simple password-protected access via `login.html` + Vercel middleware
- **Vercel Analytics & Speed Insights** — page view tracking and Core Web Vitals monitoring

---

## Project Structure

```
├── index.html        # Main app UI (ARF + Bounce panels)
├── login.html        # Password login page
├── middleware.js     # Vercel Edge middleware (auth gate)
├── vercel.json       # Vercel config (clean URLs, security headers)
└── api/
    ├── whois.js          # WHOIS lookup serverless function
    ├── website-check.js  # Website reachability & classification
    ├── dkim-check.js     # DNS DKIM selector check
    └── login.js          # Login API handler
```

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/whois?domain=` | GET | Returns domain creation date and age |
| `/api/website-check?domain=` | GET | Returns `verdict`: Legit / Fake / No website |
| `/api/dkim-check?domain=` | GET | Returns DKIM status and selectors found |
| `/api/login` | POST | Validates password and sets auth cookie |

---

## Deployment

This project is deployed on **Vercel** with no build step — it's served as static HTML with serverless API functions.

### Deploy your own

1. Fork or clone this repo
2. Import into [Vercel](https://vercel.com)
3. Set the following **Environment Variables** in the Vercel dashboard:

| Variable | Description |
|---|---|
| `APP_PASSWORD` | Password used to access the tool via `login.html` |
| `AUTH_SECRET` | Secret key used to sign the auth cookie in `middleware.js` |

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

> **Note:** Domain lookup, website check, and DKIM check will not work if you open `index.html` directly in a browser — they require the serverless API functions to be running.

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

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks)
- **Backend:** Vercel Serverless Functions (Node.js)
- **Auth:** Edge Middleware with signed cookie
- **Fonts:** Inter + DM Mono via Google Fonts
- **Hosting:** Vercel
