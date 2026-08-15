PED Repository — Database Migration Design
============================================

Status: APPROVED (2026-07-28), with 4 decisions incorporated — see
"Approved Decisions" below. Implementation is now in progress. Runtime
behavior does not change until the validation report (§6.4) is reviewed
and the cutover flag is explicitly flipped.

Approved Decisions
-------------------

1. **Collision repository enforcement**: advisory-only for this
   migration. No schema change is actually needed to add enforcement
   later — `severity` (`guardrail`/`advisory`) and `active` already let a
   future code change decide which rows to consult and block on, without
   touching the schema again. "Advisory-only for now" is purely a
   decision about what `engine.ts` *does* with the table today (nothing),
   not a constraint on the table's shape.
2. **`ai_memory`**: extended in place, not renamed. See §1.6.
3. **Conflict handling**: the seed script is mandatory-conflict-report,
   hard-pause. It runs in two modes — `--dry-run` (default; produces the
   full proposed seed dataset and a conflicts report, writes nothing) and
   `--apply` (writes to the DB, but refuses to run at all if any conflict
   remains unresolved). See §2 for the resolution mechanism.
4. **Cutover validation**: a validation report comparing the legacy
   engine against the DB-backed engine across the full repository and
   every plan is a hard gate before the runtime flag (§3) is flipped. See
   new §6.4.

Scope: make PostgreSQL the only runtime source of truth for the PED
repository, aliases, category definitions, category→plan-question mapping,
plan configuration, plan overrides, and approved mappings. Regex-based
engine behavior (normalization, safety shields, disease-family detection,
pipeline routing) stays in code, unchanged, per your decision #3.


1. Proposed PostgreSQL Schema
------------------------------

Six new tables, one extended existing table, two existing tables reused
as-is.

### 1.1 `categories` (new)

Replaces the hardcoded `CATEGORY_LABELS` object in `types.ts`.

| column        | type      | notes                                          |
|---------------|-----------|-------------------------------------------------|
| category_key  | text PK   | e.g. "genetic", "respiratory" — unchanged from today's string keys, so no ripple-effect rename across the ~50 places that already compare against these strings |
| label         | text      | e.g. "Congenital / Genetic Disorder"            |
| description   | text null | optional longer explanation                     |
| sort_order    | integer   | display order, default 0                         |
| created_at    | timestamp |                                                   |
| updated_at    | timestamp |                                                   |

Kept as a text primary key (not a new integer id) deliberately — every
other table below, and a large amount of existing `engine.ts`/`server.ts`
code, already speaks in `categoryKey` strings. Reusing the string as the PK
means categories slot in without forcing an int-id rewrite everywhere else.

### 1.2 `ped_repository` (new) — master disease registry

| column           | type        | notes                                                         |
|------------------|-------------|-----------------------------------------------------------------|
| id               | serial PK   | the stable internal identity you asked for                     |
| ped_code         | text unique | display id, e.g. "PED-000421" — formatted from `id` at insert time (`'PED-' \|\| lpad(id::text, 6, '0')`), computed in the repository layer, not hand-entered |
| canonical_name   | text        | e.g. "Obstructive Sleep Apnea" — display name, editable in place (renames/spelling fixes don't change `id` or `ped_code`, so nothing downstream breaks) |
| category_key     | text FK → categories.category_key | nullable until reviewed |
| status           | enum        | `draft` \| `approved` \| `deprecated`                            |
| merged_into_id   | integer FK → ped_repository.id, nullable | for future dedup tooling (two entries later found to be the same disease) — not used in v1, included so the column exists before data accumulates |
| notes            | text null   | free-text clinical/admin notes                                  |
| added_by         | text        |                                                                   |
| created_at       | timestamp   |                                                                   |
| updated_at       | timestamp   |                                                                   |

### 1.3 `ped_aliases` (new) — every searchable text variant

| column            | type        | notes                                                       |
|-------------------|-------------|----------------------------------------------------------------|
| id                | serial PK   |                                                                  |
| ped_id            | integer FK → ped_repository.id, cascade delete |                              |
| alias_text        | text        | display form, e.g. "Obstructive Sleep Apnoea"                  |
| normalized_alias  | text unique | `normalizeDictionaryKey(alias_text)` — the actual runtime lookup key |
| is_primary        | boolean     | true for the row that mirrors `canonical_name`                 |
| added_by          | text        |                                                                  |
| created_at        | timestamp   |                                                                  |

The canonical name itself gets a row here too (`is_primary = true`), so the
engine only ever needs to query one table (`ped_aliases`) to resolve any
PED text to an `id`, and from there to a category. The `unique` constraint
on `normalized_alias` is what *enforces* alias collisions at the database
level — two PEDs can never claim the same normalized text; an attempt to
do so fails the write and should be surfaced as an Alias Collision in the
UI rather than a generic DB error.

### 1.4 `plan_configs` (existing — reused, not redesigned)

Already has everything needed: `questions`, `category_map` (JSONB,
categoryKey → question text), `umbrella_questions`, `specific_illnesses`,
`overrides`. The only change is behavioral, not structural: after
migration, `/api/match` stops falling back to the hardcoded
`getPlanConfig()` in `types.ts` and requires a DB row for every plan (see
§4, seeding).

### 1.5 `plan_overrides` (new) — replaces the 4 hardcoded stage-0.4 blocks

| column        | type        | notes                                                            |
|---------------|-------------|---------------------------------------------------------------------|
| id            | serial PK   |                                                                       |
| plan_name     | text FK → plan_configs.plan_name |                                                 |
| ped_id        | integer FK → ped_repository.id |                                                  |
| category_key  | text FK → categories.category_key | the category THIS plan uses for this PED, which may differ from the PED's own default category_key |
| reason        | text        | e.g. "This plan's proposal wording explicitly lists OSA under the congenital question" |
| added_by      | text        |                                                                       |
| created_at    | timestamp   |                                                                       |

This is the direct replacement for the 4 hardcoded blocks I fixed earlier
today (Activ Fit Preferred: OSA→genetic, DVT/PE family→heart; Care
Supreme: Crohn's/colitis/IBD→blood; Optima Secure: RA/ankylosing
spondylitis→musculoskeletal). Each currently-regex-matched *family* of
terms becomes one row per distinct `ped_id` — e.g. the AFP vascular family
(DVT, PE, varicose veins, lymphedema, Raynaud's) becomes 5 separate rows,
since those are clinically distinct conditions, not aliases of one PED.
More rows, but it's real editable data instead of a regex an admin can't
touch.

### 1.6 `ai_memory` (existing table — extended, not renamed)

Naming note: this table already *is* the backing store for the "AI
Mapping Review" page you referenced. I'd rather add columns to it than
create a parallel `ai_mapping_review` table and migrate data between two
tables that mean the same thing — flag if you'd prefer an actual rename
instead (`ALTER TABLE ai_memory RENAME TO ai_mapping_review`, cheap either
way).

New columns:

| column                 | type        | notes                                                        |
|------------------------|-------------|-----------------------------------------------------------------|
| confidence             | text null   | "HIGH" \| "MEDIUM" \| "LOW" — AI-generated suggestions only, per your decision #2 |
| suggested_category_key | text FK → categories.category_key, null | pulled out of the raw `ai_response` JSON for clean filtering/joins |
| ped_id                 | integer FK → ped_repository.id, null | linked once/if the suggestion is approved and promoted; null while pending |

`status` already exists and already is exactly `pending` / `approved` /
`rejected` — matches your decision #2 requirement with no change needed.

### 1.7 `mapping_history` (new) — structured audit trail for mapping decisions

Distinct from the existing general-purpose `change_logs` table (which
stays for plan/announcement/user admin actions). This one is specific to
PED/category/mapping changes and stores structured before/after values
instead of a free-text description, so it can answer "what was this PED's
category on 2026-06-01" without parsing prose.

| column          | type        | notes                                                          |
|-----------------|-------------|--------------------------------------------------------------------|
| id              | serial PK   |                                                                      |
| ped_id          | integer FK → ped_repository.id, nullable | null for category- or plan-level events |
| entity_type     | enum        | `ped` \| `alias` \| `category` \| `plan_override` \| `plan_config` |
| action          | text        | `created` \| `updated` \| `category_changed` \| `approved` \| `rejected` \| `alias_added` \| `alias_removed` \| `unmapped` |
| previous_value  | jsonb null  |                                                                      |
| new_value       | jsonb null  |                                                                      |
| reason          | text null   |                                                                      |
| performed_by    | text        |                                                                      |
| performed_at    | timestamp   |                                                                      |

### 1.8 `collision_repository` (new) — institutional memory

| column                    | type        | notes                                                       |
|---------------------------|-------------|-----------------------------------------------------------------|
| id                        | serial PK   |                                                                   |
| collision_type            | enum        | `alias` \| `category` \| `plan` \| `ai` \| `regression`          |
| ped_id                    | integer FK → ped_repository.id, nullable | null for a regression entry about a term that was rejected before ever becoming a real repository row |
| rejected_category_key     | text FK → categories.category_key, nullable | the wrong category being guarded against |
| approved_category_key     | text FK → categories.category_key, nullable | what it should resolve to instead |
| related_plan_name         | text null   | for `plan` type                                                  |
| related_ai_memory_id      | integer FK → ai_memory.id, nullable | for `ai` type — links back to the specific conflicting suggestion |
| description               | text        | the human-readable "why", e.g. "Migraine must never map to Stroke/Neurological — under-disclosure risk" |
| severity                  | text        | `guardrail` (regression entries meant to actively block) \| `advisory` (informational) |
| active                    | boolean     | lets a stale guardrail be retired without deleting history       |
| added_by                  | text        |                                                                   |
| created_at                | timestamp   |                                                                   |

Your 5 collision types map onto this one table via `collision_type` rather
than 5 separate tables — they share the same shape (a PED, a rejected
outcome, an approved outcome, a reason) and separating them would mean
duplicating that shape 5 times for no query benefit. Let me know if you
had a reason to want them physically separate that I'm not seeing.

**Open question — enforcement level.** You said the goal is to "prevent
future regressions." That could mean (a) advisory: browsable, referenced
in the UI, admins see it during review — or (b) enforced: the engine
actively checks `collision_repository` before returning a match and blocks
if the about-to-be-returned category matches a `regression`-type
`rejected_category_key` for that PED. (b) is a genuine runtime-behavior
change beyond "move data to Postgres" — it adds a new validation step to
the pipeline. Given your instruction that "no runtime behavior should
change until the migration has been fully validated," I'd recommend
shipping (a) advisory-only in this migration, and treating (b)
enforcement as a deliberate follow-up you sign off on separately once the
data exists to enforce against. Flag if you want (b) in scope now instead.


2. Migration Strategy
----------------------

**Phase 1 — Schema.** Create the 6 new tables + extend `ai_memory`, via
`drizzle-kit generate` + `npm run db:migrate`, same pattern already used
for every existing table. No data moved yet, no runtime behavior change —
purely additive DDL.

**Phase 2 — One-time seed script** (`scripts/seedPedRepository.ts`,
matching the existing `scripts/backfillAiMemory.ts` convention). Run once,
by hand, reviewed before executing against production:

1. Read the ~600 entries out of the current `TOP_PED_DICTIONARY` object,
   the ~1,223 rows in `ped_directory`, and the existing rows in
   `ped_mapping_overrides`.
2. For every distinct normalized text across all three sources, resolve
   one canonical PED + category using this precedence: an existing
   `ped_mapping_overrides` row (an explicit admin decision) wins; then
   `ped_directory.category` if set; then `TOP_PED_DICTIONARY`'s compiled
   default.
3. **Conflict handling (hard gate)**: the script has two modes.
   `--dry-run` (default) computes the full proposed seed dataset and
   writes a `conflicts-report.json`/`.md` for every term where two sources
   disagree with no override to break the tie — nothing is written to the
   DB in this mode. `--apply` performs the actual writes, but checks the
   conflicts report first and **refuses to run at all** if any conflict's
   `resolution` field is still empty. You resolve conflicts by editing the
   report file directly (each conflict entry gets a `resolution:
   "<categoryKey>"` field filled in) and re-running — there is no
   auto-resolve path, by design. Every resolved conflict is also written
   into `collision_repository` as a `category`-type entry, so the
   resolution and its reasoning become permanent institutional memory
   rather than disappearing after the migration.
4. Group synonym clusters (e.g. "OSA" / "sleep apnea" / "obstructive sleep
   apnea") into one `ped_repository` row with 3 `ped_aliases` rows, using
   the existing synonym groupings already in
   `src/constants/pedSynonymGroups.ts` as a starting point, reviewed by
   hand rather than auto-merged — merging two clinically distinct terms
   into one PED by mistake would be its own regression.
5. Seed `categories` from `CATEGORY_LABELS`.
6. Seed `plan_configs` rows for all 6 hardcoded plans (Optima Secure, Care
   Supreme, Activ One Max, Activ Fit Preferred, Aspire, Reassure 2.0) from
   `getPlanConfig()`, for any that don't already have a DB row.
7. Seed `plan_overrides` from the 4 hardcoded stage-0.4 blocks (expanded
   into one row per distinct PED, per §1.5).
8. Optionally seed `collision_repository` with `regression`-type entries
   for the incidents already found this session — OSA→Congenital (Optima
   Secure/Activ Fit Preferred), the punctuation-normalization class of bug
   — as the first real guardrail entries, if you want institutional memory
   to start from day one rather than empty.

**Phase 3 — Runtime cutover** (see §4). Behind the scenes, not
user-visible: `classifyDeterministic`'s dictionary stage starts reading
from a DB-loaded in-memory cache instead of the compiled
`TOP_PED_DICTIONARY` object; plan config lookups stop falling back to
`getPlanConfig()`; the 4 hardcoded plan-specific blocks are deleted in
favor of a generic `plan_overrides` lookup.

**Phase 4 — Verification** (see §5) before the compiled objects in
`types.ts` are stripped down to empty containers.

**Phase 5 — Cleanup.** `TOP_PED_DICTIONARY`, `getPlanConfig()`'s literal
plan data, and `CATEGORY_LABELS`' literal content move out of `types.ts`
into the seed script only (as historical/backup data), leaving `types.ts`
holding just type definitions and pure helper functions.


3. Rollback Strategy
----------------------

Because Phase 1–2 are purely additive (new tables, seeded but not yet
read at runtime), rollback before Phase 3 cuts over is trivial: drop the
new tables, delete the seed script's output, nothing else changes.

Once Phase 3 cuts the engine over to reading from DB, rollback options,
cheapest first:

1. **Feature flag, not a code revert.** Add one environment variable
   (e.g. `PED_SOURCE=db` / `PED_SOURCE=legacy`) that the match endpoint
   checks at startup. If DB-sourced matching misbehaves in production,
   flipping this back to `legacy` and restarting reinstates the exact
   current behavior (compiled dictionary + existing override-layering)
   with no deploy needed, since Phase 5 (deleting the compiled data)
   wouldn't happen until well after Phase 3/4 are proven stable. This is
   the main reason I'd sequence Phase 5 (deleting the old data from
   `types.ts`) as a separate, later step rather than bundling it into the
   same deploy as Phase 3.
2. **Git revert** of the Phase 3 commit if the flag itself has a bug —
   standard revert-and-redeploy, no data loss since the DB tables and
   their data are untouched by reverting application code.
3. **Data rollback** is intentionally not needed in the above two cases —
   nothing about Phase 3 destroys or mutates the DB tables from Phase 2,
   it only changes what the running app reads. The only genuinely
   destructive step in this whole plan is Phase 5 (deleting compiled data
   from `types.ts`), which I'd hold until you've confirmed in production
   that Phase 3/4 have been stable for a real observation period.


4. Runtime Architecture After Migration
------------------------------------------

The "instant effect, no restart" behavior you asked for is *already* the
pattern this app uses for `ped_mapping_overrides` and `plan_configs` today
— write to Postgres, then update an in-memory cache in the same request,
so every subsequent lookup in the same process sees the change
immediately. This migration extends that exact pattern to cover the full
dataset instead of just the delta on top of a compiled default:

- **At server boot**: one async load builds an in-memory `Map` of
  `normalizedAlias → { pedId, categoryKey }` from `ped_aliases` JOIN
  `ped_repository`, another `Map` of `categoryKey → label` from
  `categories`, and a small in-memory structure of `plan_overrides`
  (currently ~4 rows, will grow to maybe a few dozen — trivial to hold
  entirely in memory). `plan_configs` is already loaded per-request from
  DB today; no change needed there.
- **On every write** (PED Library create/edit/delete, AI Mapping Review
  approve/reject, Plan Management edit, a new plan-override row) — the
  repository method that performs the DB write also updates the
  corresponding in-memory Map entry synchronously, before returning to the
  caller. This is exactly what `promotePedMappingOverride` /
  `unmapPedMappingOverride` already do today; the change is just that the
  Map they update is now the *complete* dataset, not a delta layered on a
  compiled default.
- **`classifyDeterministic` stays a pure, synchronous function.** No
  per-lookup DB round-trip during matching — it keeps its current
  performance profile, just reading from a DB-sourced Map instead of a
  compiled object literal. This also means the existing test suite's
  pattern (construct a fake `PlanConfig`, call `classifyDeterministic`
  directly) keeps working unchanged for anything that doesn't depend on
  dictionary content.
- **The 4 hardcoded stage-0.4 blocks in `engine.ts` are deleted** and
  replaced with one generic check: look up `(planName, pedId)` in the
  in-memory `plan_overrides` Map before falling through to the normal
  category resolution. Same effect, but every plan's overrides are now
  equally data-driven instead of 4 special-cased `if (planName ===
  "...")` blocks that only a code change could ever extend.
- **Regex-based shields, disease-family sections, life-stage firewall,
  and the P0 exact-wording matcher are untouched** — they still run in
  their current pipeline position, still contain their current word lists
  in code, per your decision #3. They only ever fire for text that
  doesn't resolve via the (now DB-backed) alias lookup, exactly as they
  do today for anything outside `TOP_PED_DICTIONARY`.
- **A server restart is still required after a code deploy** — that's
  true of any Node process and isn't something this migration changes or
  needs to change. What it eliminates is needing a code deploy *at all*
  for a PED categorization change, alias addition, or plan mapping edit.


5. Zero-Regression Impact Assessment
---------------------------------------

**Data fidelity during merge (highest risk).** `ped_directory` (~1,223
terms), `ped_mapping_overrides` (admin corrections), and
`TOP_PED_DICTIONARY` (~600 compiled entries) overlap heavily today. The
seed script's precedence rule (§2, step 2) and conflict report are the
main safeguard here — I'd want to review that conflict report with you
line-by-line before Phase 3 cuts over, not auto-resolve it.

**Normalization consistency.** The seed script must populate
`normalized_alias` using the exact same `normalizeDictionaryKey` function
`classifyDeterministic` uses at lookup time — this is precisely the bug
class I fixed earlier in this conversation (punctuated terms silently
unreachable). Reusing the one exported function everywhere, rather than
re-deriving the normalization logic in the seed script, avoids
reintroducing it.

**Plan-override semantics.** Converting the 4 regex-matched term families
into individual `plan_overrides` rows must reproduce today's exact
resolved category per term, including the subtlety I found and fixed
today — Activ Fit Preferred's DVT/PE/varicose-vein family defaults to
`vascular_fallback` in the general dictionary but is deliberately
overridden to `heart` *for this plan specifically*. The seed script needs
one row per term with the plan-specific category, not the general
dictionary default, or this exact bug returns.

**Test suite.** A meaningful number of existing regression tests
(`engine.baseline.test.ts` and others) call `classifyDeterministic`
relying on `TOP_PED_DICTIONARY` being populated at import time, since it's
currently a compiled object. Once it's populated from DB instead, tests
need either a seeded fixture Map passed in directly, or a real (test) DB
to seed against. Worth noting: `@electric-sql/pglite` (an embedded,
in-process Postgres) is already a devDependency in this project despite
not appearing to be used anywhere yet — that suggests the intended test
strategy for exactly this scenario may already have been anticipated.
I'd recommend using it for engine tests post-migration rather than
mocking the dictionary, so tests exercise the real DB-read path.

**AI-suggestion-never-overrides-approved (your decision #1, "AI
Collision").** Today, an AI Mapping Review suggestion can only reach
`ped_mapping_overrides` via an explicit human "Approve" click — there's no
existing path where an AI suggestion silently overwrites a human-approved
mapping. I'd still add an explicit guard in the approval endpoint: if the
PED already has `status = approved` with a *different* category than the
new AI suggestion, block the promotion and auto-log an `ai`-type
`collision_repository` entry instead of silently approving over it, so
this becomes a hard guarantee rather than an implicit one.

**Boot-time cost.** Loading ~1,200–1,800 alias rows plus categories and
plan overrides into memory at startup adds one DB round-trip to server
boot that doesn't exist today (data is compiled into the bundle). At this
data volume that's low-single-digit milliseconds, not a real concern, but
worth a note in case this ever runs somewhere with unusually strict
cold-start requirements.

**Cutover validation report (hard gate).** Before the runtime flag (§4)
is ever flipped from `legacy` to `db`, a script
(`scripts/validatePedMigration.ts`) runs both engines side by side and
produces a report, not a summary — one row per (PED, plan) pair actually
diffed:

1. Enumerate every `ped_repository` row × every plan in `plan_configs`
   (full cross product — for ~700 unique PEDs × 6 plans, ~4,200 pairs).
2. For each pair, call `classifyDeterministic` twice: once against the
   current legacy path (compiled `TOP_PED_DICTIONARY` +
   `ped_mapping_overrides` + hardcoded plan blocks, exactly as running in
   production today), once against the new DB-backed path (in-memory
   cache sourced entirely from the new tables).
3. Record every case where `matched_question` or `match_type` differs.
4. Output a report grouped by cause where possible (e.g. "12 differences
   are all explained by the 4 migrated plan-override rows now applying to
   synonym terms that weren't previously covered by the regex" vs. "3
   differences have no obvious explanation — investigate").

Every listed difference gets reviewed with you and marked either
*intentional* (the new behavior is correct, e.g. exactly the OSA-on-
Optima-Secure fix this whole thread started from) or *a bug to fix before
cutover*. The runtime flag does not flip until that list is empty of
unreviewed items. This is separate from and in addition to the existing
163-test regression suite, which keeps running throughout and must stay
green.

**Areas explicitly NOT affected:** the life-stage firewall, the 9
fast-path safety shields (A–I), the P0 exact-wording chunk matcher, the
~24 disease-family regex sections, `search_history`, `change_logs`,
`flagged_issues`, `announcements`, `users`, `external_resources`,
`smoke_test_peds`, and `page_visibility` — none of these are touched by
this migration.


6. Implementation Checkpoints
--------------------------------

Tracked as the actual task list for this build (not repeated here in
full) — the two points below are the hard stops where implementation
pauses for your review, matching the approved decisions above:

- **Checkpoint A**: after the seed script's `--dry-run` produces the
  conflicts report (§2, step 3). Nothing is written to the database and
  no further phase starts until every conflict has a filled-in
  `resolution`.
- **Checkpoint B**: after the cutover validation report (§6.4). The
  runtime flag stays on `legacy` and no compiled data is removed from
  `types.ts` until every listed difference is marked reviewed.

Everything else (schema DDL, repository layer, seed script itself,
in-memory cache/runtime plumbing behind the flag) is additive/inert until
one of those two checkpoints is passed, so it proceeds without needing a
pause.
