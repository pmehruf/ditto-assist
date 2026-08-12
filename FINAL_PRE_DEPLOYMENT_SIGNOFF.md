# Final Pre-Deployment Sign-Off

Closes out the 6 items from the last review round. Nothing has been executed against the database — the only change made in this pass is a code fix in `engine.ts` (item 1) and edits to the governance markdown (items 1, 3). Both are local, reviewable, not yet deployed.

---

## 1. F1 — fixed, not just documented

**Smallest change identified:** a new resolution step in `classifyDeterministic` (`src/engine.ts`), inserted between the existing exact-match dictionary stage (0.7) and the disease-family regex sections — i.e. it's absorbed into the approved diagram's existing "Alias Resolution → Canonical PED Resolution → Direct PED Plan Override" stages, not a new stage bolted on:

- If the exact-match stage found nothing, it now tries every contiguous word-sequence in the input against the same alias map (longest phrase first) — e.g. "Family history of Marfan syndrome" now resolves the phrase "marfan syndrome" to the same canonical PED that typing "Marfan Syndrome" exactly would.
- If that resolves to a PED **with** a plan override for this plan, it returns that override immediately — identical result to an exact match, regardless of phrasing.
- If it resolves to a PED **without** an override, this is a deliberate no-op: nothing changes, and control falls through to the regex sections exactly as before. This was the key constraint — the fix only ever changes the one outcome you asked to guarantee (override reached regardless of phrasing); it does not touch how any other free-text input gets categorized.
- Gated behind `dbSource` (`PED_SOURCE=db`), matching every other Phase 3 addition — a no-op on the legacy path.

**Applied to `src/engine.ts` directly** (not left as a proposal) since this is local application code, not the remote database — you can review the diff before it ships as part of your normal deploy. I validated it parses cleanly (TypeScript transpile check) but could not run your full `npm test`/typecheck suite from this environment (the same sandbox/FUSE limitation noted earlier in this project) — **run your test suite locally before merging**, same as any other code change.

One thing worth knowing rather than assuming away: this does a bounded word-sequence scan (capped at 15 words) against the alias map on every lookup that misses the exact match. For this app's traffic pattern (interactive, single lookups, not high-throughput batch) this is cheap — low single-digit milliseconds at most — but it is a real, if small, cost that wasn't there before. Flagging it rather than not mentioning it.

---

## 2. Pre-flight validation — I could not run this myself; here's the honest state

I attempted a fresh connection to the live database before writing this (DNS resolution against the Neon pooler host) and it failed the same way it has throughout this project — this sandbox has no network path to your database. I want to be direct about that rather than imply I ran these and got clean results.

What I *did* do: re-ran the proxy verification (cross-checking every new canonical name and alias — including the 4 just added in item 3 below — against `TOP_PED_DICTIONARY` and the audited JSON). Zero collisions found, same as the previous pass. This is real signal, but it's still a proxy, not a live-DB confirmation, for the reason stated in the last review (anything added via the PED Repository UI since 2026-07-29 wouldn't show up in either source).

**Please run these three queries yourself before executing Part F, and stop if anything unexpected shows up:**

```sql
-- 1. Canonical name uniqueness for every UPDATE/override target
SELECT canonical_name, count(*) FROM ped_repository
WHERE canonical_name IN (
  'Marfan Syndrome','Ehlers-Danlos Syndrome','Spinal Muscular Atrophy','G6PD Deficiency',
  'Cystic Fibrosis','Pompe Disease','Gaucher Disease','Alpha-1 Antitrypsin Deficiency',
  'Enzyme Deficiency','Down Syndrome','Turner Syndrome','Klinefelter Syndrome','Noonan Syndrome'
)
GROUP BY canonical_name HAVING count(*) <> 1;
-- Expect 0 rows. Any row = ambiguous target, stop and tell me which name and count.

SELECT canonical_name, count(*) FROM ped_repository
WHERE canonical_name ILIKE 'Huntington%' OR canonical_name ILIKE 'Friedreich%Ataxia'
   OR canonical_name ILIKE 'Charcot%Marie%Tooth%' OR canonical_name ILIKE 'Spinocerebellar Ataxia'
GROUP BY canonical_name;
-- Expect exactly 1 row per condition (4 rows total). Anything else = stop.

-- 2. Alias collisions for every new PED being added (24 total, including
-- Choanal Atresia / Congenital Ptosis / Microcephaly / Anencephaly from item 3)
SELECT normalized_alias, ped_id FROM ped_aliases WHERE normalized_alias IN (
  'patent ductus arteriosus','pda','coarctation of aorta','transposition of great arteries','tga',
  'truncus arteriosus','hypoplastic left heart syndrome','hlhs','total anomalous pulmonary venous return','tapvr',
  'arnold chiari malformation','chiari malformation','dandy walker malformation','dandy walker syndrome',
  'holoprosencephaly','encephalocele','craniosynostosis','congenital hip dysplasia',
  'developmental dysplasia of the hip','ddh','renal agenesis','congenital solitary kidney','imperforate anus',
  'congenital diaphragmatic hernia','cdh','gastroschisis','omphalocele','tracheoesophageal fistula','tef',
  'prune belly syndrome','eagle barrett syndrome','bladder exstrophy','digeorge syndrome',
  '22q11.2 deletion syndrome','velocardiofacial syndrome','shprintzen syndrome','congenital hypothyroidism',
  'biliary atresia','congenital hydrocephalus','normal pressure hydrocephalus','acquired hydrocephalus',
  'choanal atresia','congenital ptosis','microcephaly','anencephaly'
);
-- Expect 0 rows.

-- 3. Override target validation — every name the two plan_overrides INSERTs
-- reference resolves to exactly one PED (same query as #1 covers this for
-- the 11 new ones; also re-check the original 2)
SELECT canonical_name, count(*) FROM ped_repository
WHERE canonical_name IN ('Marfan Syndrome', 'Ehlers-Danlos Syndrome')
GROUP BY canonical_name HAVING count(*) <> 1;
-- Expect 0 rows.
```

If any of these return unexpected rows, stop before running Part F and send me the output — I'll tell you exactly what it means and what (if anything) needs to change before proceeding.

---

## 3. Choanal Atresia / Congenital Ptosis — confirmed unintentional, fixed

Not a deliberate deferral. While re-checking this I also found two more of the same kind of gap you hadn't flagged: **Microcephaly** and **Anencephaly** are both named in the "Full condition list" prose (line 43) but were also missing from the SQL. All four are now added to Part F's coverage-additions block, on the same terms as their sibling structural anomalies (`genetic` category, `approved` status, `IF NOT EXISTS`-guarded — see item below).

Separately, I checked **Congenital Adrenal Hyperplasia** (also named in the prose, under "organ-specific wording wins → Endocrine") — this one needed no fix. It already exists in the live dictionary mirror with `categoryKey = 'endocrine'`, exactly matching what the governance doc says should happen. No SQL action needed there; confirmed, not missed.

**Congenital Glaucoma** remains correctly, intentionally excluded — it's on the "held out of SQL entirely, needs per-plan wording check" list, and that's a real decision, not an oversight. Documentation and implementation now agree on all of these.

---

## 4. Runtime cache — your proposed sequence is correct, with one clarification

Your 5-step sequence is right, but steps 2 and 3 are actually the same event, not two separate actions — worth knowing so you don't go looking for a separate "rebuild cache" command that doesn't exist:

1. **Execute the SQL** against the live database.
2. **Redeploy/restart the application.** I checked `server.ts`'s boot sequence: when `PED_SOURCE=db`, the runtime cache is eagerly warmed automatically on every process start (not lazily on first request) — so restarting *is* rebuilding the cache. There's no separate manual "rebuild" step to run.
3. **Verify the cache loaded correctly** — check the boot log for:
   `[PED Repository] DB-backed runtime cache initialized: N aliases loaded and ready.`
   `N` should be higher than it was before (by roughly 24, for the new PEDs' primary + secondary aliases) — and there should be **no** `WARNING: DB-backed cache loaded with 0 aliases` line, which would mean the DB connection or seed failed silently.
4. **Live lookup validation** — a real `/api/match` call (or a Smoke Test page run) for a few of the new/changed conditions, both by canonical name and by free-text phrasing (to confirm item 1's fix is actually working end to end, not just in the code).

So: execute → redeploy (cache rebuild happens automatically as part of this) → check the boot log → live-test. Four real actions, matching your five items with #2/#3 merged.

One thing to flag from the earlier review that's still true: `plan_configs.category_map` (the Optima Secure repoint itself) is read live on every request, no cache involved — so if you ever apply just that one `UPDATE` without redeploying, it goes live immediately while the new PEDs/overrides wouldn't yet. Not a concern if you follow the sequence above (SQL is one transaction, redeploy happens right after), just noting why step 2 matters for the *whole* change, not only the additions.

---

## 5. UI governance — confirmed unchanged

- **PED Repository UI still controls PED → Category mapping.** Nothing in this work touches `PedRepositoryManagement.tsx` or its write path (`pedRepositoryLive.ts`) — it's a generic CRUD surface over `ped_repository`/`ped_aliases` and works identically on the new rows as the old ones.
- **Plan Configuration UI still controls Category → Question mapping.** `PlanManagementPage.tsx` edits `plan_configs.category_map` — the Optima Secure repoint is just a new value in a key that UI already reads and can re-edit, same shape as before.
- **UI edits still reach runtime after the normal cache refresh.** Confirmed again: PED Repository UI writes call the cache-update functions (`updateDbAliasCache`, `updateDbPedCategoryCache`) directly, so those go live immediately without a restart. Plan Configuration UI writes go live immediately too, since `plan_configs` is read fresh every request, no cache at all.
- **No new hardcoded routing was introduced.** Item 1's fix reads from the *same* DB-governed alias and plan-override tables the UI already manages — it doesn't add a new hardcoded list or bypass the repository anywhere. If anything, it makes free-text lookups more consistent with what's actually stored in the repository, not less.
- As you noted, `plan_overrides` still has no UI and remains SQL-managed — unchanged, and you've said that's acceptable for now.

Nothing here regresses your ability to govern mappings from the app.

---

## 6. Final recommendation

**⚠️ Apply after these corrections — and they're the operational ones only, per your framing:**

1. Run the 3 verification queries in item 2 yourself (I structurally cannot run them from here) and confirm clean results.
2. Execute Part F's SQL.
3. Redeploy immediately after — don't leave the SQL applied without a redeploy in between.
4. Check the boot log for the alias-count line and no 0-alias warning.
5. Run a few live lookups, including free-text phrasing, to confirm item 1's fix behaves as intended in your actual environment (I could only validate it locally in isolation).

All the correctness/implementation work from the last review is now closed: F1 is fixed in code, the canonical-name/alias-collision checks are proxy-clean (pending your live-DB confirmation), the documentation/SQL divergence is resolved (4 conditions added, 1 confirmed already-correct, 1 confirmed intentionally-deferred), and the idempotency gap from the earlier review is also closed while I was in that SQL block (every new-PED insert now has the same `IF NOT EXISTS` guard the Hydrocephalus split already used, so an accidental re-run is now a clean no-op instead of a rollback). If your query results in item 2 come back clean, there's no remaining governance work — proceed straight to deployment.
