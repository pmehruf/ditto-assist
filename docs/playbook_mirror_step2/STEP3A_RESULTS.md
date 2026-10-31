# Product Playbook Mirror — Step 3a Results: Dedicated Read-only Google Grant

**Status:** Done on staging (2026-10-29). Waiting for your review before the next checkpoint.
**Your condition:** "the Google Sheets write permission must be addressed explicitly before any sync implementation begins." **Met.** See §1.

## 1. Result: the mirror's Google grant is read-only

Verified read-only after you connected. The script asked Google's tokeninfo service about a fresh access token from the stored grant; it read token metadata only and made no Sheets call. Script: `_scratch_playbook_migration/scripts/step3a_verify.ts`.

| Item | Value |
|---|---|
| Account | mehruf.p@joinditto.in (connected by the same account, 2026-10-29 17:18:22 UTC) |
| Scopes stored | `openid`, `email`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/spreadsheets.readonly` |
| Scopes Google reports live | **identical** |
| Write scope `spreadsheets` | **absent** |
| Any Drive or Apps Script scope | **absent** |
| App's own check (`getVerifiedMirrorClient`, the only function the future sync may use) | **OK** |

So `include_granted_scopes: false` worked: Google issued a strictly read-only grant even though the same account has granted write access to this app elsewhere. Combined with the account being "View only" on the Playbook, the mirror's access is limited **twice**:
- by the permission itself (read-only);
- by the account's role on the file (viewer).

The **existing** Product Assist Playbook grant (`kb_playbook_connection`) is unchanged and still carries write scope. That is existing behaviour, out of scope, and recorded as a follow-up.

## 2. What was built (additive only)

| File | Change |
|---|---|
| `src/server/auth/googleOAuth.ts` | +68 lines: `getPlaybookMirrorAuthUrl` (read-only scope only, `include_granted_scopes: false`, `prompt: consent`), `exchangeCodeForPlaybookMirrorGrant` (same identity checks as the other grants) |
| `src/server/playbookMirror/mirrorGrant.ts` | New: allowed-scope list; `assertReadOnlyScopes`; `fetchTokenInfo` (token sent in a POST body, never in a URL); `getVerifiedMirrorClient`, which re-checks with Google on **every use** and refuses if the grant is broader than read-only, has gained scopes since connecting, or now belongs to another account |
| `src/server/playbookMirror/mirrorTokenCrypto.ts` | New: refresh token encrypted at rest (AES-256-GCM) with its own key salt |
| `src/server/db/repositories/playbookMirrorConnectionRepository.ts` + `index.ts` | New repository; 4 one-line registrations |
| `src/constants/featurePermissions.ts` | +1 entry `product_playbook_admin` ("Product Playbook Mirror (Admin)"), zone admin. Defaults: General None, Admin Editor, Platform Admin Editor, Developer Editor (D3) |
| `server.ts` | +118 lines, 0 changed. Three routes, each gated **server-side** by `requireFeatureAccess("product_playbook_admin", …)`: `GET /api/playbook-mirror/connect-google` (Editor), `GET /api/playbook-mirror/connection-status[?verify=1]` (Viewer), `DELETE /api/playbook-mirror/connection` (Editor). Plus one branch at the top of the shared Google callback that **only acts when the mirror's own cookie is present**. It re-checks access, asks Google for the real scopes, and stores the grant only if read-only. A refused grant is discarded, not revoked, because revoking would also cut the app's other Google grants for the same account. |
| Tests (new) | `mirrorGrant.test.ts` (14), `mirrorTokenCrypto.test.ts` (3), `playbookMirrorConnectionRepository.test.ts` (3), `playbookMirrorAuthUrl.test.ts` (4, including "existing Playbook connect URL is unchanged") |

**Not built:** sync, snapshot writing, routes that read the sheet, UI, publishing. No route reads or writes the Google Sheet.

## 3. Zero Regression Audit evidence

| Check | Result |
|---|---|
| Full test suite | **76 files passed, 1 skipped; 1,005 passed** (981 before + 24 new), 1 skipped. No test that passed before fails. |
| Type check | 0 errors |
| Lint (changed files) | 0 problems |
| Diffs to existing files | Additions only: `server.ts` +118/−0, `googleOAuth.ts` +68/−0, `featurePermissions.ts` additions only, `repositories/index.ts` +4/−0 |
| Staging before/after your connect | Schema, Product Assist Playbook facts, Playbook resource, **existing Playbook connection**, sheet text chunks and migrations: **all identical**. One expected difference: the Health/Term FAQ resources' `last_fetched_at` moved (17:15 UTC) when your sign-in opened the home page and the existing staleness refresh ran. Their content fingerprints and chunk counts are identical. That's existing staging behaviour, not this change. |
| Production | untouched |

**Mistake caught and fixed during the work:** my first edit to `featurePermissions.ts` renamed the existing `product_assist_quota` entry instead of adding a new one. I spotted it at once and reverted it before any test or run. The final diff is additions only (verified).

**Operational note:**
- The local dev server (this branch, staging database) was stopped and restarted once by the app during your first attempt, which is why the first connect didn't complete.
- It has now been **stopped**.
- The launcher is `_scratch_playbook_migration/scripts/run_local_staging.mjs` via `.claude/launch.json`; it refuses any database but staging.

## 4. Next checkpoint (needs your approval)

**Step 3b: fetch and store raw snapshots (staging only, nothing published).** In short:
- read the two tabs with the verified read-only client (used area + margin, plus a whole-tab scan of values and notes);
- store the raw response unchanged with its fingerprint;
- transform it into `playbook_cells` exactly (runs, links, notes, merges, hidden flags, lone CRs);
- record sync state.

No structure acceptance, no reconciliation verdict and no publishing yet. Those are Steps 4–5. Product Assist and the existing sync stay untouched.
