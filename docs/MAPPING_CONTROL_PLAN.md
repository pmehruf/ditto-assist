# Mapping-control implementation plan

Governing documents: `MASTER_CONSTITUTION.md` (incl. Change Impact Template, Part XII, Appendix F), the Validation Framework, the Collision Library, Change Control and Audit, and the existing Zero Regression Audit. **No separate regression framework is created.** Every category change is treated as potentially behaviour-changing.

| Phase | Scope | Status |
|---|---|---|
| 1 | Investigation, baseline, R10 findings, design | Done |
| 2 | One DB-backed control layer reproducing production exactly (equality migration), cutover | Built; cutover per `docs/MAPPING_CONTROL_PHASE2.md` |
| 3 | One admin section (R3/R9): rule/alias/plan/PED controls, audit + undo (A1), impact preview, category CRUD with safeguards (A3), UI-managed exceptions (A5) | Not started |
| 4 | Ordered category chain per PED (R11, A4) | Not started |
| 5 | Approved R10 corrections as a separate listed batch | Not started |
| **PED Category Governance** | **Named phase, after Phase 2 is signed off. Not built yet.** See below. | Planned |
| 6 | Cleanup: remove legacy paths, final Constitution check | Not started |

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
