# Deployment Reference

Secrets (SESSION_SECRET, DATABASE_URL, GOOGLE_CLIENT_SECRET, GEMINI_API_KEY) live only in
`.env.production.yaml` / `.env.staging.yaml` on your machine — both are git-ignored.
Never paste real secret values into this file; it's a normal tracked doc, not a secrets store.

```
Production
----------
Branch:      main
Cloud Run:   ditto-assist                 (a separate "declaration-assistant" service also
                                            still exists in this project/region — unclear as
                                            of 2026-08-25 whether it's still live or a leftover
                                            pending decommission; not touched here)
Database:    Neon "production" branch     (the original/root branch — untouched)
APP_URL:     https://ditto-assist-y5biuzxgda-el.a.run.app   (confirmed via `gcloud run services
                                            list` 2026-08-25 — Cloud Run's default URL format
                                            changed at some point since this doc was last
                                            updated; the old ...-93120856554.asia-south1.run.app
                                            form is stale)
Env file:    .env.production.yaml (local, git-ignored)

Staging
-------
Branch:      main (single canonical branch; staging is deployed from a branch or main, then production from main)
Cloud Run:   ditto-assist-staging
Database:    Neon "ditto-assist-staging" branch (branched from production, isolated)
APP_URL:     https://ditto-assist-staging-y5biuzxgda-el.a.run.app   (confirmed 2026-08-25, see note above)
Env file:    .env.staging.yaml (local, git-ignored)
```

## Deploy commands

**Staging** (from `main`, or a short-lived feature branch you want to try first):
```
gcloud run deploy ditto-assist-staging --source . --region asia-south1 --allow-unauthenticated --env-vars-file .env.staging.yaml
```

**Production** (from `main` branch):
```
gcloud run deploy ditto-assist --source . --region asia-south1 --allow-unauthenticated --env-vars-file .env.production.yaml
```

## Rules

- Never point `.env.production.yaml` at the staging database, or vice versa.
- Staging is safe to break — it has its own isolated Neon branch.
- Every OAuth redirect URI (production + staging) must be registered in Google Cloud Console → APIs & Services → Credentials → same OAuth client → Authorized redirect URIs.

## Status

- [x] Staging deployed and verified isolated from production (2026-08-05)
- [x] `develop` retired: `main` is the single long-lived branch (2026-10-05)
- [ ] Production service `ditto-assist` deployed
- [ ] `declaration-assistant` converted to a 301-redirect stub pointing at `ditto-assist`
