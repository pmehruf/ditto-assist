# Product Playbook Mirror — Step 2: Staging Results

**Status:** Step 2 is applied to **staging only** (2026-10-29). Waiting for your review before the next checkpoint.
**Reviewed design:** `STEP2_MIGRATION_REVIEW.md` (approved 2026-10-29: SQL/schema, Option A read-only grant, `testUtils.ts` change).

## 1. What changed

**Repository (on branch `claude/playbook-migration-analysis-ea69fb`, not committed):**

| File | Change |
|---|---|
| `drizzle/0090_playbook_mirror.sql` | New. Body identical to the reviewed proposal (checked by diff); only the 2 header comment lines differ. |
| `drizzle/meta/_journal.json` | +1 entry: idx 65, when 1792400000000, tag `0090_playbook_mirror` (7 lines added, nothing else changed) |
| `src/server/db/schema.ts` | Imports extended (`customType, primaryKey, foreignKey, check, unique`, plus `sql` from drizzle-orm); reviewed block appended at the end. **211 lines added, 0 changed or removed.** |
| `drizzle-test-baseline/*` | Regenerated with the project's own command. The SQL file name changed (`0000_wise_skin.sql` → `0000_clumsy_kat_farrell.sql`, random by design). Content: **175 old statements all identical, 20 added, all `playbook`.** |
| `src/server/db/testUtils.ts` | Additive: after the baseline, runs 0090's CREATE FUNCTION / CREATE TRIGGER / seed INSERT statements, read from the real migration file |
| `src/server/db/playbookMirrorGuards.test.ts` | New: 21 database guard tests, synthetic data only (D7) |

**Staging database:** migration 0090 applied with the project's own runner (`src/server/db/migrate.ts`). It went through a wrapper that refused anything except the staging host, and refused unless the pending set was exactly `[0090_playbook_mirror]`. Result: "applied 1".

**Not changed:**
- production;
- existing tables, columns, types or rows;
- the current Playbook sync;
- Product Assist;
- the existing Google connection.

No repositories, routes, sync or UI were added. Nothing is published.

## 2. Zero Regression Audit: evidence

| Check | Before | After | Result |
|---|---|---|---|
| Full test suite (`vitest run`) | 71 files passed, 1 skipped; **960 passed**, 1 skipped | 72 files passed, 1 skipped; **981 passed** (960 + 21 new), 1 skipped | ✅ no test that passed before fails |
| Type check (`tsc --noEmit`) | 0 errors | 0 errors | ✅ |
| Lint (changed files) | — | 0 problems | ✅ |
| Test baseline statements | 175 | 175 identical + 20 `playbook` | ✅ |
| Staging: non-mirror tables / columns / constraints / indexes / enums / triggers / functions / views / extensions | 69 / 594 / 559 / 130 / 23 / 0 / 118 / 0 / 2 | **identical (same SHA-256 per section)** | ✅ |
| Staging: `kb_playbook_plan_facts` (Product Assist Playbook facts, content + notes) | 73 rows, sha256 a697f982… | **identical** | ✅ |
| Staging: Playbook/FAQ sheet resources, their text chunks, existing Playbook Google connection | recorded | **identical** | ✅ |
| Staging: migration bookkeeping | 90 rows | 91 rows: **only** `created_at 1792400000000` added | ✅ |
| Staging: new objects | 0 | 42 `playbook*` objects (9 tables + indexes/sequences, 4 functions, 5 types) | ✅ as designed |
| Staging structure vs local test | — | 9 tables, 104 columns, 89 constraints, 13 indexes, 5 enums, 6 triggers. **Identical to the locally validated migration.** | ✅ |
| Staging guard smoke test (inside a rolled-back transaction) | — | **10/10**; rows left afterwards: 0 snapshots, 0 cells, 0 published, 0 plans, 0 grants; AD46 still open with warning | ✅ |
| Advisor visibility | — | `playbook_published` empty; no route or screen reads the new tables | ✅ |

**My assessment:** the Step 2 regression checks all pass, for the scope of Step 2: schema, test suite, and staging data and structure.

**One limit:** Product Assist was not exercised with a live question on staging. Its unchanged behaviour is shown three ways: no code path touches the new tables, its data on staging is byte-identical, and its tests pass. The audit's final sign-off is yours.

## 3. Things to know

- **Test snapshot line endings:** each test run on this Windows checkout rewrites `specificIllnessEngine.baseline.test.ts.snap` with different line endings. The content was verified identical and the file restored both times. This is existing behaviour, not caused by this work.
- **Production is not migrated.** Project rule: run `npm run db:migrate` on production **before** deploying any code that uses these tables. Separate approval.
- **Rollback (staging), if ever needed:**
  - run `docs/playbook_mirror_step2/0090_playbook_mirror_ROLLBACK.sql`;
  - then delete the bookkeeping row `created_at = 1792400000000` from `drizzle.__drizzle_migrations`.
  - It was tested locally: it restores the schema exactly.
- **Not committed:** the branch changes above are in the worktree only.
- Scratch evidence (not committed), in `_scratch_playbook_migration/output/`:
  - `staging_fingerprint_before.json`, `staging_fingerprint_after.json`;
  - `baseline_tests.txt`, `after_tests.txt`, `after_typecheck.txt`.

## 4. Next checkpoint (needs your approval)

**Step 3a: dedicated read-only Google grant (Option A)**, before any sync code:
- a new connect route and a small connection repository;
- `include_granted_scopes: false`, read-only scope only;
- Google's tokeninfo checked at connect and at every use; the database already refuses broader grants;
- server-side access check (D3);
- tests;
- then you connect once on staging, and I verify the granted scopes.

The existing `kb_playbook_connection` stays untouched.
