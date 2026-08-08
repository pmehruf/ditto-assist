# PED Repository Governance Model

Status: **approved, permanent governance policy** (established 2026-07-28, during the PED Repository DB migration's Checkpoint B). This document is the source of truth for how PED data is organized going forward — every future PED Library edit, seed script, or admin UI change should be consistent with it.

## Repository Architecture v1.0 — Stable (tagged 2026-08-07)

Architecture validated and formally approved via the congenital-routing governance review (`MAPPING_GOVERNANCE_REVIEW_CONGENITAL_FINAL.md`, supersedes its v1–v4 drafts). Sign-off basis:

- Repository architecture (`ped_repository` → medical category → `plan_overrides` → per-plan `categoryMap` → question) held up under an extended real-world stress test — 60+ conditions reviewed, several genuine architectural tensions surfaced and resolved (Optima Secure's disability/deformity routing) without any schema change or new routing stage.
- Runtime engine (`engine.ts`) required zero modification — only one regex-list edit (removing a stale `huntington` token now superseded by the dictionary) and data-layer changes throughout.
- Regression validation performed: baseline snapshot suite run, one pre-existing unrelated failure diagnosed to its root cause (stale snapshot, not a live regression) and resolved separately from this work.
- 12 governance principles documented and registered (see the review doc's Part D-equivalent section), including that `categoryKey = 'genetic'` on a structural anomaly is an implementation compromise, not a medical claim — logged specifically to prevent future misreading of the taxonomy.
- Explicit trade-offs recorded rather than hidden (the Optima Secure `genetic` repoint's wider blast radius on that one plan).
- Remaining ambiguous conditions (Ebstein's Anomaly, Eisenmenger Syndrome, Horseshoe/Duplex Kidney, Meckel's Diverticulum, Malrotation, Hirschsprung Disease, Congenital Glaucoma) intentionally held for manual review rather than force-resolved.

**Direction going forward:** repository enrichment (new conditions, alias coverage, AI-assisted governance review of ambiguous cases) rather than further core-architecture redesign. Any future change proposing a new `categories` row, a new routing stage, or a runtime-engine structural change should be treated as reopening this v1.0 baseline, not a routine repository update — flag it accordingly.

## The three layers

### 1. Repository (visible) — the source of truth

`ped_repository` + the aliases in `ped_aliases` where `is_visible = true`.

Contains professional medical terminology only:

- Canonical PEDs: the clinically correct name for a condition or procedure ("Cystoscopy", "CABG", "Appendicitis").
- Approved medical aliases: genuine alternate names a clinician would recognize — abbreviations (COPD ↔ Chronic Obstructive Pulmonary Disease, CKD ↔ Chronic Kidney Disease, OSA ↔ Obstructive Sleep Apnea, DVT ↔ Deep Vein Thrombosis) and accepted UK/US spelling variants (Anaemia/Anemia, Apnoea/Apnea, Oesophagus/Esophagus).

Does **not** contain: action phrases ("Cystoscopy done", "CABG performed", "Underwent CABG"), status phrases ("Dialysis patient", "Smoker status"), or misspellings, typos, and OCR artifacts ("Apendicitis", "Cholestrerol", "Tonsilitis").

Everything in this layer is safe to render anywhere an advisor sees it: dropdowns, search suggestions, PED Library listings, lookup results.

### 2. Normalization layer (hidden) — forgiving search, not a source of truth

`ped_aliases` rows where `is_visible = false`.

Same table, same `normalized_alias` matching mechanism as visible aliases — the only difference is the flag. Contains:

- Common typing mistakes and misspellings ("Apendicitis" → Appendicitis).
- OCR mistakes.
- Action phrases ("Cystoscopy done", "CABG done", "Underwent CABG" → CABG).
- Search-only synonyms that aren't themselves professionally accepted terminology.

The matching engine (`classifyDeterministic` / `pedRuntimeCache.ts`) deliberately does **not** filter on `is_visible` — a hidden alias resolves exactly as reliably as a visible one. The flag is a UI/presentation concern only: any admin screen that lists, searches, or offers autocomplete over PED names must filter to `is_visible = true` (or call `PedAliasesRepository.listVisibleByPed`) so an advisor never sees a misspelling or an action phrase presented as if it were correct terminology.

**This separation is the whole point**: a user can type "Apendicitis" or "Cystoscopy done" and still get matched correctly, without the repository itself ever looking anything but clinically clean.

### 3. Declaration engine — business logic, reads the other two

`engine.ts` (`classifyDeterministic` and the rest of the `/api/match` pipeline), `plan_overrides`, `categories`, plan configs.

Responsibilities:
- Reads canonical repository data (via the alias lookup, keyed by normalized text — visible or hidden, doesn't matter).
- Applies plan-specific overrides (`plan_overrides`: same PED, different question on a specific plan, for a documented underwriting reason).
- Applies umbrella/procedure routing (e.g. the `investigation_procedure` category, which routes a procedure name to the tests-and-investigations question instead of forcing it into a disease category).
- Makes the runtime P0/P1/P2/FALLBACK decision.

The engine should never need to know *why* a term resolves to a given PED — that's entirely the repository + normalization layer's job. It only decides, given a resolved PED and category, which question to route to.

## Practical rules this implies

1. **Never store an action verb or status word as a canonical name or a visible alias.** If a term is only reachable by users typing an action phrase, add it as a hidden alias, not a rename of the canonical entity.
2. **Never store a misspelling as a canonical name or a visible alias.** Fix the canonical name to the correct spelling; keep the misspelling as a hidden alias so search still finds it.
3. **Before renaming or adding an alias, check for a collision.** Because the repository was originally seeded from years of free-text legacy data, several concepts exist twice under different spellings/phrasings (e.g. "Nephrectomy" and "Nephrectomy history" were two separate `ped_repository` rows for one condition). A rename that lands on an already-existing canonical name or alias should become a **merge** (aliases re-pointed to the existing PED, the duplicate marked `status = deprecated` + `merged_into_id`), never two live PEDs for one concept.
4. **A plan-specific business rule belongs in `plan_overrides`, never in engine.ts regex.** If a rule is general enough to apply regardless of which plan (e.g. "mild/peripheral nerve conditions route to the general nervous question, not the severe stroke question"), it belongs in a governed `categories` entry (like `neuro_mild`) with a small, generic resolution rule in the engine — not a hardcoded list of disease names in a regex.
5. **A procedure/investigation is not a disease category.** Give it the `investigation_procedure` categoryKey (or a future refinement of the umbrella-question framework) rather than assigning it whatever disease category happens to be adjacent.

## Where this is implemented today

- Schema: `src/server/db/schema.ts` (`pedAliases.isVisible`, `pedRepository.mergedIntoId`/`status`).
- Matching: `src/engine.ts` (`classifyDeterministic`'s DB-alias-lookup stage; the `neuro_mild` / `investigation_procedure` categoryKey special cases).
- Governance/cleanup tooling: `scripts/applyGovernanceRules.ts` (Checkpoint B's Bell's palsy / ulcer / Cystoscopy fixes + the ongoing rule 1/2 audit), `scripts/generateEntityCleanupPlan.ts` + `scripts/applyEntityCleanupPlan.ts` (the action-phrase/misspelling rename-or-merge plan and its apply step).
- Validation: `scripts/validatePedMigration.ts` (cross-checks the DB-backed engine against the legacy engine before any cutover).
- Admin UI: `src/components/PedRepositoryManagement.tsx` (2026-07-29) — the "PED Repository" page's PED Library sub-tab. Filters alias listings by `is_visible` as described below.

## Open follow-up (not yet built)

**Update, 2026-07-29:** the "PED Repository" admin page (`PedRepositoryManagement.tsx`) now filters its alias-management panel by `is_visible` — visible aliases are listed normally; hidden ones are grouped separately underneath, visually muted, and labeled "normalization only." This closes the gap below for that one page.

Still open: **PED Suggestions/Directory** (the legacy `ped_directory`-backed page, no longer linked from any tab but still reachable via its API routes if something is pointed at it) and **AI Mapping Review** do not filter by `is_visible` — they predate this governance model and were not part of the 2026-07-29 change. A hidden alias is still correctly *excluded from matching bias* everywhere (the engine never filters on this flag), so this remains a presentation-only gap on those two surfaces, not a data problem.
