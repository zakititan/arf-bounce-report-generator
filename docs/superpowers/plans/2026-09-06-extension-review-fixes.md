# Extension Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unsuspension state request-scoped, validate result URLs and render them safely, and align account TLD validation across extension, app, and API.

**Architecture:** Use request-ID-derived storage keys for reason and verification state, preserving the existing 90-second freshness window and reload retry. Centralize URL and account rules in pure helpers used by tests and mirror the small rules in browser-only scripts. Build the sheet toast with DOM nodes instead of interpolating the returned URL into HTML.

**Tech Stack:** JavaScript ES modules, Chrome extension storage, Node test runner.

**Spec:** User-provided final review findings in this task.

## Global Constraints

- Preserve the existing 90-second TTL and verification retry behavior.
- Only expected HTTPS JIRA and Google Sheets hosts may be used as result links.
- Keep existing sequential extension flows working.
- Add regression tests before production changes.

---

### Task 1: Request-scoped unsuspension state

**Files:**
- Modify: `extension/rg-lib.js`
- Modify: `extension/content-webapp.js`
- Modify: `extension/background.js`
- Modify: `extension/content-abusedesk.js`
- Test: `tests/rg-lib.test.js`

- [ ] Write tests for distinct request storage keys and request-scoped reason freshness.
- [ ] Run the focused tests and confirm they fail because the helpers do not exist.
- [ ] Add key helpers and change all reason/verification reads and writes to use request ID plus account where applicable.
- [ ] Run focused and full tests.

### Task 2: Safe result URLs and DOM rendering

**Files:**
- Modify: `extension/rg-lib.js`
- Modify: `scripts/pure.js`
- Modify: `extension/content-webapp.js`
- Modify: `scripts/app.js`
- Modify: `scripts/ui.js`
- Test: `tests/rg-lib.test.js`
- Test: `tests/pureFunctions.test.js`

- [ ] Write tests rejecting `javascript:`, `data:`, wrong-host, and HTML-payload result URLs while accepting expected HTTPS links.
- [ ] Run focused tests and confirm the new assertions fail.
- [ ] Enforce JIRA and Google Sheets URL allowlists at extension result validation and content-webapp boundaries.
- [ ] Replace the sheet toast HTML interpolation with created text and anchor nodes.
- [ ] Run focused and full tests.

### Task 3: Consistent account validation

**Files:**
- Modify: `extension/rg-lib.js`
- Modify: `extension/content-webapp.js`
- Modify: `scripts/pure.js`
- Test: `tests/rg-lib.test.js`
- Test: `tests/pureFunctions.test.js`

- [ ] Add regression cases rejecting one-character TLDs and accepting valid punycode domains in extension/app validators.
- [ ] Run focused tests and confirm the new cases fail.
- [ ] Require a two-character final label while retaining ASCII punycode acceptance.
- [ ] Run the full suite and extension package verification.

### Task 4: Commit

- [ ] Inspect status and diff for only intended changes.
- [ ] Commit with `fix: close final extension review findings`.
