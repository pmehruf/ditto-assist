# Mapping-control Phase 4 — R11: ordered category fallback per PED

Status: **implemented on branch, validated by tests and a frozen-baseline comparison; staging/production rollout see below.** Isolated from the proven 3B-ii production baseline: no change to existing mappings, category assignments, plan questions, protected rules, Gemini behavior or the 3B-ii admin architecture. The only intended behavior change is the ordered category fallback, and it only applies to a PED that is given a chain (none is, at deployment).

## Where PED category routing happens today (the focused inspection)

| Question | Answer |
|---|---|
| Single-category path | `routingEngine.ts` → `primDictionaryLookup` turns the alias into ONE category (`ctx.categoryKey`: alias override > PED category; or the forced last-resort category on the second pass). The dictionary-stage short-circuit rules (`dict.*`, `category` conditions) and `primPlanDecision` then route on it. |
| Where the PED category is stored / read | `ped_repository.category_key`; loaded into the per-instance snapshot by `loadMappingSnapshot` (`AliasEntry.pedCategory`). |
| Where plan question availability is decided | `questionForCategory(config, category)` (`src/engine.ts`): empty when the category is not in the plan's `categoryMap` or maps to nothing. |
| Where a category fails to resolve | `primPlanDecision`: `if (!targetQ) return null` (no mapping) → the family rules, generic shields, then unresolved (AI step). A category mapped to the plan's Others question returns the explicit Others fallback. |
| Where the final fallback takes over | After the dictionary/plan-decision stages: family rules → generic shields → unresolved; plus the `fallback_category_key` second pass. |
| Where the chain is introduced | Only in `primDictionaryLookup`, choosing which category goes into `ctx.categoryKey`. With no chain that code path is untouched. Everything before it (plan-specific PED mappings, firewall, plan rules, shields, exact wording) already takes precedence; everything after it is unchanged. |

## How the chain is represented and evaluated

- `ped_repository.category_chain` (jsonb, nullable; migration 0088, additive). The PED's **primary** stays in `category_key`; the column holds the ordered **fallbacks after it** (max 5, no repeats, existing categories only, a primary required). NULL = single-category = every existing PED.
- `primDictionaryLookup`: if the category came from the PED itself (not an alias override, not the forced last-resort pass) and the PED has a chain, `chooseFromChain` walks primary, then each fallback in order, and picks the first category with a **real question** on the selected plan (exists, and is not the plan's Others question). That one category replaces `ctx.categoryKey`; nothing else changes, so a PED yields one declaration. If none qualifies, `ctx.categoryKey` stays the primary and today's behavior runs.
- Trace: `decision_trace.dictionary.chain = { configured, selected, skipped: [{category, reason: no_question | catch_all}] }`, `source: "category_chain"` when a fallback was used. Shown in plain language in "Why this result" and in Mapping Control > Rules > Test a lookup.
- Admin: Mapping Control > PED Library > a PED > **Category fallback order** (add, remove, reorder), saved through `PATCH /api/ped-repository/:id` — the existing gated route (impact preview, confirmation, change set, undo). Refused (not ignored) when the database-backed engine is not active.

## Validation

| Check | Evidence |
|---|---|
| Baseline equality | `npm run mapping:freeze` froze the pre-R11 engine's output for all 113,226 (plan, term) pairs on production data (sha256 `4e053927…`); the same corpus replayed with the R11 code over a read-only capture of production's mapping tables is **identical (0 differences, same sha256)**. |
| Positive / priority / reorder / no-valid / single-category / override precedence / no double declaration / explainability | `src/__tests__/categoryChainR11.test.ts` (engine, real fixture data) |
| Chain read from the real column; live on already-running instances without restart; impact preview; undoable row change; no existing PED has a chain | `src/__tests__/categoryChainR11.db.test.ts` |
| Isolation | legacy engine and seeded rules contain nothing about chains; the chain is evaluated in exactly one place |

## Collision analysis

| Area | Result |
|---|---|
| Exact plan-specific overrides | Run at position 10, before the dictionary stage: unchanged and authoritative (tested with a chain present). |
| Existing single-category PEDs | No chain → identical code path and output (113,226 pairs identical). |
| Universal / short-circuit category rules (`dict.*`) | They key on the category the dictionary stage selects. A chain can only select a category with a real question, so it can never route into an Others-mapped universal category; a primary that has no real question keeps today's behavior when nothing in the chain qualifies. |
| Plan question availability | Evaluated per plan at lookup time with the same `questionForCategory` the engine already uses. |
| Shields / firewalls / exact wording | All run before the dictionary stage: unchanged. |
| Existing fallback behavior | Preserved verbatim when no category in the chain has a real question. |
| Ordering / priority | Array order is priority; tested including reversal. |
| PEDs that resolve through a category today / that fall to Others, umbrella or AI today | Without a chain: unchanged. With a chain: only the category selection changes, never the stages after it. |
| Alias-level override, last-resort category | Never altered by a chain. |
| Legacy engine / `MAPPING_ENGINE=legacy` | Ignores chains; saving one outside `db` mode is refused. |

## Business note (owner to confirm; does not affect day-one behavior)

A plan-mapped category that points at the plan's **Others** question is treated as *not* a real question for the chain (otherwise a chain could never fall past a category deliberately mapped to Others). Recorded in Constitution v1.6.
