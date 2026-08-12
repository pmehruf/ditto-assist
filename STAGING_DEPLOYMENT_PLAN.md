# Staging Deployment Plan — Congenital Governance Changes

Good call — staging first. Per `DEPLOYMENT.md`, staging runs on its own isolated Neon branch (`ditto-assist-staging`, branched from production), so this is genuinely safe: nothing here can touch production data.

One honest note before the plan: I checked, and this sandbox can't reach the staging database either (same DNS failure as production — this environment has no network path to Neon at all, staging or prod). So the SQL execution and query-running below are steps for you to run, same as they would have been for production; I can't run them from here regardless of which environment you target.

---

## Sequence

**1. Run the 3 verification queries against the staging database.**
Use `.env.staging.yaml`'s `DATABASE_URL` (or your Neon console, staging branch selected). Same 3 queries as before — canonical-name uniqueness, the 4-condition recategorization check, and alias collisions. Full text is in `IMPLEMENTATION_AND_VERIFICATION_COMPLETE.md`.

**2. If clean, execute Part F's SQL against staging.**
Same SQL, same transaction (`MAPPING_GOVERNANCE_REVIEW_CONGENITAL_FINAL.md`, Part F) — no staging-specific variant needed, it's plan/environment-agnostic (only ever touches Optima Secure's `plan_configs` row and the shared PED repository tables).

**3. Deploy the code (the F1 fix) to staging:**
```
git checkout develop
git merge <your branch with the engine.ts F1 fix>
gcloud run deploy ditto-assist-staging --source . --region asia-south1 --allow-unauthenticated --env-vars-file .env.staging.yaml
```
This redeploy is also what rebuilds the runtime cache (confirmed in the last review — it warms automatically on boot when `PED_SOURCE=db`).

**4. Verify the cache loaded.**
Check the Cloud Run logs for `ditto-assist-staging` for:
`[PED Repository] DB-backed runtime cache initialized: N aliases loaded and ready.`
No `WARNING: 0 aliases` line, and `N` higher than before by roughly the 28 new PEDs' aliases.

**5. Run the smoke test against staging.**
Same 7 cases as `DEPLOYMENT_SMOKE_TEST_CHECKLIST.md`, but against `https://ditto-assist-staging-93120856554.asia-south1.run.app` instead of production.

**6. Once staging checks out, production is a separate, deliberate step.**
Re-run the same SQL against the production database, merge to `main`, deploy `ditto-assist`, redo the cache-load and smoke-test checks there too. Staging passing doesn't auto-promote anything — production still gets its own explicit go.

---

Everything referenced above (the SQL, the F1 fix, the verification queries, the smoke test cases) is already final from the last two rounds — this is just sequencing it at staging first, which is the right call given you have an isolated environment to use it in.
