# Phase 6 audit: remaining legacy and duplicate paths (R1, R5, R8, R9)

Scope: what still feeds or can affect routing besides the database. Nothing below has been deleted except where marked "Done". Evidence is from the code on `main` (3e94031) plus batch A.

Production runs `MAPPING_ENGINE=db`, so the legacy engine does not decide any lookup today. Items are classified:

- **A. Runtime routing dependency** (affects what an advisor gets or what an admin can do, and is not DB-driven)
- **B. Rollback / oracle code** (kept on purpose; the legacy engine proves equality and is the `MAPPING_ENGINE=legacy` rollback)
- **C. Historical / audit data** (kept unless you say otherwise)
- **D. Harmless artifacts** (comments, seed scripts, docs)

## A. Runtime routing dependencies that remain (R1, R9)

| # | Item | Where | What it does today | Proposal |
|---|------|-------|--------------------|----------|
| A1 | Compiled category list in the plan restriction and plan-PED override editors | `PlanRestrictionsEditor.tsx`, `PlanPedOverridesEditor.tsx` | Offered only 34 categories; labels from code | **Done (batch A, 6424836)**: both read the live category list. Test added. |
| A2 | Legacy post-guard pipeline applied to AI answers | `server.ts` 963-965 (Gemini path), 581-583 (legacy branch); `engine.ts` `applyPostGuards`, `sanitizeOutput`, `finalizeOutput` | After Gemini answers, the hard-coded `applyPostGuards` rules (diabetes restriction guard etc.) run. The same rules exist as `routing_rules` rows used by the db engine. Two copies. | Batch C: run the snapshot's post-guard rules on AI answers instead and drop the hard-coded copy. Needs a new test that feeds AI-style outputs through both and shows identical results first. |
| A3 | Hard-coded plan configs used as a fallback | `types.ts` `getPlanConfig()` / `PLANS`; `server.ts` 438, 505, 1027, 4881, 5818, 6363; `App.tsx`; `PlanManagementPage.tsx` | If a plan has no `plan_configs` row, the compiled copy of that plan is used. All six production plans have DB rows, so it is a dead fallback today, but it is a second source of plan data. | Batch D: remove the fallback so a plan exists only if its DB row does. Check first that every plan on production and staging has a row (production: all six do). |
| A4 | Per-request read of the legacy `ped_mapping_overrides` table | `server.ts` 502 `ensurePedOverridesLoaded`; `pedMappingLive.ts` | Every `/api/match` still loads the legacy table and mutates an in-memory copy of the compiled dictionary. In db mode nothing reads the result. | Batch B (safe, no behaviour change). |
| A5 | Retired legacy-only routes | `server.ts` 1066 `/api/add-ped-mapping`, 5144 `/api/ped-suggestions` POST/PUT/DELETE | Return 410 in db mode. They contain the last compiled-category validations (`CATEGORY_LABELS`). Unreachable. | Batch B: delete the dead routes. |
| A6 | Smoke-test endpoint uses the legacy engine | `server.ts` 5854 | Runs `classifyDeterministic` over the smoke-test PEDs; in db mode it checks the wrong engine. | Batch B: run the smoke test through the db engine. |
| A7 | Compiled dictionary as a Lookup-page suggestion fallback | `App.tsx` 2075 (`TOP_PED_DICTIONARY`, `SCRIPT_DICTIONARY` and a short hard-coded term list) | Fills the dropdown until `/api/ped-repository/autocomplete` answers. The DB list overwrites it. A second dictionary, but for suggestions only, not routing. | **Needs your decision** (see below): removing it changes what advisors see before the list loads, and drops the extra hard-coded terms unless they are added as DB aliases. |
| A8 | Browser-side classification path | `App.tsx` 78, 2465 `classifyDeterministic` | Only runs when the server says mode is not db. In production it never runs. | Batch B: delete with the legacy path. |

## B. Rollback / oracle code (R5: delete only once equality is proven, with replacement protection)

| Item | Role | Protection needed before deleting |
|------|------|-----------------------------------|
| `src/engine.ts` `classifyDeterministic` and the other legacy-only functions (about 1,000 lines), `TOP_PED_DICTIONARY` and the compiled plan configs in `types.ts`, `STATIC_DICTIONARY_SNAPSHOT` | The oracle that `mapping:verify` and several tests compare the db engine against. `MAPPING_ENGINE=legacy` rollback. | The oracle is replaced by a **committed frozen baseline** of every (condition, plan) pair. Today it exists only as an untracked 2 MB file in `backups/` (git-ignored). It must be regenerated after the six approved R10 corrections (so those are the deliberate differences) and committed, and a test must compare the db engine to it. |
| `PED_SOURCE`, `MAPPING_ENGINE` flags, `pedRuntimeCache`, `pedMappingLive`, `legacyWriteGuard`, `getDbSource` | Switch between legacy and db | Removed together with the oracle; the db engine becomes the only engine. |
| Shared pure helpers in `engine.ts` (`normalizeDictionaryKey`, `questionForCategory`, `applyPlanPedOverride`, `finalizeOutput`, ...) | Used by the db engine itself | **Kept**: move to a new module (for example `src/mapping/helpers.ts`) with identical code. |
| `src/mapping/legacyRuleSeed.ts`, `seedBuilder.ts`, `equalityHarness.ts`, `scripts/seedMappingControl.ts`, `rollbackMappingControl.ts`, `generateMappingBaseline.ts` | Build the day-one seed from the legacy code and compare | Seed and equality tooling become unnecessary after the legacy engine goes; the frozen baseline replaces them. Keep `mapping:freeze` (compare against the baseline) and `mapping:snapshot` / `mapping:backup`. |

## C. Historical / audit data (kept)

| Table | Status |
|-------|--------|
| `ped_mapping_overrides` | Legacy dictionary overrides. After batch B nothing reads it at runtime. It is the data the legacy rollback needs. **Keep until you approve dropping it**; a drop would be a separate migration with a dump taken first. |
| `ped_directory` (`pedSuggestions`) | Legacy PED suggestion queue (legacy-only routes use it). Review before any drop. |
| `mapping_history`, `mapping_change_sets` | Audit and undo records. **Keep.** |
| `ai_memory`, `collision_repository`, `smoke_test_peds`, `search_history` | AI layer, collision governance, smoke tests, usage history. **Keep.** |
| Authoritative: `categories`, `routing_rules`, `ped_repository`, `ped_aliases`, `plan_configs`, `plan_overrides`, `plan_restrictions`, `mapping_state` | The single source of truth. |

## D. Harmless artifacts

Comments and docs that name the legacy path (`engine.ts`, `pedRepositoryLive.ts`, UI doc comments), the Phase 1 to 4 docs, the pre-migration backups under `backups/`, the `drizzle` migration history. Update wording, delete nothing.

## R8: the Constitution must match the final engine

The Constitution still describes the legacy path as part of the engine (Part IV lines 66, 104-116, 124-132, 345, 442-482, glossary, version history). When batches B-D land, those sections must be rewritten to say the database is the only source and the legacy path and flags are gone, with a Version History entry and a Change Impact record. Removing the rollback and replacing the live oracle with a frozen baseline touches a core safeguard (the regression gate), so I will flag it plainly in the approval request.

## Proposed batches (nothing destructive without your approval)

| Batch | Contents | Behaviour change | Protection |
|-------|----------|------------------|------------|
| A (done) | Editors use the live category list | None | Source-level test; full suite and Zero Regression Audit pass |
| B | Remove A4, A5, A6, A8: per-request legacy load, dead routes, legacy smoke path, browser classifier | None (all unreachable or no-op in db mode) | Full suite, Zero Regression Audit, `mapping:freeze` compare against the frozen baseline |
| C | A2: AI answers use the data-driven post-guard rules | None expected; proven by a new equality test | New equivalence test; Zero Regression Audit |
| D | A3: remove compiled plan-config fallback | None if every plan has a row | Pre-check on both databases; full suite |
| E | Remove the legacy engine and flags (section B) and re-base the tests on the committed frozen baseline | None | Frozen baseline committed (regenerated after R10); db-engine equality test; Zero Regression Audit |
| F | Constitution rewrite (R8) | Documentation | Change Impact template, Version History, your approval |
| G (separate approval) | Drop `ped_mapping_overrides` and `ped_directory` | None at runtime | Database dump first; migration run by you |

## Decisions I need before I delete anything irreversible

1. Approve batches B-E as listed (code removal only; reversible through git).
2. A7: remove the compiled suggestion fallback (dropdown shows a short loading state instead), and add the few hard-coded terms as DB aliases, or leave A7 alone for now?
3. G: approve a later, separate migration that drops the two legacy tables, or keep them indefinitely?
4. R8: approve the Constitution wording change described above, including that the live legacy oracle is replaced by a committed frozen baseline.
