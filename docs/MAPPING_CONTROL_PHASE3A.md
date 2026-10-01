# Mapping-control Phase 3A — authoritative admin mapping control

Status: implemented on branch `mapping-control/phase2` (commit `e44553f`), **validated on staging**, **not yet deployed to production**. The Phase 2 engine, the legacy engine, `MAPPING_ENGINE=legacy` and the rollback path are unchanged. No existing production mapping is changed by deploying this.

## What changed

| Item | Result |
|---|---|
| AI Mapping Review → **Approve** | Sets the term's category on `ped_repository`/`ped_aliases` (creates the PED + alias for an unknown term). Never overwrites an existing category; refused if the alias has matching options. Bumps the mapping version, then runs a **fresh lookup through the live engine**; success is reported only if it returns the approved question via the new category, otherwise the change is reverted and the reason shown. |
| AI Mapping Review → **Reject** | Reverses exactly what the approval did (refused, never forced, if the rows were edited since); verifies the next lookup no longer uses it; says so truthfully when the approval had not changed any live mapping. |
| Audit + undo | Every change is a `mapping_change_sets` row (who, what, the confirming lookup) plus `mapping_history`. `POST /api/mapping-changes/:id/undo`, `GET /api/mapping-changes`. UI: truthful notices, an Undo button, and the list of changes in each entry's details. |
| `POST /api/add-ped-mapping`, old PED Directory create/edit/delete | Answer **410** in `db` mode and change nothing (no requests in 30 days on either service; no UI caller). Unchanged in `legacy` mode. Dead `PedSuggestionsManagement.tsx` removed. |
| PED Library writes + its rollback mirror | Unchanged. |
| Operational scripts | None of the four writes `ped_mapping_overrides` (`validatePedMigration` only reads it). Three (`applyGovernanceRules`, `fixGallbladderCategory`, `applyEntityCleanupPlan`) wrote the authoritative tables **without bumping the mapping version**, so running servers would not have seen their changes — fixed: they now bump it after `--apply`/`--commit`. |

Consequence to know: AI approvals made in `db` mode are **not** mirrored into `ped_mapping_overrides` (that would restore a parallel source of truth), so they would not exist if production were rolled back to `MAPPING_ENGINE=legacy`. Re-apply them in the PED Library if that ever happens.

## Tests added (all in the full suite: 842 passed, 1 skipped)

- `src/__tests__/aiMappingPromotion.test.ts` (14): approve live on a second instance; old table untouched; no-op on repeat; sets a missing category and undo restores it; never overwrites an existing category; matching-options and orphan aliases refused; a term decided first by a built-in rule is reverted with the reason; unknown category refused; reject reverts on every instance; reject with nothing applied says so; undo not repeatable; undo refused after later edits; audit contents.
- `src/__tests__/mappingWritePathAudit.test.ts` (8): the exact inventory of routes that write the old table; retired routes guarded before any write; AI Mapping Review writes the old table only in its legacy branch; no other code references the write helpers; the new mechanism never touches the old table; scripts never write it and bump the version.
- Phase 2 equality (113,130 pairs), propagation and Zero Regression Audit tests unchanged and passing.

## Staging validation (revision `ditto-assist-staging-00177-5f2`, 3 instances, real AI Mapping Review entry #207 "low hb", Optima Secure)

| Check | Result |
|---|---|
| Approve | `promoted: true, verified: true`; all 3 instances answered with the blood question on the very next lookup (v16, decided by the plan decision) |
| Reject | `reverted: true, verified: true`; all 3 instances back to original behaviour (v17) |
| Approve again → Undo via endpoint | reverted + verified (v19); second undo refused ("already been undone") |
| Entry #211 (existing alias with matching options) | `promoted: false` with the reason; nothing changed |
| `/api/add-ped-mapping`, `POST /api/ped-suggestions` | 410, `retired: true` |
| Cleanup | no leftover PED/alias; entries reset to pending; `ped_mapping_overrides` unchanged (13 rows) |

## Production rollout (not done — needs the owner's go-ahead)

Migration 0086 is additive (one new table). Migrate production **before** deploying the code. Same procedure as Phase 2: backup, migrate, deploy exactly the commit from a clean `git archive` export (never the working tree), keep `MAPPING_ENGINE: "db"` in `.env.production.yaml` so a `--env-vars-file` deploy does not reset it.

```powershell
npm run mapping:backup -- --out backups/production-pre-0086.json.gz
npm run db:migrate
gcloud run deploy ditto-assist --source . --region asia-south1 --allow-unauthenticated --env-vars-file .env.production.yaml
```

Rollback: `gcloud run services update-traffic ditto-assist --region asia-south1 --to-revisions ditto-assist-00111-cpb=100` (code), then, if wanted, drop `mapping_change_sets`. The table is unused by any older code.

## Not done / still open

- The AI Mapping Review screen changes (notices, Undo, change list) were verified by typecheck, build and the API flow above, **not** by viewing the screen.
- Phase 3 remaining (not started): the single admin section, impact preview and confirmation threshold, category CRUD, UI-managed exceptions, removal of the PED Library rollback mirror (Phase 6).
