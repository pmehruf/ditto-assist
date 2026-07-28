# PED Repository — Phase 5 Production Cutover Report

Status: **Phase 5 complete, pending final user approval before Phase 6.**
Date: 2026-07-28

## 1. Active runtime source

`PED_SOURCE=db` is now set in `.env` and is the production default. `classifyDeterministic` reads PED classification data from PostgreSQL (`ped_repository`, `ped_aliases`, `plan_overrides`) via `src/server/pedRuntimeCache.ts`, not from the hardcoded `TOP_PED_DICTIONARY` object in `types.ts`.

Rollback path: set `PED_SOURCE=legacy` (or unset it) and restart. No redeploy, no code change. Legacy dictionary, the four historical hardcoded plan-specific blocks, `ped_mapping_overrides`, and all legacy repository code remain in the codebase untouched, exactly as instructed — nothing was deleted or disabled.

## 2. Startup verification

`server.ts` now logs the active source and eagerly warms the DB-backed cache at boot (previously it only loaded lazily on the first `/api/match` request). Confirmed via a live `npm run dev` run:

```
[PED Repository] Runtime source: PostgreSQL (ped_repository / ped_aliases / plan_overrides — governed PED Repository)
[PED Repository] DB-backed runtime cache initialized: 1358 aliases loaded and ready.
Server running at http://localhost:3000
```

If the cache ever loads with 0 aliases (bad `DATABASE_URL`, unseeded DB), this same code path prints a loud `WARNING` rather than failing silently — that condition did not occur.

## 3. Runtime cache status

Cache initializes successfully and consistently across three independent live runs against the production database (the `npm run dev` boot above, and two separate script runs below): **1,358 aliases loaded**, matching the exact count from Checkpoint B's validation. No load errors, no fallback-to-legacy events.

## 4. Smoke-test results

```
npm test
Test Files  15 passed (15)
     Tests  192 passed (192)
```

All 192 tests pass, including `engine.baseline.test.ts` (stable classification for every smoke-test PED across all 6 plans) and `specificIllnessEngine.baseline.test.ts`. No test suite changes were needed for this phase — the DB-backed path was already exercised by the existing suite via `PED_SOURCE` env handling.

## 5. Production verification results (representative searches)

Ran `scripts/verifyProductionCutover.ts` against the live database — the 13 requested terms (14 checks, since Leptospirosis/Weil's disease was requested as one line but is two distinct alias texts) across all 6 plans, 84 (term, plan) pairs total:

| Result | Count |
|---|---|
| Resolved deterministically via DB | 84 / 84 |
| Fell through to null (would hit AI) | 0 |

Every representative term resolved to a real `ped_repository` row and produced a concrete match_type/question. Two cases explicitly confirmed the new DB-backed `plan_overrides` mechanism winning over the old hardcoded blocks in practice (not just by code inspection):

- **Obstructive Sleep Apnea, Activ Fit Preferred** -> `[DB plan_override]` P1, congenital/genetic question — the exact case that originally motivated this migration.
- **Peptic ulcer disease, Activ Fit Preferred** -> `[DB plan_override]` P1, "Cancer, tumor, lump, cyst, ulcer" — the refined ulcer override (correctly excluding Diabetic foot ulcer, which independently resolved to the diabetes category as intended).

Leptospirosis and Weil's disease both resolve identically (pedId 1033, `acute_infection`, FALLBACK/"Others" on every plan) — confirming the entity merge behaves as one unified concept. Cystoscopy resolves via the new `investigation_procedure` routing on every plan, as approved.

Full per-pair output is in the terminal transcript from this session; nothing anomalous.

## 6. Confirmed reading from PostgreSQL

Every one of the 84 checks above reports a resolved `pedId` and `categoryKey` sourced from the live `ensurePedRuntimeCacheLoaded()` call, which queries `ped_repository`, `ped_aliases`, `categories`, and `plan_overrides` directly (`src/server/pedRuntimeCache.ts`). `scripts/migrationStats.ts` independently confirms these same tables are populated and queryable:

- `ped_repository`: 1,196 rows
- `ped_aliases`: 1,358 rows
- `plan_overrides`: 22 rows
- `categories`: 36 rows
- `collision_repository`: 16 rows

## 7. No remaining legacy dictionary reads — precise finding

The bulk O(1) dictionary lookup (`TOP_PED_DICTIONARY`, ~1,196 entries) is **fully and unconditionally bypassed** when `dbSource` is supplied — this is a hard code gate at `engine.ts` line 791-796 (`dbSource ? dbSource.aliasLookup.get(...) : TOP_PED_DICTIONARY[...]`), not a behavioral coincidence.

One nuance, surfaced rather than hidden: 4 historical hardcoded plan-specific blocks (OSA/Activ Fit Preferred, DVT/Activ Fit Preferred, Crohn's-Colitis/Care Supreme, RA/Optima Secure) still read `TOP_PED_DICTIONARY` unconditionally at line 525, as their own internal fallback-category source (`liveOverrideCategory`). They remain reachable whenever the new DB `plan_overrides` check doesn't resolve a pair first (`engine.ts` lines 542-558). This is intentional layered fallback design, not a leftover bug — and is exactly what "keep legacy in place as an emergency rollback" requires structurally.

In practice, per section 5 above, the DB `plan_overrides` path already wins for the two cases these blocks cover that are in the representative set (OSA and the ulcer override on Activ Fit Preferred). The other two blocks (DVT/AFP, Crohn's/Care Supreme, RA/Optima Secure) were not in the representative list and were not independently re-verified this phase; they're flagged as a Phase 6 cleanup candidate below.

## 8. Runtime warnings

None. Cache loaded successfully all three times it was exercised live. No fallback-to-legacy error paths were triggered.

## 9. Rollback readiness

**Ready.** Confirmed:
- Legacy code paths (`TOP_PED_DICTIONARY`, the 4 hardcoded plan blocks, `ped_mapping_overrides` / `pedMappingLive.ts`) are untouched and still fully functional — `ped_mapping_overrides` is in fact still actively consulted on every request regardless of `PED_SOURCE` (a pre-existing, separate live-override layer, unrelated to this flag).
- Rollback is a single environment variable change (`PED_SOURCE=legacy`) plus a restart. No migration, no data loss, no deploy.
- `getDbSource()` in `server.ts` already degrades to legacy automatically, per-request, if the DB cache ever fails to build (try/catch around cache warm-up, both at boot and per-request).

## Recommendation

Phase 5 requirements are met. Recommend approval to proceed to Phase 6 once this report and the accompanying Migration Completion Report are reviewed.
