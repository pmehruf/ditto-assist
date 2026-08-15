
# Declaration Assistant → Ditto Assist: Migration Plan

Status: **planning only — nothing in this document has been executed.** The one exception is the in-app text rebrand (page titles, tab labels, browser tab title), which was already done as straightforward, reversible UI copy changes before this plan was requested — no infrastructure, database, URL, or deployment change has been made.

---

## 1. Goals (as stated)

- Production database stays completely isolated — nothing touches it except real production traffic.
- A separate staging environment: its own Neon database, its own backend/frontend, its own env vars, its own URL.
- No write path from staging can ever reach production.
- The old Declaration Assistant URL 301-redirects permanently to the new Ditto Assist URL.
- App rebranded to "Ditto Assist," backward compatible (old links still work, via redirect).
- A sane git branching + deployment strategy (main → production, develop → staging, feature branches).
- A full audit of every "Declaration Assistant" reference, and a migration checklist.

---

## 2. Current-state audit

### 2.1 What's already fixed (code-level branding)

Done in this session — plain text/label changes, no infra impact, safe to ship on the next normal deploy:

| Location | Was | Now |
|---|---|---|
| `index.html` `<title>` | Declaration Assistant | Ditto Assist |
| `App.tsx` — sidebar tab label, collapsed-sidebar tooltip, top-bar page label, logo `aria-label`, `ErrorBoundary` labels (×2), one code comment | Declaration Assistant | Ditto Assist |
| `LookupIntroPage.tsx` — splash-screen body copy + doc comment | "Your Declaration Assistant helps you identify…" | "Ditto Assist helps you identify…" |
| `MyActivityPage.tsx` — empty-state copy + comment | "…lookup in the Declaration Assistant page…" | "…lookup in the Ditto Assist page…" |
| `LookupPage.tsx`, `AuditPage.tsx`, `PrimaryCtaButton.tsx`, `index.css`, `constants/featurePermissions.ts`, `components/icons/README.md` | code comments / one user-visible permission-list name | Ditto Assist |

### 2.2 What's still "Declaration Assistant" and needs a decision

| Item | Where | Notes |
|---|---|---|
| Cloud Run service name | `declaration-assistant` (GCP project `gen-lang-client-0626170274`, region `asia-south1`) | This is what generates the current URL (`declaration-assistant-93120856554.asia-south1.run.app`). Renaming a Cloud Run service isn't possible in place — you deploy a **new** service with the new name. |
| `package.json` `"name"` | `"react-example"` | Not even "declaration-assistant" — a leftover scaffold name. Harmless (never shown to users, only read by tooling), but worth fixing for hygiene. |
| GitHub repo name | `Declaration-Map-WebApp-Jul` | Cosmetic only — doesn't affect the running app. Renaming it is optional and can happen anytime independently (GitHub auto-redirects the old repo URL when you rename). |
| Local project folder name | `Declaration Assitant WebApp` | Cosmetic, your machine only. No effect on anything deployed. |
| Governance/permanent-record docs | `MASTER_CONSTITUTION.md`, `PRODUCTION_GOVERNANCE_MANUAL.md`, `MAPPING_POLICY_CHARTER.md`, audit reports, etc. (10 files) | Per your own project convention, these are permanent historical record, not living docs — **recommend leaving their body text as-is** (they describe decisions made under that name at that time). If you want, I can add a one-line "this project was renamed to Ditto Assist on [date]" note at the top of each without touching the historical content. |
| `README.md` | Root readme | Living doc — safe and sensible to update whenever you like; low priority, no functional impact. |
| Env vars | `APP_URL`, `DATABASE_URL` | Not named after the brand, but **environment-specific** — this is the crux of the staging work below, not a text find-and-replace. |
| OAuth redirect URI | Registered in Google Cloud Console against your OAuth client | Must include whatever new URL(s) you deploy to (staging URL, new production URL) as **additional** authorized redirect URIs — the existing one doesn't need to be removed until you're ready. |

### 2.3 Confirmed via code search (so the plan below isn't guessing)

- No CORS allowlist, no hardcoded service URL, and no hardcoded brand string anywhere in `server.ts` or `src/server/**` — the rename is purely a deployment/config concern, not a code-logic one.
- `APP_URL` is read in exactly one place (`src/server/auth/googleOAuth.ts`) to build the OAuth callback URL. This is the only place a new URL needs to be *known* by the running app.
- `DATABASE_URL` is read the same lazy way everywhere (`drizzle.config.ts`, `src/server/db/migrate.ts`, `src/server/db/client.ts` presumably) — fully portable; pointing it at a different Neon connection string is the entire mechanism for environment isolation. No code change needed.
- Only one git branch exists today (`main`), and there's no Cloud Build trigger or auto-deploy — deploys are a manual `gcloud run deploy` run from your machine. This gives you a clean slate for the branching model below with nothing to unwind first.

---

## 3. Target architecture

```
                      ┌────────────────────┐        ┌──────────────────────┐
   main branch  ───▶  │ ditto-assist        │──────▶ │ Neon: production DB   │
   (protected)        │ (Cloud Run, prod)   │        │ (existing, untouched) │
                      └────────────────────┘        └──────────────────────┘

                      ┌────────────────────┐        ┌──────────────────────┐
   develop branch ──▶ │ ditto-assist-staging│──────▶ │ Neon: staging branch  │
                      │ (Cloud Run, staging)│        │ (isolated, resettable)│
                      └────────────────────┘        └──────────────────────┘

   declaration-assistant (old Cloud Run service)
     → kept alive, code replaced with a 5-line redirect server
     → every request 301s to https://ditto-assist-<hash>.asia-south1.run.app
```

**Two Cloud Run services, two Neon databases, two sets of env vars. Nothing shared except the source code and (optionally) the OAuth client.**

### 3.1 Database isolation — Neon branch, not just a second database

Neon's branching feature is built for exactly this: a branch is a full copy-on-write clone of production with its **own connection string**. Writes to the staging branch physically cannot reach the production branch — there's no shared write path, which directly satisfies your "no writes from staging should ever reach production" requirement. This is the recommended approach over a from-scratch second database because:

- It starts as an exact copy of prod schema + data (useful for realistic testing), not an empty shell you have to reseed by hand.
- It's free/cheap on Neon's standard tiers.
- You can reset it (delete + recreate the branch from prod) in seconds whenever staging data gets messy.

If you'd rather have *maximum* separation (e.g. a hard guarantee that staging could never even theoretically share a Neon project with prod), a **separate Neon project** is the alternative — more isolated, slightly more setup (you seed schema via `npm run db:migrate` instead of getting it for free), and no easy "reset from prod" button. Both are legitimate; I'd default to the branch unless you have a specific reason to want full project separation.

### 3.2 Environment variables per service

| Var | Production (`ditto-assist`) | Staging (`ditto-assist-staging`) |
|---|---|---|
| `DATABASE_URL` | existing prod Neon connection string (unchanged) | staging branch's own connection string |
| `APP_URL` | `https://ditto-assist-<hash>.asia-south1.run.app` | `https://ditto-assist-staging-<hash>.asia-south1.run.app` |
| `SESSION_SECRET` | existing value (unchanged) | **a different, freshly generated value** (`openssl rand -base64 32`) — so a staging session cookie can never be replayed against production or vice versa |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | existing (unchanged) | same OAuth client is fine — just add the staging callback URL as a second authorized redirect URI (simplest); a fully separate OAuth client is possible later if you want to restrict who can even attempt sign-in on staging |
| `GEMINI_API_KEY` | existing (unchanged) | can reuse the same key (low risk) or use a separate one if you want to track/cap staging's AI usage separately |
| `PED_SOURCE` | `db` | `db` |
| `NODE_ENV` | `production` | `production` (Cloud Run always runs the built artifact) |

None of this requires a code change — it's entirely what you set as Cloud Run's env vars per service (`gcloud run deploy ... --set-env-vars` or via the console).

---

## 4. Git branching strategy

Your proposal is the right shape for a two-environment setup; here's the concrete version:

- **`main`** — production. Every commit here is deployable, and every deploy to `ditto-assist` (prod) comes from `main`. Protect it: no direct pushes, only merges via reviewed PR.
- **`develop`** — staging. Feature branches merge here first; every push/merge to `develop` is what gets deployed to `ditto-assist-staging`. This is your "does it actually work" gate before anything touches production.
- **`feature/*`** — one branch per piece of work, branched from `develop`, PR'd back into `develop`. Once it's verified on staging, `develop` → `main` via PR promotes it to production.

Flow: `feature/x` → PR → `develop` (auto/manual deploy to staging) → verify on staging → PR `develop` → `main` (deploy to prod).

This also directly fixes the problem you flagged at the start of this conversation ("some changes I do directly get applied on deployed app... basically I think everything DB related") — once staging exists, your day-to-day testing (adding announcements, members, etc. while developing) happens against the **staging** Neon branch, and production is only touched by deliberate, reviewed promotions from `develop` → `main`.

---

## 5. Deployment mechanics

You deploy manually today (`gcloud run deploy ... --source .`). Two reasonable options:

**A. Manual, two commands (recommended to start with)** — no new moving parts, lowest risk while you're setting this up:
```
# staging (from develop branch, locally checked out)
gcloud run deploy ditto-assist-staging --source . --region asia-south1 --allow-unauthenticated

# production (from main branch, locally checked out)
gcloud run deploy ditto-assist --source . --region asia-south1 --allow-unauthenticated
```
Each service already has its own env vars configured once (via `--set-env-vars` the first time, or the Cloud Run console), so subsequent deploys don't need to repeat them.

**B. Automated via Cloud Build triggers** — one trigger watching `develop` → deploys to staging, one watching `main` → deploys to production, both on push. Removes the "did I deploy from the right branch" risk entirely. Worth setting up once the manual flow above has proven itself for a couple of weeks — happy to write the exact trigger config when you're ready for it.

---

## 6. Rollback strategy

- **Code rollback (either service):** Cloud Run keeps prior revisions automatically. Rolling back is instant and doesn't require a rebuild:
  `gcloud run services update-traffic <service> --to-revisions=<previous-revision>=100`
- **Database rollback:** Neon supports point-in-time restore / branch reset independent of the app. Practical safety net: before running any migration against **production**, either (a) it's already been run and verified on the staging branch first, and/or (b) take a quick Neon branch snapshot of prod immediately before migrating, so you have a restore point.
- **Migration discipline:** prefer additive migrations (new columns/tables) over destructive ones (dropping/renaming columns) where possible, so a code rollback never strands the database in a state the old code can't read.
- **URL/redirect rollback:** trivial — the old `declaration-assistant` service is untouched app-wise (it just becomes a redirect), so if anything about the cutover goes wrong, pointing it back at the real app instead of a redirect is a one-command redeploy.

---

## 7. Sequence of execution

Nothing below has been done — this is the order I'd recommend when you say go:

1. **Neon staging branch.** Create a branch of the production database in the Neon console (or `neon branches create`). Grab its connection string.
2. **`develop` branch.** Create it from current `main`.
3. **Staging Cloud Run service.** Deploy `develop` as `ditto-assist-staging` with its own env vars (table above). Add its `/api/auth/google/callback` URL to the OAuth client's authorized redirect URIs.
4. **Smoke-test staging end-to-end** — sign in, add an announcement, add a member, confirm none of it appears in production, confirm production data is untouched.
5. **New production Cloud Run service.** Deploy current `main` as `ditto-assist`, pointed at the **existing** production Neon database (not a new one) and its own `APP_URL`. Add its callback URL to the OAuth client too. Verify it fully replaces current functionality — this runs *alongside* the old `declaration-assistant` service for now, both pointed at the same prod DB is fine since one of them is about to stop serving real traffic.
6. **Cut over.** Once `ditto-assist` is verified, replace `declaration-assistant`'s deployed code with a minimal redirect server (a few lines — respond to every request with a 301 to the `ditto-assist` URL) and redeploy that service. This is what makes the old link "permanently redirect."
7. **Announce / update bookmarks** — anywhere the old URL is written down (docs, browser bookmarks, shared links) can now be updated to the new one at your convenience; the redirect makes this non-urgent.
8. **Housekeeping** (any time after, no urgency): `package.json` name, `README.md`, optionally renaming the GitHub repo.

---

## Open items for you to confirm before I touch anything

- Neon **branch** of prod (recommended) vs a fully separate Neon **project** for staging?
- Manual two-command deploys (A) to start, or set up Cloud Build triggers (B) right away?
- OK to reuse the same Google OAuth client for both environments (adding a second redirect URI), or do you want a fully separate OAuth client for staging?
