# Access Control Center — Phase Plan (Resource + Capability Rules)

**Status:** Phases 1–5 complete and verified (tsc/build/test clean at each
step). Phase 6 (row-level data scoping) is intentionally deferred/out of
scope — see its section below; it stays unimplemented until explicitly
requested. Originally written after inspecting the existing codebase against
the original 38-section implementation brief (see chat history) — corrects
that brief's factual assumptions and scopes the work into verifiable phases.

## 0. Scope correction (read first)

The original brief assumed Product Assist eligibility is hardcoded as
`Bliss + Advisory + Advisor + Health`. It isn't. The real rule
(`resolveQuotaBucket()` in `productAssistQuota.ts`) reads a single
**Admin-configurable** Department + Team + Role combo (`product_assist_quota_settings.eligibleDepartmentId/eligibleOrgTeamId/eligibleRoleId`),
checked alongside the "Health" tag separately. That configured value is not
touched by this plan — Phase 3 only adds a second, independent way (Access
Rules) to grant *feature-level* Viewer/Editor access; it does not replace or
duplicate Product Assist's own eligibility bucket logic, per the brief's own
§16 instruction to keep business eligibility and ACC permissions conceptually
separate.

This plan also deliberately does **not** cover row-level data scoping ("which
other advisors' records can a Mentor see") — that's a different, already
-designed proposal in `docs/DATA_SCOPING_ARCHITECTURE.md` (`data_scope_rules`,
unimplemented). That doc's own §4 argues feature gating and data scoping
should stay architecturally separate; this plan follows that precedent. If
row-level scoping is also wanted, it's Phase 6 below and needs an explicit
go-ahead — it is not assumed.

## 1. What already exists (reused, not rebuilt)

- `org_teams` (Bliss/Falcon/Central), `departments`, `roles`,
  `relationship_types`/`user_relationships` — real tables, CRUD repos,
  currently inert w.r.t. access (migration `0038`, by design).
- `feature_access_overrides` — Developer-editable per-tier override of
  `DEFAULT_FEATURE_PERMISSIONS`. Stays the source of a resource's *default*
  access; Access Rules (Phase 1) sit alongside it, not instead of it.
- `custom_access_grants` — per-individual add-only override, only
  `grantType: "feature_access"` functional today.
- `EffectiveAccessModal.tsx` — a display-only, separately-maintained
  re-derivation of `App.tsx`'s `hasAccess()`. Phase 3 retires the duplication
  by pointing both at one evaluator.
- `qa_dashboard_roles` (Admin/Guide/Mentor) — QA Dashboard's own role system,
  intentionally decoupled from the app's General/Admin/Platform
  Admin/Developer tiers. Not merged into Access Rules; Phase 3 only makes
  sure nothing accidentally conflates the two.

## 2. Phases

### Phase 1 — Core Access Rule engine (schema + evaluator, inert) ✅ Complete

- New `access_rules` table: `id, resource_key (reuses existing featureId
  values), capability ("view"/"edit", i.e. Viewer/Editor bundles — matching
  today's model), org_team_id, department_id, role_id, product_tag
  (nullable, "don't care" per condition), granted_level, active, created_by/
  at`. Structured columns, not a JSON condition tree — same decision
  DATA_SCOPING_ARCHITECTURE.md made for the same reason (§3.5/§6 there).
- One reusable `evaluateAccess(user, resourceKey, capability)` function.
  Conditions within one rule = AND. Multiple active rules for the same
  resource = OR. Effective level = max across every matching rule, the tier
  default, any override, and any custom grant — additive only, no deny
  precedence (matches the existing `custom_access_grants` model; no deny
  system exists today to preserve).
- Ships with zero rules created — must reproduce today's `hasAccess()`
  output exactly before anything is wired to it. Security Tier is never a
  rule *output* — a rule can only grant Viewer/Editor within what a tier's
  ceiling already allows, never elevate tier itself.
- Verification: unit tests comparing evaluator output to current
  `hasAccess()` across every existing feature/tier combination.

### Phase 2 — Access Rules tab in the Access Control Center ✅ Complete

- New tab beside the existing Teams/Departments/Roles/Permissions/Custom
  Grants tabs. CRUD for rules using the existing Team/Department/Role/tag
  catalogs — no new dropdown data source.
- Rules are just data at this point; nothing reads them yet. Verification:
  create/edit/disable/delete a rule in the UI, confirm it persists and has
  no runtime effect.

### Phase 3 — Wire the evaluator into real enforcement ✅ Complete

- Replace `App.tsx`'s `hasAccess()` body and the server-side
  `requireFeatureAccess()` route guard with calls to `evaluateAccess()`.
  Ship this behind the Phase 1 regression tests passing with zero rules
  active, so existing behavior is provably unchanged before any rule is
  turned on.
- Retire `EffectiveAccessModal.tsx`'s separate `resolveEffectiveAccess()` —
  point it at the same evaluator so "why does this user have access" (brief
  §24) is one real implementation, not two.
- Verification: full click-through of Admin/Developer/Platform Admin/General
  flows in both dark/light mode; confirm no page's visible access changed
  with zero rules active.

### Phase 4 — Delete + dependency safety for Teams/Departments/Roles ✅ Complete

- Add real delete endpoints (today only create/update/enable-disable exist).
- Before deleting, count references in: `users`, `access_rules`,
  `custom_access_grants`, `product_assist_quota_settings`'s
  `eligibleDepartmentId/eligibleOrgTeamId/eligibleRoleId`, and
  `user_relationships`. Existing FKs already use `onDelete: "set null"`, so a
  delete can't corrupt a row — but it can silently disable a live Access Rule
  or the Product Assist eligibility setting, which is a functional break
  even though it's not a DB error. Surface the reference count in the UI and
  require confirmation; block outright when an active `access_rules` row or
  the quota-eligibility settings row references it, suggesting Disable
  instead.

### Phase 5 — Audit log for Access Control Center changes ✅ Complete

- New `access_control_audit_log` table (actor, entity type/id, before/after,
  timestamp), written by every mutating endpoint across Teams/Departments/
  Roles/Product Tags/Access Rules/Custom Grants/the quota-eligibility
  settings row.
- New read-only "Change History" view in the Access Control Center
  (Admin/Platform Admin/Developer only).

**As implemented (deviates from the plan above):** no new table was built.
Investigation found every Access Control Center route already wrote to the
existing app-wide `change_logs` table (the same one behind the Activity
Log's "Modification History" sub-tab), so a second, parallel audit table
would have duplicated existing infrastructure for no real gain. Instead:
`change_logs` gained an `actionTypePrefixes` OR-of-prefix filter
(`changeLogRepository.ts`), `GET /api/change-logs?scope=access-control` was
added to scope results to Access Control Center activity, and a new
**Change History** sub-tab was added to the Access Control Center reading
that scoped endpoint — same outcome (a durable, readable audit trail with
its own dedicated view), reusing existing infrastructure instead of
duplicating it.

**Follow-up — User Directory audit logging:** closed a related gap found
during Phase 5: User Directory mutations (`/api/users*`) previously only
recorded an ephemeral, client-side-only log entry, not a durable one.
Every User Directory route now writes a durable `change_logs` entry — using
the same existing audit infrastructure above, not a new one — whenever an
access-control-relevant attribute (tier, status, tags, department, team, or
role) actually changes; edits touching only name/TACT ID don't log, since
those aren't access-relevant. See `describeUserAccessChanges.ts`.

### Phase 6 — Row-level data scoping ⛔ Deferred / out of scope

Intentionally deferred — not started, not scheduled. Kept here only so the
plan stays discoverable if the requirement arises later; nothing in Phases
1–5 depends on it, and nothing about it is assumed.

- Only if explicitly requested. Implements the already-designed
  `data_scope_rules` table from `DATA_SCOPING_ARCHITECTURE.md` (row
  filtering — "which advisors can a Mentor see" — not capability granting).
  Kept as its own migration/evaluator, per that doc's own reasoning for
  staying separate from feature gating.

## 3. Sequencing rule

Each phase ships with zero behavior change until its own verification step
passes, then the next phase begins. No phase depends on guessing ahead —
Phase 3 only flips real enforcement over once Phase 1's evaluator is proven
identical to current behavior with no rules active.
