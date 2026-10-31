# Product Playbook Mirror — Step 6 Results: Admin Review Screen and Read API

**Status:** Built and checked on staging (2026-10-30). **Nothing published, no status confirmed, advisor access not enabled, nothing committed, production untouched.** Waiting for your approval before Step 7.

## 1. Your seven conditions

| # | Condition | How it is met | Evidence |
|---|---|---|---|
| 1 | Plan statuses stay explicitly unconfirmed until the product team reviews them | The confirm action exists (product team, Editor) but was **not used**. The screen shows an "Unconfirmed" badge on all 29. The read API ignores unconfirmed plans. | Staging: `statuses_confirmed = 0`; screen: "29 of 29 plan statuses are unconfirmed" |
| 2 | No inference of eligibility or category relationships from formatting, colours, headers or approximate matching | The read API locates cells only through the **accepted structure** (plan key → exact-header column; category key → rows recorded by the passed structure check). There is no search, no fuzzy matching, and no use of colour or formatting. Header-derived statuses remain suggestions only. | `readService.ts`; tests in `readService.test.ts` |
| 3 | Column A (QA guide) out of every advisor-facing response | The read API only reads accepted plan columns, and refuses any column before D (so a mapping to column A is rejected too). The admin grid shows column A, labelled "QA guide — never for advisors". | Tests: a plan mapped to column A is refused; no returned cell is in column A |
| 4 | Hidden rows/columns kept, and not advisor-visible by default | Hidden flags are stored and shown (marked HIDDEN) in the admin grid. The read API never returns a plan in a hidden column, nor a hidden row, even if a plan were confirmed and enabled. | Tests: hidden column S and hidden row content never returned |
| 5 | Verified snapshot stays unpublished until an authorised person publishes manually | Publishing is only a manual Editor action that needs the snapshot number typed again. The database refuses publishing anything not verified. **Not used on staging.** | Staging: `published = 0`; snapshot 2 still `verified` |
| 6 | Permissions enforced server-side | All 19 mirror routes require sign-in **and** a server check on `product_playbook_admin` as their first statement. Changing actions need Editor. The Google callback re-checks Editor before storing anything. | Route-by-route table (§3); automated access-review test; live check: all 19 routes return **401** without sign-in |
| 7 | Product Assist, existing knowledge tables, current Playbook sync, existing Google connection untouched | No code path touches them. Staging fingerprints identical apart from the routine FAQ timestamp refresh (§5). | §5; changed-file list (§2) |

## 2. Complete changed-file list (whole branch so far: Part A + Steps 2–6)

**Existing files modified:**

| File | Lines | What changed |
|---|---|---|
| `MASTER_CONSTITUTION.md` | +6 −0 | Part A folder rule |
| `server.ts` | +349 −0 | Mirror routes (19) + one callback branch that only acts on the mirror's own cookie; additions only |
| `src/App.tsx` | +21 −2 | Lazy import, sidebar entry and render block for the new admin page. The 2 changed lines **extend** existing lists (the tab type, and the Administration section's tab list) with `product_playbook_admin`. |
| `src/constants/featurePermissions.ts` | +16 −0 | New permission `product_playbook_admin` (Admin and above) |
| `src/server/auth/googleOAuth.ts` | +68 −0 | Read-only mirror grant functions |
| `src/server/db/repositories/index.ts` | +12 −0 | Register 3 new repositories |
| `src/server/db/schema.ts` | +211 −0 | Mirror tables (migration 0090) |
| `src/server/db/testUtils.ts` | +19 −0 | Test databases also get 0090's guards and seed rows |
| `drizzle/meta/_journal.json` | +7 −0 | Entry for 0090 |
| `drizzle-test-baseline/*` | regenerated | Project's own regeneration command. The old file `0000_wise_skin.sql` is replaced by `0000_clumsy_kat_farrell.sql` (random name by design): all 175 old statements identical, plus 20 mirror statements. |

**New files:**
- **Migration:** `drizzle/0090_playbook_mirror.sql` (applied to staging only in Step 2).
- **Admin screen:** `src/pages/PlaybookMirrorAdminPage.tsx`.
- **Server, `src/server/playbookMirror/`:** `config`, `a1`, `transform`, `sync`, `client`, `mirrorGrant`, `mirrorTokenCrypto`, `structure`, `structureService`, `reconcile`, `diff`, `verifyService`, `publishService`, `readService`, `adminService`.
- **Repositories, `src/server/db/repositories/`:** `playbookMirrorConnectionRepository`, `playbookMirrorSnapshotsRepository`, `playbookMirrorStructureRepository`.
- **Tests (17 files, synthetic data only):**
  - in `playbookMirror/`: `mirrorGrant`, `mirrorTokenCrypto`, `transform`, `sync`, `client`, `structure`, `structureService`, `reconcile`, `verifyService`, `publishService`, `readService`, `routeAccess`;
  - elsewhere: `src/server/auth/playbookMirrorAuthUrl.test.ts`, `src/server/db/playbookMirrorGuards.test.ts`, `src/server/db/repositories/playbookMirrorConnectionRepository.test.ts`;
  - plus the fixture `playbookMirror/__fixtures__/syntheticSheet.ts`.
- **Docs:** `docs/PRODUCT_PLAYBOOK_*.md` (3) and `docs/playbook_mirror_step2/*` (review, results, proposal SQL, rollback SQL, schema draft).
- **Local launcher:** `.claude/launch.json`, used to run this branch locally against staging; it refuses any other database.

Not part of the app: `_scratch_playbook_migration/` (experiments, scripts, evidence; not committed).

## 3. API access review

All routes require sign-in (`requireAuth`), and **the first statement of every handler** is a server-side `requireFeatureAccess(req, res, "product_playbook_admin", …)`. No route uses any advisor-facing permission.

| Method | Route | Level |
|---|---|---|
| GET | `/api/playbook-mirror/connect-google` | Editor |
| GET | `/api/playbook-mirror/connection-status` | Viewer |
| DELETE | `/api/playbook-mirror/connection` | Editor |
| POST | `/api/playbook-mirror/fetch` | Editor |
| GET | `/api/playbook-mirror/snapshots` | Viewer |
| GET | `/api/playbook-mirror/snapshots/:id/structure-proposal` | Viewer |
| GET | `/api/playbook-mirror/structure` | Viewer |
| POST | `/api/playbook-mirror/structure/accept` | Editor |
| POST | `/api/playbook-mirror/snapshots/:id/check-structure` | Editor |
| POST | `/api/playbook-mirror/snapshots/:id/verify` | Editor |
| GET | `/api/playbook-mirror/snapshots/:id/diff` | Viewer |
| GET | `/api/playbook-mirror/overview` | Viewer |
| GET | `/api/playbook-mirror/snapshots/:id/grid` | Viewer |
| POST | `/api/playbook-mirror/snapshots/:id/publish` | Editor + typed snapshot number |
| POST | `/api/playbook-mirror/snapshots/:id/rollback` | Editor + typed snapshot number |
| POST | `/api/playbook-mirror/snapshots/:id/reject` | Editor + reason |
| POST | `/api/playbook-mirror/plans/:planKey/confirm-status` | Editor |
| GET | `/api/playbook-mirror/read/meta` | Viewer (admin preview; advisors not enabled) |
| GET | `/api/playbook-mirror/read/cells` | Viewer (admin preview; advisors not enabled) |

**Who has `product_playbook_admin` by default:** Developer, Platform Admin and Admin have Editor. General users have **none**. This can be changed only through the existing Access Control Center.

**Checks:**
- **Automated:** `routeAccess.test.ts` parses `server.ts` and fails the build if any mirror route:
  - lacks sign-in;
  - lacks the server check as its first statement;
  - uses another permission;
  - lets a Viewer change something.

  It also checks the route count is exactly 19, so a new route can't slip in unreviewed, and that the Google callback re-checks Editor before storing.
- **Live (staging, local server):**
  - every one of the 19 routes returned **401** without sign-in;
  - signed in, the read API returned **"Nothing has been published yet"** and `plans: [], features: []`.
- **Not tested live:** a signed-in user *without* the permission. I have no such account session. It is covered by the automated check and the existing `requireFeatureAccess` → `evaluateAccess` code path.

## 4. Staging screens (local app on this branch, staging database, your signed-in Chrome, view only)

What I saw, in order:
1. **Health and warnings:**
   - the AD46 picture issue;
   - "29 of 29 plan statuses are unconfirmed";
   - "Nothing is published. Advisors see nothing";
   - "Advisor access to the mirror is not enabled".

   Google access shows mehruf.p@joinditto.in, **read-only**. Last successful fetch 29/10 23:44. Published: nothing. 54 categories.
2. **Snapshots:**
   - #2 `verified`, structure passed, 0 differences (actions: View, Differences, Publish…, Reject…);
   - #1 `fetched`, not checked.
3. **Grid view of snapshot 2:**
   - column A marked **HIDDEN** and **"QA guide — never for advisors"**;
   - category labels merged as in the sheet (e.g. "Entry Age for Adults" over rows 2–4) with the sheet's header colours;
   - add-on cells with gold numbered headings, "Ditto Recommendation: ❌ Not recommended", bold sub-points;
   - notes always visible under their cell (e.g. D44 "Other Riders (not on check out)…").
4. **Plans:** all 29 with exact headers (" Care Heart" keeps its leading space; line breaks shown as `\n`), suggested status, **Unconfirmed** badge, Shown to advisors **No**.
5. **Source issues:** AD46 (open, warning) and G29 (recorded Excel-copy discrepancy).
6. **Advisor preview:** `published: false, plans: [], features: []`.

Only **View** was clicked (a read-only request). Fetch, Verify, Publish, Reject and Confirm were **not** clicked.

**Screenshots:** the browser tool saved its captures in its own session storage, which is **outside** `D:\Ditto Assist WebApp`. To respect the folder rule I have **not** copied them into the project (that would mean reading outside the folder). If you want them in `docs/`, say so and I'll copy those 5 images in.

**Cosmetic observation:** in dark mode the "Fetch now" button looked dimmed. It wasn't clicked; I'll check its styling in Step 7.

## 5. Regression comparison

| Check | Before this work | After Step 6 |
|---|---|---|
| Test suite | 71 files passed, 1 skipped; **960 passed**, 1 skipped | 86 files passed, 1 skipped; **1,108 passed**, 1 skipped (960 + 148 new). **No test that passed before fails.** |
| Type check | 0 errors | **Correction (2026-10-30):** 0 errors was measured before the Step 6 test files were added; three of them did not type-check. Fixed in the ranges/visibility change; see `RANGES_AND_VISIBILITY_RESULTS.md` §5. |
| Lint, new/changed mirror files | — | 0 problems |
| Lint, `App.tsx` | 21 warnings (all existing) | 21 warnings: **identical set** (checked against an unmodified copy, since deleted) |
| Staging schema (69 tables, all columns/constraints/indexes/enums/functions) | baseline | identical apart from the 42 mirror objects (Step 2) |
| Staging Product Assist data (`kb_playbook_plan_facts`, sheet text chunks, existing Playbook connection) | baseline | identical |
| Staging `kb_resources` sheet rows | baseline | only `last_fetched_at` of Health/Term FAQ moved (15:10 UTC). Opening the app's home page triggers the **existing** FAQ staleness refresh. Content hashes and chunk counts identical. Not caused by the mirror. |
| Mirror state | — | snapshot 2 verified; published 0; statuses confirmed 0; plans shown to advisors 0 |
| Production | untouched | untouched |

Each test run on this Windows checkout rewrites one existing snapshot file's line endings. The content was verified identical and the file restored each time.

## 6. Open decision for you (before Step 7)

- **Should an open source issue (AD46) block publishing?** Today publishing is allowed but shows the warning (D5 asked only that the warning stay visible). I'd suggest **blocking publishing while any `source_gap` issue is open**, unless you explicitly allow it. That's a one-line rule plus a test.

## 7. Next: Step 7 (dry run and "migration passed" sign-off)

This step would:
- run several fetches over time and show a real sheet edit (made by the product team) appearing correctly in the difference report;
- do the one-off cross-check against a fresh `.xlsx` download (never opened in Excel);
- run product-team spot checks through the admin screen;
- confirm statuses only with the product team;
- check the "Fetch now" styling.

Publishing would still need your explicit go-ahead.
