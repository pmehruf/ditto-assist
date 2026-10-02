# Mapping-control Phase 3B — safety backbone (3B-i) and routing-rule administration (3B-ii)

Status: **3B-i implemented on branch, validated by tests; staging/production rollout pending** (approved scope, 2026-10-02). Branch `mapping-control/phase2`. The Phase 2 engine, the legacy engine, `MAPPING_ENGINE=legacy` and the rollback path are unchanged. No existing production mapping changes by deploying 3B-i. Out of scope and not started: PED Category Governance, taxonomy consolidation, the ordered category chain (Phase 4), legacy cleanup (Phase 6), `LookupPage.tsx`, `DeclarationGuideSection.tsx`.

## Impact metrics (defined first)

Impact is measured by running the **same deterministic engine** over a corpus (every alias in the mapping + every term advisors searched in the last 90 days) × every active plan, on the world before the change and the world after it, and comparing. Nothing is estimated.

Per change: pairs changed, terms changed, plans affected, direct-match (P0 / plan-override) results changed, specific→Others losses (specificity loss), rules-answered→AI-step (resolved→unresolved), Others→specific gains, specific→different-specific swaps, and **advisor lookups affected** (last 90 days, by plan+term). The tier ladder P0 → P1 → P3 is used for the "from → to" transitions.

## Thresholds — chosen from production behaviour, not a round number

Measured on the production day-one snapshot (6 active plans, 1,402 aliases) with 90-day real usage (10,839 lookups, 1,554 terms), 60 random PEDs × 5 edit kinds + the 20 most-used PEDs:

| Edit | changed pairs p50 / p90 / max | advisor lookups p50 / p90 / max |
|---|---|---|
| one PED's category changed | 4 / 6 / 10 | 0 / 11 / 75 |
| one alias category override | 4 / 6 / 6 | 0 / 14 / 75 |
| category removed / alias disabled / alias deleted | 0 / 6 / 6 | 0 / ≤1 / ≤20 |
| the 20 most-used PEDs, category changed | 6 / 26 / 70 | 115 / 220 / 266 |

One term can only ever change in as many pairs as there are plans (6), so an ordinary edit touches ≤ 10 pairs. Therefore:

- **low** — ≤ 12 changed pairs, ≤ 6 plans, < 15 advisor lookups affected, and none of the "always high" signals below. Normal confirm.
- **elevated** — > 12 pairs, or ≥ 15 advisor lookups, or many question swaps. Explicit confirm with the numbers.
- **high** — ≥ 60 pairs, or ≥ 120 advisor lookups, **or any** direct-match result changing, a specific question lost to Others, or a lookup that would stop being answered by the rules. Explicit confirm of the preview + a signed preview token bound to exactly what was previewed.

Thresholds live in one constant (`IMPACT_THRESHOLDS` in `src/mapping/impact.ts`) and are re-derivable with the scratch simulation; they are reviewed when production usage shifts.

## 3B-i scope (this milestone)

1. **Impact preview** for every admin write that can change routing: PED Library (PED category/name, alias add/edit/delete incl. routing controls), plan configs (category map, anyOther, etc.), plan restrictions, plan PED overrides. A dry-run (header `X-Mapping-Preview: 1`) runs the real route logic inside a database transaction, computes impact, and **rolls back**. Preview and apply therefore cannot disagree about what a save does.
2. **Apply path** (`withMappingChange`): inside one transaction — lock `mapping_state` `FOR UPDATE`; run the route; recompute impact; require a valid signed preview token when tier ≥ elevated and refuse if the recomputed change no longer matches the previewed one (someone else changed things); write the change set; commit; bump the mapping version.
3. **Generic change sets / audit / undo**: table-level before/after diffs stored in `mapping_change_sets.ops`; `POST /api/mapping-changes/:id/undo` restores the exact rows, refuses (never forces) if any row has since changed. Existing 3A change sets still undo.
4. **Confirmation flow** in the UI (`ImpactPreviewDialog` + `mappingFetch`): low → one confirm showing counts; elevated/high → numbers, sample of affected lookups (most serious first) and an explicit confirm.
5. **Decision trace / "Why this result"** panel in `DeclarationAssistantResults` (admin/dev tiers only): decidedBy, tier P0/P1/P3, dictionary source, category, snapshot version, instance.
6. **Inert-control handling**: controls the live engine ignores are labelled or hidden (PED `status`; restrictions with no effect) — never shown as live. No routing change.
7. **Required change-control fields** on every mapping change: reason (required), change category per Part XIV, Business-Decision check per Part XI step 4. Stored on the change set.
8. **Constitution v1.4**: P0–P3 definitions as actually implemented (documentation), A1/A5 governance, change-control fields, impact thresholds.
9. Feature flag `MAPPING_IMPACT_GATE` (default off → routes behave exactly as in 3A until enabled per environment).

## Affected

- Tables: `mapping_change_sets` (+ columns, migration **0087**, additive, nullable). No existing mapping table changes shape.
- Routes: `/api/ped-repository*` (6), `/api/plan-configs*` (3), `/api/plan-restrictions*` (3), `/api/plan-ped-overrides*` (2) wrapped, not rewritten; new `POST /api/mapping-impact/preview`; existing `/api/mapping-changes*` extended.
- Code: `src/mapping/impact.ts` (new), `src/server/mappingChange.ts` (new tx wrapper/preview token/diff), `src/server/db/client.ts` (tx-scoped `getDb()`), UI components for PED Library / plan settings, `DeclarationAssistantResults.tsx`.

## Rollout sequence

1. Implement + tests on branch; full suite, `tsc`, build, Zero Regression Audit (Phase 2 equality of 113,130 pairs unchanged).
2. Neon restore point confirmed by the owner → migrate staging (0087) → deploy exact commit from a clean `git archive` export → enable `MAPPING_IMPACT_GATE` on staging → validate (preview accuracy vs real apply, token refusal, undo, propagation across instances, concurrency, permissions).
3. Migrate production (additive) → deploy same commit with the flag **off** → equality + smoke → enable the flag → validate with a temporary test PED, then revert.

## Validation gates

Preview predicted == actual on every route; no-preview apply of a high-impact change refused; stale token refused; undo restores byte-identical rows and is refused after later edits; every writer route covered by the audit test (no un-wrapped writer); propagation on a second instance; concurrent edits serialise; non-admin cannot see traces; engine equality baseline unchanged; full suite green.

## Rollback

Flag off (`MAPPING_IMPACT_GATE`) restores 3A behaviour with no redeploy; code rollback via traffic to the previous revision; migration 0087 is additive and unused by older code. `MAPPING_ENGINE=legacy` remains the engine rollback.

## 3B-ii (separate, later milestone)

Routing-rule administration: API + UI with validation, protected rule bands, rule revision column (migration 0088), preview/undo through the 3B-i machinery. Not started.

## Implementation notes (3B-i) — where it differs from the plan text

- **No separate preview route.** A preview is the real route called with `X-Mapping-Preview: 1`; with the gate off a preview request is refused (409), never executed. The audit test pins that every one of the 14 gated routes goes through `mappingGate`.
- **Confirmation binding is a content hash, not a signed token.** The server recomputes the impact on apply and compares a hash of exactly which (plan, term) answers change and how with the one the admin confirmed. It is not an authentication secret (the session is), which keeps it correct across Cloud Run instances without a shared signing key.
- **Changes that alter no lookup result** (e.g. disabling a plan, editing its Specific Illness list) are still recorded and undoable but need no reason or confirmation.
- **Preview cost at production scale:** about 2.4 s (2,387 terms x 6 plans x 2 worlds), serialised on the `mapping_state` row; per-user limit 150 requests / 15 min.
- Inert controls: PED `status` is labelled "Label only — does not affect matching" in the PED Library. Plan restrictions that the live engine ignores (e.g. a restriction on a category with no question in that plan) are NOT yet flagged in the UI — recorded as an open item for 3B-ii / 3C, no behaviour change.
- Tests: `mappingChange.test.ts` (preview changes nothing; gate off never writes; change-control required; stale/forged confirmation refused; predicted == live lookup; undo restores exact rows and is refused after later edits; deleted alias restored; concurrent changes serialise), `mappingWritePathAudit.test.ts` (inventory of gated routes), `constitutionP0P3.test.ts` (Constitution matches the code).

---

# 3B-ii — unified admin section, rule and category administration (R3 / R9)

Built on the proven 3B-i baseline (`8676358`); no engine, seed or legacy-engine code changed; no migration (`routing_rules` and `categories` already exist and are now part of the change-set row diff).

## What exists now (reused) vs. added

| R3 / R9 item | Where | Status |
|---|---|---|
| Assign a PED to a specific question of a specific plan | Plans & Questions → plan-specific PED mappings (`plan_overrides.target_question`) | Existing (3A/earlier), now gated by the impact preview |
| Assign a category to a specific plan question | Plans & Questions → category map | Existing, gated |
| Change a PED's category / leave it empty on purpose | PED Library | Existing, gated |
| Add / edit / rename / remove PEDs and aliases | PED Library | Existing, gated |
| Add / rename / remove **categories** | **Categories** | **New** (delete refused while anything uses the category) |
| Edit plan questions, plan-specific overrides / restrictions; add a plan or question | Plans & Questions | Existing, gated |
| **Order / priority of rules; enable / disable; add / edit supported rules without code** | **Rules** | **New** (stage bands, protected steps, full validation) |
| **See which rule decided a result** | Rules → "Test a lookup", and "Why this result" on a lookup | **New** / 3B-i |
| **One admin section, no duplicate pages** | **Mapping Control** (replaces "PED Repository" + "DA Mapping Config") | **New** |
| Audit + undo for all of it | History, plus Undo | 3B-i, extended to rules and categories |

## Not UI-controlled, with reasons (R3: "listed in the report")

- **The built-in algorithm steps** (`primitive.*`: plan override, exact wording, dictionary lookup, plan decision, diabetes-confirmed, hypertension, diabetes guard) are the pipeline skeleton; their parameters (e.g. the plan-decision explanation templates) are not exposed. Editing them rewrites the wording of every explanation — that is a Business Decision, not a routing control. Protected by design.
- **The compiled `TOP_PED_DICTIONARY` / legacy engine** remain only as the rollback oracle (Phase 6 cleanup, needs owner approval). They are not read at runtime in `db` mode.
- **Per-plan flags in `plan_configs.overrides`** (the three legacy booleans) are superseded by Plan Restrictions; unchanged.

## Safety properties (all tested — `src/__tests__/mappingAdmin.test.ts`, `mappingAdminAudit.test.ts`)

Invalid shapes / unknown categories, plans, result types, placeholders refused; match-everything and catastrophic patterns refused (nested-repeat check + timed worker probe); `ref` loops refused; positions confined to the stage band and unique; primitives, stage changes and built-in deletion refused; every write previewed (impact, with admin-supplied test terms), confirmed, audited, undoable; the next lookup — on a fresh instance, no restart — uses the change; categories in use cannot be deleted; only one writer of `routing_rules` / `categories` exists outside scripts; writes need Editor access to `plan_scope`, reads need Viewer access to either mapping feature.
