# MASTER_CONSTITUTION
## Declaration Assistant — Mapping Engine

---

## Quick Start (read this before changing any mapping)

Most changes are small. You do **not** need to read all 17 parts first. Do this:

1. Read **Part VII — Mapping Rules** (how to evaluate the change).
2. Check **Part IX — Business Decisions** (is your change in an unresolved area?).
3. Follow **Part XI — Integration Workflow** (the lifecycle).
4. Run **Part XIII — Review Process** (the reviewer checklist).
5. Pass **Part XII — Regression Philosophy** (snapshot + tests before release).

**If unsure: never guess. Escalate the Business Decision (Part IX) to its owner.**

Two rules that override convenience: do not change existing production behavior without a reviewed regression diff, and do not resolve a Business Decision yourself.

---

## AI Usage (read this first if you are an AI assistant)

When AI is used to review or integrate mappings:

- Read this Constitution first and treat it as the **highest authority**.
- **Do not invent governance.** If a rule is not in here, it does not exist — surface the gap, don't fill it.
- **Do not resolve Business Decisions** (Part IX / Appendix G). Flag them for a human owner.
- **Preserve existing production behavior.** Any change to an existing (condition, plan) output is a regression event (Part XII) and must be surfaced, never silent.
- Respect the four classifications (see "How to read classifications" under Version Information). Never mark something [CURRENT] unless it is provable from the engine.

---

## Version Information

- **Version:** 1.10
- **Status:** Authoritative — approved baseline. This is the single highest-authority governance document for the mapping engine.
- **Last Updated:** 2026-10-07
- **Authority:** This document supersedes and consolidates all prior governance material — the Mapping Policy Charter, the Production Governance Manual, and any Validation Framework, Integration Playbook, Change Control, Mapping Governance, or Integration Rules notes. Those documents become optional historical reference. Where any of them conflicts with this Constitution, **this Constitution governs.**
- **Purpose:** To let any future contributor or AI assistant safely maintain and extend the engine using this one document alone — preserving current production behavior, keeping governance and process distinct from behavior, and never silently resolving decisions that belong to the business.

### How to read classifications

Every normative statement in this document carries exactly one tag. They are never merged.

- **[CURRENT]** — Current Production Behavior. Provable from the engine's execution order or implementation.
- **[GOVERNANCE]** — Governance Rule. A rule contributors must follow; not runtime behavior.
- **[BUSINESS]** — Business Decision Required. An area where production defines no single policy. Documented, never resolved here.
- **[PROCESS]** — Process Requirement. A required workflow step.

**Classification integrity rule** — [GOVERNANCE]: If a statement cannot be proven from the production engine, it must not be tagged [CURRENT]. It is instead [GOVERNANCE], [BUSINESS], or [PROCESS].

### Document map

- **Behavior reference** (do not change without a regression run): Parts I–VI, XV, XVI; Appendices A, B, C, H.
- **Governance & process** (changing these does not change the engine): Parts VII, VIII, X, XI, XII, XIII, XIV; Appendices D, E, F, G.
- **Unresolved:** Part IX and Appendix G.

This map is a navigation aid only. A Part may contain statements of more than one classification (for example, Part VI includes both [CURRENT] and [GOVERNANCE] content). The classification tag on an individual statement always takes precedence over this section-level grouping.

---

# Part I — Mission

**What the engine is** — [CURRENT]
The mapping engine (`src/mapping/routingEngine.ts`, a database-driven interpreter of the `routing_rules`, `ped_aliases`, `ped_repository` and `categories` tables) is a **deterministic router**. Given a declared pre-existing condition (PED) and a selected plan, it returns one outcome: a `match_type` (P0 / P1 / FALLBACK / NON_AILMENT / ESCALATE / INVALID) and the specific plan question under which the condition should be declared (or the plan's Others/Any-other catch-all). It is **wording-first and plan-aware**: it resolves a condition to a category, then resolves that category to *this plan's actual question text* via each plan's `categoryMap`.

**What the engine is not** — [CURRENT]
It is not a medical taxonomy, not a diagnosis tool, not a universal medical-routing authority, not a source of medical truth, not the sole decision-maker (unmatched inputs pass to an AI fallback outside the engine), and not a multi-declaration system. Its "disease family" groupings are matching conveniences, not clinical classifications. (Full non-goals: Part XVI.)

---

# Part II — Scope

**Responsibilities** — [CURRENT]
Accept a (condition, plan) pair; route it deterministically to a single declaration question or fallback; surface applicable umbrella (hospitalisation/surgery/medication) questions; return an advisory to cross-check the declaration framework before final disclosure.

**Limitations** — [CURRENT]
The engine routes by text and pattern matching against plan wording and category assignments. It performs no clinical inference, no risk scoring, and no report interpretation. When no deterministic stage matches, it returns `null` and defers to the AI layer.

**Intended use** — [GOVERNANCE]
The engine assists advisors in locating the correct declaration question. Its output is advisory and must be cross-checked by the human advisor; it does not replace underwriting judgment (Part XVI).

---

# Part III — Core Principles

Only principles provable from the implementation. Aspirational rules are excluded (see Part IX for what production leaves open).

1. **Wording-first routing** — [CURRENT]. Routing terminates at the question whose text covers the condition. Evidence: the exact plan-wording chunk-match stage returns `P0` when a condition equals a `/`-separated question fragment; `questionForCategory()` resolves each category to real plan question text. Exact wording outranks category inference.
2. **Plan-aware routing** — [CURRENT]. The same category resolves to different questions per plan because `categoryMap` is per-plan; plan overrides and `overrides` flags (`requiresInsulinForDiabetes`, `bypassBenignTumors`, `excludePrediabetes`) further alter routing for named plans. Evidence: `if (planName === "…")` blocks executed before generic logic.
3. **Deterministic routing** — [CURRENT]. Output is a pure function of (condition, plan). Evidence: baseline snapshot tests (`src/__tests__/engine.baseline.test.ts`, `specificIllnessEngine.baseline.test.ts`).
4. **Conservative fallback** — [CURRENT]. Symptoms, tests, life stages, acute/transient events, and non-diagnoses route to Others with umbrella questions surfaced. Evidence: life-stage firewall; test/acute-infection/ambiguous-symptom/lab shields; `finalizeOutput` attaching umbrella `secondary_recommendation` to FALLBACK outputs.
5. **Single-declaration routing** — [CURRENT]. Each condition resolves to exactly one `matched_question`. Evidence: no multi-question emission path exists.
6. **Unknown → AI handoff** — [CURRENT]. When no stage returns, the routing engine returns no decision and the surrounding service defers to AI. Evidence: the terminal `return null`.

---

# Part IV — Runtime Architecture

**Execution order (the first stage that returns wins)** — [CURRENT]

1. **Natural life-stage firewall** → `NON_AILMENT` (pregnancy, menopause, puberty, lactation, "healthy/normal/nil/n-a", vaccination, routine checkup). Hard exception: inputs containing `ectopic` bypass it.
2. **Plan-specific overrides** — Activ Fit Preferred, Care Supreme, Optima Secure `planName ===` blocks. Since 2026-07-28, each block first checks the term's *current live* dictionary category (see stage 5) and uses that if it differs from the term's original compiled default, falling back to the block's own historical hardcoded category only when no live override exists — added because an admin re-categorizing a term (e.g. PED Library) previously had no effect on these four plans. Since 2026-07-28/29 (PED Repository DB migration, see below), when the caller passes a populated `dbSource`, a DB-backed generic plan-override lookup (`plan_overrides` table, keyed by `planName` + the resolved PED's id) runs ahead of these hardcoded blocks and takes precedence if a matching row exists — this is the intended eventual replacement for all four blocks (Part IX is silent on when/whether to retire them; not yet done).
3. **Fast-path safety shields (A–I)** — global test firewall; acute-infectious firewall; hypoglycaemia; DVT/PE; gangrene; hypotension; gestational/Type-2 diabetes; prediabetes; HPV/HIV-only coupling.
4. **Exact plan-wording chunk match** → `P0`.
5. **Dictionary exact-match routing** — looks up the normalized key in the database alias map (`ped_repository`/`ped_aliases`, read through the live mapping snapshot) and routes on the PED's category (or the alias's `category_key_override`). The compiled `TOP_PED_DICTIONARY` is **not** consulted by routing. Pseudo-category keys short-circuit to fixed fallbacks (`vascular_fallback`, `acute_infection`, `ambiguous_symptom`, `lifestyle`, `natural_life_stage`, `acute_trauma`, `benign_growth`); otherwise `questionForCategory`.
6. **Disease-family regex sections** (~24 ordered blocks).
7. **Generic shields** — benign growths, allergy, gynecomastia, ambiguous symptoms, lab findings, diagnostics, isolated procedures/trauma.
8. **No match** → `null` → **AI fallback** (outside this engine).

**Single source of truth (final architecture, v1.7, 2026-10-06)** — [CURRENT]. The database-backed routing engine is the only routing engine. The earlier legacy engine (`src/engine.ts` / `classifyDeterministic`), the `PED_SOURCE` and `MAPPING_ENGINE` server flags, the in-memory dictionary cache (`pedRuntimeCache.ts`), the browser-side classifier, the legacy mirror writes and the `MAPPING_ENGINE=legacy` rollback switch were **removed** in Phase 6. Consequences:
- Every routing input is a database row read through the per-instance mapping snapshot (reloaded when `mapping_state.version` changes): PEDs, aliases, categories, routing rules (including the four plan-specific rules and the shields), plan configs, plan restrictions and plan-specific PED mappings. The stage descriptions above (the plan-specific blocks, shields A–I, dictionary and regex sections) are `routing_rules` rows or named primitives interpreted by `src/mapping/routingEngine.ts`; the order and precedence are unchanged.
- Every lookup goes to the server (`/api/match`); the browser does not classify. AI-answer post-guards use the same database rules (`applyPostGuardsFromSnapshot`).
- The "PED Repository" admin UI writes only to `ped_repository`/`ped_aliases` (`src/server/pedRepositoryLive.ts`); there is no second store and no mirror, so a saved edit is live on every instance on its next lookup.
- **Regression oracle** — [GOVERNANCE]. The live legacy engine can no longer serve as the oracle. Regression protection is the committed frozen baselines in `src/__tests__/fixtures/mapping/` (production day-one snapshot and baseline; post-R10 snapshot and baseline of 113,130 (term, plan) pairs; the documented R10 deliberate differences; AI post-guard expectations; frozen audit expectations), compared by the equality and Zero Regression Audit tests and by `npm run mapping:freeze` (`--out`, `--compare`, `--dump`; read-only). A change to routing behavior must be explained against these baselines (Part XII); an intended change refreshes the baseline in the same reviewed change.
- **Compiled data kept, not used for routing** — [CURRENT]. `TOP_PED_DICTIONARY`, the compiled plan configs in `src/types.ts` and the seed tooling (`legacyRuleSeed.ts`, `seedBuilder.ts`, `mappingSeed.ts`, `seedMappingControl.ts`) remain as seed/provenance data and display fallbacks. The Lookup page's *suggestion* fallback (`TOP_PED_DICTIONARY`, `SCRIPT_DICTIONARY` in `src/App.tsx`) only offers typing suggestions; it is not part of routing and never decides a declaration. The legacy tables `ped_mapping_overrides` and `ped_directory` are retained as historical data and are not read by routing.
- This does not change anything in Parts I–III, V–IX (routing precedence, evidence hierarchy and unresolved Business Decisions are unaffected).

**Stage before stage 1 — admin plan-specific PED mapping** — [CURRENT] (in the engine since 2026-08; documented here 2026-10-01). Before the life-stage firewall, `applyPlanPedOverride` checks the plan's `plan_overrides` rows (attached to the plan config on every lookup, so they are always read fresh): an exact alias match first, otherwise the longest contiguous word-span of the input (up to 15 words) that is one of the PED's aliases. A hit returns that PED's exact question (or its category's question) on that plan, flagged `plan_override`, and the post-guards are skipped for it. It outranks every stage below.

**Plan restrictions and flags** — [CURRENT] (documented 2026-10-01). A plan can narrow what its diabetes and benign-growth questions accept through `plan_restrictions` rows (modes `require_keywords`, `exclude_keywords`, `block_category`) or the legacy `plan_configs.overrides` flags (`requiresInsulinForDiabetes`, `excludePrediabetes`, `bypassBenignTumors`); where both exist the row takes over. Only the `diabetes` and `benign_growth` categories are read by the engine today — a restriction on any other category has no routing effect.

**Where classification runs (browser and server)** — [CURRENT], confirmed 2026-10-01 against the production service configuration:
- Historical note (removed in v1.7): before Phase 6 the browser classified first with compiled rules when `MAPPING_ENGINE` was unset or `legacy`. That path no longer exists; every lookup is classified by the server's database-driven engine.
- The browser does not classify; every lookup goes to the server's data-driven engine (below).

**Mapping-control layer (the only engine since v1.7)** — [CURRENT] (added 2026-10-01). `src/mapping/routingEngine.ts` interprets the `routing_rules`, `ped_aliases`, `ped_repository` and `categories` tables and reproduces the legacy pipeline exactly. Equality with production's day-one behaviour was proven on 113,130 (term, plan) pairs, including explanation text, umbrella recommendations and supporting flags (`src/__tests__/mappingControl.equality.test.ts`; frozen baseline `src/__tests__/fixtures/mapping/production-day-one.*`). The legacy engine that served as the migration oracle was removed in Phase 6 (v1.7) after the database engine was proven against frozen baselines; those baselines are now the oracle.
- *Order (first stage that returns wins; each row is a `routing_rules` row or a named primitive):* admin plan-specific PED mapping (primitive) → life-stage firewall → plan-scoped rules (AFP sleep apnea, AFP vascular, Care Supreme IBD, Optima autoimmune-joint; **fixed categories** — they no longer follow a changed dictionary category, approved 2026-10-01) → shields A–I → exact plan wording / P0 (primitive) → dictionary stage: alias lookup (primitive), benign-CNS reassignment, category short-circuits (vascular_fallback, autoimmune on Optima, acute_infection, allergy, gynecomastia, ambiguous_symptom, eosinophilia_finding, lifestyle, natural_life_stage, acute_trauma, neuro_mild, investigation_procedure, benign_growth), then the Plan Decision (primitive) → disease-family rules in the legacy order → generic shields → unresolved (AI step). Post-processing: sanitize → post-guards (rules; skipped for plan overrides) → finalize.
- *Alias compatibility controls* — per alias, applied only at the dictionary stage; they never override exact wording, plan overrides, shields or plan rules: `routing_enabled = false` → the alias has no dictionary entry; else `category_key_override`, when set, replaces the PED's category; else the PED's own category is used. The category then passes through the same short-circuits and Plan Decision as before. Third control (approved 2026-10-01): `fallback_category_key` is a last-resort category — only if the whole pipeline resolved nothing with the primary category is the pipeline run once more with this category in the dictionary stage. It reproduces production's browser-then-server two-pass behaviour (the browser classifies with the compiled dictionary; only if that finds nothing does the server run with `ped_mapping_overrides` merged in) for the aliases where those two differ. They exist so the data-driven engine can reproduce production without deleting or changing any PED data; each is visible and editable in the PED Library ("Matching options") and shown in the lookup trace.
- *Named engine primitives (code, no editable mapping data):* admin plan-override matching, exact-wording match, dictionary lookup, Plan Decision, confirmed-diabetes handling, hypertension complication handling, and the diabetes-restriction post-guard; plus sanitize/finalize post-processing and umbrella-question detection. Their patterns, tables and message templates are held as rule parameters.
- *Live propagation:* every lookup reads the single-row `mapping_state.version`; each instance reloads its snapshot when the number changed. Writes that can change a routing result bump it, so a change is live on every instance on its next lookup. The decision trace (`decision_trace`: deciding rule, post-guard, dictionary source) is returned with each result.
- *Rollback:* the `MAPPING_ENGINE=legacy` switch was removed in v1.7. Rolling back a mapping change is done with change-set undo (Mapping Control → History); rolling back code is a redeploy of the previous revision.
- *Ordered category fallback per PED (added 2026-10-02, Phase 4 / R11)* — [CURRENT]. A PED keeps its primary category (`ped_repository.category_key`) and may have an ordered list of fallback categories after it (`ped_repository.category_chain`, at most 5, no repeats, every entry an existing category, a primary category required; NULL = none, which is every PED at deployment). The chain is evaluated in exactly one place: the dictionary stage (`primDictionaryLookup`), where the PED's category is turned into the category the later stages route on. For the selected plan the engine walks primary, then each fallback in order, and uses the FIRST category the plan has a real question for; only that category is used, so a PED still produces one declaration. A **real question** is one that exists on the plan (`questionForCategory`) and is not the plan's Others / catch-all question. If no category in the chain has a real question the PED's primary category is used and the existing behavior runs unchanged (the same Others / family-rule / generic-shield / AI-step fall-through as today); nothing new is invented. The chain does not apply to a category that comes from an alias-level override or to the last-resort second pass, and it never reaches the stages before the dictionary stage: plan-specific PED mappings, life-stage firewall, plan rules, shields and exact plan wording (P0) all still take precedence. Each lookup's decision trace records the configured order, the category used, and why earlier categories were skipped (no question on this plan, or mapped to Others); the admin trace and "Why this result" show it in plain language. The chain is edited in Mapping Control > PED Library (a PED's "Which category should be used?"), through the same preview / confirmation / change-set / undo gate as every other mapping change, (saving one outside the engine is refused, not ignored). [BUSINESS — owner to confirm] The definition of a "real question" (a plan-mapped category that points at the plan's Others question does not count) is the implementation's reading of the approved R11 text; it only matters for PEDs that are given a chain.
- *Mapping Control — one admin section; rule and category administration (added 2026-10-02, Phase 3B-ii)* — [CURRENT]. There is one admin section for the declaration engine ("Mapping Control"), with sub-views (on-screen names since v1.8): PED Library (formerly the first sub-tab of "PED Library & AI Review"; access `ped_suggestions`), AI Mapping Review (the AI answers waiting for review; access `ped_suggestions`), Plans & Questions (plan configuration with restrictions, category mapping, plan-specific PED mappings; access `plan_scope`), Categories, Decision Steps (formerly "Rules"), and History. It replaced the separate "PED Repository" and "DA Mapping Config" pages; each person still sees only the sub-views their existing access allows. There is exactly one category list (`categories`) and one routing pipeline (`routing_rules`); the only writer of either is the admin ops module behind the impact gate (a test pins this). **Rules:** every routing rule is a `routing_rules` row. An admin may enable/disable a rule, reorder it within its stage, edit its description/definition, and add, edit, reorder or delete custom rules (`custom.*`). An admin may not change a rule's stage, move a rule outside its stage's position band, touch a built-in algorithm step (a `primitive`: plan override, exact wording, dictionary lookup, plan decision, diabetes/hypertension algorithms, diabetes guard), or delete a built-in rule (disable it instead). Stage bands: life-stage firewall 20–29, plan rules 30–99, shields 100–199, exact wording 200–299, dictionary stage 300–399, plan decision 400–499, disease-family rules 500–999, generic shields 1000–1999, post-guards 10–99 (ordered separately). New rules may be added to plan rules, shields, disease-family rules, generic shields and post-guards. **Validation (an admin edit cannot take lookups down):** only the condition/action shapes of `src/mapping/ruleTypes.ts` are accepted; category, plan and rule references must exist; `ref` chains may not loop; result types are limited to P0/P1/FALLBACK/NON_AILMENT/ESCALATE/INVALID (never P2, which is AI-only); message placeholders are limited to the known set; every pattern the admin introduces or edits is checked for catastrophic backtracking (static nested-repeat check plus a timed probe in a worker thread), and a pattern that matches empty text or more than 25% of the dictionary is refused as "matches everything". Unchanged built-in patterns are not re-probed. **Impact:** rule and category writes use the same preview / confirmation / change-set / undo gate as Phase 3B-i, and an admin may supply extra terms to include in the impact measurement (so a new rule is measured on the wording it is meant to catch). Categories can be added, renamed (label only; the key is permanent) and removed; a category still used by any PED, alias setting, plan question mapping, plan-specific mapping, restriction or rule cannot be removed (the server reports exactly what uses it). **Which rule decided a lookup:** Mapping Control > Rules includes a read-only "Test a lookup" (no AI call, no search history, no AI Memory write) that names the deciding rule, its stage and position, the dictionary source, any post-guard, and — if the rules do not decide it — the AI Memory entry that would be served. Rule and category writes are available only with `MAPPING_ENGINE=db`.
- *Impact gate for admin mapping writes (added 2026-10-02, Phase 3B-i)* — [CURRENT] when `MAPPING_IMPACT_GATE=on`; with the flag off, Phase 3A behavior applies unchanged. Every admin route that can change a routing result (PED Library PED/alias writes, plan configs, plan restrictions, plan-specific PED mappings) runs inside one database transaction. A preview request executes the route's real logic and rolls it back, returning the measured impact; an apply recomputes the impact, requires the change-control fields and (above low impact) the admin's confirmation of that exact impact, records a row-level change set (`mapping_change_sets`) and bumps the mapping version. Impact is measured by running the live deterministic engine over every alias plus every term advisors searched in the last 90 days, across all active plans, before and after the change. A change set can be undone from the audit list; undo restores the exact rows and is refused, never forced, if any have changed since. Impact tiers (thresholds in `IMPACT_THRESHOLDS`, derived from production behavior; see docs/MAPPING_CONTROL_PHASE3B.md): **low** (<= 12 changed lookups, < 15 advisor lookups affected, none of the safety signals), **elevated** (more than that), **high** (>= 60 changed lookups, >= 120 advisor lookups, or any direct-match change, specific question lost to Others, or lookup that would stop being answered by the rules). Staff tiers can open "Why this result" on a lookup (decision trace: deciding stage, match level, dictionary source and category, mapping version, server).
- *Admin mapping actions (added 2026-10-02, Phase 3A)* — [CURRENT]. An admin action may only report a mapping change as made if the live engine uses the result. AI Mapping Review **Approve** sets the term's category on `ped_repository`/`ped_aliases` (creating the PED and alias if the term is unknown) — it never overwrites a category the term already has, and it is refused when the alias carries matching options; it then bumps the mapping version, runs a fresh lookup through the live engine and reports success only if that lookup returns the approved question via the new category, otherwise the change is reverted and the reason shown. **Reject** reverses exactly what the approval did (refused, never forced, if the rows were edited since) and verifies the next lookup no longer uses it. Each change is recorded as an undoable change set (`mapping_change_sets`, who/what/the confirming lookup) plus `mapping_history`, and can be undone from AI Mapping Review. These actions do not write `ped_mapping_overrides`. The other actions that wrote only that table (the "teach it" route `/api/add-ped-mapping` and the old PED Directory create/edit/delete) answer 410 and change nothing (the legacy path they served was removed in v1.7). Operational scripts that write the mapping tables bump the mapping version.

**Post-processing (always after a route is chosen)** — [CURRENT]: `sanitizeOutput` → `applyPostGuards` (plan-aware corrections, e.g. Care Supreme diabetes Type-1 restriction; SLE/lupus organ-reroute) → `finalizeOutput` (resolves the question against the plan's real text, attaches umbrella recommendations, applies terminology and advisory-footer rules).

**AI fallback boundary** — [CURRENT]: The engine's responsibility ends at `return null`. The AI layer lives in the service, not this engine; it is invoked only when deterministic routing yields no match.

(Diagram: Appendix A.)

---

# Part V — Decision Hierarchy (runtime precedence and tie-breaking)

**Implemented precedence** — [CURRENT]
- **Plan override beats everything downstream.** `planName ===` blocks run before shields, dictionary, and regex.
- **Exact wording (P0) beats dictionary and regex.** The chunk-match stage precedes dictionary routing.
- **Dictionary beats regex.** Dictionary exact-match routing (stage 5) precedes the disease-family regex sections (stage 6). This is why a condition present as a dictionary key routes by its category even when a later regex would match it differently.
- **Among regex sections, earlier wins.** Sections are evaluated top-to-bottom; the first match returns. Section order is the de-facto tie-break for multi-family conditions.
- **Benign CNS override.** A specific check reassigns `categoryKey` to `benign_growth` for meningioma / acoustic neuroma / craniopharyngioma before category resolution.
- **Post-guards can override the chosen question** (`applyPostGuards`).

**Undocumented-but-real (behavior exists; no stated rule)** — [CURRENT behavior / [GOVERNANCE] gap]
- Two regex sections both matching is resolved only by source order; there is no named tie-break policy — contributors must read section order.
- A canonical term and a qualified variant (e.g. same words plus an adjective) can resolve at different stages; the engine does not guarantee a variant matches its canonical form.

**Not settled by production** — [BUSINESS]
- Whether all synonyms of one condition must route identically (Part IX, item 6).
- Precedence when a plan's `categoryMap` could resolve one condition to two different questions (Part IX, item 9).

(Decision tree: Appendix C.)

**Match priority ladder P0 → P1 → P2 → P3 (documented 2026-10-02, Phase 3B; documentation of existing behavior, no runtime change)** — [CURRENT]
- **P0 — Direct Match.** The condition is exactly (or names) wording of a plan question: the exact plan-wording stage (`match_type` `P0`) and admin plan-specific PED mappings (`plan_overrides`). Shown as "Level 1: Direct Match" (`src/utils/matchTier.ts`).
- **P1 — Category Match (deterministic).** The dictionary resolves the condition to a category and the plan's `categoryMap` gives the plan's question for that category (`match_type` `P1`). "Level 2: Category Match".
- **P2 — Category Match (AI-found).** The same outcome reached by the AI step when no deterministic rule resolved the condition (`match_type` `P2` in the AI response schema). It is displayed identically to P1. **The deterministic engine never produces P2.**
- **P3 — Fallback.** No specific question covers the condition: the plan's umbrella / Others / Any-other question (`match_type` `FALLBACK`; "P3" is the documentation label only and is not a stored value). "Level 3: Fallback".
- Outside the ladder: `NON_AILMENT`, `ESCALATE`, `INVALID`.
- **Question-wording precedence:** a specific question that names the condition outranks a broader or catch-all question; a specific mapping (exact wording, plan override, or a more specific rule) overrides a broader one; where no safe mapping exists the result is the fallback (P3), never a guessed specific question.

---

# Part VI — Evidence Hierarchy (how to justify a mapping)

Used to decide or defend where a condition routes. Higher evidence overrides lower. — [CURRENT] for 1–4; [GOVERNANCE] for 5–6.

1. **Insurer question wording** — [CURRENT]. Decisive where a plan's text names or encompasses the condition (encoded by P0 and `questionForCategory`).
2. **Plan-specific implementation** — [CURRENT]. An existing override or `overrides` flag for that plan.
3. **Existing production behavior** — [CURRENT]. The current baseline snapshot; changing it is a regression event (Part XII).
4. **Existing dictionary / synonym / category behavior** — [CURRENT]. How the canonical term and siblings already route.
5. **Clinical reasoning** — [GOVERNANCE]. Used only to *pick a category* where wording and precedent are silent — never to override plan wording. The engine encodes clinical reasoning only as far as its existing category assignments.
6. **Fallback** — [CURRENT]. If nothing above resolves: Others + umbrella, or AI handoff.

### Normative (authority) hierarchy for resolving conflicts — [GOVERNANCE]

Distinct from runtime order (Part V) and evidence-for-a-new-mapping (above). This is the authority order a reviewer uses when two sources disagree. Highest wins:

1. Plan declaration wording
2. Existing approved production behavior (a stability / no-regression authority)
3. Approved plan overrides
4. Approved dictionary behavior
5. Approved regex behavior
6. This Constitution
7. Contributor judgment (only where 1–6 are silent; always recorded)
8. Clinical reasoning (only to pick a category where all above are silent)

**Reconciliation note** — [GOVERNANCE]: Ranking "existing approved production behavior" above "approved plan overrides" is a no-regression principle, not a claim that generic behavior out-routes an override at run time. At run time, plan overrides still execute first for their plan (Part V) — an approved override *is* approved behavior for that plan, so they do not normally conflict. The one case where a *generic* approved behavior would genuinely contradict a *plan-specific* override for the same condition on the same plan is **not settled by production** and is recorded in Part IX (item 8).

(Evidence diagram: Appendix B.)

---

# Part VII — Mapping Rules (integration decision framework)

How a contributor evaluates a new condition. This framework deliberately does **not** prescribe one medical philosophy, because production implements none (Part IX). — [GOVERNANCE]

For each new condition, evaluate in order:

1. **Declaration wording.** Does any plan question already name or encompass it? If yes, that plan routes by wording; record it.
2. **Plan wording differences.** Expect and document that the condition may route to different questions on different plans. This is correct, not an inconsistency.
3. **Specificity.** Prefer the most specific covering question (consistent with `P0 > P1 > FALLBACK`).
4. **Overlap.** Enumerate every stage (override, dictionary, regex) that could match; the earliest in the Part IV order wins — verify it is the intended stage.
5. **Collision.** Check whether the condition's tokens also match an unrelated earlier regex or a firewall; decide whether the earlier capture is acceptable.
6. **Fallback.** Confirm terminal behavior when a plan has no covering question.

Where this cannot yield a single deterministic answer because production itself has competing behaviors (e.g. manifestation routing), stop and escalate to **Business Decision** (Part IX) — do not choose arbitrarily. — [GOVERNANCE]

---

# Part VIII — Mapping Invariants

Principles that must never be violated.

1. **Determinism** — [CURRENT]. Output must remain a pure function of (condition, plan). Evidence: baseline snapshots.
2. **Plan-override isolation** — [CURRENT]. A `planName ===` override affects only that plan. Evidence: overrides gated by exact plan-name check. Contributors must never place plan-specific logic in the global dictionary or a shared regex.
3. **No silent routing changes** — [GOVERNANCE]. Any change to an existing (condition, plan) outcome must be surfaced as a reviewed snapshot diff.
4. **No unrelated collateral change** — [GOVERNANCE]. Integrating one condition must not shift the routing of an unrelated one; because dictionary-before-regex and section-order are global, a broad new regex can capture unintended inputs — this must be checked.
5. **Synonym consistency where intentionally defined** — [GOVERNANCE]. Where a synonym set is declared to route identically, that must hold. (Not globally enforced by the engine — Part IX, item 6.)
6. **Firewall precedence preserved** — [CURRENT]. Non-diagnosis firewalls must continue to intercept before disease routing, preserving conservative fallback.
7. **Regression gate** — [GOVERNANCE]. No mapping change ships without a baseline snapshot comparison.

---

# Part IX — Business Decisions Required

Areas where production establishes no single deterministic policy. Documented as unresolved; **not** solved here. Each requires the product/underwriting owner to decide before it can move into Parts III–VII. — [BUSINESS]

1. **Manifestation routing (root disease vs affected organ).** Some complications route to the root disease, others to the affected organ; no single governing rule exists. Define one policy (organ-first, root-first, or a wording-dependent framework) and apply it uniformly.
2. **Multi-family conditions.** Resolved today only by regex section order. Decide whether a named primary family is required or whether "one deterministic route via ordering" is the accepted policy.
3. **Investigation vs diagnosis precedence.** Some investigations pre-empt a co-mentioned diagnosis (early test firewall); others defer to it (late diagnostics section). Define one precedence.
4. **Finding polarity.** No systematic handling of positive / negative / incidental findings. Define how each should route.
5. **Organ containment for systemic diseases.** The post-guard keeping SLE/lupus/scleroderma/Sjögren on the autoimmune question covers only some organ targets. Decide whether containment should be complete or the organ-first rule (item 1) applies.
6. **Synonym-consistency enforcement.** Whether all synonyms of a condition must route identically.
7. **Global vs plan-specific placement.** The rule for when a mapping belongs in the global dictionary vs a plan override is not consistently applied. Define a placement rule that preserves plan-override isolation (Part VIII, invariant 2).
8. **Generic approved behavior vs a plan-specific override, in genuine disagreement** for the same condition on the same plan (see Part VI reconciliation note). Which wins is not settled by production.
9. **Competing declaration questions within one plan.** Precedence when a plan's `categoryMap` could resolve one condition to two different questions is not settled by production (surfaced in Part V).

Until decided, contributors must not resolve these ad hoc; escalate to the owner and record the decision. (Register: Appendix G.)

---

# Part X — Governance (ownership and approvals)

Ownership assigns responsibility; the engine does not encode it, so every row is a [GOVERNANCE] rule to adopt. Role names are placeholders to be mapped to your team.

| Asset | Owner responsibility |
|---|---|
| Canonical conditions | Authoritative name; decision to add a new condition. |
| Synonyms | Synonym set per canonical condition; whether routing must stay consistent. |
| Regex sections | The ordered disease-family blocks; approves order-sensitive edits. |
| Shields / firewalls | The non-diagnosis token classes. |
| Category keys | The controlled `categoryKey` vocabulary and its meaning. |
| Plan overrides | Per-insurer `planName ===` blocks and `overrides` flags; ensures isolation. |
| Collision handling | Adjudicates new-condition collisions with existing stages. |
| Fallback logic | Sanctioned fallback chains and the Others/AI terminal behavior. |
| Regression approval | Signs off that a change's diff against baseline snapshots is intended. |

**Contributor expectations** — [GOVERNANCE]: Follow the integration workflow (Part XI), run the reviewer checklist (Part XIII), respect invariants (Part VIII), and escalate Business Decisions (Part IX) rather than resolving them. Until owners are named, changes in each area default to requiring regression approval.

---

# Part XI — Integration Workflow (adding a new condition)

The required lifecycle. — [PROCESS]

1. **Review.** Confirm canonical name and synonym set; confirm the target category exists in the controlled vocabulary.
2. **Collision analysis.** Enumerate every Part IV stage that could match the condition or synonyms; confirm the earliest matching stage is intended; check for accidental firewall/broad-regex capture.
3. **Placement.** Choose dictionary vs regex vs plan override, preserving plan-override isolation. Plan-specific mappings must not go in the global dictionary.
4. **Business-decision check.** If routing depends on any Part IX area, stop and obtain the owner's decision first.
5. **Regression analysis.** Run the baseline snapshot suite; inspect every diff (intended and unintended).
6. **Testing.** Add a test asserting the canonical term's routing (and, where a synonym set is declared consistent, at least one synonym) on every plan.
7. **Approval.** Obtain regression sign-off (Part X).
8. **Documentation.** Record the condition, category, synonyms, per-plan routing, and any owner decision; update Known Exceptions (Part XV) if applicable.

(Workflow: Appendix E.)

---

# Part XII — Regression Philosophy

**Definition** — [CURRENT / GOVERNANCE]: A regression is any change to the output (`match_type` or `matched_question`) for an existing (condition, plan) pair, measured against the baseline snapshots. A previously deterministic PED becoming AI-dependent (or vice-versa) is also a regression signal (snapshots record `resolved: true/false`).

**Regression types** — definitions [CURRENT]; review levels [PROCESS]:

| Type | Definition | Example | Review level |
|---|---|---|---|
| Behavioral | Output changes for an existing (condition, plan). | A condition's question flips P1→FALLBACK. | Full regression sign-off. |
| Structural | Pipeline structure changes (stage added/removed/reordered) that could alter resolution. | Inserting a regex before dictionary routing. | Architecture review + regression owner. |
| Coverage | A condition moves between deterministic and AI (`resolved` flips). | A removed token drops a condition to `null`. | Regression owner. |
| Plan isolation | A change intended for one plan alters another. | A global-dictionary entry meant for one plan shifts another. | Mandatory block; regression + plan-override owner. |
| Documentation | The Constitution no longer matches the engine. | An override added without updating Part XV. | Documentation owner. |
| Test | Snapshots/tests removed, weakened, or not updated. | A snapshot deleted to make a diff pass. | Regression owner; never self-approved. |

**Validation requirements** — [PROCESS]: Baseline snapshot comparison on every mapping change; targeted tests for the new condition on every plan; explicit review of the full diff.

**Release readiness** — [PROCESS]: Releasable only when the snapshot diff is fully explained, new tests pass, any Part IX dependency has an owner decision on record, and regression sign-off is obtained.

(Checklist: Appendix F.)

---

# Part XIII — Review Process

**Reviewer checklist** — [PROCESS] (answer each before approval):
- Does this alter an existing (condition, plan) output? → snapshot diff required.
- Does it affect any other plan? → plan-isolation check.
- Does it broaden regex matching? → scan for unintended captures.
- Does it collide with an earlier stage? → confirm the intended winner (dictionary-before-regex; section order — Part V).
- Does it change fallback / terminal behavior?
- Does it depend on a Part IX Business Decision? → escalate; do not decide it.
- Does it require regression testing? → any output change = yes.
- Is documentation updated (Part XV, category vocabulary, synonym set)?
- Is the correct owner's sign-off (Part X) recorded?

**Required validations** — [PROCESS]: baseline snapshot run; per-plan targeted tests; full diff review.
**Required approvals** — [PROCESS]: the owning role for the change category (Part XIV) plus regression sign-off.

**Change-control fields for admin mapping changes (added 2026-10-02, Phase 3B)** — [PROCESS]: any admin change that alters a lookup result is recorded with (1) a reason, (2) its Part XIV change category, and (3) for elevated/high impact, the admin's confirmation of the previewed impact. Since v1.9 the Review window no longer asks for the Part XI step 4 Business-Decision check: a new change is stored with the neutral value `none`, and changes saved earlier keep the value they were saved with (`none` or `approved: <name>`). A change that alters no lookup result is still audited and undoable but needs no reason. The admin UI does not decide a Business Decision (Part IX). [GOVERNANCE]: approved A1 (instant live changes with pre-save impact preview, confirmation scaled to impact, audit, undo) and A5 (audited, reversible exceptions) are implemented by this gate for the PED Library, plan and plan-override writers; routing-rule administration is a later milestone (3B-ii).

(Checklist: Appendix D.)

---

# Part XIV — Change Categories

Standard change types and their review expectations. — [PROCESS]

| Category | Description | Review expectation |
|---|---|---|
| New synonym | Alias to an existing canonical condition. | Confirm identical routing to canonical where consistency is declared; targeted regression. |
| New canonical condition | New condition + category assignment. | Full Part XI lifecycle. |
| Dictionary update | Add/edit a `ped_repository`/`ped_aliases` row via the Mapping Control admin UI (see Part IV); editing `TOP_PED_DICTIONARY` no longer changes routing. | Dictionary owner; regression — high blast radius (dictionary precedes regex), regardless of which storage backs it. |
| Regex update | Edit a disease-family section. | Regex owner; broadening + collision check. |
| Shield update | Change a firewall token/class. | Shield owner; conservative fallback preserved. |
| New category | Introduce a `categoryKey`. | Category owner; must map to a real plan question; add to label vocabulary. |
| Plan override | Add/edit a `planName ===` block or `overrides` flag. | Plan-override owner; mandatory isolation check. |
| Fallback update | Change a fallback chain or terminal behavior. | Fallback owner; Business-Decision check. |
| Regression fix | Intentionally correct an existing output. | Regression owner; corrected diff tied to a documented decision. |
| Documentation update | Manual-only change, no code impact. | Documentation owner. |

**On-screen names** — [CURRENT] (v1.9). The Review window shows the change category in plain language, under the question "What kind of change is this?", but saves the category names in this table unchanged: New synonym = "Add another name for a condition"; New canonical condition = "Add a new condition"; Dictionary update = "Change a condition or its category"; Regex update = "Change a disease-group rule"; Shield update = "Change a safety check"; New category = "Add a new category"; Plan override = "Change something for one plan only"; Fallback update = "Change a second-choice or Others setting"; Regression fix = "Correct a wrong answer". Result names (impact preview, decision trace and Lookup): "Direct match" (the condition itself is exactly one of the items listed in the plan's question: the engine type P0 always, and also a P1 result whose chosen question itself lists the condition, for example Activ Fit Preferred "Ulcer" and "Obstructive sleep apnea", where the engine reports P1 for plan-specific mappings and rules without checking the wording); "Category match" (types P1 and P2 where no question names the condition and the chosen question covers its category, including through a plan-specific mapping or rule); "Fallback" (type FALLBACK: the result is the plan's Others question; Umbrella questions are a separate list of questions to also check and can also accompany other results); "AI generated" (the defined rules did not decide the condition, so a saved AI answer or the AI did; the AI is not itself instructed to try direct match, then category match, then fallback: the engine does that before the AI is called); "Not a condition" (NON_AILMENT); "Needs clarification" (ESCALATE, INVALID). The name is decided at the display layer from the result's wording and source, never from the impact-gate tier: the engine's own type (P0, P1, P2, FALLBACK) is not changed and can differ from the name shown. Order: an AI-sourced result is AI generated; the Others question or type FALLBACK is Fallback; a question that names the condition is a Direct match; any other specific question is a Category match. Direct match and Category match are the primary results; Fallback is the secondary one. Lookup no longer shows "Level 1/2/3"; the audit, activity and smoke-test screens still do. Plan question tags are shown as Specific, Umbrella and Others (stored as Specific, Umbrella and Catch-all). Tabs, in order: "PED Library", "AI Mapping Review" (the two screens that were sub-tabs of "PED Library & AI Review"), "Plans & Questions", "Categories", "Decision Steps" (stored as the routing rules) and "History"; the plan screen is headed "DA Mapping Config".

---

# Part XV — Known Exceptions

Intentional exceptions already present in production. None invented; each exists in the engine, most because a specific insurer's wording places a condition differently from the generic engine (correct under "wording is law"). — [CURRENT]

**Plan-specific routing overrides:**
- **Activ Fit Preferred — sleep apnea / OSA → congenital-genetic question** (that plan's genetic question explicitly names OSA).
- **Activ Fit Preferred — DVT / PE / varicose veins → heart question** (that plan's heart question lists peripheral vascular disease).
- **Care Supreme — Crohn's / ulcerative colitis / IBD → Blood and/or Immunity question** (that question names them).
- **Optima Secure — autoimmune joint diseases (RA, ankylosing, psoriatic/reactive arthritis) → musculoskeletal question.**

**Plan `overrides` flags:**
- **`requiresInsulinForDiabetes` (Care Supreme)** — gestational/Type-2 non-insulin diabetes → Others; only Type-1/insulin/severe → diabetes question.
- **`bypassBenignTumors`** — benign growths → Others where the plan's neoplasm question targets only malignancy.
- **`excludePrediabetes`** — prediabetes → Others where the diabetes question requires a confirmed diagnosis.

**Global carve-outs:**
- **Benign CNS tumours** (meningioma, acoustic neuroma, craniopharyngioma) → `benign_growth`, not `neoplasm`.
- **Ectopic-pregnancy exception** — inputs containing "ectopic" bypass the life-stage firewall.
- **HPV vs HIV-only questions** — HPV → Others when the plan's question is HIV/AIDS-restricted.
- **Activ Fit Preferred — "ulcer" → tumour/ulcer question as an exact listing (P0).**

Any new exception must be recorded here as part of its change, or it constitutes a documentation regression (Part XII). (Register: Appendix H.)

---

# Part XVI — Non-Goals

What the engine intentionally does not attempt. Each is consistent with the implementation. — [CURRENT]

- **Does not diagnose disease** — text/pattern matching only; no clinical inference.
- **Does not provide medical advice** — every output ends with a cross-check advisory.
- **Does not medically classify diseases** — `categoryKey`s are routing tokens, not a taxonomy.
- **Does not estimate underwriting risk** — no scoring; output is a declaration location.
- **Does not replace insurer wording** — routes conditions *to* insurer questions; wording is the top authority.
- **Does not maximize disclosures** — single declaration; conservative fallback.
- **Does not minimize disclosures** — does not suppress; surfaces umbrella questions.
- **Does not interpret medical reports** — tests/reports → conservative fallback; asks for the diagnosis.
- **Does not replace underwriting judgment** — advisory footer on every output.

---

# Part XVII — Glossary

- **categoryKey** — [CURRENT] Internal routing token (e.g. `diabetes`, `kidney`, `neoplasm`, `benign_growth`, `vascular_fallback`). A declaration abstraction / implementation detail, not a medical taxonomy; the key used to look up a plan's question in `categoryMap`.
- **Declaration category** — [CURRENT] The conceptual grouping a `categoryKey` represents.
- **Declaration question** — [CURRENT] The actual plan question text a condition is declared under.
- **Canonical condition** — [GOVERNANCE] The single authoritative name for a condition.
- **Synonym** — [GOVERNANCE] An alternate name/abbreviation/spelling of a canonical condition. Not globally guaranteed to route identically.
- **Manifestation / complication** — [CURRENT term; [BUSINESS] routing] A downstream effect of another disease; routing not governed by a single rule (Part IX).
- **Override** — [CURRENT] A `planName ===` block or `overrides` flag that changes routing for one plan, run before generic logic and isolated to that plan.
- **Fallback** — [CURRENT] Terminal routing when no specific question covers a condition: Others/Any-other + umbrella, or the AI handoff.
- **Shield / firewall** — [CURRENT] A stage intercepting a class of non-diagnoses (tests, acute infections, symptoms, life stages, procedures, lab findings) and routing them conservatively. Used interchangeably in this document.
- **Routing** — [CURRENT] The act of resolving a condition to an outcome.
- **Mapping** — [CURRENT] The condition→question relationship the engine encodes.
- **Umbrella question** — [CURRENT] A plan's broad hospitalisation/surgery/medication question, surfaced as a `secondary_recommendation`.
- **Declaration route** — [CURRENT] The final `(match_type, matched_question)` result for a (condition, plan) pair.
- **P0 / P1 / FALLBACK / NON_AILMENT** — [CURRENT] Match types: exact-wording; category; Others/umbrella; explicitly-not-an-ailment.
- **ESCALATE** — [CURRENT] A `match_type` indicating the condition could not be resolved to a single declaration question and is flagged with competing/confused candidate questions for resolution in post-processing (`resolveConfusionAndEscalation` in `finalizeOutput`).
- **INVALID** — [CURRENT] A `match_type` marking an output that failed validation and is not a usable declaration route; preserved by `finalizeOutput` without further resolution.
- **Routing rule** — [CURRENT] One ordered step of the data-driven pipeline (`routing_rules` row): a condition tree plus actions, or a named primitive's parameters.
- **Alias control** — [CURRENT] A per-alias compatibility setting (`routing_enabled`, `category_key_override`) that changes how the dictionary stage treats that alias without changing the PED.
- **Mapping version** — [CURRENT] The `mapping_state.version` counter that every routing-affecting write bumps and every lookup checks, so changes reach all server instances immediately.
- **Decision trace** — [CURRENT] The `decision_trace` returned with a result: which rule decided, which post-guard (if any) rewrote it, and how the dictionary stage resolved the alias.

---

# Appendices

## Appendix A — Runtime Execution Flow — [CURRENT]

```
Input (condition, plan)
  │
  ▼
1. Natural life-stage firewall ──► NON_AILMENT   (except "ectopic")
  │
  ▼
2. Plan-specific overrides (planName ===)  ──► route
  │
  ▼
3. Fast-path safety shields (A–I)  ──► FALLBACK / route
  │
  ▼
4. Exact plan-wording chunk match  ──► P0
  │
  ▼
5. Dictionary exact-match (TOP_PED_DICTIONARY) ──► categoryKey ──► questionForCategory ──► route
  │
  ▼
6. Disease-family regex sections (ordered) ──► route
  │
  ▼
7. Generic shields (benign, allergy, symptom, lab, diagnostics, procedure) ──► FALLBACK
  │
  ▼
8. No match ──► null ──► [AI fallback — outside engine]

Post-processing (after any route): sanitizeOutput → applyPostGuards → finalizeOutput
```

**Note (2026-10-01):** every box above is a `routing_rules` row or a named primitive evaluated in the same order by `src/mapping/routingEngine.ts` (see Part IV, "Mapping-control layer"); the diagram's shape is unchanged. The admin plan-specific PED mapping runs before box 1.

**Note (2026-10-06):** stages 2 and 5 above, like every other box, read the database (`routing_rules`, `ped_repository`, `ped_aliases`, `plan_overrides`) through the live mapping snapshot; the flag-based variants described in earlier versions were removed in v1.7. The shape of the flow (same 8 stages, same precedence) is unchanged.

## Appendix B — Evidence Hierarchy (justifying a mapping) — [CURRENT 1–4 / GOVERNANCE 5–6]

```
Highest ┌─ 1. Insurer question wording
        │  2. Plan-specific implementation (override / flag)
        │  3. Existing production behavior (baseline snapshot)
        │  4. Existing dictionary / synonym / category behavior
        │  5. Clinical reasoning (category selection only)
Lowest  └─ 6. Fallback (Others + umbrella / AI)
```

## Appendix C — Decision Tree (which stage decides) — [CURRENT]

```
Is it a life stage / normal-health phrase (and not "ectopic")?  ─ yes ─► NON_AILMENT
  │ no
Is there a plan override for this planName + condition?          ─ yes ─► override route
  │ no
Does a safety shield class match (test/acute/DVT/…)?            ─ yes ─► shield fallback/route
  │ no
Does the condition equal a plan-question fragment?              ─ yes ─► P0
  │ no
Is it an exact TOP_PED_DICTIONARY key?                          ─ yes ─► category → plan question
  │ no
Does a disease-family regex match (first in order)?            ─ yes ─► category → plan question
  │ no
Does a generic shield match?                                   ─ yes ─► fallback
  │ no
                                                                └────► null → AI fallback
```

## Appendix D — Review Checklist — [PROCESS]
(Full text: Part XIII.) Alters existing output? · Affects another plan? · Broadens regex? · Introduces collision? · Changes fallback? · Depends on a Business Decision? · Requires regression tests? · Docs updated? · Owner sign-off recorded?

## Appendix E — Change Approval Workflow — [PROCESS]
Review → Collision analysis → Placement → Business-decision check → Regression analysis → Testing → Approval → Documentation. (Full text: Part XI.)

## Appendix F — Regression Checklist — [PROCESS]
Run baseline snapshots · Inspect every diff (intended + unintended) · Classify any regression by type (Part XII) · Confirm plan isolation · Confirm coverage (`resolved` flags) unchanged unless intended · Add/keep per-plan tests · Obtain regression sign-off.

## Appendix G — Business Decision Register — [BUSINESS]
1. Manifestation routing (root vs organ) · 2. Multi-family precedence · 3. Investigation vs diagnosis precedence · 4. Finding polarity · 5. Organ containment completeness · 6. Synonym-consistency enforcement · 7. Global vs plan-specific placement · 8. Generic behavior vs plan override in genuine disagreement · 9. Competing declaration questions within one plan. (Detail: Part IX. None resolved here.)

## Appendix H — Known Exceptions Register — [CURRENT]
AFP sleep apnea→genetic · AFP DVT/PE/varicose→heart · Care Supreme Crohn's/UC/IBD→blood · Optima autoimmune-joint→musculoskeletal · `requiresInsulinForDiabetes` · `bypassBenignTumors` · `excludePrediabetes` · benign CNS→benign_growth · ectopic firewall bypass · HPV→Others on HIV-only questions · AFP ulcer→tumour/ulcer P0. (Detail + reasons: Part XV.)

---

## Consolidation & Validation Statement

This Constitution consolidates the prior Mapping Policy Charter and Production Governance Manual (and any Validation Framework, Integration Playbook, Change Control, Mapping Governance, or Integration Rules notes) into one authority. Validation performed before finalizing:

- **No duplicated guidance:** overlapping rules were merged and cross-referenced (e.g. runtime precedence lives only in Parts IV–V; justification only in Part VI; regression only in Part XII).
- **No contradictory guidance:** the one genuine tension found during consolidation — generic approved behavior vs a plan-specific override in true disagreement — is preserved as **[BUSINESS]** (Part IX item 8), not resolved by assumption.
- **No conflicting terminology:** terms are used per Part XVII throughout; `shield`/`firewall` are declared interchangeable; `categoryKey` vs `declaration category` vs `declaration question` are kept distinct.
- **No missing cross-references:** each Part points to the appendix or Part that elaborates it.
- **No undocumented production behavior marked Current:** every [CURRENT] statement is tied to an execution stage or implementation construct; anything unprovable is [GOVERNANCE], [BUSINESS], or [PROCESS].
- **Nothing changed:** no mapping, no engine behavior, no business decision, and no governance intent was altered. Aspirational rules from the prior charter that the engine does not implement are represented here only as Business Decisions (Part IX), never as Current behavior.

---

## Change Impact Template

Every future change to this Constitution must record its impact using this block. Tick all that apply. A change that ticks "Runtime behavior change" or "Business decision" cannot merge without the corresponding owner sign-off (Part X) and, where applicable, a regression diff (Part XII).

```
Change Impact:

[ ] Documentation only        — wording/clarity; no governance or behavior change
[ ] Governance only           — a rule contributors follow; no engine change
[ ] Business decision         — resolves or opens a Part IX item; requires owner approval
[ ] Runtime behavior change    — alters an existing (condition, plan) output; regression review required
[ ] Regression expected        — a snapshot diff is anticipated and must be reviewed & explained

Owner sign-off (if Governance / Business / Runtime): __________
Regression diff reviewed (if Runtime / Regression):  __________
```

**Classification** — [PROCESS].

---

## Version History

```
v1.0  (2026-07-18)
- Initial consolidated Constitution. Supersedes the Mapping Policy Charter and the
  Production Governance Manual (and any Validation Framework, Integration Playbook,
  Change Control, Mapping Governance, or Integration Rules notes).
- 17 Parts + Appendices A–H. Four-way classification ([CURRENT] / [GOVERNANCE] /
  [BUSINESS] / [PROCESS]) established.
- Added: Quick Start, AI Usage, Change Impact Template, Version History.
- No mapping, engine behavior, or Business Decision changed.

v1.1  (2026-07-29)
- Documentation-only update (Change Impact: Documentation only). Corrected a
  documentation regression (Part XII) that existed unnoticed since the
  2026-07-28 PED Repository DB migration cutover: Part IV described only the
  legacy TOP_PED_DICTIONARY dictionary/override path, which is no longer the
  only one in production.
- Added, to Part IV: the `PED_SOURCE` flag, the `dbSource`-gated DB-backed
  variants of stages 2 and 5, and the 2026-07-29 change making the "PED
  Repository" admin UI write directly to `ped_repository`/`ped_aliases`
  (mirrored into the legacy table for `PED_SOURCE=legacy` rollback safety).
  Added a corresponding note to Appendix A and updated Part XIV's
  "Dictionary update" row.
- No mapping, routing precedence, evidence hierarchy, or Business Decision
  (Parts I-III, V-IX) was altered. No owner sign-off required per the Change
  Impact Template (Documentation only).

v1.2  (2026-10-01)  — mapping-control Phase 2 (equality migration)
- Change Impact:
  [x] Documentation only        — corrections A6 (documentation regressions fixed)
  [x] Governance only           — A2: routing rules move into data; alias controls
  [ ] Business decision
  [ ] Runtime behavior change   — none: equality proven; engine off by default
  [ ] Regression expected       — none: zero differences on the full baseline
  Owner sign-off: approved in chat 2026-10-01 (A2, A6, fixed plan-rule categories).
  Regression diff reviewed: zero primary and zero strict differences, 113,130 pairs.
- Documentation corrections (approved A6): added the admin plan-specific PED
  mapping stage, plan restrictions/flags, where classification runs (browser
  first, then server) and the production configuration; corrected the Part IV
  description of the PED_SOURCE=db dictionary stage (no term-by-term fall-through
  to the legacy dictionary); added Appendix A note and glossary terms; removed
  the empty duplicate v1.2 stubs.
- Added the mapping-control layer to Part IV (approved A2): routing rules as
  data in the same order; alias compatibility controls with their precedence;
  fixed categories for the four plan-specific rules (approved 2026-10-01);
  named primitives; live propagation; decision trace; rollback switch.
- Regression sign-off: full-corpus equality (113,130 pairs, zero primary and
  zero strict differences), plus the named audit checks, in
  src/__tests__/mappingControl.{equality,propagation,audit}.test.ts.
- Third alias control `fallback_category_key` (last-resort category): approved
  by the owner 2026-10-01; needed to preserve current production behaviour for
  the 32 (condition, plan) pairs where the browser-then-server two-pass quirk
  decides the result. Documented in Part IV.
- Not yet recorded here (not yet implemented): the ordered category chain
  (approved A4, Phase 4), UI-managed exceptions and audit/undo (approved A5/A1,
  Phase 3), category management (approved A3, Phase 3), and PED Category
  Governance (a later named phase, see docs/MAPPING_CONTROL_PLAN.md).

v1.3  (2026-10-02)  — mapping-control Phase 3A: admin mapping control
- Change Impact:
  [ ] Documentation only
  [x] Governance only           — admin write-path integrity rule: no action may report
                                  success for a change the live engine ignores
  [ ] Business decision
  [ ] Runtime behavior change   — none from the deployment itself: no (condition, plan)
                                  output changes. An admin approving an AI answer now
                                  actually changes that term's mapping (previously a no-op in
                                  db mode); that is an admin-initiated mapping change.
  [ ] Regression expected       — none
  Owner sign-off: instructed by the owner 2026-10-02 (Phase 3A scope).
  Regression diff reviewed: the Phase 2 equality baseline and Zero Regression Audit are
  unchanged and pass; new admin-writer / no-silent-no-op tests added.
- Documented in Part IV ("Admin mapping actions"). Migration 0086 adds mapping_change_sets.

v1.4  (2026-10-02)  — mapping-control Phase 3B-i: safety backbone
- Change Impact:
  [x] Documentation only        — P0 -> P1 -> P2 -> P3 ladder as implemented (Part V); no engine change
  [x] Governance only           — impact gate, change-control fields (reason / Part XIV category /
                                  Business-Decision check), confirmation scaled to measured impact,
                                  generic change sets and undo (Parts IV, XIII)
  [ ] Business decision
  [ ] Runtime behavior change   — none: no (condition, plan) output changes from deploying this; the
                                  gate is off by default (MAPPING_IMPACT_GATE) and wraps existing
                                  admin routes without changing their logic.
  [ ] Regression expected       — none
  Owner sign-off: instructed by the owner 2026-10-02 (Phase 3B approvals 1-7).
  Regression diff reviewed: Phase 2 equality baseline and Zero Regression Audit unchanged and pass.
- Migration 0087 adds change-control and impact columns to mapping_change_sets (additive, nullable).

v1.5  (2026-10-02)  — mapping-control Phase 3B-ii: unified admin section, rule and category administration
- Change Impact:
  [ ] Documentation only
  [x] Governance only           — rule/category administration, validation rules, stage bands, protected
                                  steps, one-writer rule, one admin section replacing two pages (Part IV)
  [ ] Business decision
  [ ] Runtime behavior change   — none: no (condition, plan) output changes from deploying this. The
                                  engine, the seeded rules and every existing mapping are untouched; an
                                  admin edit made afterwards is an admin-initiated change shown by the
                                  impact preview.
  [ ] Regression expected       — none
  Owner sign-off: instructed by the owner 2026-10-02 (Phase 3B-ii scope: R3/R9).
  Regression diff reviewed: Phase 2 equality baseline (113,226 lookups) and Zero Regression Audit unchanged and pass.
- No migration: routing_rules and categories already exist; both are added to the change-set row diff.

v1.6  (2026-10-02)  — mapping-control Phase 4: R11 ordered category fallback per PED
- Change Impact:
  [ ] Documentation only
  [x] Governance only           — chain administration through the existing gate (Part IV)
  [ ] Business decision         — see the [BUSINESS] note on the definition of a real question (Part IV)
  [x] Runtime behavior change   — APPROVED (R11): for a PED that has a category chain, the selected plan's
                                  first category with a real question is used. No PED has a chain at
                                  deployment, so NO existing (condition, plan) output changes: the full
                                  corpus (113,226 lookups on production data) is identical before and after.
  [ ] Regression expected       — none
  Owner sign-off: instructed by the owner 2026-10-02 (Phase 4, R11 as defined in the approved main plan).
  Regression diff reviewed: frozen production baseline vs new engine = 0 differences (sha256 identical);
  Phase 2 equality and Zero Regression Audit unchanged and pass.
- Migration 0088 adds ped_repository.category_chain (additive, nullable; NULL = single-category).
- Wording note (owner-approved 2026-10-05): the admin screen for a PED's category list is named "Which category should be used?" (Primary and Fallback 1..n, in plain language) instead of "Category fallback order", to match the implemented UI; no behavior change.
  Change Impact for this note:
  [x] Documentation only        — one UI label renamed in Part IV; no governance or behavior change
  [ ] Governance only
  [ ] Business decision
  [ ] Runtime behavior change
  [ ] Regression expected
  Owner sign-off: approved in chat 2026-10-05 (this wording change only).
  Regression diff reviewed: not applicable (documentation only); R11 baseline replay still 0 differences.

v1.7  (2026-10-06)  — mapping-control Phase 6: legacy engine removed; single source of truth
- Change Impact:
  [ ] Documentation only
  [x] Governance only           — SAFEGUARD CHANGE: the live legacy engine (migration oracle) and the
                                  MAPPING_ENGINE=legacy / PED_SOURCE rollback switches are removed; the
                                  regression oracle is now the committed frozen baselines (Part IV, XII)
  [ ] Business decision
  [ ] Runtime behavior change   — none intended: the database engine had already served production; no
                                  (condition, plan) output changes from the removal. The six R10 production
                                  corrections and R11 are untouched.
  [ ] Regression expected       — none
  Owner sign-off: approved in chat 2026-10-05/06 (Phase 6 batches B-E, frozen-baseline requirement, Constitution update).
  Regression diff reviewed: database engine vs frozen post-R10 baseline (113,130 pairs) = 0 differences
  outside the documented R10 deliberate differences; frozen production day-one baseline and the Zero
  Regression Audit pass; R11 checks pass.
- Removed: src/engine.ts, pedRuntimeCache, legacy PED mirror writes, legacyWriteGuard, browser classifier,
  the MAPPING_ENGINE/PED_SOURCE flags and the baseline/verify/rollback scripts. Shared pure helpers moved to
  src/mapping/helpers.ts unchanged. No migration; legacy tables ped_mapping_overrides and ped_directory kept.
- Documented in Part IV ("Single source of truth"), Appendix A, Part XIV.
v1.8  (2026-10-07)  — Mapping Control: plain-language names
- Change Impact:
  [x] Documentation only        — on-screen names only; see Part XIV "On-screen names"
  [ ] Governance only
  [ ] Business decision
  [ ] Runtime behavior change   — none: no (condition, plan) output changes; stored values, routes and rules are unchanged
  [ ] Regression expected       — none
  Owner sign-off: instructed by the owner 2026-10-07 (terminology and comprehension only).
  Regression diff reviewed: not applicable (documentation / display only); full test suite and Zero Regression Audit unchanged and pass.
- Mapping Control screens now use task-oriented wording instead of internal terms (for example "Decision Steps" for Rules,
  "Correct a wrong answer" for Regression fix). Plan-Specific PED Mappings became its own view under Plans & Questions.
v1.9  (2026-10-07)  — Mapping Control: Review window no longer asks for an owner's approval; on-screen names finalised
- Change Impact (A) — Review window:
  [ ] Documentation only
  [x] Governance only           — the Mapping Control Review window no longer requires the Business-Decision check
                                  (owner's approval question). New changes store `none`; earlier records are unchanged.
  [ ] Business decision
  [ ] Runtime behavior change   — none: no (condition, plan) output changes; routes, rules, impact preview and confirmation are unchanged
  [ ] Regression expected       — none
  Owner sign-off: approved in chat 2026-10-07 (removal of the requirement from the Mapping Control Review window only).
  Not changed, awaiting the owner's decision: Part XI step 4, the Part XIII checklist and the Part XIV "Fallback update" review expectation still name the Business-Decision check (proposed wording given in chat).
- Change Impact (B) — on-screen names:
  [x] Documentation only        — Part XIV "On-screen names" now records the final wording (change types, result labels, question tags, tab names)
  [ ] Governance only
  [ ] Business decision
  [ ] Runtime behavior change
  [ ] Regression expected
  Owner sign-off: approved in chat 2026-10-07 (wording only).
  Regression diff reviewed: not applicable (documentation / display only); full test suite, Zero Regression Audit and the frozen-baseline equality check unchanged and pass.
v1.10 (2026-10-08)  — Mapping Control and Lookup: result names defined
- Change Impact:
  [x] Documentation only        — Part XIV "On-screen names" records the result names and what each means, as the code behaves
  [ ] Governance only
  [ ] Business decision
  [ ] Runtime behavior change   — none: engine, routes, rules, the AI step and stored values are unchanged
  [ ] Regression expected       — none
  Owner sign-off: instructed by the owner 2026-10-08 (wording and display only).
  Regression diff reviewed: not applicable (display only); full test suite, Zero Regression Audit and the frozen-baseline equality check unchanged and pass.
```

Each future entry must summarize what changed and cite its Change Impact classification. A version that changes runtime behavior must reference the regression sign-off.

**Classification** — [PROCESS].
