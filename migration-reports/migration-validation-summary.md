# PED Repository Migration — Cutover Validation Report (Phase 4)

Generated: 2026-07-28T16:10:14.491Z

- PEDs: 1196
- Aliases tested: 1358
- Plans tested: 6
- (alias, plan) pairs compared: 8148
- Total differences: 178

## Differences by likely cause

- **new_dictionary_coverage**: 160
- **new_plan_override_coverage**: 8
- **category_mismatch**: 10

**10 unexplained difference(s) (category_mismatch)** — these are the ones to investigate first; everything else has a hypothesis attached. See the JSON report for full detail on each.

## Bucket definitions

- `new_plan_override_coverage`: the DB-backed generic plan_overrides row resolved this (alias, plan) pair; legacy's hardcoded regex block didn't reach it (e.g. a synonym not in the block's word list). Expected — this is the DB-backed path doing its job better, not a regression.
- `new_dictionary_coverage`: legacy returned null (would have fallen to AI); the DB alias set resolves it deterministically. Expected improvement, but confirm the resolved category is actually correct.
- `lost_dictionary_coverage`: legacy resolved it; the DB alias set doesn't yet (returns null, would fall to AI). Needs attention — likely a term present in TOP_PED_DICTIONARY/ped_mapping_overrides that the Phase 2 seed script didn't carry over, or a category conflict left deliberately unresolved.
- `category_mismatch`: both sides resolved, to a genuinely different question or match_type. The bucket that most needs a human look — could be an intentional fix (e.g. exactly the OSA-on-Optima-Secure case that started this whole migration) or a real regression.

Full per-pair detail: `migration-validation-report.json`.