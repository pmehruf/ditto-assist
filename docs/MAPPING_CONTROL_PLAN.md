# Mapping-control implementation plan

Governing documents: `MASTER_CONSTITUTION.md` (incl. Change Impact Template, Part XII, Appendix F), the Validation Framework, the Collision Library, Change Control and Audit, and the existing Zero Regression Audit. **No separate regression framework is created.** Every category change is treated as potentially behaviour-changing.

| Phase | Scope | Status |
|---|---|---|
| 1 | Investigation, baseline, R10 findings, design | Done |
| 2 | One DB-backed control layer reproducing production exactly (equality migration), cutover | Built; cutover per `docs/MAPPING_CONTROL_PHASE2.md` |
| 3A | Authoritative admin mapping control: AI Mapping Review approve/reject on the live tables with live verification, audit + undo; retire legacy-only writers; script version bumps. See `docs/MAPPING_CONTROL_PHASE3A.md` | Built + validated on staging; live in production, approved and closed |
| 3B-i | Safety backbone: impact preview, confirmation scaled to measured impact, change-control fields, generic change sets + undo, "Why this result" trace, inert-control labelling, Constitution v1.4 (P0-P3 as implemented). See `docs/MAPPING_CONTROL_PHASE3B.md` | Built + tested on branch; staging/production rollout pending |
| 3B-ii | Routing-rule administration (API + UI, validation, protected bands, revision column) | Not started |
| 3 (remaining) | One admin section (R3/R9): rule/alias/plan/PED controls, audit + undo (A1), impact preview, category CRUD with safeguards (A3), UI-managed exceptions (A5), **admin write-path integrity: no action may report success for a change the live engine ignores (see below)** | Not started |
| 4 | Ordered category chain per PED (R11, A4) | Not started |
| 5 | Approved R10 corrections as a separate listed batch | Not started |
| **PED Category Governance** | **Named phase, after Phase 2 is signed off. Not built yet.** See below. | Planned |
| 6 | Cleanup: remove legacy paths, final Constitution check | Not started |

## Phase 3 requirement: admin write-path integrity (`ped_mapping_overrides`)

Recorded 2026-10-01 after the Phase 2 cutover. **Analysis only — no production mapping, engine or table was changed.** The legacy engine and the `MAPPING_ENGINE=legacy` rollback stay exactly as they are until Phase 3 is complete and separately validated.

**The integrity rule.** An admin must never be shown a successful mapping change when that change will not affect the live mapping engine. With `MAPPING_ENGINE=db` the engine does not read `ped_mapping_overrides`, so any action that still writes only there reports success for a change that does nothing. The old table must not be restored as a parallel source of truth.

### Inventory of everything that writes `ped_mapping_overrides` (from the code, 2026-10-01)

| # | Action | Where | Reachable by an admin? | Does the write reach the db engine? | Still required? | Phase 3 disposition |
|---|---|---|---|---|---|---|
| 1 | **AI Mapping Review → Approve** (promotes the AI answer to a category mapping; shows a "promoted" notice) | `PATCH /api/ai-memory/:id/status` → `promotePedMappingOverride` (server.ts ~4750); UI `AiMappingReview.tsx` | **Yes — live UI** | **No** — the success notice is misleading in db mode | Yes (approving an AI answer into a real mapping is a wanted workflow) | **Migrate** to write the authoritative config (PED/alias category in `ped_repository`/`ped_aliases`, or a plan override when the answer is plan-specific), with audit + undo; until then hide the promotion or show that nothing was applied |
| 2 | **AI Mapping Review → Reject** (un-promotes a previously approved entry) | same route → `unmapPedMappingOverride` (~4762) | **Yes — live UI** | **No** | Yes | Migrate together with #1 (reject must revert the authoritative change it made) |
| 3 | **"Teach it" mapping** | `POST /api/add-ped-mapping` → `promotePedMappingOverride` (server.ts ~965) | **No UI caller found in `src/`** — API route only | **No** | Probably not (superseded by PED Library) | **Retire** the route (or migrate if a caller is found); confirm no external caller |
| 4 | **Old PED Directory** create / edit / delete with a category | `POST/PUT/DELETE /api/ped-suggestions` → promote/unmap (server.ts ~4887, 4955, 4958, 5000); component `PedSuggestionsManagement.tsx` is **unwired** from every tab | **No UI**; routes still reachable | **No** | No (replaced by the PED Library) | **Retire** the routes and the dead component |
| 5 | **PED Library** create / rename / re-categorise / delete PED and alias **mirror** | `pedRepositoryLive.ts` (promote/unmap at lines ~74, 136–144, 169, 204, 248–250) | Yes — live UI | **Yes** — the primary write goes to `ped_repository`/`ped_aliases`, which the db engine reads; the `ped_mapping_overrides` write is only a rollback mirror | The mirror: only while the legacy rollback must keep working | Keep until the legacy path is removed (Phase 6); then delete. The admin-visible result is already truthful |
| 6 | One-off operational scripts (`scripts/applyGovernanceRules.ts`, `fixGallbladderCategory.ts`, `generateEntityCleanupPlan.ts`, `validatePedMigration.ts`) | scripts | Run by a developer | n/a | One-off | Audit each; none should write the old table after Phase 3 |

Readers of the old table (unchanged for now): `ensurePedOverridesLoaded` / `TOP_PED_DICTIONARY` merge — legacy path only.

### Phase 3 requirements

1. Every admin action that changes a mapping writes to the database-backed source of truth that `MAPPING_ENGINE=db` reads (`ped_repository`, `ped_aliases`, `routing_rules`, `plan_overrides`, `plan_configs`, `plan_restrictions`, `categories`) — and nothing else.
2. For each inventory row above: migrate to the authoritative mechanism, **or** retire/hide it until its replacement exists. No action may be left visible that reports success without effect.
3. The UI reports a mapping as changed **only after** confirming the live engine uses the resulting configuration (e.g. the mapping version was bumped and the post-save decision trace reflects it).
4. Every new admin mapping mechanism bumps `mapping_state` so the change reaches all instances on the next lookup, and is audited and undoable (A1).
5. Do not change any existing production mapping while doing this work; do not restore or extend `ped_mapping_overrides`.
6. The legacy engine, the legacy paths and the rollback switch remain until Phase 3 is completed and separately validated and the owner approves the cleanup.

### Zero Regression Audit additions for Phase 3

- **Write-path audit test:** enumerate every route that mutates mapping data; for each, assert it writes only to the authoritative tables and that, in `db` mode, a lookup immediately after the action returns the new result (and the reverted result after undo).
- **No-silent-no-op test:** for every admin mapping action, assert that a success response implies the decision trace for the affected term changed; assert retired routes return a clear "no longer available" error, not success.
- **No-parallel-source test:** in `db` mode, no admin action writes `ped_mapping_overrides` (assert the table is unchanged after each action).
- **AI Mapping Review test:** approve → live in the next lookup on every instance; reject → reverted; the notice text matches what happened.
- Existing audit items (plan isolation, override precedence, restriction/alias/collision integrity, deterministic, live propagation, equality against the frozen baseline) continue to apply unchanged.

## PED Category Governance (planned — after Phase 2 sign-off)

Must use the existing Constitution, Validation Framework, Collision Library, Change Control and Audit, and Zero Regression Audit.

- **G1 Create categories.** Authorised admins create a category in the admin UI, stored in the database and usable by the engine with no code change or redeploy. Minimum fields: name/key, description/purpose, active or deprecated status, related plan/question mappings, assigned PEDs. A new category needs a demonstrated mapping need (not "medically cleaner"); it must pass validation, collision and regression checks.
- **G2 Edit and deprecate.** Review categories, edit safe metadata, deprecate, move PEDs between categories. Show which plans and questions depend on a category and how many PEDs are affected. Never physically delete a referenced category — controlled deprecation and migration only.
- **G3 Duplicates and overlap (analysis first, change nothing).** Review the whole list for duplicates, near-duplicates (e.g. `eye_ent` / `eye_vision`), inconsistent naming, too-broad/too-narrow, unused, and routing-ambiguity categories. Do not merge because names look similar. For each proposed consolidation identify PEDs, aliases, plans, the questions routed to, plan-specific overrides, and shields/restrictions/disease-family rules that depend on it, then compare actual resulting behaviour. Classify each pair: true duplicate / intentionally distinct / overlapping but needing separation. Deliver a proposed taxonomy + impact report first; each proposed change carries reasoning, confidence, collision analysis, regression analysis, affected PEDs and plans, current vs proposed question mapping, and a migration + rollback approach. Implement only approved changes, only after they pass the Zero Regression Audit. The goal is a coherent list with no change to valid underwriting behaviour — not a tidier list.
- **G4 Keep plan-specific PED overrides.** Plan + PED → exact question stays higher priority than generic category mapping; category cleanup never removes the need for it (e.g. OSA: Sleep Disorder on Plan A, Respiratory on Plan B — solved by the override, not duplicate global categories). The override stays database-backed, plan-specific, alias-aware, shown in the decision trace, auditable, propagated without redeploy, and isolated to its plan.
- **G5 Impact preview** before any change/move/merge/deprecate: affected PEDs, aliases, plans and questions, current vs proposed mappings, plan-specific overrides that stay in force, potential collisions, potential fallback/unresolved changes.
- **G6 Dependency view** per category: Category → PEDs → aliases → plan mappings → plan questions → overrides → rules, shields and restrictions.
- **G7 Regression checks** for any category change: unrelated PEDs and plans unchanged; existing overrides still win; question and question-number mappings valid; fallback, secondary/supporting recommendations, restrictions and shields intact; aliases still route; no new collision.
- **G8 Constitution.** If this phase conflicts with the Constitution: report what blocks it, why it helps, the risk and a recommendation; keep working on what is not blocked; wait for approval in chat; then update the Constitution via the Change Impact Template and Version History.
