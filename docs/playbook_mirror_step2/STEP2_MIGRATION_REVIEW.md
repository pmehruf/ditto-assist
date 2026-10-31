# Product Playbook Mirror — Step 2: Proposed Migration and Schema Review

**Status:** **Approved 2026-10-29 and applied to staging only.** Results are in `STEP2_STAGING_RESULTS.md`. Production is not applied.
**Date:** 2026-10-29
**Files in this folder:**
- `0090_playbook_mirror.sql`: the proposed migration
- `schema_additions.ts.txt`: the matching `schema.ts` block
- `0090_playbook_mirror_ROLLBACK.sql`: how to undo it

**Zero Regression Audit:** *not yet passed*. Schema-level checks passed locally (§5). The audit can only pass after staging application and the before/after checks in §8.

---

## 1. Google access: write permission clarified (your condition)

| Question | Finding | How verified |
|---|---|---|
| Does the stored **token** carry write-enabled OAuth scopes? | **Yes.** The existing Playbook grant (`kb_playbook_connection`, staging) includes `https://www.googleapis.com/auth/spreadsheets` (read/write on every spreadsheet the account can edit) and `script.processes`, as well as `spreadsheets.readonly`. | Google's tokeninfo lookup during the Step 1 spike |
| Why? | The Playbook connect flow requests read-only only, but uses `include_granted_scopes: true`, so Google merges in the scopes the same person granted to other features of the app (the Product Assist log export requests write access). | [CODE] `src/server/auth/googleOAuth.ts` lines 208–219, 491–513 |
| Does the **account** have edit permission on the Playbook itself? | **No: "View only".** mehruf.p@joinditto.in is a viewer of the Playbook. Google would refuse any edit to *this* sheet, but the token could edit *other* spreadsheets that account can edit. | Sheet opened in your Chrome as "Mehruf P (mehruf.p@joinditto.in)": badge "View only"; Insert/Format menus disabled. The Drive permissions API couldn't be used (the token has no Drive scope, and I didn't add one). |

**Conclusion:** the existing token is **not acceptable** for the mirror, even though Google would block edits to the Playbook itself. The mirror will not use it.

**Narrowest practical read-only access (recommendation):**

| Option | What it can reach | Needs | Fit |
|---|---|---|---|
| **A. Dedicated mirror grant (recommended now)** | Only what `spreadsheets.readonly` allows, for an account that is itself only a viewer of the Playbook | A new, additive "Connect for Playbook mirror" flow: read-only scope only, `include_granted_scopes: false`, `prompt: consent`. On connect, call tokeninfo and store the scopes Google actually granted. The **database refuses** to store any grant with a write, Drive or script scope (CHECK constraint, tested). On every sync, re-check scopes and refuse to fetch if they have widened. | No owner dependency. Existing `kb_playbook_connection` untouched. |
| B. Service account, shared as Viewer on the Playbook only | Only files explicitly shared with it, read-only | The **sheet owner** shares the Playbook with the service account's email; a key stored as a secret | Narrowest of all, but depends on the owner. Can replace A later. |
| ~~C. Reuse existing grant~~ | Write on all spreadsheets the account can edit | — | **Rejected** |

Important caveat: whether Google issues a strictly read-only token when `include_granted_scopes` is false **must be proven at connect time**. That is why the scopes are stored and checked by the database rather than assumed. The connect flow is app code. It is the first item of Step 3 and needs your approval. **No sync code will be written before it works and is verified.**

Separately: the *existing* Product Assist Playbook grant keeps its write scope. That is existing behaviour, out of scope here, and recorded as a follow-up.

---

## 2. What the migration creates (additive only)

| Object | Purpose | Key protections |
|---|---|---|
| `playbook_mirror_connection` | The dedicated read-only Google grant (§1A) | CHECK: must include `spreadsheets.readonly`; must **not** include `spreadsheets`, `drive`, `drive.file` or `script.processes` |
| `playbook_snapshots` | One row per fetch: raw Google response (gzip, as received), SHA-256 fingerprint, request ranges and fields, parser version, status, check reports | Source columns **immutable** (trigger); rejecting requires a reason; publishing requires who/when |
| `playbook_snapshot_tabs` | Per tab: title, IDs, frozen panes, grid size, **hidden rows/columns**, rows hidden by filter, **merges as received** | Write-once (trigger) |
| `playbook_cells` | Every cell with a value, note, link or formatting. Keeps **exact raw text**, the number as its original literal *and* as a number, the displayed value, the **raw Google objects** (value, formatting runs incl. links, formats, chips), note, cell link, merge anchor / covered-by | Write-once (trigger); "empty" can't carry text; a cell can't be both a merge anchor and covered |
| `playbook_plans` / `playbook_features` | Approved structure (plan keys, exact expected headers/labels) | A plan **cannot be shown to advisors until its status is confirmed by a named person** (D4). Duplicate headers refused. Nothing derived from header text. |
| `playbook_published` | The advisor-visible pointer. **Empty after this migration.** | Can only point at a `verified` snapshot of the same domain with recorded structure and reconciliation reports (trigger). Published snapshots can't be deleted (foreign key + trigger). |
| `playbook_sync_state` | Last attempt, success, error and trigger (D9 immediate warning, including failures with no snapshot) | — |
| `playbook_source_issues` | Known source issues. **Seeded with 2 rows:** `ad46_picture` (open, warning on) and `excel_copy_g29` (recorded) | AD46's warning **cannot be turned off until verified**, and verification must be by **a different person** than the resolver (D5) |
| 5 enum types, 4 functions, 6 triggers | Status values and guards | — |

**Not created:** no change to any existing table, column, type or row. The existing `announcement_team` type (Health/Term) is **reused, not altered**, as other Playbook tables already do.

**Exactness (your schema condition):** raw cell values, formatting runs, notes, links (stored inside the runs, which is where Google keeps them for this sheet), merges and hidden flags are all stored as received. Nothing is trimmed or normalised; lone carriage returns, leading and trailing spaces, and "-" vs blank all survive (tested). Convenience columns sit *next to* the raw data, never instead of it.

**Known discrepancies recorded (your condition):**
- **G29 (Excel copy)** is recorded as `excel_copy_g29`: the live Google Sheet ("50% to 100%") is the source of truth, and the Excel copy must not be used as a source.
- **AD46 picture** stays **open with a visible warning** until its information is represented in the sheet, mirrored, and verified by a second person.

---

## 3. Collision analysis

| Area | Existing | Collision? | Notes |
|---|---|---|---|
| Table / type / function names | 68 tables, 23 types on staging; none named `playbook*` | **None** | Checked on staging (read-only) and in local PGlite |
| Plan registries | `plan_configs` (Declaration Assistant, key = plan name), `kb_categories.plan_names` / `disabled_plan_names` (Product Assist picker), `kb_playbook_plan_facts.plan_name` (current sync), `INSURER_LOGOS`, `planCoverEligibility`, `types.ts` built-ins | **No technical collision; real risk of divergence** | `playbook_plans` is a separate registry, linked only by an optional text column `kb_plan_name`. No foreign key and no writes to the others. Divergence (e.g. "Activ Yuva (Not live yet with Ditto)" in today's staging facts) is managed by the product-confirmed mapping (D4), not by sharing tables. |
| Access controls | `featurePermissions.ts` ids, `feature_access_overrides`, `group_tool_access`, `custom_access_grants`, `page_visibility` | **None in Step 2** | No access schema or ids change now. New ids `product_playbook_admin` / `product_playbook` are code (later step), enforced server-side through `requireFeatureAccess` (D3). Checked: no existing id with those names. |
| Current sync tables | `kb_playbook_connection`, `kb_resources`, `kb_playbook_plan_facts`, `kb_chunks` | **None** | No foreign keys to them, no reads or writes. Staging fingerprint of `kb_playbook_plan_facts` recorded (73 rows, md5 `e0baac31…`) to prove they're unchanged after applying. |
| Snapshot references | — | Designed in | Published pointer: `RESTRICT`. Sync state: `SET NULL`. Tabs/cells: `CASCADE`, but only for snapshots that were never published (trigger). |
| Routes | — | **None** | No `/api/playbook*` routes exist. Step 2 adds none. |
| Migration numbering | Staging newest applied = `1792300000000` (0089); nothing else pending | **None** | 0090 journal `when` = **1792400000000**. The runner only applies migrations newer than the newest applied, so this is required. Any other branch adding a migration must use a later `when`. |
| Lost migrations 0057–0081 | Documented in `drizzle.test.config.ts` / `testUtils.ts`: lost from the checkout before being committed; applied on staging and production | Explains R3 from Step 1 | No impact on 0090 |

---

## 4. Regression analysis

| Risk | Assessment | Proof |
|---|---|---|
| Migration alters existing objects | **None found** | Local PGlite: every pre-existing table, column, constraint, index, type, trigger and function is identical after applying; every addition is a `playbook_*` object (§5) |
| Migration half-applies or re-runs silently | Prevented | The runner applies each file in its own transaction. A second application fails loudly ("type already exists"). Tested. |
| `schema.ts` and SQL drift | **None** | Offline `drizzle-kit generate` from `schema.ts` + draft, compared with the SQL: identical columns (104), constraints (89), indexes (13), types (5). Triggers, functions and seed rows are SQL-only by design. |
| Tests break when `schema.ts` grows | Low | New tables are only added to the shared `schema` object; no existing code imports them. Before/after test runs compared (§8). |
| Test databases miss the guards | Known gap, fixed in apply plan | `drizzle-test-baseline` is generated from `schema.ts` and can't contain triggers or seed rows. `testUtils.ts` will apply 0090's functions, triggers and seed rows after the baseline, the same way it already carries 0038/0049 seed rows. This is a small additive change to an existing test helper and is listed for approval. |
| Product Assist answers change | **None expected** | No code path reads the new tables. Existing Playbook tables untouched; their fingerprint is compared before/after on staging. |
| Production affected | **None** | Not applied to production. Before any code that uses these tables ships, the migration must be run on production first (project rule). That is a separate, later approval. |

---

## 5. Local validation results (throwaway in-memory Postgres, staging untouched)

Scripts: `_scratch_playbook_migration/scripts/step2_validate.ts`, `step2_schema_match.ts`, `step2_rollback_test.ts`. Output: `_scratch_playbook_migration/output/step2_validation.txt`.

- Built the app's current schema (68 tables, 23 types), applied the 26 statements: **no errors**.
- **Pre-existing schema identical**; added 9 tables, 5 types, 4 functions, 6 triggers, 13 indexes, 89 constraints. All `playbook_*`.
- **45/45 guard tests behaved as intended**, including:
  - exact text with a leading space and lone CR survives byte for byte;
  - editing cells, tabs, the raw response or the fingerprint is blocked;
  - publishing a `fetched` snapshot, or a verified one without check reports, or into the wrong domain, is blocked;
  - deleting the published snapshot, or a superseded (ever-published) one, is blocked;
  - retention can delete a never-published rejected snapshot, and its cells go with it;
  - write-, script- or no-readonly-scoped grants are refused, and a read-only grant is accepted;
  - an unconfirmed plan can't be shown to advisors;
  - AD46's warning can't be hidden, and the resolver can't also be the verifier.
- **Rollback** returns the schema exactly to the original.
- **Schema draft ↔ SQL:** identical structure, after aligning 3 foreign-key names and one index detail to the project tool's naming.

**Staging pre-check (read-only):**
- newest applied migration 1792300000000;
- nothing else pending;
- no `playbook*` objects;
- `announcement_team` = Health, Term;
- 68 tables;
- PostgreSQL 18.6.

---

## 6. Apply plan (only after you approve this review)

**A. Repository changes (branch only):**
1. Copy `0090_playbook_mirror.sql` to `drizzle/`; add journal entry `idx 65, when 1792400000000, tag 0090_playbook_mirror`.
2. Append `schema_additions.ts.txt` to the end of `src/server/db/schema.ts` (imports extended; nothing above changes).
3. Regenerate `drizzle-test-baseline`. The diff must show **only** `playbook_*` additions.
4. `testUtils.ts`: after the baseline, also run 0090's functions, triggers and seed inserts (additive).
5. Add DB tests: the 45 guard cases as a permanent test file, using synthetic data only (D7).
6. Run type check + full test suite; compare with the "before" run (§8).

**B. Staging (only after A passes):**

7. Read-only pre-check again: same results as §5, plus a fingerprint of every non-`playbook` object.
8. `npm run db:migrate` against staging (`.env` host `ep-billowing-tree…`; the script refuses the production host).
9. Read-only post-check: non-`playbook` fingerprint identical; `kb_playbook_plan_facts` fingerprint identical; 9 tables, 2 seed rows present; `playbook_published` empty.
10. Guard smoke test on staging **inside a transaction that is rolled back**, so no data is left behind.
11. Report results. Stop.

**Not in Step 2:** repositories, connect flow, sync, routes, UI, production.

---

## 7. Decisions for you

1. **Approve the SQL and schema** as proposed, or ask for changes.
2. **Approve Option A** (dedicated read-only mirror grant) as the access method, built first in Step 3 before any sync code. Or ask the owner for Option B.
3. **Approve the small additive `testUtils.ts` change** (§4) so tests include the database guards.
4. Retention of the 14 MB raw spike response in the scratch folder: keep it until the go-live cross-check, or delete it now.

---

## 8. Zero Regression Audit: evidence so far

| Check | Before | After | Status |
|---|---|---|---|
| Local schema fingerprint (non-playbook objects) | baseline | identical | ✅ |
| Full test suite (`vitest run`) | **71 files passed, 1 skipped; 960 tests passed, 1 skipped** (2026-10-29) | after step A | pending |
| Type check (`tsc --noEmit`) | **0 errors** | after step A | pending |

Note: running the suite on this Windows checkout rewrites `src/__tests__/__snapshots__/specificIllnessEngine.baseline.test.ts.snap` with different line endings. Its content is identical (verified by fingerprint). I restored the file so the working tree is clean. Expect the same after future runs.

Note: the draft schema file is saved as `schema_additions.ts.txt`, not `.ts`. Saved as `.ts`, the project's type check picked it up as a broken fragment (caught and fixed during this review). The draft never affected app code.
| Staging non-playbook fingerprint | before step 8 | after step 8 | pending |
| Staging `kb_playbook_plan_facts` (73 rows, md5 e0baac31…) | recorded | after step 8 | pending |
| Product Assist behaviour | no code path reads the new tables | confirmed by tests + fingerprint | pending |
