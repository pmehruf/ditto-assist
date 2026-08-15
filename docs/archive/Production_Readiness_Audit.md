*# Declaration Assistant WebApp — Final Production Readiness Audit

**Scope of this pass:** static, code-level audit of the full repository (Express/Node backend, React 19 + Vite frontend, Drizzle/Postgres schema, Google OAuth, CI pipeline). Every file in `src/`, `server.ts`, config files, and CI was read. There was no running instance, no live Postgres database, and no browser available in this environment — so this audit **cannot** independently confirm visual dark/light rendering, click-through UX, or cross-browser behavior. Those items are called out explicitly below as "requires live QA" rather than asserted as pass/fail. Everything else (auth, data flow, RBAC, error handling, dead code, business logic) is based on direct reading of the actual source, not inference.

---

## Executive Summary

**Overall production readiness score: 38 / 100**

The codebase is well-organized in places — the Google OAuth implementation, session signing, error boundaries, and code-splitting are genuinely solid engineering. But the audit surfaced a small number of **architectural-level** problems that undermine the app's core value proposition for a multi-user rollout, plus one **unauthenticated arbitrary file-write** endpoint. These are not cosmetic issues; they mean several flagship features (shared audit trail, announcements, flagged-issue triage, user directory sync) will not behave correctly the moment a second user or a second browser is involved.

## Release Decision

# ❌ NOT READY FOR PRODUCTION

---

## Critical Findings (🔴 must fix before launch)

1. **Role/tier data lives in client-editable `localStorage`, not the server** — any signed-in user can grant themselves Owner/Admin.
2. **The "Owner Passcode" gate is 100% client-side theater** (default `"1234"`, compared in browser JS, also stored in `localStorage`) — provides no real access control.
3. **The entire Postgres persistence layer (search history, change log, announcements, flagged issues) is built but never wired into any API route** — every one of these features actually runs on per-browser `localStorage`, so they cannot function as shared, multi-user records in production.
4. **`/api/match`, `/api/add-ped-mapping`, and `/api/ai-plan-workflow` have no authentication check at all** — reachable by anyone with the URL, bypassing every bit of frontend RBAC.
5. **`/api/add-ped-mapping` performs unauthenticated, unsanitized `fs.writeFileSync` string-splicing into `src/types.ts` and `src/constants/scriptDictionary.ts` on the live server** — a code-injection-shaped risk, and also functionally broken in production (see detail below).

## High Priority Findings (🟠)

- Session/tier bootstrap race: the client's cached user directory is only refreshed from the server when someone opens the "Profile Access" tab — so a newly-provisioned user's first login on a new device/browser can silently misclassify them.
- Hardcoded Owner special-case (`mehruf.p@joinditto.in`) bypasses the permissions/directory system entirely in `App.tsx`.
- No rate limiting or security headers (no `helmet`, no CSP, no `express-rate-limit`) on any route, including the two unauthenticated Gemini-backed endpoints — direct cost/DoS exposure.
- No global Express error-handling middleware — an uncaught exception outside the routes' own `try/catch` blocks falls through to Express's default handler.
- Gemini model IDs (`gemini-3.5-flash`, `gemini-3.1-flash-lite`) are unverified against the current API catalog; if invalid, every request burns the full 3×3 retry ladder (~9 calls) before silently degrading to a generic fallback answer with no visible error to the user.
- Five large root-level data files (`600_conditions_corrected_database.json`, `regex_blocks.json`, `dictionary_entries.json`, `categoryMap.json`, `all_plan_questions.json`) are not imported anywhere in `src/` — apparent dead data artifacts from an earlier generation phase.

## Medium Findings (🟡)

- Raw user PED (pre-existing disease) text is interpolated directly into the LLM prompt with no escaping — prompt-injection surface on a business-critical classification.
- Icon-only buttons and interactive controls significantly outnumber `aria-label`/`role` usage (35 occurrences across 9 files vs. a 3,300-line `App.tsx` with dozens of icon buttons) — likely accessibility gaps that need a screen-reader pass.
- No automated accessibility testing (axe/jest-axe) in CI.
- `console.log`/`console.error` used as the only server-side logging — fine for now, but nothing structured, no log levels, no redaction guarantee for medical-condition text in logs.
- No favicon, manifest.json, or robots.txt.

## Low Findings (🟢)

- Two stray `node_modules_ghost_*` / `node_modules_zz` directories (~47MB) sitting in the repo working tree (gitignored, harmless to deploys, but confusing clutter).
- A PPTX file and its Office lock file (`~$UI THEME CONSISTANCY COMPARISON.pptx`) committed at repo root.
- Root-level `.md`/`.json` working documents (`DEBUG_REPORT.md`, `clinical_and_technical_analysis.md`) could move into `/docs`.

---

## Detailed Findings

### 🔴 1. Client-side-only role/tier storage enables self-service privilege escalation

**Location:** `src/App.tsx` lines 285–306, 532–540, 763–799; `src/components/ProfileAccessManagement.tsx`

**Steps to reproduce:** Sign in with any valid `@joinditto.in` Google account (General tier). Open DevTools → Application → Local Storage → edit the `ditto_users_list` entry for your own email, changing `"tier": "General"` to `"tier": "Owner"`. Reload the page.

**Expected behavior:** Tier/role should be resolved exclusively from the server-authoritative directory (`data/users.json` via `/api/users`), which is what the underlying schema comment in `session.ts` explicitly promises ("Role/permission lookups... a separate, deliberately-not-cached check").

**Actual behavior:** `baseUserTier` and the initial post-login `existingUser` lookup (`App.tsx:773`) both read from the `usersList` React state, which is seeded with a hardcoded 3-user array and persisted via `usePersistentState` into `localStorage` (`ditto_users_list`). That state is only ever refreshed from the real server (`GET /api/users`) when the user happens to open the "Profile Access" page (`ProfileAccessManagement.tsx:77-102`), which most users never will, since it's Admin/Owner-only. Until then, the client trusts whatever is sitting in its own, user-writable `localStorage`.

**Root cause:** The Phase-4 migration comment in `session.ts` ("Tier still comes from the local usersList lookup for now") documents this as a known interim state, but it shipped as the production behavior.

**Recommended fix:** Fetch `/api/users` (or a scoped `/api/me` that returns only the caller's own record, resolved server-side from their verified session email) on every app load, before tier is computed — never trust a client-supplied or client-cached tier for authorization decisions. Any client-side tier value should be treated as a UI hint only; every privileged server route must re-derive tier from `data/users.json` (as `/api/users` already correctly does).

**Regression risk:** Medium — this touches the core session bootstrap most pages depend on.
**Confidence:** High (directly verified in source).

---

### 🔴 2. Owner Passcode is not a security control

**Location:** `src/App.tsx` lines 563–601, 3245–3329

**Steps to reproduce:** Trigger any Owner-gated action that calls `requestOwnerPasscode` (e.g., resolving a flagged issue, clearing activity). In DevTools console, read `localStorage.getItem("ditto_owner_passcode")` (defaults to the literal string `"1234"` if never changed), or simply type `1234` into the modal.

**Expected behavior:** A step-up confirmation for destructive/Owner-only actions should be verified server-side against the caller's actual session-derived tier, not a shared 4-digit code stored and checked entirely in the browser.

**Actual behavior:** `handleVerifyPasscode` (`App.tsx:597`) does `passcodeAttempt === ownerPasscode`, a pure client-side string comparison against a value also stored in `localStorage`. Anyone can read it, guess the default, or just call the success callback directly from DevTools.

**Root cause:** Passcode was clearly intended as a lightweight "are you sure" speed bump, not real authorization — but it is the *only* gate in front of several destructive actions (clear history, resolve/ignore flagged issues), since the server never enforces those actions at all (see Finding 3).

**Recommended fix:** Either remove it and rely purely on server-enforced tier checks (simpler, more honest), or make it a real second factor validated server-side. Do not ship a hardcoded default secret.

**Regression risk:** Low to change; the UI already isolates it into a single reusable modal (`requestOwnerPasscode`).
**Confidence:** High.

---

### 🔴 3. The production database layer exists but is completely disconnected from the API

**Location:** `src/server/db/schema.ts`, `src/server/db/repositories/*` (with real unit tests) vs. `server.ts` (zero references) vs. `src/App.tsx` (all state via `usePersistentState`/`localStorage`)

**Steps to reproduce:** `grep -r "createRepositories\|SearchHistoryRepository\|ChangeLogRepository\|AnnouncementsRepository\|FlaggedIssuesRepository" server.ts` — zero matches. Then check how "My Activity", "Audit", "Announcement Manager", and "Flagged Responses" actually get their data in `App.tsx`: `localStorage.getItem("ditto_ped_search_history")`, `"ditto_qa_announcements"`, `"ditto_change_logs"`, `"ditto_reported_issues"`.

**Expected behavior:** Per the schema's own doc comment, these four tables are supposed to be "the single source of truth" replacing the legacy localStorage keys, shared across every user and device.

**Actual behavior:** They are not. `search_history`, `change_logs`, `announcements`, and `flagged_issues` have complete Drizzle schemas, repository classes, and passing unit tests — but `server.ts` never imports or calls any of them, and there isn't a single `/api/search-history`, `/api/change-logs`, `/api/announcements`, or `/api/flagged-issues` route. Every one of these features currently reads and writes to the *browser's own* `localStorage`.

**Impact at "hundreds of users" scale:**
- An Admin publishing a QA announcement will only ever see it in their own browser; no other user's session will show it.
- Flagged-issue triage (Pending → Urgent/Resolved) only updates the triaging Owner's own browser; the advisor who flagged it, and every other Admin, will never see the resolution.
- The Audit Log / My Activity views are per-browser, so an Admin auditing "all searches" is really only auditing their own device's search history — the audit trail is not actually a trail.
- "Clear Activity" only clears one browser's cache, giving a false impression that history was purged company-wide.

**Root cause:** Phase 4 (per the code comments, "Production Infrastructure") appears to have shipped the data layer without the corresponding API wiring and frontend fetch calls — an incomplete migration, not a design choice.

**Recommended fix:** Before launch, either (a) finish the migration — add authenticated Express routes for all four repositories and swap the four `usePersistentState` calls for `fetch`-backed state (the same pattern already correctly used for the user directory in `ProfileAccessManagement.tsx`), or (b) if launch timeline doesn't allow it, clearly document to stakeholders that these four features are single-browser/demo-only in this release and gate expectations accordingly. Given the audit/compliance nature of this data (insurance disclosure mismatches), option (a) should be treated as launch-blocking, not deferred.

**Regression risk:** Medium-high — this is the single largest scope item in this report, but the DAL and tests are already done, so it's primarily route + fetch-call work, not new architecture.
**Confidence:** High (directly verified — this is an absence, not a guess).

---

### 🔴 4. Core API routes have no authentication

**Location:** `server.ts` — `/api/match` (line 53), `/api/add-ped-mapping` (line 263), `/api/ai-plan-workflow` (line 336)

**Steps to reproduce:** `curl -X POST https://<deployed-url>/api/match -H "Content-Type: application/json" -d '{"planName":"...","ped":"diabetes"}'` with no cookies at all.

**Expected behavior:** Given the app is restricted to `@joinditto.in` Workspace accounts and every other route (`/api/users`) correctly requires `requireAuth`, the core matching/AI endpoints should too.

**Actual behavior:** These three routes are mounted with no `requireAuth` middleware. `attachUser` runs globally and populates `req.user` if a valid cookie exists, but nothing in these three handlers checks it. Anyone who discovers the deployed URL — no login required — can invoke the paid Gemini-backed matching endpoint and the AI plan workflow, and can call `/api/add-ped-mapping` (see Finding 5).

**Root cause:** Inconsistent application of the `requireAuth` middleware that already exists and is proven to work on `/api/users`.

**Recommended fix:** Add `requireAuth` to all three routes (and any future route touching Gemini, the codebase-mutation endpoint, or user data).

**Regression risk:** Low — `requireAuth` already exists, tested, and used elsewhere; this is a one-line addition per route. Will require the frontend to already have a valid session before calling these, which it does in the current UI flow.
**Confidence:** High.

---

### 🔴 5. Unauthenticated endpoint writes directly to server source files

**Location:** `server.ts` lines 263–333 (`/api/add-ped-mapping`)

**Steps to reproduce:** With no authentication (see Finding 4), POST `{"ped": "some new condition", "category": "diabetes"}` to `/api/add-ped-mapping`.

**Expected behavior:** New PED-to-category mappings should be persisted through a reviewed, authenticated, validated path — ideally the database, not live source code.

**Actual behavior:** The handler does `fs.readFileSync`/`fs.writeFileSync` directly against `src/types.ts` and `src/constants/scriptDictionary.ts` on the running server's disk, splicing the caller-supplied `ped`/`category` strings into the file as a new JS object entry, anchored by string-matching a specific existing line (`"gerd": "digestive"`). Neither `ped` nor `category` is validated for character content: a value containing a `"` or a JS injection sequence (e.g. `x": (()=>{...})(), "y` ) would corrupt the source file's syntax or splice attacker-controlled code into a `.ts` file that the dev server (`tsx`) will re-evaluate on next reload.

**Also functionally broken in production:** in the deployed build, the running server is `dist/server.cjs`, an esbuild-bundled artifact produced at build time. Writing to `src/types.ts` at runtime has **no effect whatsoever** on the already-bundled, already-running server — so even for a legitimate Owner using this feature as intended, it silently does nothing useful in production while still being a security exposure in any environment where source is still being executed live (dev/staging).

**Recommended fix:** Remove this runtime source-mutation pattern entirely. New PED mappings belong in the database (there's already a schema and repository pattern to extend), behind `requireAuth` + an Owner/Admin tier check, with strict input validation (allow-list characters, length caps) — never direct filesystem writes to application source.

**Regression risk:** Low to remove/replace — this endpoint doesn't work in production anyway.
**Confidence:** High.

---

### 🟠 6. Hardcoded Owner bypass

**Location:** `src/App.tsx` lines 532–539

```
if (currentUser.email?.toLowerCase().trim() === "mehruf.p@joinditto.in") {
  baseUserTier = "Owner";
}
```

**Issue:** This bypasses the entire user-directory/tier system for one specific email, hardcoded in the client bundle (visible to anyone who reads the shipped JS). It's brittle (if that Workspace account is ever offboarded or the email changes, there may be zero recognized Owners) and inconsistent with the "server is authoritative" model used everywhere else. Combined with Finding 1, this hardcoded email is also just... a string in client JS, so it doesn't even function as a real access boundary — it's an example of exactly the anti-pattern that makes Finding 1 possible.

**Recommended fix:** Remove the special case. Seed the initial Owner via `data/users.json` on the server (already supported — that file already models an Owner tier) and delete the hardcoded fallback.
**Regression risk:** Low, provided `data/users.json` is seeded correctly before this ships.
**Confidence:** High.

---

### 🟠 7. No rate limiting or security headers

**Location:** `server.ts` (entire file), `package.json` dependencies

No `helmet`, no `express-rate-limit`, no CSP, no `X-Frame-Options`/`X-Content-Type-Options`. Combined with Finding 4 (no auth on the Gemini-backed routes), this is a direct cost-abuse and denial-of-service vector: an attacker can script unlimited calls to `/api/match` and `/api/ai-plan-workflow`, both of which call the paid Gemini API with retry loops (up to 3 models × 3 attempts = 9 upstream calls per request).

**Recommended fix:** Add `helmet` for baseline headers, and rate-limit (`express-rate-limit` or a Cloud Run/API-gateway-level limiter) on `/api/match`, `/api/ai-plan-workflow`, and ideally all `/api/*` routes.
**Confidence:** High (dependency list confirmed absent).

---

### 🟠 8. No global Express error-handling middleware

**Location:** `server.ts`

Every route wraps its own logic in `try/catch` (good discipline), but there is no `app.use((err, req, res, next) => ...)` catch-all. Any error thrown outside those blocks (e.g., in middleware, in a future route, or a synchronous throw before the try) falls through to Express's default error handler, which — depending on `NODE_ENV` — can leak stack traces to the client.

**Recommended fix:** Add a final error-handling middleware that logs the error and always returns a generic JSON error to the client, regardless of environment.
**Confidence:** High.

---

### 🟠 9. Session/tier bootstrap ordering bug

**Location:** `src/App.tsx` lines 763–799 vs. `ProfileAccessManagement.tsx` lines 77–102

Because `usersList` is only refreshed from `/api/users` when the Profile Access page mounts, a **newly added or newly re-tiered user's very first page load on a fresh browser** resolves their identity against a stale/local copy of the directory. If they're not found (e.g., a brand-new hire added by an Owner on a different machine), they get routed into the "first-time setup" flow even though they're already provisioned server-side — or worse, they get whatever stale tier was last cached locally. This is a genuine functional bug, not just an architecture preference.

**Recommended fix:** Same fix as Finding 1 — resolve tier from the server on every session check, not from a locally-cached array.
**Confidence:** High.

---

### 🟠 10. Unverified Gemini model identifiers

**Location:** `server.ts` line 124: `const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];`

I could not verify against a live API call whether `gemini-3.5-flash` / `gemini-3.1-flash-lite` are valid, generally-available model IDs (this environment has no Gemini credentials configured). If either name is wrong or retired, every request pays the full retry cost (up to 3 attempts × 600ms/1200ms backoff) for each bad model before moving to the next, adding multiple seconds of latency, and if *all three* fail, the user silently receives a generic "Match API Error Fallback" answer with no indication that anything went wrong upstream (`server.ts:241-259` returns `res.json(...)` with HTTP 200, not an error status).

**Recommended fix:** Confirm all three model IDs against the current Gemini API model list before launch. Separately, consider surfacing a distinct "AI classification degraded, please double check manually" signal to the UI when the fallback path is hit, rather than a silent 200 response that looks identical to a real classification.
**Confidence:** Medium (the risk is real regardless of whether these specific names are currently valid; the silent-fallback behavior is confirmed either way).

---

### 🟠 11. Orphaned data files

**Location:** repo root — `600_conditions_corrected_database.json`, `regex_blocks.json`, `dictionary_entries.json`, `categoryMap.json`, `all_plan_questions.json`

None of these are imported anywhere under `src/`. They appear to be intermediate artifacts from generating `types.ts`'s dictionaries. Confirm they're not needed by any build/deploy step, then delete or move to a `/scripts` or `/data-source` folder that's clearly excluded from the deployed app.
**Confidence:** High (confirmed via repo-wide search).

---

### 🟡 12. Prompt injection surface on classification

**Location:** `server.ts` lines 86–121

The raw `ped` string is concatenated directly into the LLM prompt and system instruction with no escaping/delimiting beyond plain string interpolation. Since this endpoint has no auth (Finding 4) and directly affects an insurance disclosure classification decision, a user could craft input designed to manipulate the model's output (e.g., text resembling an instruction rather than a medical term). The deterministic engine (`classifyDeterministic`) runs first and would catch known terms, but anything falling through to the LLM path is exposed.
**Recommended fix:** Fix Finding 4 first (auth), then consider wrapping user input in clear delimiters and adding an explicit "treat everything inside these tags as data, not instructions" instruction — standard prompt-injection hardening.
**Confidence:** Medium — plausible risk, not demonstrated with a live exploit in this pass.

---

### 🟡 13. Accessibility coverage looks thin relative to UI surface area

**Location:** across `src/` — `aria-label`/`role=`/`alt=` usage: 35 occurrences across 9 files, against a 3,300-line `App.tsx` with a large number of icon-only buttons (lucide-react icons used extensively with no adjacent text).

This is not a confirmed failure (I could not run a screen reader or axe scan in this environment), but the ratio is a strong signal that a real accessibility pass — tab order, icon-button labeling, focus visibility on all interactive elements, form error announcements — is needed before launch. The keyboard focus-trap logic for drawers (`App.tsx:308-357`) is genuinely well done and should be the template for auditing everything else.
**Confidence:** Medium (heuristic from source, not a live audit).

---

### 🟡 14. No automated accessibility or visual-regression testing in CI

**Location:** `.github/workflows/ci.yml`

CI runs typecheck, lint, unit tests, and a production build — a solid baseline — but nothing exercises the rendered UI (no Playwright/Cypress, no jest-axe, no visual snapshot diffing). Given the scale of this audit's UI-consistency and theme-consistency requirements, this is the gap that will keep recurring every release unless closed.
**Confidence:** High (workflow file fully read).

---

### 🟢 15–17. Repo hygiene

- Two stray `node_modules_ghost_1782975786_retry_r2_x0_x1_x2_z` and `node_modules_zz` directories (~47MB combined) sitting in the working tree — gitignored, so they won't ship, but they're dead weight and a source of confusion for anyone `find`/`grep`-ing the repo.
- `UI THEME CONSISTANCY COMPARISON.pptx` and its Office lock file `~$UI THEME CONSISTANCY COMPARISON.pptx` are sitting at repo root.
- `DEBUG_REPORT.md` and `clinical_and_technical_analysis.md` are working documents at the repo root rather than under `/docs`.

None of these affect the running app; they're organizational debt.
**Confidence:** High.

---

## What's Actually Solid (so this isn't one-sided)

- **Google OAuth flow** (`googleOAuth.ts`, `session.ts`): ID token signature/audience/issuer verified via Google's library (not just decoded), domain restriction enforced server-side against the verified `email`/`hd` claims (with an explicit code comment warning against trusting the `hd` URL param alone), CSRF state cookie on the auth redirect, HMAC-SHA256 signed session cookies with `timingSafeEqual` comparison, `httpOnly`/`sameSite=lax`/`secure`-in-prod cookies. This is meaningfully above-average auth hygiene.
- **`/api/users`** is the one route that does the client/server split correctly: fetches on mount, PUTs changes back, enforces tier server-side from `data/users.json` independent of any client claim, and refuses to let the last Owner be removed.
- **Error boundaries**: every lazily-loaded tab is individually wrapped (`App.tsx` + `ErrorBoundary.tsx`), so a render crash in one tab doesn't take down the whole app shell — a good resilience pattern, correctly implemented.
- **Code splitting**: tab-level `React.lazy` + manual Vite `manualChunks` for vendor libraries (react/motion/recharts/lucide split into separate cacheable chunks) — deliberate, documented performance work.
- **No `dangerouslySetInnerHTML` anywhere in `src/`** — confirmed via full-repo search. Combined with no direct HTML string injection points found, XSS surface from rendered content looks low.
- **CI pipeline** covers typecheck, lint, unit tests, and build on every push/PR — a real baseline, just missing UI-level testing (see Finding 14).
- Focus-trap/keyboard handling for drawers is thoughtfully implemented with Escape-to-close and focus restoration.

---

## Missing Production Requirements

- Server-side enforcement for search history, change logs, announcements, and flagged issues (Finding 3).
- Authentication on `/api/match`, `/api/add-ped-mapping`, `/api/ai-plan-workflow` (Finding 4).
- Rate limiting / abuse protection on all `/api/*` routes, especially Gemini-backed ones.
- Security headers (helmet/CSP).
- Global Express error-handling middleware.
- Favicon, `manifest.json`, `robots.txt`.
- A real, server-verified step-up check to replace the passcode modal.
- Confirmation that `GEMINI_API_KEY`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `APP_URL` are actually set in the production environment (all correctly `throw` if missing at call time, which is good — but there's no startup-time validation that fails fast before accepting traffic).
- Automated accessibility and end-to-end UI test coverage in CI.

## Technical Debt

**Must fix before launch:** Findings 1–5 (client-side RBAC, passcode theater, disconnected DB layer, unauthenticated routes, unauthenticated file-write endpoint).

**Can be deferred to a fast-follow release:** Findings 6–11 (hardcoded Owner bypass, rate limiting/headers, global error handler, bootstrap race, model ID verification, orphaned data files), and all 🟡/🟢 items, provided Findings 1–5 are resolved first — several of the deferred items become lower-stakes once the auth/RBAC foundation is fixed.

## Performance Summary

- **Largest risk:** unauthenticated, unrate-limited Gemini calls (Finding 4 + 7) are a cost/availability risk more than a latency risk — an attacker could drive real API spend.
- **Quick win:** the Gemini retry ladder (3 models × 3 attempts) is reasonable resilience engineering but should short-circuit faster on clearly non-transient errors (already partially done via the `isTransient` regex check — good instinct, worth double-checking the regex covers actual Gemini error message formats).
- **Positive:** vendor chunk splitting and per-tab lazy loading are already in place, which is the right architecture for initial load time at this app's size.
- Full performance verification (bundle size numbers, render profiling, actual network waterfall) requires a running instance and browser — not available in this pass.

## Security Summary

**Recommendation: block production launch until Findings 1–5 are resolved.** The combination of (a) client-editable role storage, (b) a fake passcode gate, and (c) unauthenticated endpoints — one of which writes to server source files — means the app's actual security boundary today is "did the attacker read this audit," not the RBAC system the UI presents to users. The OAuth/session layer underneath is solid and doesn't need rework; the gap is entirely in what happens *after* a legitimate `@joinditto.in` login.

## Accessibility Summary

No live screen-reader or axe scan was possible in this environment. Based on source review: focus-trapping in drawers is well implemented; aria-labeling coverage looks thin relative to the number of icon-only interactive controls across `App.tsx` and the page components. Recommend a dedicated accessibility pass (keyboard-only walkthrough + axe/jest-axe in CI) before launch, treating this audit's finding as a risk flag rather than a confirmed WCAG failure list.

## UI Consistency Summary

Not independently verifiable without a running browser in this pass. The codebase shows a consistent Tailwind + theme-prop (`theme === "dark"`) pattern used throughout every component reviewed, which is the right foundation for consistency — but a manual/visual pass across both themes and all breakpoints is still required to confirm actual rendering, per the Review Standards' instruction not to assume correctness from implementation alone.

## Production Checklist

| Area | Status |
|---|---|
| Functional QA (code-level) | 🟡 PARTIAL — core lookup flow present; several tabs' data layer is architecturally incomplete (Finding 3) |
| UI Review | ⚪ NOT VERIFIED — requires live browser pass |
| Theme Review | ⚪ NOT VERIFIED — requires live browser pass |
| Responsive Review | ⚪ NOT VERIFIED — requires live browser pass |
| Accessibility | 🟡 PARTIAL — good patterns present, coverage unconfirmed |
| Security | 🔴 FAIL — Findings 1, 2, 4, 5 |
| Performance | 🟡 PARTIAL — good architecture, unauthenticated cost exposure |
| Error Handling | 🟡 PARTIAL — good per-route try/catch, no global handler |
| Data Integrity | 🔴 FAIL — Finding 3 |
| RBAC | 🔴 FAIL — Findings 1, 2, 6 |
| Authentication | 🟢 PASS (OAuth/session itself) / 🔴 FAIL (routes not requiring it) |
| Production Build | 🟢 PASS — build/typecheck/lint/test all wired in CI |
| Browser Compatibility | ⚪ NOT VERIFIED |
| Regression Testing | 🟡 PARTIAL — good unit test coverage on engine logic; no UI regression tests |
| Deployment Readiness | 🔴 FAIL — missing favicon/manifest/robots.txt, no security headers, no rate limiting |

---

## Final Verdict

**Is the application production-ready?** No.

**What must be fixed before release:**
1. Move role/tier resolution to be server-authoritative on every load, not client-cached (Finding 1, 9).
2. Remove or properly re-implement the Owner Passcode as a real, server-verified check (Finding 2).
3. Wire the existing Postgres repositories into real, authenticated API routes and point the frontend at them for search history, change logs, announcements, and flagged issues (Finding 3) — or explicitly descope those four features to "not multi-user in this release" with stakeholder sign-off.
4. Add `requireAuth` to `/api/match`, `/api/add-ped-mapping`, `/api/ai-plan-workflow` (Finding 4).
5. Remove the runtime source-file-mutation pattern in `/api/add-ped-mapping` entirely (Finding 5).
6. Add rate limiting and baseline security headers (Finding 7).
7. Add a global Express error handler (Finding 8).

**What can safely wait until a future version:**
- Model ID verification and richer fallback signaling (Finding 10).
- Repo hygiene cleanup (orphaned data files, stray directories, misplaced docs).
- Automated accessibility/visual-regression tooling in CI (can be added incrementally as the accessibility pass itself happens).
- Favicon/manifest/robots.txt (cheap to add, not launch-blocking on their own, but should land in the same release as the security fixes).

The good news: none of the must-fix items require new architecture. The database layer, the auth middleware, and the passcode UI all already exist — this is a wiring and enforcement problem, not a redesign.
