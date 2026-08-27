# Changelog

All notable changes to the ARF/Bounce Report Generator since `f43dc77`.

## [4.4.4] — 2026-08-26

### Fixed
- **ReferenceError in unsuspend tracking** — `beginUnsuspendTracking`, `renderUnsuspendVerdicts`, `setPanelJiraLink`, and the entire result-routing block were defined inside `init()`'s closure, but called from top-level functions (`unsuspendAccount`, `createTaeJira`). Clicking Unsuspend threw immediately after posting the extension message, so the in-panel results section never appeared on any panel. Moved the block to module top level.
- **USER STATUS badge selector** — `readUserStatus` now uses `.bu-field-label` / `.bu-field-value` / `.bu-badge` selectors matching the real Abuse Desk DOM. Includes case-insensitive generic fallback and API-based fallback via background `ad-user-status` handler (requires `api-abusedesk.ops.titan.host` host permission).
- **Legacy extension edge case** — extensions that never send verdict messages now hide the pending section instead of showing permanent `… <account>` chips.
- **Ghost section after Clear** — `_cancelUnsuspendTracking` hook now cleans up the in-panel results section when the user clicks Clear during a tracking session.

### Added
- **In-panel action results** — all four report panels (ARF, Bounce, IP Spike, SMTP Suspension) now show a JIRA link row and unsuspension verdict chips (confirmed / failed / pending) directly in the panel body, eliminating the need to rely on toasts.
- **Unsuspension verification via USER STATUS** — after saving the AD entry, the extension reloads the page and reads the DOM badge to confirm the user's status flipped to "Active", with an API fallback. Per-account verify markers in `chrome.storage.local` prevent automation from re-running on reload.
- **Background `ad-user-status` handler** — content-abusedesk.js delegates the API fallback to the background worker so the host permission can be used. Returns `{status, error}`.
- **`ad-tab-done` outcome-aware close delays** — Abuse Desk tabs now wait 3s on success, 10s on failure, and 12s on error (instead of a flat 5s) so the user can see the result before the tab closes.
- **`unsuspend-outcome` bridge** — background forwards each verdict to all report-page tabs via `forwardUnsuspendOutcome()`, enabling real-time chip updates.

### Changed
- **Toast ownership** — the extension no longer renders any toasts on the report page. All notifications (success/error/warning/info) are owned by the web app via `showToast()`. This eliminates the overlap issue between extension and app toasts.

### Bumped
- Extension manifest: **4.4.4**
- `MIN_VERSION`: **4.4.4**
- Footer chip: **v4.4.4**

---

## [4.4.3] — 2026-08-26

### Fixed
- **USER STATUS verification** — `readUserStatus` now reads the real Abuse Desk DOM (`div.bu-field > .bu-field-label "User Status" + .bu-field-value > span.bu-badge`) instead of an older hardcoded structure. Includes case-insensitive generic fallback and API fallback via background `ad-user-status` action (host permission added to `api-abusedesk.ops.titan.email`).

### Bumped
- Extension manifest: **4.4.3**

---

## [4.4.2] — 2026-08-26

### Added
- **USER STATUS badge verification** — after saving the AD entry, the extension reloads the page and reads the DOM badge to confirm the user's status flipped to "Active". Per-account verify markers (`unsuspendVerify: {[account]: ts}` with 90s TTL) prevent automation from re-running on the reload.
- **In-panel JIRA link rows** — ARF, Bounce, SMTP Suspension, and IP Spike panels now display the created JIRA issue key as a clickable link directly in the panel body (under "Actions Taken"), instead of relying on toasts alone.
- **In-panel unsuspension verdict chips** — all four panels show `✓ confirmed` / `✗ failed` / `… pending` chips per account, updating live as Abuse Desk verdicts arrive.

### Fixed
- **Ghost section after Clear** — clicking Clear during an in-flight unsuspension session now cleans up the results section (via `_cancelUnsuspendTracking` hook).
- **Legacy extension pending chips** — extensions that never send verdict messages now hide the pending section instead of showing permanent pending chips.

### Bumped
- Extension manifest: **4.4.2**
- `MIN_VERSION`: **4.4.2**
- Footer chip: **v4.4.2**

---

## [4.4.1] — 2026-08-26

### Added
- **Unsuspension confirmation relayed back to the report page** — Abuse Desk tab results (`outcome: confirmed | failed`) are forwarded via background → content-webapp → `REPORT_GENERATOR_UNSUSPEND_OUTCOME` → aggregated in `app.js`. Shows a single summary toast after all accounts resolve or a 45s timeout.

### Fixed
- **`forwardUnsuspendOutcome` no longer closes early** — was using `setTimeout` without keeping the event channel alive; now returns `true` and lets the background relay complete.

### Bumped
- Extension manifest: **4.4.1**
- `MIN_VERSION`: **4.4.1**
- Footer chip: **v4.4.1**

---

## [4.4.0] — 2026-08-26

### Added
- **Auto-close Abuse Desk tabs** — after unsuspension automation completes, tabs close automatically after 5s (via `ad-tab-done` background action with host permission).
- **Partner Panel `partner-panel-result` listener** — raw results now routed through background → `content-webapp.js` → `app.js`, eliminating cross-origin issues.
- **`store-report` / `get-report` background actions** — content scripts store the report payload and webapp retrieves it, solving extension ID mismatch issues.

### Fixed
- **Request ID location mismatch** — `partner-panel.js` now stores `requestId` on the background side (`runtime.onMessage.addListener`) instead of passing via `chrome.runtime.sendMessage`, so `content-webapp.js` can read it from `bgResult.data.requestId`.
- **Version-check injection on previews + localhost** — `version-check.js` had a fallthrough; added explicit `return;` in the unsupported-URL case.
- **Deduplication** — partner panel clicks are suppressed while a request is already in flight (`isPartnerPanelRunning` flag).
- **Sheet results** — `log-to-sheet` action now returns `{success, error}`; UI uses it instead of always showing success.

### Changed
- Extension version: **4.4.0**
- `MIN_VERSION`: **4.4.0**
- Footer chip: **v4.4.0**

---

## UI/UX Improvements (PR #56, merged to main)

Commits `6d84514` through `a23a365` — 12 commits covering 7 rounds of UI polish.

### Features
- **Banner auto-dismiss** — approval/error banners fade out after 6s.
- **Double-click guards** — buttons disable during processing.
- **Draft autosave** — form data persists to `localStorage` with restore on load.
- **Accessible tab switching** — keyboard navigation with arrow keys.
- **Region chips** — clickable region selection instead of dropdown.
- **Caret-safe inputs** — backspace on region fields no longer deletes the entire value.
- **Live error clearing** — validation errors disappear as soon as the user fixes the field.
- **Theme quality pass** — consistent `color-scheme`, dark mode fixes, depth/glow polish.

### Polish
- Accent borders, shadows, motion, micro-polish across all panels.
- Ambient glow brightness tuned (light +5%, dark +10%, violet +8%).
- Dark-mode pop pass — depth, glow language, texture.
- Round-7 refinements — consistency, ergonomics, robustness.
- Sentence-case labels (CSS `text-transform: uppercase` removed).

---

## Design System Refactor (`ui-refactor` branch)

Commits `3674d55` through `d21e35f` — premium SaaS design system + sapphire palette + unsuspension verification.

### Design System
- **Sapphire brand palette** — 5-shade scale (`--brand-100` through `--brand-900`), emerald removed in favor of blue.
- **Cool-gray neutrals** — green-cast neutrals removed; success uses independent green family.
- **Radii system** — 6–16px scale; flat solid buttons.
- **Shadow system** — `shadow-sm`, `shadow-md`, `shadow-lg`.
- **Segmented tab bar** — flush with panel width, hairline divider, ambient glow.
- **Background glows** — sapphire-tuned radial gradients (light: indigo + violet; dark: tri-tone).

### Features
- **DKIM auto-verified via Domain Lookup** — ARF/Bounce DKIM selects removed; all panels use the shared Domain Lookup result card. `dkimLookupError()` and `dkimFromLookup()` helpers.
- **Report generation blocked when DKIM is unverified** — "Not Set" or lookup-not-complete prevents submission.
- **Micro-interactions** — 140–180ms press/hover feedback, `prefers-reduced-motion` respected.

### Files Modified
- `scripts/app.js` — top-level result routing, unsuspension tracking, DKIM helpers, validation wiring.
- `scripts/ui.js` — toast with type icons, validation error helpers.
- `extension/manifest.json` — v4.4.4, `host_permissions` include `api-abusedesk.ops.titan.email`.
- `extension/background.js` — `ad-user-status` handler, `ad-tab-done` outcome-aware delays, `forwardUnsuspendOutcome`.
- `extension/content-abusedesk.js` — full verification chain: automation → save → reload → DOM read → API fallback.
- `extension/content-webapp.js` — NO toasts, `unsuspend-outcome` bridge, image count forwarding.
- `index.html` — all four `.action-results` sections, DKIM selects removed, versions bumped.
- `styles/main.css` — complete design system, sapphire palette, micro-interactions, verdict chips, action-results.
- `login.html` — sapphire tokens, `--color-on-primary` for dark submit button.
- `favicon.svg` — sapphire gradient badge.

### Bumped
- Extension manifest: **4.4.4**
- `MIN_VERSION`: **4.4.4**
- Footer chip: **v4.4.4**
