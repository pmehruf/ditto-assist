# PED Repository — Migration Completion Report

**Permanent record.** This document is the definitive answer to "how did we transition from a code-based PED dictionary to a governed PostgreSQL repository," written at the close of Phase 5 (production cutover). It should not be edited to reflect later changes — start a new dated addendum instead if the architecture evolves further.

Date range: this migration ran across multiple phases culminating 2026-07-28. Phase 6 (final legacy code removal) is intentionally not covered here — it had not yet been approved at the time of writing.

## 1. Initial architecture — the hardcoded dictionary

Before this migration, PED (Pre-Existing Disease) classification was entirely code-based:

- **`TOP_PED_DICTIONARY`** (`src/types.ts`): a single hardcoded JavaScript object mapping ~1,200 exact term strings to a `categoryKey`. Every new PED, every synonym, every misspelling fix required a code change and a redeploy.
- **4 hardcoded plan-specific override blocks** in `engine.ts`: narrow, manually-written `if (planName === "X")` regex blocks handling cases where one plan's proposal-form wording didn't match the generic category routing (e.g. Obstructive Sleep Apnea routing to the congenital/genetic question specifically on Activ Fit Preferred, not the respiratory question every other plan used).
- **`ped_mapping_overrides`** (Postgres table, pre-existing): a live-editable override layer bolted on top of the hardcoded dictionary, letting PED Library / AI Mapping Review admin edits take effect without a redeploy — but only for the base category, not plan-specific routing, and with no formal alias/synonym model, no visibility distinction between clinical terms and misspellings, and no audit trail beyond basic timestamps.

This worked, but had three structural problems that motivated the migration: (1) a genuine bug where the 4 hardcoded plan blocks could silently shadow live PED Library edits forever on that one plan (the OSA/Activ Fit Preferred incident that started this project), (2) no single source of truth — clinical terms, action phrases ("Cystoscopy done"), and misspellings ("Apendicitis") all lived in the same flat dictionary with no governance distinction, and (3) every plan-specific business rule required a code change, not a data change.

## 2. Final architecture — PostgreSQL as source of truth

Six new tables, a three-layer governance model, and a feature-flagged runtime cutover:

- **`ped_repository`**: canonical PED rows (`pedCode`, `canonicalName`, `categoryKey`, `status`, `mergedIntoId`). The single source of truth for "what is this condition."
- **`ped_aliases`**: every searchable text variant, each flagged `isVisible` — visible aliases are genuine clinical synonyms and accepted spelling variants (COPD, CKD, Anaemia/Anemia); hidden aliases are misspellings, OCR artifacts, and action-phrase variants ("Cystoscopy done") kept for search matching only, never shown in any UI.
- **`plan_overrides`**: the generic, data-driven replacement for the 4 hardcoded engine.ts blocks — `(planName, pedId) -> categoryKey` with a human-readable reason, editable without a code change.
- **`categories`**: the category taxonomy itself, now a table instead of an implicit set of string literals scattered through `engine.ts`.
- **`collision_repository`**: guardrail records for known ambiguous-term situations (e.g. the diabetic-foot-ulcer-vs-ulcer-family exclusion), so a future edit that would silently reintroduce a fixed bug gets flagged.
- **`mapping_history`**: an audit trail of every governance/data change made to the repository, with a `reason` field — every fix in this migration (Bell's palsy, the ulcer refinement, every entity merge) is traceable here.

**Governance model** (formalized in `PED_REPOSITORY_GOVERNANCE.md`): Repository (visible) contains professional medical terminology only; Normalization Layer (hidden aliases) absorbs misspellings and action phrases for forgiving search without polluting the UI; the Declaration Engine reads both layers plus `plan_overrides` and never needs to know *why* a term resolves the way it does.

**Runtime cutover**: `src/server/pedRuntimeCache.ts` loads all four tables into an in-memory, request-synchronous cache once per process. `engine.ts`'s `classifyDeterministic` takes an optional `dbSource` parameter — when present (gated by the `PED_SOURCE=db` environment flag, now the production default as of Phase 5), it reads exclusively from this cache; when absent, behavior is byte-identical to the original hardcoded-dictionary implementation. The legacy path was never deleted — it is the documented, one-line-env-var rollback.

## 3. Scale of the migration

| Metric | Count |
|---|---|
| PEDs in `ped_repository` | 1,196 total (1,184 approved, 12 deprecated via merges) |
| Aliases in `ped_aliases` | 1,358 total (1,327 visible, 31 hidden/normalization-only) |
| Categories | 36 |
| Plan overrides | 22 (Activ Fit Preferred: 13, Optima Secure: 6, Care Supreme: 3) |
| Collision guardrails | 16 (all active) |
| Mapping history entries | 1,000+ (created: 965, merged: 12, alias_added: 12, updated: 9, category_changed: 1, removed: 1 — capped at 1,000 in the query used; more exist from the initial seed) |
| Plans covered | 6 (Optima Secure, Care Supreme, Activ One Max, Activ Fit Preferred, Aspire, Reassure 2.0) |

## 4. Repository health

- 1,184 approved PEDs, 12 cleanly deprecated (merged into a surviving canonical entity, never hard-deleted — `mergedIntoId` preserves the trail).
- 332 approved PEDs currently have no `categoryKey`. This is **pre-existing, not introduced by this migration** — the final Phase 4/Checkpoint B validation ran an exhaustive alias-by-alias comparison against the legacy engine and found 0 `lost_dictionary_coverage` differences, which would have caught any case where legacy could resolve a term the DB-backed path now can't. Since that count is 0, every one of these 332 PEDs was already unreachable via the old hardcoded dictionary too (falls to AI Memory/Gemini either way). Flagged as technical debt below, not a regression.
- 16/16 collision guardrails active — none have been disabled or bypassed.

## 5. Validation statistics (Checkpoint B, final run)

Exhaustive comparison of legacy vs. DB-backed engine across every `(alias, plan)` pair:

- **8,148 pairs compared** (1,358 aliases x 6 plans, capped to existing combinations)
- **178 total differences**, fully explained:
  - 160 `new_dictionary_coverage` — legacy returned null (would hit AI), DB now resolves deterministically. Confirmed correct on spot review.
  - 8 `new_plan_override_coverage` — the DB `plan_overrides` mechanism resolving cases the old hardcoded regex blocks didn't reach.
  - 10 `category_mismatch` — both approved as **intentional bug fixes**: Cerebrovascular Accident (5 plans) and Cystoscopy (5 plans), both documented with explicit before/after reasoning and sign-off.
  - 0 `lost_dictionary_coverage` — after one round of investigation and fix (see Lessons Learned #3 below).
- Production verification: 84/84 representative-term/plan pairs resolved deterministically post-cutover, 0 falling through to AI.
- Test suite: 192/192 passing.

## 6. Lessons learned

1. **A merge is not just an alias reassignment.** The entity-cleanup migration's "merge_into" step correctly reassigned aliases from a losing PED to a winning one, but didn't reconcile `categoryKey`. When "Weils disease" (which carried the correct `acute_infection` category) was merged into "Leptospirosis" (which had none), the merged alias briefly lost all classification — caught by the very next validation run, not by inspection. Fixed generally (any merge, not just this one) via `scripts/reconcileMergedCategoryKeys.ts`. Lesson: any migration script that moves data between two rows needs to inventory *everything* that differs between them, not just the field the migration was nominally about.
2. **Apostrophes are a real collision surface.** `normalizeDictionaryKey` strips punctuation, so "Weils disease" and "Weil's disease" normalize identically and cannot exist as two separate `ped_aliases` rows — a naive "hide one, create the other" approach threw a unique-constraint violation. The general lesson (also seen earlier with "Bell's palsy" being unreachable via the legacy dictionary because its key preserved the apostrophe while normalization stripped it at lookup time) is that normalization consistency between where a key is *stored* and where it's *looked up* has to be verified explicitly, not assumed.
3. **Exhaustive validation catches what code review can't.** The `lost_dictionary_coverage` regression from lesson #1 was invisible to sandbox testing (which exercised the specific cases being fixed, not the full alias set) and only surfaced because `validatePedMigration.ts` re-compares literally every alias against every plan on every run. Point-fix verification is necessary but not sufficient for a change touching shared, denormalized data.
4. **A blanket regex is a liability the moment real data has exceptions.** The original ulcer plan-override fix used `/\bulcer\b/i` against every PED, which correctly caught gastric/duodenal/peptic ulcer but also incorrectly swept in "Diabetic foot ulcer" — a term legacy deliberately routed to the diabetes-complication path via an earlier pipeline stage. The fix generalized to an exclusion rule (`/\bdiabetic\b/i`) rather than a hardcoded ID list, so it holds for any future "diabetic ...ulcer" entry, not just the one found.
5. **Governance decisions belong in data, not code.** Every one of the plan-specific behavioral fixes this migration made (Bell's palsy, the ulcer exclusion, Cystoscopy's procedure routing) could have been written as more engine.ts regex. Choosing instead to encode them as `plan_overrides` rows / `categories` entries with a `reason` field means a future change is a data edit with an audit trail, not a code change requiring another migration like this one.

## 7. Remaining technical debt (not addressed this migration, tracked deliberately)

- **332 active PEDs with no `categoryKey`.** Pre-existing, not a regression (see §4), but worth a dedicated pass to either categorize them or confirm they're genuinely low-value/rare terms best left to AI classification.
- **Capitalization normalization.** Canonical PED names are inconsistently cased (e.g. lowercase "hysterectomy", "smoker", "tympanoplasty" sitting alongside properly-cased entries). Explicitly deferred per governance decision — Title Case + standard abbreviation casing (COPD, CKD, CABG, HIV) is scoped as a separate, presentation-only follow-up task, never mixed into this migration's identity/normalization work.
- **Admin UI does not yet filter by `is_visible`.** PED Library / PED Suggestions / AI Mapping Review can still display hidden (misspelling/action-phrase) aliases in some screens. The data layer is correct; the UI pass to consistently use `PedAliasesRepository.listVisibleByPed` wherever an admin-facing list is rendered has not been built yet.
- **`ped_mapping_overrides` remains a separate, parallel live-override system.** It predates this migration, is still actively read on every request regardless of `PED_SOURCE`, and is not yet unified with the new `ped_repository`/`ped_aliases` model — PED Library and AI Mapping Review edits still write into the old table. Bringing admin write paths onto the new schema is out of scope for "wire the runtime engine to read the new tables," which is what Phases 1-5 delivered.
- **4 hardcoded plan-specific blocks still exist in `engine.ts`** (OSA/DVT on Activ Fit Preferred, Crohn's-Colitis on Care Supreme, RA on Optima Secure) as a fallback beneath the generic `plan_overrides` check. Two of the four were empirically confirmed to be superseded by the DB path in production verification (OSA, and the related ulcer override); the other two were not independently re-verified this phase. A candidate for Phase 6 or a dedicated follow-up: migrate the remaining two into `plan_overrides` rows and remove the now-dead hardcoded blocks entirely.
- **QA Dashboard integration** (unrelated system, on hold from earlier work) — iframe embed confirmed blocked; native port recommended if resumed. Noted here only because it's the other open architectural item in this codebase at time of writing.

## 8. What Phase 6 will do (not yet approved, not yet started)

Per the design doc, Phase 6 strips the compiled dictionary data out of `types.ts` down to a seed-only artifact, once Phase 5 has been running in production long enough to build confidence. This report does not authorize that step — it is a prerequisite input for the user's separate Phase 6 approval decision.
