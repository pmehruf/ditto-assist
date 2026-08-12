# Production Readiness Review — Congenital Governance SQL (Part F)

**Status: read-only. Nothing executed, nothing modified.** This is a pre-flight validation of `MAPPING_GOVERNANCE_REVIEW_CONGENITAL_FINAL.md`'s Part F SQL (recategorizations, Hydrocephalus split, ~22 new PEDs, Optima Secure repoint + 13 plan overrides), scoped strictly to production readiness — not a re-litigation of the governance decisions themselves.

**Data source caveat, unchanged throughout this project:** the live Neon DB is unreachable from this environment. Every check below that needs live-DB confirmation is backed by the best available proxy (schema.ts, the legacy dictionary mirror, the audited JSON) and paired with an exact query for you to run yourself before executing. This is stated plainly wherever it applies rather than assumed away.

---

## 1. SQL pre-flight validation

| Check | Result | Detail |
|---|---|---|
| Every `category_key` referenced exists in `categories` | ✅ Pass | `categories` is seeded from `CATEGORY_LABELS` (`types.ts`) by `scripts/seedPedRepository.ts`. All 5 keys Part F uses — `genetic`, `neuro`, `blood`, `endocrine`, `liver` — are present there. |
| Every referenced plan exists | ✅ Pass | `Optima Secure` is in `PLANS` and is one of the 4 originally-migrated `plan_configs` rows. |
| Every `ON CONFLICT` behaves as intended | ✅ Pass | `plan_overrides` has a real unique index on exactly `(plan_name, ped_id)` (`plan_overrides_plan_ped_idx`) — matches the `ON CONFLICT (plan_name, ped_id) DO UPDATE` clause used throughout. `plan_configs` is keyed by `plan_name` (PK); the `category_map` JSONB merge (`||`) is a safe upsert-in-place with no conflict clause needed. |
| No orphaned aliases | ✅ Pass | Every new-PED block inserts the `ped_repository` row, captures its `id` via `RETURNING ... INTO new_id`, then inserts that PED's aliases against `new_id` in the same transaction. No alias is ever created before its parent PED exists. (Note: this is enforced by the script's own structure, not by a DB-level FK — `schema.ts` states explicitly there are no FK constraints on `ped_aliases.ped_id`.) |
| Every `canonical_name` referenced exists exactly once | ⚠️ Needs verification | `ped_repository.canonical_name` has **no unique constraint** in the schema — only `ped_code` is unique. The recategorization `UPDATE`s (`ILIKE` matches) and the plan-override `INSERT ... SELECT ... WHERE canonical_name IN (...)` subqueries all assume exactly one row per name. If a legacy duplicate exists (the governance model's own rule 3 documents this as a known historical pattern), an `UPDATE`/override could silently apply to more rows than intended, or a `WHERE ... IN` could match zero rows (as already caught once with Situs Inversus) without erroring. **Run before executing:** <br>`SELECT canonical_name, count(*) FROM ped_repository WHERE canonical_name IN ('Marfan Syndrome','Ehlers-Danlos Syndrome','Spinal Muscular Atrophy','G6PD Deficiency','Cystic Fibrosis','Pompe Disease','Gaucher Disease','Alpha-1 Antitrypsin Deficiency','Enzyme Deficiency','Down Syndrome','Turner Syndrome','Klinefelter Syndrome','Noonan Syndrome') GROUP BY canonical_name HAVING count(*) <> 1;` <br>`SELECT canonical_name, count(*) FROM ped_repository WHERE canonical_name ILIKE 'Huntington%' OR canonical_name ILIKE 'Friedreich%Ataxia' OR canonical_name ILIKE 'Charcot%Marie%Tooth%' OR canonical_name ILIKE 'Spinocerebellar Ataxia' GROUP BY canonical_name;` <br>Both should return zero rows (first) / exactly one row each (second). |
| No duplicate canonical PEDs / hidden alias collisions will be introduced | ⚠️ Needs verification (proxy passed) | Cross-checked all ~22 new canonical names and their aliases against `TOP_PED_DICTIONARY` and the independently audited `600_conditions_corrected_database.json` — **zero collisions found** in either. This is a meaningful but incomplete check: both sources are static and predate the 2026-07-29 PED Repository UI cutover, so anything added directly through that UI since then wouldn't show up here. `ped_aliases.normalized_alias` **is** uniquely constrained at the DB level, so a real collision would fail the `INSERT` loudly (see idempotency note below) rather than silently corrupting data — but it's cheaper to catch it before running than mid-deployment. **Run before executing:** <br>`SELECT normalized_alias, ped_id FROM ped_aliases WHERE normalized_alias IN ('patent ductus arteriosus','pda','coarctation of aorta','transposition of great arteries','tga','truncus arteriosus','hypoplastic left heart syndrome','hlhs','total anomalous pulmonary venous return','tapvr','arnold chiari malformation','chiari malformation','dandy walker malformation','dandy walker syndrome','holoprosencephaly','encephalocele','craniosynostosis','congenital hip dysplasia','developmental dysplasia of the hip','ddh','renal agenesis','congenital solitary kidney','imperforate anus','congenital diaphragmatic hernia','cdh','gastroschisis','omphalocele','tracheoesophageal fistula','tef','prune belly syndrome','eagle barrett syndrome','bladder exstrophy','digeorge syndrome','22q11.2 deletion syndrome','velocardiofacial syndrome','shprintzen syndrome','congenital hypothyroidism','biliary atresia','congenital hydrocephalus','normal pressure hydrocephalus','acquired hydrocephalus');` <br>Expect 0 rows. |
| Every `plan_override` target resolves to a valid PED | ⚠️ Same caveat as above | The two override `INSERT ... SELECT` blocks (Marfan/Ehlers-Danlos, and the 11 added 2026-08-08) only insert for names the subquery actually finds — a missing name is a silent no-op, not an error (exactly what happened with Situs Inversus). Covered by the same canonical-name query above. |
| The SQL is idempotent | ❌ Gap found | The ~22 new-PED inserts in the "coverage additions" `DO $$` block have **no existence guard** — unlike the Hydrocephalus split just above them, which explicitly checks `IF NOT EXISTS (SELECT 1 FROM ped_repository WHERE canonical_name ILIKE ...)` before inserting. A second full run would attempt to create duplicate `canonical_name` rows (allowed — no unique constraint) and then hit a unique-constraint violation on the first repeated alias, which aborts and rolls back the **entire** transaction (the whole script is one `BEGIN...COMMIT`) — so a re-run fails safely with no partial corruption, but it fails loudly rather than completing as a clean no-op, and requires someone to diagnose why. **Recommended fix (mechanical, not architectural):** wrap each of the ~22 inserts in the same `IF NOT EXISTS (...) THEN ... END IF;` pattern already used for the two Hydrocephalus rows, or simply treat this script as single-use and don't re-run it. |

---

## 2. Regression validation

| Check | Result | Detail |
|---|---|---|
| Existing mappings unchanged unless intentionally modified | ✅ Pass, contingent on the canonical-name check above | Only the 4 recategorizations and the Optima Secure repoint + 13 overrides touch existing rows; everything else is additive. |
| Existing plan overrides continue to work | ✅ Pass | The 3 pre-existing hardcoded `engine.ts` blocks (Activ Fit Preferred OSA/DVT, Care Supreme Crohn's/UC/IBD, Optima Secure RA/ankylosing spondylitis) share no condition names with anything in Part F — no collision, and Part F makes no `engine.ts` changes at all. |
| Alias resolution unaffected except intended additions | ✅ Pass, same DB-verification caveat as Section 1 | |
| Category routing remains deterministic | ✅ Pass | See Section 4 — stage order is unchanged. |
| AI fallback behavior is unchanged | ✅ Pass | Part F never touches `ai_memory`; the Gemini call path in `server.ts` is untouched. |
| Collision repository remains valid | ✅ Pass (trivially) | `collision_repository` is advisory-only and not consulted by `classifyDeterministic` at all (per its own schema comment) — Part F doesn't write to it either way. |
| No existing approved PED changes declaration outcome unexpectedly | ❌ **Significant finding** | See below — this is the most important result of this review. |

### The one real regression risk: `plan_overrides` only protects exact alias matches

`classifyDeterministic`'s plan-override stage (0.4) fires on an **exact** normalized-text match against a stored alias. If an advisor's input doesn't exactly match a registered alias for one of the 13 Optima-Secure-overridden conditions, the exact-match dictionary stage (0.7) also misses, and the input falls through to `engine.ts`'s §16b regex block — a **substring** match (`\b(marfan|noonan|turner syndrome|klinefelter|down syndrome|cystic fibrosis|gaucher|pompe|...)\b`) that resolves straight to `questionForCategory(config, "genetic")`, with **no knowledge of `plan_overrides` at all**.

Concretely: an advisor typing exactly **"Marfan Syndrome"** gets the plan override (correct — Blood/Genetic). An advisor typing **"Family history of Marfan syndrome"** or **"Suspected Turner syndrome"** does not hit an exact alias, falls through to §16b, and gets routed to `config.categoryMap.genetic` directly — which, after the repoint, is Optima Secure's **Disability/Deformity** question. Same underlying condition, two different declaration outcomes, purely based on phrasing.

This affects 11 of the 13 overridden conditions (everything in §16b's regex alternation: Marfan, Ehlers-Danlos is *not* in this specific list — checked, it isn't — Down Syndrome, Turner Syndrome, Klinefelter, Noonan, Cystic Fibrosis, Gaucher, Pompe, Alpha-1 Antitrypsin Deficiency, Enzyme Deficiency). Two are structurally exempt: G6PD Deficiency has its own hardcoded blood-redirect earlier in the same regex block (line 1355), so free-text G6PD mentions already resolve to Blood regardless of the repoint. Spinal Muscular Atrophy has **no regex coverage anywhere in `engine.ts`** — free-text SMA mentions that miss the exact alias fall all the way through to AI Memory/Gemini instead of a hardcoded category, a different (not necessarily better, just different) failure mode.

**This is not a new bug introduced by this session's SQL** — it's a pre-existing structural characteristic of how `plan_overrides` (exact-alias-scoped) and the regex fallback sections (substring-scoped) have always interacted, and it was already true for the originally-approved Marfan Syndrome and Ehlers-Danlos Syndrome overrides. It was invisible before because `categoryMap.genetic` and the plan override both pointed at the same Blood/Genetic question — the repoint is what makes the two paths diverge and produce inconsistent outcomes for the same condition.

Per your instruction not to introduce new architectural changes in this pass, I'm not proposing an `engine.ts` fix here — that would need its own scoped review (e.g., teaching §16b to check `dbSource.planOverrideLookup` once it identifies a category, not just an exact `pedId`). What I'd recommend instead, as the smallest correction available right now: **explicitly smoke-test free-text phrasings** (not just canonical terms) for all 13 overridden conditions on Optima Secure after applying, and treat any mismatch you find as a known, tracked residual risk rather than a surprise.

---

## 3. UI compatibility

| Check | Result | Detail |
|---|---|---|
| Can still edit a PED's category from the PED Repository UI | ✅ Pass | `PedRepositoryManagement.tsx` / `pedRepositoryLive.ts` are structurally untouched by this SQL — it's a generic CRUD path over `ped_repository`/`ped_aliases` that works identically on old and new rows. |
| Can still edit plan category mappings from the Plan Configuration UI | ✅ Pass | `PlanManagementPage.tsx` edits `plan_configs.category_map` (JSONB) — the repoint just changes one key's value in the same shape the UI already reads/writes. |
| UI changes immediately affect runtime | ⚠️ True for UI edits, **not** true for this SQL run directly | `plan_configs.category_map` is queried live on every `/api/match` call (no caching) — a UI edit there is instant. But `ped_repository`/`ped_aliases`/`plan_overrides` are loaded into an **in-process, load-once cache** (`pedRuntimeCache.ts`) that only refreshes via explicit mutator calls wired into the PED Repository UI's own write path. **Running Part F directly against Postgres (psql/Neon console) will not be visible to an already-running server process** — the new PEDs, recategorizations, and plan overrides will silently not apply until that process restarts. The Optima Secure `category_map` repoint itself *will* take effect immediately (it's the one part read live), which makes the inconsistency easy to miss. **Required step, not optional:** redeploy or restart the Cloud Run service immediately after running the SQL, then verify with a real lookup before considering the change live. |
| Plan overrides remain editable/manageable through the existing UI or the intended admin workflow | ❌ **Gap (pre-existing, not caused by this work)** | There is no admin UI for `plan_overrides` anywhere in this app — confirmed zero references in `src/components/`, and the cache-update functions for it (`updateDbPlanOverrideCache`/`removeDbPlanOverrideCache`) are wired but never called by anything. The 13 Optima Secure override rows this SQL creates can only be viewed or changed via direct SQL/DB access going forward — there's no "undo this in the UI" path. Not something this governance work broke; it simply means you should know this before relying on the UI to manage these specific rows later. |
| No mapping has become hardcoded in a way that bypasses the UI | ⚠️ See Section 2's finding | The 3 pre-existing hardcoded `engine.ts` plan blocks are unrelated and unaffected. The §16b regex fallback isn't new, but once the repoint is live, it behaves like an effectively-hardcoded route for free-text inputs on the 11 conditions above — invisible to and unmanageable from any UI, including the (nonexistent) plan-overrides UI. |
| Runtime still treats the database as the source of truth | ✅ Pass, with the caching caveat above | `PED_SOURCE=db` is confirmed live; `/api/match` reads `plan_configs` fresh every call and reads `ped_repository`/`ped_aliases`/`plan_overrides` through the cache described above — DB is authoritative, but "authoritative" and "immediately visible to a running process" are two different things for the latter three tables. |

---

## 4. Architecture verification

Confirmed directly against `classifyDeterministic` in `engine.ts` (line 634 onward) and `/api/match` in `server.ts`:

```
Normalize Input              → normalizeText(ped) / normalizeDictionaryKey(pedText)
Alias Resolution              → dbSource.aliasLookup.get(dictKeyForPed)  [stage 0.4]
Canonical PED Resolution      → dbEntry.pedId
Direct PED Plan Override      → dbSource.planOverrideLookup(planName, pedId)  [stage 0.4, before dictionary]
Category Resolution           → dictionary exact-match [0.7] → 24 disease-family regex sections
Plan Category Mapping         → questionForCategory(config, categoryKey), reading plan_configs.category_map
Umbrella/catch-all guidance   → config.anyOther / umbrella-question branches within the regex sections
AI only where approved        → server.ts Level 2 (AI Memory) → Level 3 (Gemini), only when classifyDeterministic returns null
Fallback                      → FALLBACK output / Gemini
```

This matches the approved diagram exactly, in the exact order specified. No hidden stages, no duplicate mapping logic, no repository bypass. Part F makes zero `engine.ts` changes — the only outstanding code-level item from the governance doc is the still-unapplied removal of the stale `huntington` token from §16b's regex (line 1350), which is harmless to leave as-is: since Huntington's Disease now resolves via the dictionary (stage 0.7, which always wins over regex per the documented precedence), that token is simply dead/unreachable code, not a functional risk.

---

## 5. Findings summary

| # | Finding | Severity | Blocks deployment? |
|---|---|---|---|
| F1 | `plan_overrides` only protects exact alias matches; free-text phrasing for 11 of 13 Optima Secure overrides falls through to a regex path that ignores the override, post-repoint | **High** | No (pre-existing structural behavior, not a defect in this SQL) — but must be explicitly acknowledged and smoke-tested, not silently accepted |
| F2 | `ped_repository.canonical_name` has no unique constraint; SQL assumes exactly one match per name | Medium | **Yes** — run the provided verification query first |
| F3 | New alias/canonical-name collision check is proxy-only (static dictionary mirror), can't see anything added via the UI since 2026-07-29 | Medium | **Yes** — run the provided verification query first |
| F4 | In-process cache means direct SQL execution isn't visible to a running server until restart/redeploy; the `plan_configs` repoint alone *would* go live immediately, creating a confusing partial-apply window | Medium-High | **Yes** — redeploy/restart immediately after running, before considering the change complete |
| F5 | No admin UI exists for `plan_overrides` at all (pre-existing) | Low-Medium | No — informational |
| F6 | Choanal Atresia and Congenital Ptosis are named in the governance doc's condition list but never created by Part F's SQL | Low | No — informational, doc/implementation gap only |
| F7 | ~22 new-PED inserts lack `IF NOT EXISTS` guards (idempotency gap) | Low | No — safe-but-noisy on accidental re-run; recommend adding guards or running once |
| F8 | `mapping_history` isn't written by this SQL | Info | No — the UI doesn't write it either today; no new asymmetry |

---

## Final Go/No-Go

**⚠️ Apply after these corrections**

The SQL itself is correct and does what was approved — nothing here calls the underlying governance decisions into question. But three things need to happen around it, not necessarily inside it, before this is genuinely production-ready:

1. Run the two verification queries in Section 1 (canonical-name uniqueness, alias collision) and confirm clean results before executing.
2. Redeploy or restart the application immediately after running the SQL — don't treat the SQL as "done" until you've confirmed a live lookup reflects the changes.
3. Acknowledge F1 explicitly and smoke-test natural free-text phrasings (not just canonical terms) for the 13 Optima Secure overrides, since that's a real, known gap this SQL can't close on its own without a separately-scoped `engine.ts` change.

None of these are reasons to abandon or redesign the plan — they're the difference between "the SQL ran successfully" and "the intended behavior is actually live and verified."
