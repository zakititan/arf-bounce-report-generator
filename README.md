# ARF & Bounce Report Generator

A lightweight, zero-dependency internal tool for generating structured ARF (Abuse Reporting Format) complaint reports and email bounce unblock reports. Built as a single-page app and deployed on Vercel.

---

## Features

### Report Generation
- **ARF Report** — captures complaint count, email content type, screenshots, and assurances
- **Bounce Report** — handles CSV bounce list upload, bounce count, domain checks, and assurances
- **Inline screenshots** — attached images are rendered directly inside the output section with divider labels and numbered filenames; included as labelled filenames in the clipboard copy
- **Assurance screenshots** — separate screenshot upload zones for ARF and Bounce assurance evidence, rendered inline in the output alongside email screenshots
- **Paste screenshots on hover** — hover over any upload zone and press `Ctrl+V` to paste clipboard images directly into that zone; no click-to-focus required
- **One-click copy** — copies the full formatted report (including screenshot labels) to clipboard with a "Copied ✓" visual confirmation
- **Rich clipboard with images** — copies both `text/plain` and `text/html` to the clipboard; the HTML version uses monospace font (`DM Mono`) so pasting into email clients, Word, or Google Docs renders the report in monospace; when screenshots are attached, embedded `<img>` tags are included
- **Report type pill + timestamp** — each generated report shows a coloured report type badge (ARF/Bounce/SMTP) and a "Generated:" timestamp
- **Keyboard shortcut** — `Ctrl`/`Cmd` + `Enter` generates the report for whichever panel is currently active
- **Confirm before clear** — clearing any panel requires confirmation to prevent accidental data loss

### Domain Lookup
- **Auto WHOIS lookup** — fetches domain creation date and age via RDAP (Registration Data Access Protocol); falls back to [whoisjson.com](https://whoisjson.com) if RDAP fails
- **Website Check** — classifies the domain as *Valid Website* or *No website* via a serverless function; supports SPA shell detection for JS-heavy sites
- **DKIM Check** — detects Titan and Neo DKIM selectors (`titan`, `titan1`–`titan9`, `neo`, `neo1`–`neo9`) via DNS lookup; returns `"Set"` when any selector matches and `"Not Set"` when none do
- **Lookup debounce** — 1-second debounce prevents API spam from rapid button clicks or CSV auto-triggers
- **Stale cache invalidation** — editing the domain input immediately clears the cached WHOIS result and hides the result card
- **Per-panel generate gating** — the Generate button is disabled only while *that panel's own* lookup is in-flight; the other panel remains unaffected
- **Progress stepper** — numbered steps (1/2/3) with pulse animation, checkmark on completion, and shine effect on connectors
- **Domain age color coding** — age display is colour-coded: red for <30 days, amber for 30–180 days, green for 180+ days
- **Collapsible result card** — domain lookup results show a summary line by default; click to expand/collapse details
- **Skeleton shimmer** — pulsing placeholder bars replace "checking…" text while website/DKIM results load
- **Data source indicator** — domain lookup results show whether the age data was fetched from RDAP or WhoisJSON (fallback)

### CSV (Bounce Panel)
- **Drag-and-drop or file picker** upload of `.csv` bounce lists
- **Automatic row count** with a `< 40` / `≥ 40` threshold badge
- **Auto-detect domain from CSV** — domain is read from the 2nd column (index 1) of the first data row, falling back to the 3rd column (index 2); lookup fires automatically
- **Account auto-fill** — the Account field is pre-filled with the raw column 2 value (email or domain) if all rows share the same column 2 value; otherwise falls back to the sanitised domain
- Header row is always excluded from the bounce count

### UX & Polish
- **Email → domain sanitisation** — pasting or typing a full email address (`user@example.com`) in the domain field automatically strips the local-part to `example.com`; also strips `http(s)://`, trailing paths, and ports
- **Account field sanitisation** — the Account field sanitises pasted input: domain-like values get HTML/protocol stripping and control char removal; email addresses (containing `@`) pass through untouched
- **Auto-lookup on paste** — pasting a domain or email into either panel's domain field automatically fires the WHOIS/Website/DKIM lookup without needing to click the Lookup button
- **Dark / Light theme** — respects system preference with a manual toggle; preference is persisted to `localStorage` with a smooth 250ms crossfade transition
- **Tabbed panel navigation** — all four report panels (ARF, Bounce, IP Spike, SMTP Suspension) are wrapped in a single panel container with a tab bar at the top; only the active panel is visible; selected tab persists across page refreshes via `localStorage`
- **Extension download button** — a button in the top-right header opens a modal with step-by-step install instructions and a direct download link for the browser extension; accessible (Escape to close, focus return, keyboard navigation); label hidden on mobile
- **Required field validation** — all required fields are highlighted with inline error messages before generation is allowed
- **Error resilience** — generate functions are wrapped in `try/catch` so unexpected errors surface as a user-facing toast instead of silently failing
- **10-screenshot cap** — excess files are skipped with a descriptive toast
- **Toast type differentiation** — toasts carry a `data-type` attribute (success, error, warning, info) for coloured styling
- **Accessible assurance buttons** — assurance toggle buttons use `aria-pressed` to reflect active state for screen readers
- **Decorative SVG hiding** — all decorative icons carry `aria-hidden="true"` to prevent screen reader noise
- **Required field markup** — form fields include `aria-required="true"` for assistive technology
- **XSS-safe validation** — validation error messages use `textContent` instead of `innerHTML` to prevent HTML injection
- **Clipboard API guard** — shows a warning toast if `navigator.clipboard` is unavailable (non-HTTPS or insecure context)
- **Combined age calculation** — `parseAgeToDays` accumulates all units (years + months + days) instead of returning only the first non-null match
- **Print stylesheet** — hides UI chrome (topbar, buttons, upload zones, stepper) when printing, showing only the output areas
- **Assurance button subgroups** — assurance buttons are grouped into Email Hygiene and Technical sections with labelled headers
- **Stepper reset on clear** — clicking Clear resets the stepper to step 1
- **Reduced motion support** — respects `prefers-reduced-motion: reduce` by disabling all animations
- **Sticky generate button** — the generate button row sticks to the bottom of the panel on scroll with a frosted-glass backdrop blur
- **Mobile layout** — full-width lookup buttons and vertical stepper on narrow screens
- **Vercel Analytics & Speed Insights** — page view tracking and Core Web Vitals monitoring

### JIRA Integration
- **Create TAE JIRA** — a "Create TAE JIRA" button appears in the bottom action row of ARF, Bounce, and SMTP Suspension output sections; creates the JIRA only (no status change, no Abuse Desk)
- **Create TAE JIRA and Unsuspend** — a second button that creates the JIRA (listing all accounts if multiple), transitions it to **Done** (transition ID `71`), adds a comment "Unsuspended", then opens one Abuse Desk tab per account
- **REST API creation** — creates JIRA tickets directly via `POST /rest/api/2/issue` using the browser's authenticated session cookies; no API key required
- **Image attachments** — screenshot images are decoded from base64 and uploaded as individual attachments via JIRA's attachment API (`POST /rest/api/2/issue/{key}/attachments`)
- **Prefilled fields** — Project (TAE, `pid=12900`), Issue Type (Task, `id=10902`), Priority (P3, `id=10000`), Summary, Description, Labels, and Zendesk link (`customfield_12211`) are all set automatically
- **Clean JIRA/sheet output** — report type headers (e.g. #ARF, #Bounce) and screenshot filenames are excluded from the JIRA description and Google Sheet log; visual images still render inline in the output
- **Dynamic labels** — ARF reports get the `ARF_unsuspension` label; Bounce reports get `Bounce_unsuspension`; SMTP Suspension reports get `SMTP_unsuspension`
- **Dynamic titles** — ARF: "ARF unsuspension request"; Bounce: "Bounce unsuspension request"; SMTP: "SMTP Compromised unsuspension request"
- **Zendesk ticket link (required)** — a "Zendesk Ticket Link" input field appears below Account in both panels; the URL is passed as `customfield_12211` in the JIRA payload; report generation is blocked if empty
- **Auto-transition to Done** — the "Unsuspend" flow transitions the JIRA to Done status via `POST /rest/api/2/issue/{key}/transitions` with ID `71`, then adds a "Unsuspended" comment via `POST /rest/api/2/issue/{key}/comment`
- **Fallback to paste** — if the REST API call fails (auth expired, network error), the report is stored in `chrome.storage.local` and the user is redirected to JIRA's create page for manual paste
- **Clickable JIRA link** — on success, a toast displays the created JIRA issue key as a clickable link to the ticket
- **Safety gate** — the button shows a warning if no report has been generated yet
- **Browser extension (optional)** — a Chrome extension (`extension/`) handles JIRA creation and auto-pasting
  - The web app sends report HTML (including base64-embedded screenshot images) via `window.postMessage`
  - The content script forwards the message to the background service worker, which creates the JIRA ticket via REST API
  - On JIRA, the extension extracts images from the HTML first (via DOMParser), then pastes text-only into the Visual editor, followed by pasting each image separately as a `File` item in `clipboardData.items`
  - 500ms delay between image pastes for TinyMCE processing
  - Fallback chain: paste → execCommand → textarea
  - Supports JIRA Server v7.13+ (Atlassian JEP editor); falls back gracefully if the visual editor isn't found
  - Install by [downloading the extension zip](https://github.com/zakititan/arf-bounce-report-generator/raw/main/extension/releases/extension.zip), unzipping, and loading the folder as an unpacked extension in `chrome://extensions` (Developer mode)
  - To repackage after changes: `npm run pack-extension`
  - **Version check** — the web app auto-detects the extension via a ping/pong handshake (`REPORT_GENERATOR_PING` / `REPORT_GENERATOR_PONG`); a sticky banner appears at the top of the page:
    - **Green banner** — extension detected and up to date (`Extension vX.X.X detected.`)
    - **Yellow banner** — extension outdated, with download link for the latest version
    - **Red banner** — extension not installed or is outdated (pre-v4.3), with install link
    - Dismiss persists per `MIN_VERSION` in `localStorage`; reappears when min version is bumped

### Log to Sheet (Google Sheets Integration)
- **Log to Sheet button** — a "Log to Sheet" button appears in the bottom action row of ARF, Bounce, and SMTP Suspension output sections, next to the JIRA buttons; disabled until a report is generated
- **Google Apps Script** — writes report data to a Google Sheet via a Google Apps Script web app (`fetch()` POST); the Apps Script has the spreadsheet ID embedded and appends rows directly; no DOM automation required
- **Content-Type: application/json** — the extension sends JSON with `Content-Type` header; uses `mode: 'no-cors'` to avoid CORS restrictions on Google Apps Script origins
- **Clean output** — report type headers (e.g. `#ARF`, `#Bounce`, `#SMTP Suspension`) and screenshot filenames are stripped from the reason field before logging to the sheet
- **Column layout** — writes to columns B–G (column A is left empty): B = Date, C = ZD Ticket ID, D = JIRA Link, E = Domain/Email, F = Unsuspension Type, G = Reason
- **JIRA link from unsuspend flow** — the JIRA link in the sheet is the one created during "Create TAE JIRA and Unsuspend"; stored in `chrome.storage.local` as `lastJiraUrl` for Log to Sheet to read
- **Sheet config** — the Apps Script URL is fetched from `/api/sheet-config` (reads `APPS_SCRIPT_URL` env var)

### Unsuspend (Abuse Desk Integration)
- **"Create TAE JIRA and Unsuspend" button** — creates JIRA → transitions to Done → adds "Unsuspended" comment → opens Abuse Desk
- **Multi-account unsuspend** — if "Other Blocked Email in Domain?" is set to Yes, the blocked accounts from the "Blocked Email Account(s)" field are also unsuspended; one JIRA is created listing all accounts, and one Abuse Desk tab is opened per account
- **Abuse Desk automation** — the extension's content script on `abusedesk.ops.titan.email` automatically:
  1. Clicks the **Unblock** button
  2. Pastes the JIRA URL as the reason into the textarea
  3. Clicks **Save reason and proceed**
- **Account from URL parameter** — each Abuse Desk tab reads its account from the `?entity=` URL parameter, eliminating storage race conditions when multiple tabs open simultaneously
- **Region-aware URL** — Abuse Desk URL includes the correct `region` parameter (`us-east-1` for NA, `eu-central-1` for EU) based on MX-based region detection
- **Fallback toast** — shows success/failure toast notifications at each step for user feedback

### IP Spike & SMTP Suspension Panels
- **Dedicated panels** — IP Spike and SMTP Suspension panels displayed alongside ARF and Bounce; responsive layout: 1 column (<900px), 2 columns (900–1399px), 3 columns (1400–1799px), 4 columns (≥1800px)
- **Panel order** — ARF → Bounce → IP Spike → SMTP Suspension
- **Account field** — enter the account email/domain; domain lookup auto-fills from the account input (same as ARF/Bounce)
- **Domain Lookup** — same WHOIS/Website/DKIM widget as ARF and Bounce panels
- **Partner Panel link** — "Check on Partner Panel" link opens `admin.titan.email` for manual lookups
- **Partner Panel automation** — the extension's content script on `admin.titan.email` automatically:
  1. Enters the account in the search field
  2. Clicks **Get Info**
  3. Clicks **View** on the Active order
  4. Clicks **View Account History**
  5. Reads the Action History to detect suspension date and password reset events
  6. Returns results to the web app
- **Password changed detection** — automatically determines if a password reset or password change occurred after the most recent suspension by comparing event positions in the Action History (newest-first ordering); matches both "Password reset" and "Password changed" actions
- **Suspension date & password changed date** — displays the most recent suspension date and last password reset date from the partner panel; shows N/A if not found
- **Auto-check button** — click to trigger the partner panel automation; results auto-fill the "Password changed after suspension?" dropdown
- **Password changed after suspension** (IP Spike) — required dropdown field; auto-check verifies via partner panel; manual selection also supported
- **Unsuspend via AD** — opens Abuse Desk tabs directly (no JIRA created); reason is hardcoded to "Password Changed"

#### SMTP Suspension
- **Account & Zendesk link** — required fields for the account and Zendesk ticket link
- **Domain auto-fill** — typing or pasting in the Account field auto-populates the Domain Lookup input and triggers lookup (same as ARF/Bounce)
- **Domain Lookup** — same WHOIS/Website/DKIM widget as ARF and Bounce panels; website and DKIM are informational only (not validated)
- **Laravel .env check** — automatically probes `/.env`, `/.env.backup`, `/.env.old`, `/api/.env` for exposed Laravel config files containing SMTP credentials; results shown as coloured badges (⚠ Exposed / ✓ Not Found)
- **XML-RPC check** — automatically probes `/xmlrpc.php` with an XML-RPC `system.listMethods` call to detect publicly accessible WordPress XML-RPC endpoints; results shown as coloured badges (⚠ Accessible / ✓ Not Found)
- **WordPress detection** — automatically probes for WordPress signatures (`wp-content`/`wp-includes` in page source, `/wp-login.php` login form, WP REST API at `/wp-json/wp/v2/users`); results shown as coloured badges (⚠ Detected / ✓ Not Found); always appears in report as `Hosted on WordPress: Yes / No / Not Checked`
- **Password changed after suspension** (SMTP Suspension) — required dropdown field; auto-check verifies via partner panel and auto-selects the "Password changed" assurance when confirmed
- **Assurances** (required) — single-group assurance buttons: Virus scan shared, Fixed SMTP issues, + Other (custom text); "Password changed" is auto-selected based on partner panel check (not a manual button)
- **Screenshot upload** — drag-and-drop or file picker for virus scan evidence images; renders inline in the output
- **Generate report** — produces a structured text report with domain age, DKIM status ("Set" or "Not Set" only), Laravel SMTP compromise status, XML-RPC vulnerability status, WordPress detection, and selected assurances
- **JIRA** — creates TAE JIRA with title "SMTP Compromised unsuspension request" and `SMTP_unsuspension` label
- **Unsuspend** — creates JIRA → transitions to Done → opens Abuse Desk (uses ZD link as reason)
- **Log to Sheet** — logs the report to the tracking Google Sheet (type: SMTP)
- **Sticky generate + clear** — generate button sticks to the bottom of the panel; Clear button sits below it (same as ARF/Bounce)

### Mailboards Integration
- **Check on Mailboards** — a "Check on Mailboards" link sits below the Account field in both ARF and Bounce panels, linking to [mailboards.ops.titan.email](https://mailboards.ops.titan.email)
- **Smart parameter selection** — if the Account field contains an email address (`@` present), the URL uses `?email=`; otherwise it uses `?domain=`; falls back to bare `?env=prod` when the Account field is empty
- **Dynamic href updates** — the link URL updates in real-time as the Account field is typed or pasted into; no report generation required
- **MX-based region detection** — automatically detects account region (NA/EU) via DNS MX lookup; EU accounts use `env=euprod` instead of `env=prod`

### Abuse Desk Quick Link
- **Check ARF count** — a "Check on AD" button sits in a 50/50 split row alongside the ARF Complaints field, linking to the Abuse Desk history page (`abusedesk.ops.titan.email/history.html`) with the Account name as the `entity` parameter
- **Dynamic href** — the link URL updates in real-time as the Account field is typed or pasted into
- **MX-based region detection** — EU accounts (MX `mx0101.titan.email`) use `region=eu-central-1`; NA accounts (MX `mx1.titan.email`) use `region=us-east-1`

### User Agent Quick Link (Bounce Panel)
- **Check User Agent** — a "Check User Agent" button sits below "Check on Mailboards" in the Bounce panel, linking to [mailboards.ops.titan.email/mail_analytics](https://mailboards.ops.titan.email/mail_analytics) with `sender` set to the Account value and `from_date`/`to_date` extracted from the 1st column of the uploaded CSV
- **Date extraction** — `from_date` is taken from the last data row's 1st column; `to_date` is taken from the first data row's 1st column; timestamps are truncated to `YYYY-MM-DD`
- **Dynamic href** — the link URL updates when the Account field changes or a CSV is uploaded/cleared
- **MX-based region detection** — EU accounts use `env=euprod` instead of `env=prod`

### MX Region Detection (NA/EU)
- **Automatic region detection** — when a domain lookup is triggered, an MX record query runs in parallel via Google DNS-over-HTTPS
- **MX-to-region mapping** — `mx1.titan.email` → NA (default); `mx0101.titan.email` → EU
- **Dynamic link updates** — AD link uses `region=eu-central-1` for EU; Mailboards and User Agent links use `env=euprod` for EU
- **Graceful fallback** — defaults to NA (`region=us-east-1`, `env=prod`) if MX lookup fails or returns an unknown MX record
- **Custom event architecture** — region detection dispatches a `regionchange` event on the account input to re-trigger link updaters without causing infinite loops

### Testing
- **307 unit tests across 14 files** — covers `sanitiseDomain` (39 edge cases), `checkRateLimit`/`classifyFetchError`/token helpers, website-check helpers, `withMiddleware` CORS/rate-limit middleware, `safeEqual` (10 cases), `createCache` (8 cases including TTL expiry and pruning), `getClientIp` (6 cases), `rateLimitInMemory` (6 cases), pure functions `escapeHtml`/`parseCsvRow`/`sanitiseDomainInput`/`sanitiseAccountInput`/`describeReason`/`parseAgeToDays` (33 cases), website-check-helpers (10 cases), RDAP response parsing (12 cases), DKIM lookup and config (18 cases), API fetch wrappers (15 cases), MX region detection (11 cases)
- **Config integrity checks** — all keyword/pattern arrays are verified at test time for empty strings and lowercase consistency
- **Pure function extraction** — `escapeHtml`, `parseCsvRow`, `sanitiseDomainInput`, `sanitiseAccountInput` extracted to `scripts/pure.js` for testability; `app.js` re-exports from there

### Security
- **Login gate** — password-protected access via `login.html` + Vercel Edge middleware with HMAC-SHA256 signed cookies
- **No default password** — `APP_PASSWORD` environment variable must be set; no fallback `'changeme'` default; trailing whitespace is trimmed automatically
- **Constant-time password comparison** — login handler uses an XOR loop (`safeEqual()`) to prevent timing attacks
- **Login rate limiting** — the `/api/login` endpoint uses the shared rate-limit store to prevent brute-force attacks
- **CORS** — all API endpoints restrict `Origin` to `APP_ORIGIN` env var; `Vary: Origin` header is set correctly; no wildcard fallback when `APP_ORIGIN` is empty
- **Rate limiting** — max 20 requests/min per IP on all API endpoints; in-memory per-instance store with auto-pruning above 10,000 entries
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
- **Extension host permissions** — Chrome extension declares `host_permissions` for `https://jira.directi.com/*` and `https://admin.titan.email/*` to enable authenticated REST API calls and Partner Panel automation using browser session cookies; Google Apps Script logging uses `mode: 'no-cors'` so no `docs.google.com` permission is needed

### Code Quality & Performance
- **No theme flash** — inline `<script>` in `<head>` sets dark theme before first paint, preventing flash on dark-mode systems
- **Regex constants** — frequently used regexes (`LOCAL_TLD_RE`, `HTML_TAG_RE`, `WHITESPACE_RE`) are module-level constants, not recreated per call
- **Drag event caching** — `getElementById` results are cached in a `Map` instead of queried on every ~60Hz drag event
- **Shared utilities** — `safeEqual()`, `getClientIp()`, `escapeHtml()` extracted into reusable helpers; `renderReportOutput()` and `clearPanel()` deduplicate generate/clear logic across ARF and Bounce
- **Button CSS consolidation** — `.btn-tool-link` base class shared by Mailboards, User Agent, and Abuse Desk buttons; unique overrides kept minimal
- **Toast timer safety** — rapid `showToast()` calls clear the previous timer, preventing premature hide
- **Memory leak prevention** — screenshot data URLs are explicitly nulled before array clear to free base64 strings
- **Null guard coverage** — `toggleOtherBlockedField`, `toggleAssurance`, `toggleContactFormAssurance` all guard against missing DOM elements
- **Backend API caching** — generic `createCache(ttlMs)` utility with 15-minute TTL applied to WHOIS, Website Check, and DKIM Check endpoints; auto-prunes stale entries above 1000 entries
- **DKIM early termination** — queries 2 base selectors first (`titan`, `neo`); skips 18 indexed selectors if match found, reducing DNS queries by ~89% for common cases
- **`sanitiseDomain` memoization** — caches last 200 results to avoid redundant regex-heavy validation on repeated calls
- **`parseAgeToDays` extraction** — age parsing extracted from inline DOM logic into a pure function for direct unit testing (6 accumulation cases)
- **Pure function extraction** — `escapeHtml`, `parseCsvRow`, `sanitiseDomainInput` moved to `scripts/pure.js` (no DOM dependencies) so they can be imported and tested in Node.js
- **X-XSS-Protection header removed** — modern browsers ignore this header; it was never effective against DOM-based XSS
- **RDAP-first WHOIS** — domain lookups use the free IANA RDAP protocol (no API key, structured JSON) with WhoisJSON as fallback; supports 200+ TLDs via hardcoded map + IANA bootstrap for unmapped TLDs
- **Account field sanitisation** — `sanitiseAccountInput()` strips HTML tags, `javascript:` protocol, and control characters from pasted domain values while preserving email addresses (detected by `@`) for use with Mailboards and Abuse Desk links
- **Login error text reset** — `errorText.textContent` is cleared on page load to prevent stale error messages from persisting across refreshes
- **CSS optimization** — consolidated duplicate selectors, moved shared properties to base rules
- **Zero production dependencies** — removed Vercel KV; in-memory rate limiting only; `APP_ORIGIN` read at request time for CORS flexibility
- **DRY IP extraction** — `withMiddleware` delegates to `getClientIp()` instead of duplicating IP extraction logic
- **DNS trailing dot handling** — MX/DNS lookups strip the FQDN trailing dot (`mx0101.titan.email.` → `mx0101.titan.email`) before comparison

---

## Project Structure

```
├── index.html                      # Main app UI (ARF, Bounce, IP Spike, and SMTP Suspension panels)
├── login.html                      # Password login page
├── favicon.svg                     # App favicon
├── middleware.js                   # Vercel Edge middleware (auth gate + HMAC cookie verification)
├── vercel.json                     # Vercel config (clean URLs, security headers)
├── package.json                    # Node deps (used for local dev / tests)
├── .gitignore
├── api/
│   ├── _utils.js                   # Shared helpers: sanitiseDomain, createCache(ttlMs), checkRateLimit (in-memory Map), signToken, verifyToken, safeEqual, getClientIp, CORS headers, classifyFetchError
│   ├── config.js                   # Centralised API config (rate limits, DKIM selectors, website-check patterns, parked keywords, RDAP TLD map with 200+ entries)
│   ├── whois.js                    # WHOIS lookup serverless function (RDAP-first with WhoisJSON fallback, cached 15 min)
│   ├── website-check.js            # Website reachability & classification (SPA detection, parked/placeholder detection, redirect analysis; cached 15 min)
│   ├── dkim-check.js               # DNS DKIM selector check (cached 15 min, early termination)
│   ├── laravel-check.js            # Laravel .env exposure check — probes for exposed SMTP credentials (cached 15 min)
│   ├── xmlrpc-check.js             # XML-RPC SMTP vulnerability check — probes /xmlrpc.php for accessible endpoints (cached 15 min)
│   ├── wordpress-check.js          # WordPress detection — probes for wp-content, wp-login.php, WP REST API (cached 15 min)
│   ├── health.js                   # Health-check endpoint (probes WhoisJSON + Google DNS)
│   ├── login.js                    # Login handler — constant-time password check, rate limited, sets signed auth cookie
│   └── sheet-config.js             # Returns Google Sheet ID and Apps Script URL from env vars for Log to Sheet feature
├── scripts/
│   ├── app.js                      # Core app logic (ARF, Bounce, SMTP Suspension generate; IP Spike unsuspend; domain lookup; CSV; unified state; event delegation)
│   ├── pure.js                     # Pure functions (escapeHtml, parseCsvRow, sanitiseDomainInput, sanitiseAccountInput) — no DOM dependencies
│   ├── api.js                      # Frontend API helpers (fetchWhois, fetchWebsiteCheck, fetchDkimCheck, lookupMx, fetchLaravelCheck, fetchXmlrpcCheck, fetchWordPressCheck — throws on non-2xx)
│   └── ui.js                       # UI helpers (showToast with types, theme toggle with transition, stepper, age colors, validation display, drag-and-drop)
├── styles/
│   └── main.css                    # All styles (light/dark theme tokens, layout, stepper, skeleton shimmer, toast types, extension modal, responsive)
├── extension/                      # Chrome extension (Manifest V3) for JIRA integration, Abuse Desk automation, and Google Sheets logging
│   ├── manifest.json               # Extension config: v4.3, permissions, content scripts for webapp, JIRA, Abuse Desk, and Partner Panel
│   ├── background.js               # Service worker: create-jira, create-jira-and-done (JIRA + markDone + comment), log-to-sheet, partner-panel-lookup, store/get report
│   ├── content-webapp.js           # Content script on Report Generator: handles JIRA creation, Unsuspend (create + markDone + AD), partner panel lookup, and sheet logging
│   ├── content-jira.js             # Content script on JIRA: fallback paste strategy (text first, images one by one)
│   ├── content-abusedesk.js        # Content script on Abuse Desk: auto-clicks Unblock, pastes reason, clicks Save
│   ├── content-partner-panel.js    # Content script on admin.titan.email: automates account lookup, order view, account history, and password change detection
│   ├── releases/extension.zip      # Packaged extension for easy distribution
│   └── icons/                      # Extension icons (16/48/128px)
└── tests/
    ├── sanitiseDomain.test.js      # Unit tests for domain sanitisation logic (39 cases)
    ├── api-handlers.test.js        # Tests for checkRateLimit, classifyFetchError, signToken/verifyToken
    ├── website-check.test.js       # Tests for website classification helpers + config integrity
    ├── withMiddleware.test.js       # Tests for CORS, rate limiting, and method guard middleware
    ├── safeEqual.test.js           # Tests for constant-time string comparison (10 cases)
    ├── createCache.test.js         # Tests for generic TTL cache utility (8 cases)
    ├── getClientIp.test.js         # Tests for IP extraction from X-Forwarded-For (6 cases)
    ├── rateLimitInMemory.test.js   # Tests for in-memory rate limiter (6 cases)
    ├── pureFunctions.test.js       # Tests for pure functions: escapeHtml, parseCsvRow, sanitiseDomainInput, sanitiseAccountInput, describeReason, parseAgeToDays (33 cases)
    ├── website-check-helpers.test.js # Tests for website-check exported helpers (extractMetaRobots, hasNoindex, isImageOnlyPage, isSpaShell)
    ├── whois-rdap.test.js          # Tests for RDAP response parsing and TLD map coverage (12 cases)
    ├── dkim-check.test.js          # Tests for DKIM DNS lookup and config constants (18 cases)
    ├── api-fetch.test.js           # Tests for frontend API fetch wrappers and client-side cache (15 cases)
    └── lookupMx.test.js            # Tests for MX-based region detection (11 cases)
```

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/whois?domain=` | GET | Returns domain creation date, age, and `source` (`rdap` or `whoisjson`) |
| `/api/website-check?domain=` | GET | Returns `verdict`: Valid Website / No website + `reason` |
| `/api/dkim-check?domain=` | GET | Returns DKIM `status` and `selectors_found` array |
| `/api/laravel-check?domain=` | GET | Returns `vulnerable` (boolean) and `reason` for Laravel .env exposure |
| `/api/xmlrpc-check?domain=` | GET | Returns `vulnerable` (boolean) and `reason` for XML-RPC accessibility |
| `/api/wordpress-check?domain=` | GET | Returns `detected` (boolean) and `reason` for WordPress detection |
| `/api/login` | POST | Validates password and sets HMAC-signed auth cookie |
| `/api/health` | GET | Health-check — probes WhoisJSON and Google DNS, returns `{ status: "ok"|"degraded" }` |
| `/api/sheet-config` | GET | Returns `{ sheetId, appsScriptUrl }` from `GOOGLE_SHEET_ID` and `APPS_SCRIPT_URL` env vars |

All API endpoints enforce:
- **CORS** — `Origin` must match `APP_ORIGIN` env var (read at request time); `Vary: Origin` is set
- **Rate limiting** — max 20 requests/min per IP; in-memory per-instance store with auto-pruning above 10,000 entries

---

## Environment Variables

Set these in the **Vercel Dashboard → Settings → Environment Variables**:

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | ✅ | Password used to access the tool via `login.html` |
| `AUTH_SECRET` | ✅ | Random secret used to HMAC-sign the auth session cookie |
| `WHOISJSON_API_KEY` | ⭐ | API key for [whoisjson.com](https://whoisjson.com) WHOIS lookups (optional — used as fallback when RDAP fails) |
| `APP_ORIGIN` | ✅ | Your deployment URL (e.g. `https://your-app.vercel.app`) — used for CORS |
| `APPS_SCRIPT_URL` | ⭐ | Google Apps Script web app URL for Log to Sheet feature (optional — the Apps Script has the spreadsheet ID embedded) |

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
APP_ORIGIN=http://localhost:3000
WHOISJSON_API_KEY=your-api-key  # optional — RDAP is primary; WhoisJSON is fallback
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec  # optional — for Log to Sheet
```

> **Note:** Domain lookup, website check, and DKIM check will not work if you open `index.html` directly in a browser — they require the serverless API functions to be running via `vercel dev`.

---

## Usage

### ARF Report
1. Fill in complaint details
2. Upload screenshot(s) of the email content (max 10) via drag-and-drop or file picker
3. Enter the sender domain and click **Lookup** to auto-fill WHOIS, website, and DKIM fields
   - You can paste a full email address — the local-part is stripped automatically
   - The progress stepper (1 → 2 → 3) tracks WHOIS, Website, and DKIM completion
   - Domain age is colour-coded (red <30d, amber 30–180d, green 180d+)
4. Select active assurances (organised into Email Hygiene and Technical subgroups)
5. Click **Generate ARF Report** (or press `Ctrl`/`Cmd` + `Enter`) → screenshots appear inline
6. Click **Copy** to copy the full report to clipboard
7. Enter a Zendesk ticket link in the "Zendesk Ticket Link" field (required)
8. Click **Create TAE JIRA** → JIRA ticket is created via REST API
9. Or click **Create TAE JIRA and Unsuspend** → JIRA created + marked Done + "Unsuspended" comment + Abuse Desk opens
10. Click **Log to Sheet** to append the report to the tracking Google Sheet (uses the JIRA created in step 8 or 9)

### Bounce Report
1. Select previous unblock status
2. Upload the bounce list CSV (header row is automatically excluded from the count)
   - Domain is auto-detected from the 2nd or 3rd CSV column and Lookup runs immediately
   - A `< 40` / `>= 40` badge shows the row count threshold
3. Fill in remaining domain details (website and DKIM are auto-populated from the lookup)
4. If "Other Blocked Email in Domain?" is Yes, enter comma-separated blocked accounts in the "Blocked Email Account(s)" field (these will also be unsuspended)
5. Select active assurances
6. Click **Generate Bounce Report** (or press `Ctrl`/`Cmd` + `Enter`) → copy the output
7. Enter a Zendesk ticket link in the "Zendesk Ticket Link" field (required)
8. Click **Create TAE JIRA** → JIRA ticket is created via REST API
9. Or click **Create TAE JIRA and Unsuspend** → JIRA created (listing all accounts) + marked Done + Abuse Desk opens one tab per account
10. Click **Log to Sheet** to append the report to the tracking Google Sheet (uses the JIRA created in step 8 or 9)

### IP Spike Unsuspend
1. Enter the account email/domain in the Account field
2. Domain lookup auto-runs (same as ARF/Bounce)
3. Click **Auto-check** (or wait for the partner panel tab to open automatically) — the extension opens `admin.titan.email`, searches the account, views the active order, and reads the Account History
4. The "Password changed after suspension?" dropdown auto-fills based on the history analysis
5. Suspension Date and Last Password Changed dates appear in a results card below the dropdown
6. Click **Unsuspend via AD** — opens Abuse Desk tabs directly with reason "Password Changed" (no JIRA created)

### SMTP Suspension
1. Enter the account email/domain in the Account field — domain auto-fills and lookup runs automatically
2. Enter the Zendesk ticket link (required)
3. Review domain lookup results (website and DKIM are informational, not validated)
4. Laravel .env, XML-RPC, and WordPress checks run automatically alongside website/DKIM — results shown as coloured badges
5. Click **Auto-check** to verify password change via partner panel; "Password changed" assurance auto-selects if confirmed
6. Select additional assurances: Virus scan shared and/or Fixed SMTP issues (at least one required)
7. Upload virus scan evidence screenshots (optional)
8. Click **Generate SMTP Suspension Report** → report with domain age, DKIM, Laravel SMTP compromise, XML-RPC vulnerability, WordPress detection, and assurances appears
9. Click **Create TAE JIRA** → JIRA ticket created with title "SMTP Compromised unsuspension request"
10. Or click **Create TAE JIRA and Unsuspend** → JIRA created + marked Done + Abuse Desk opens
11. Click **Log to Sheet** to append the report to the tracking Google Sheet

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
- **Rate limiting** mitigates brute-force and scraping; in-memory per-instance store with auto-pruning to prevent memory leaks
- **CSP** includes `base-uri 'self'`, `form-action 'none'`, and `object-src 'none'` directives
- **HSTS** enforces HTTPS with `max-age=31536000; includeSubDomains; preload`
- **Middleware URL matching** uses exact path or subpath prefix to prevent `/api/login-staging` from bypassing auth
- **`AUTH_SECRET`** and **`APP_PASSWORD`** are never committed to the repo — always set via environment variables
- **Hostname validation** rejects IPv4/IPv6 addresses, localhost names, `.localhost`/`.local`/`.internal` TLDs (SSRF prevention), consecutive dots, hyphen-leading labels, and email local-parts
- **Extension host permissions** — declares `host_permissions` for `https://jira.directi.com/*` and `https://admin.titan.email/*` to enable authenticated REST API calls and Partner Panel automation using browser session cookies

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks, no build step)
- **Backend:** Vercel Serverless Functions (Node.js 18+)
- **Auth:** Vercel Edge Middleware with HMAC-SHA256 signed session cookie
- **Fonts:** Inter + DM Mono via Google Fonts
- **Hosting:** Vercel
- **Analytics:** Vercel Analytics + Speed Insights
