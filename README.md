# Ditto Assist

Ditto Assist is the internal advisory web app Ditto's team uses to work insurance pre-existing-disease (PED) declarations, product Q&A, and related advisor workflows in one place. It's a React/TypeScript single-page app backed by an Express API and a Postgres (Neon) database, deployed on Google Cloud Run.

The core feature — **Declaration Assistant** — maps a customer-reported medical condition to the correct declaration question for a given insurance plan using a rule-based classification engine (governed PED Repository + category hierarchy), backed by an AI-assisted Product Assist chat for product/policy questions grounded in the plans' own knowledge base.

---

## Features

- **Declaration Assistant** — looks up a reported medical condition/procedure and returns the correct plan-specific declaration question, using a deterministic classification engine over a governed PED (pre-existing disease) repository, with synonym/alias handling and plan-specific overrides.
- **Product Assist** — a Gemini-powered chat that answers plan/policy questions grounded in an ingested knowledge base (PDFs, URLs, and a live-synced Google Sheet "Product Playbook"), scoped to the plans the advisor is asking about.
- **Coverage Projection** — a projection/estimation tool for coverage scenarios.
- **Specific Illness Check** — a focused lookup flow for a fixed set of named illnesses.
- **QA Dashboard** — pulls QA evaluation data from a connected Google Sheet (per-advisor OAuth connection, no service account required) and surfaces scores/history.
- **Declaration Map / Plan Reference** — browsable reference views over the plan question set and category mappings.
- **Announcements** — an authoring + read/acknowledge flow for team-wide notices, with a QA-specific announcement log.
- **Admin & Developer tooling** — PED Repository management, plan management, user/role management, audit/change history, flagged-response review, and connection management (Google OAuth for Sheets), gated by role tier (Advisor, Guide/Mentor, Admin, Developer).

## Architecture

```
Browser (React + Vite SPA)
        │
        ▼
Express API (server.ts + src/server/**)
        │
        ├── Declaration engine (src/engine.ts) — deterministic PED classification
        ├── Product Assist (src/server/knowledgeBase/**) — retrieval + Gemini
        ├── QA Dashboard (src/server/qaDashboard/**) — Google Sheets OAuth sync
        └── Drizzle ORM ──▶ Postgres (Neon)
```

The classification engine (`src/engine.ts`) reads from the **PED Repository** — governed tables (`ped_repository`, `ped_aliases`, `plan_overrides`) maintained through the admin UI — via a synchronous in-memory runtime cache (`src/server/pedRuntimeCache.ts`) so lookups never hit the database per-request. A legacy hardcoded fallback path still exists behind the `PED_SOURCE` flag as an emergency rollback (see `.env.example`), but the DB-backed path is the production default.

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS (v4), Recharts, lucide-react icons
- **Backend:** Express 4, esbuild (bundles `server.ts` to `dist/server.cjs`), Node 20
- **Database:** Postgres (Neon) via Drizzle ORM, migrations in `drizzle/`
- **AI:** Google Gemini (`@google/genai`) for Product Assist
- **Auth:** Google OAuth (Sign-in + per-feature Sheets access grants)
- **Testing:** Vitest (+ PGlite for in-memory Postgres in repository tests)
- **Deployment:** Docker, Google Cloud Run

## Getting started

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, GEMINI_API_KEY, GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET
npm run db:migrate
npm run dev             # http://localhost:3000
```

See `.env.example` for the full list of environment variables and what each one controls. `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` are required; `GEMINI_API_KEY` is required for Product Assist (falls back to keyword matching if unset).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (Vite middleware + Express, via `tsx`) |
| `npm run build` | Production build — `vite build` (client) + esbuild bundle (server) |
| `npm start` | Run the built server (`dist/server.cjs`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over the whole repo |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio |

A handful of one-off `db:*` scripts (backfills, imports) exist for specific historical data migrations — see `scripts/` and their inline comments before running one against a live database.

## Testing & CI

`npm test` runs the Vitest suite (`src/__tests__/**`, plus colocated `*.test.ts` files). Repository-layer tests under `src/server/db/repositories/` use PGlite (an embedded Postgres) so they don't require a live database connection.

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `main`: typecheck → lint → test → production build, in that order, on `ubuntu-latest` with Node 22.

## Deployment

Deployed on **Google Cloud Run** via `Dockerfile` (multi-stage: build with devDependencies, ship a pruned production image). See `DEPLOYMENT.md` for the current environment layout (staging/production service names, database branches, deploy commands) and `DEPLOYMENT_SMOKE_TEST_CHECKLIST.md` for the post-deploy verification checklist.

## Documentation

- `DECLARATION_ENGINE_ARCHITECTURE.md` — how the classification engine and PED Repository work
- `MAPPING_POLICY_CHARTER.md` / `MASTER_CONSTITUTION.md` — governance rules for how conditions get mapped to declaration questions
- `PED_REPOSITORY_GOVERNANCE.md` — PED Repository data model and the governance/validation tooling in `scripts/`
- `PRODUCTION_GOVERNANCE_MANUAL.md` — production change-management process
- `GOOGLE_OAUTH_SETUP.md` / `QA_DASHBOARD_SHEETS_SETUP.md` — OAuth and Sheets-integration setup
- `docs/APP_STRUCTURE_MAP.md` — internal map of `App.tsx`'s tab/state structure
- `docs/archive/` — superseded audits, migration reports, and design docs kept for historical record

## Disclaimer

Ditto Assist is a decision-support tool for insurance declaration workflows. It is **not** a diagnostic or clinical decision-making tool and must not be used for medical advice. Final underwriting decisions should always follow insurer guidelines and applicable policy wording.
