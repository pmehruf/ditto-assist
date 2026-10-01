# Mapping-control Phase 2 — equality migration runbook

Status: implemented on branch `mapping-control/phase2` (baseline commit `98e0334`). **Nothing here changes behaviour until `MAPPING_ENGINE=db` is set**, and nothing is deployed or applied to any database yet.

The aim: the data-driven engine (`src/mapping/`) reproduces **current production behaviour exactly**, proven before anything is switched. Deliberate improvements (R10 corrections, ordered category chains, Care Supreme V2, alias exceptions you choose to change) come later as separate, listed batches.

## What was added

| Piece | Where |
|---|---|
| Schema + migration (additive only) | `drizzle/0085_mapping_control_foundation.sql`, `src/server/db/schema.ts` |
| Rule model, seed of every legacy rule | `src/mapping/ruleTypes.ts`, `src/mapping/legacyRuleSeed.ts` |
| Data-driven engine | `src/mapping/routingEngine.ts` |
| Per-environment seed derivation | `src/mapping/seedBuilder.ts`, `src/server/mappingSeed.ts` |
| Live snapshot + version check | `src/server/mappingSnapshot.ts` |
| Server switch `MAPPING_ENGINE` (default `legacy`) | `server.ts` |
| Alias "Matching options" in the PED Library | `src/components/PedRepositoryManagement.tsx` |
| Frozen production day-one snapshot + baseline | `src/__tests__/fixtures/mapping/` |
| Gate tests | `src/__tests__/mappingSeedFidelity.test.ts`, `mappingControl.equality.test.ts`, `mappingControl.propagation.test.ts`, `mappingControl.audit.test.ts` |

New tables/columns (migration 0085): `routing_rules`, `mapping_state`, and on `ped_aliases`: `routing_enabled`, `category_key_override`, `fallback_category_key`.

## Run order, per environment (staging first, then production)

Production is **migrated before** the new code is deployed (the code selects the new alias columns).

PowerShell, from the repository root. Staging uses `.env` as-is. For production, load the URL from the local (git-ignored) production file for this one shell:

```powershell
$env:DATABASE_URL = ((Get-Content .env.production.yaml | Where-Object { $_ -match '^DATABASE_URL:' }) -replace '^DATABASE_URL:\s*"?','' -replace '"?\s*$','')
```

1. **Preview what the seed will do** (read-only; works before the migration):

```powershell
npm run mapping:seed
```

2. **Apply the migration** (adds tables/columns only):

```powershell
npm run db:migrate
```

3. **Apply the seed** (idempotent; refuses to run twice; all-or-nothing):

```powershell
npm run mapping:seed -- --apply
```

4. **Prove equality against the live database** (read-only; must end with `EQUAL — zero differences`):

```powershell
npm run mapping:verify
```

5. **Deploy the new code with the switch still off**, then turn it on (staging shown; production identical with its names):

```powershell
gcloud run deploy ditto-assist-staging --source . --region asia-south1 --allow-unauthenticated --env-vars-file .env.staging.yaml
gcloud run services update ditto-assist-staging --region asia-south1 --update-env-vars MAPPING_ENGINE=db
```

6. **Roll back instantly (no redeploy):**

```powershell
gcloud run services update ditto-assist-staging --region asia-south1 --update-env-vars MAPPING_ENGINE=legacy
```

Production: use service `ditto-assist` and `--env-vars-file .env.production.yaml`.

## Before the production cutover

- Take a **fresh production snapshot** immediately before the final seed and equality run, and make **no mapping changes** from then until cutover. If one happens, repeat snapshot → seed → verify:

```powershell
npm run mapping:snapshot -- --env production --out src/__tests__/fixtures/mapping/production-day-one.snapshot.json.gz
npm run mapping:baseline -- --snapshot src/__tests__/fixtures/mapping/production-day-one.snapshot.json.gz --out src/__tests__/fixtures/mapping/production-day-one.baseline.json.gz
```

  (The pinned counts in `mappingControl.equality.test.ts` and the snapshot hash move with a new snapshot — update them deliberately in the same commit.)
- After the flip, run `DEPLOYMENT_SMOKE_TEST_CHECKLIST.md` and the app's Smoke Test page, and compare with the frozen baseline.

## Alias compatibility controls (precedence)

Applied only at the dictionary stage; they never override exact wording, plan-specific PED overrides, shields or plan rules.

1. `routing_enabled = false` → the alias has no dictionary entry.
2. else `category_key_override` (when set) replaces the PED's category.
3. else the PED's own category.
4. (pending owner approval) `fallback_category_key` is tried only when the whole pipeline resolved nothing with the primary category.

The chosen source is recorded in each result's `decision_trace.dictionary`.

## Known data findings in production (reported, not changed)

- 41 aliases point at PEDs that no longer exist (they are the lifestyle terms: cigarette, beer, gutkha …). The seed reproduces production by giving them a category override.
- 5 aliases have a stored normalised key that differs from the current normaliser (hyphenated names stored with a space): 22q11.2 Deletion Syndrome, Arnold-Chiari Malformation, Dandy-Walker Malformation, Dandy-Walker Syndrome, Eagle-Barrett Syndrome.
- The active Optima Secure restriction on the `respiratory` category has no effect today: the engine only reads restrictions for `diabetes` and `benign_growth`.
- In `MAPPING_ENGINE=db` mode the legacy "teach it" flow, the AI Mapping Review approve action and the old PED Directory still write only to `ped_mapping_overrides`, which the data-driven engine does not read. They are retired in the admin consolidation phase.
