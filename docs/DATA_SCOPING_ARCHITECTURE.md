# Data Scoping Architecture (Proposed, Not Implemented)

**Status:** Design proposal only. No enforcement code exists yet. This document
exists so the schema and access-control code added in migration `0038`
(`org_teams`, `roles`, `relationship_types`, `user_relationships`,
`custom_access_grants`, plus `users.org_team_id`/`users.role_id`) doesn't
accidentally foreclose the model described here. Concrete scoping rules will
be written when real feature requirements exist — this is the shape those
rules will fit into, not the rules themselves.

## 1. The requirement

Today, access control in this app answers one question: **"Can this user use
feature X at all?"** — a boolean, resolved by `hasAccess(featureId,
actionType)` in `App.tsx` from tier + feature overrides + custom grants (see
`ACCESS_CONTROL_CENTER` work, migrations `0037`/`0038`).

The requirement described for the next phase is a second, different
question: **"Given a user CAN use feature X, which records (which other
advisors) are they allowed to see or act on?"** — a per-record filter, not a
per-feature gate.

Critically, this filter must be **composable and feature-specific**:

- Feature A might scope by Team alone.
- Feature B might scope by Team + Role.
- Feature C might scope by Team + Role + Department + Relationship, as in
  the concrete example given: a Falcon-team Mentor in the "Mentor
  Excellence" department should see only the Advisors formally assigned to
  them via a Mentor relationship.

Nothing may hard-code "always check Team + Role + Relationship" as a
universal rule — the set of dimensions a given feature cares about is itself
data, decided per feature, not fixed in code.

## 2. What already exists (and already supports this)

No schema changes are being made right now. What's already in place from
migration `0038` happens to map cleanly onto the four dimensions named:

| Dimension | Where it lives | Cardinality |
|---|---|---|
| Team | `users.org_team_id` → `org_teams` | one team per user |
| Department | `users.department_id` → `departments` | one department per user |
| Role | `users.role_id` → `roles` | one role per user |
| Relationship | `user_relationships` (`owner_email`, `subject_email`, `relationship_type_id`) | many-to-many, typed, directional |

The relationship table is already the generic shape this needs — `(owner,
subject, type)` rather than a single "reports to" column — so "Mentor →
assigned Advisors" from the example requires no new table, just a
`relationship_types` row named "Mentor" and rows in `user_relationships`
mapping each mentor to their advisors. That part of the foundation is
already correct for the target model.

What does **not** exist yet, and is the actual subject of this document, is
**a place to declare, per feature, which of these dimensions matter and
how they combine.**

## 3. Proposed model: `data_scope_rules`

### 3.1 Two different kinds of condition

The worked example — *"Team = Falcon, Role = Mentor, Department = Mentor
Excellence, Relationship = Mentor → assigned Advisors"* — actually mixes two
structurally different kinds of condition, and the design needs to keep them
distinct:

1. **Caller eligibility** — properties the *caller* (the person using the
   feature) must have for this scope rule to apply to them at all. These are
   checks against **specific, named values**: "the caller's role must be
   exactly Mentor," "the caller's department must be exactly Mentor
   Excellence." A caller who doesn't match isn't scoped by this rule (they
   either fall through to a different rule, or to "no access" / "full
   access," depending on the feature's default).

2. **Target selection** — how to find the set of *other users* ("targets")
   that an eligible caller is allowed to see. This is normally **relative**,
   not a fixed value: "targets whose team equals the caller's own team,"
   not "targets whose team equals Falcon" hard-coded into the rule (that
   would break the moment Falcon is renamed or a rule needs to apply to
   every team symmetrically). Relationship-based selection ("targets reachable
   from the caller via an active Mentor-type relationship edge") is the other
   target-selection primitive.

Collapsing these two into one flat "check these fields match" rule is the
trap to avoid — it can't express "caller must specifically be a Mentor in
Mentor Excellence" (a fixed check) *and* "but which team's advisors they see
depends on the caller's own team" (a relative check) at the same time.

### 3.2 Shape

A `data_scope_rules` table, one row per **named scope policy** for a given
feature/resource:

```
data_scope_rules
  id                    serial primary key
  resource_key          text        -- see §3.3, NOT the same as featureId
  name                  text        -- human label, e.g. "Falcon Mentor -> Assigned Advisors"
  active                boolean

  -- Caller eligibility (all non-null columns must match exactly; null = "don't care")
  caller_org_team_id    integer references org_teams(id)
  caller_department_id  integer references departments(id)
  caller_role_id        integer references roles(id)

  -- Target selection: relative matching against the caller's own values
  match_team            boolean default false   -- target.org_team_id = caller.org_team_id
  match_department      boolean default false   -- target.department_id = caller.department_id
  match_role_id         integer references roles(id)  -- target.role_id = this specific role (e.g. "only show Advisors")

  -- Target selection: via relationship
  relationship_type_id  integer references relationship_types(id)
  relationship_direction text  -- 'caller_is_owner' | 'caller_is_subject'

  created_by, created_at, ...
```

Reading the worked example back through this shape:

```
resource_key:            "advisor_directory"        -- whatever feature/resource this scopes
caller_org_team_id:      <Falcon's id>
caller_department_id:    <Mentor Excellence's id>
caller_role_id:           <Mentor's id>
match_team:               true                        -- and only within the caller's own team
relationship_type_id:     <Mentor's relationship-type id>
relationship_direction:   'caller_is_owner'
```

A feature that only needs Team-based scoping sets *only*
`match_team = true` and leaves every other column null/false — no caller
eligibility restriction, no relationship requirement. A feature needing
Team + Role sets `match_team = true` and `match_role_id = <Advisor>`. This
is what makes it composable per feature rather than a fixed 4-dimension
check: **every dimension is independently optional, on both the caller side
and the target side.**

### 3.3 `resource_key`, not `featureId`

Scope rules are proposed to key off a new, independent `resource_key`
string — **not** the existing `featureId` used by `feature_access_overrides`
/ `DEFAULT_FEATURE_PERMISSIONS`. A single page can expose more than one
scoped resource (e.g. the Directory page might separately scope "which
advisor rows are visible" and "which change-log entries are visible"), and a
single resource can be read from more than one page. Keying scoping to the
page/feature id would silently break the first time those two things
diverge. `resource_key` is a small free-text catalog (like `grant_type` on
`custom_access_grants` already is) — cheap to extend, no migration needed to
add a new scoped resource later.

### 3.4 Multiple rules per resource = OR

A resource can have more than one active `data_scope_rules` row. A caller is
"in scope" for that resource if **any** active rule's caller-eligibility
conditions match them; the visible target set is the **union** of what each
matching rule selects. This gives OR-composition (e.g. "Falcon Mentors see
their assigned advisors, OR any Central-team Admin sees everyone in their
own department") without needing a boolean-expression language — it's the
same "list of independently-active rows, any match wins" pattern this app
already uses for `custom_access_grants` and `feature_access_overrides`, so
it stays consistent with the rest of the admin surface.

### 3.5 Escape hatch, not a redesign

Because the dimension set (team/department/role/relationship) is fixed as
real columns rather than a JSON condition tree, a genuinely novel condition
this shape can't express (e.g. "tenure > 6 months") would need a new column
— a normal, additive migration, not a redesign. If that ever feels too
restrictive, the cheap mitigation decided now rather than later is a single
nullable `extra_conditions jsonb` column on the same table, interpreted only
when present, so the common case stays simple, structured, and easy to build
an admin UI for (dropdowns/checkboxes, matching the existing Teams/Roles/
Departments tabs), while an unbounded escape valve exists without forcing a
storage-format migration.

## 4. Where enforcement will hook in (when built)

Feature gating (`hasAccess()`) and data scoping stay architecturally
separate, on purpose:

- `hasAccess(featureId, actionType)` — unchanged — answers "can this tier/
  user use this feature at all." Boolean, evaluated client-side for UI and
  re-checked server-side per route, exactly as today.
- Data scoping — future work — is a **row filter inside a specific list/
  query endpoint** (e.g. `GET /api/users`, or a future advisor-list endpoint
  for Mentors), resolved by: look up active `data_scope_rules` rows for that
  endpoint's `resource_key` → find rows where the caller matches the
  eligibility columns → union the target sets those matching rules select →
  apply as a SQL `WHERE`/join, not as a client-side post-filter.

A user who fails every rule for a scoped resource, on a feature that
requires scoping, sees an empty/restricted list — not a 403. Whether a given
resource is scoped at all, and what happens when no rule matches, is itself
decided per-resource (a resource with zero active rules is presumably
unscoped/full-visibility, same as today) — this stays a deliberate choice
made when each resource is actually wired up, not implied by the schema.

## 5. Relationship to Custom Access Grants

`custom_access_grants` (already built) is the **per-individual** override —
it exists to fix one person's access when the population-level scope rule
above doesn't fit them. These stay two separate layers:

- **Scope rules** define the default population-level filter for a
  resource.
- **Custom grants** already have a generic `(userEmail, grantType,
  targetId, level)` shape. A future `grantType` value (e.g.
  `"data_scope_bypass"`, `targetId = resource_key`) would let an individual
  bypass a scope rule entirely for one resource — no schema change, just a
  new convention value, exactly how `"feature_access"` was added as the
  first functional `grantType` in this migration.

## 6. Decisions that would be expensive to change later

Ranked by how expensive, most to least:

1. **Structured columns vs. JSON condition tree for `data_scope_rules`.**
   This is the highest-leverage call in this whole design. Once real
   enforcement code and an admin UI are built against one shape, migrating
   to the other means a full data migration *and* a rules-engine rewrite —
   not additive. §3.5 proposes structured columns now with a nullable JSON
   escape hatch specifically to avoid being forced into this choice
   prematurely; that decision (columns-first, JSON-as-overflow) should be
   treated as close to final once any enforcement code ships.

2. **Keying scope rules to a new `resource_key` rather than reusing
   `featureId`.** Reusing `featureId` would be a few hours less work today,
   but retrofitting `resource_key` in later — once rules, an admin UI, and
   endpoint call sites all assume "resource == feature" — means re-keying
   every existing rule row and updating every call site's lookup. Cheap to
   decide correctly now (§3.3); moderately expensive to fix later.

3. **"Any matching rule wins" (OR-of-rules) as the base assumption**, even
   though today at most one rule will typically exist per resource.
   Assuming "at most one rule per resource" now and later needing OR
   semantics means migrating every call site from "fetch the one rule" to
   "fetch and union multiple rules" — a real but mechanical rewrite. Baking
   in "N rules, OR'd" from day one (§3.4) costs nothing extra now.

4. **Single-valued Team/Role per user** (`users.org_team_id` /
   `users.role_id` as scalar FKs, not many-to-many). This matches the
   stated model (Bliss/Falcon/Central — one team per advisor) and is *not*
   a blocker for the scoping design above. It would only become expensive
   if a real future need for "one person, multiple teams/roles
   simultaneously" emerges — that requires a junction-table migration
   (`user_org_teams`, `user_roles`) plus rewriting every read of
   `orgTeamId`/`roleId` as a scalar (Directory UI, `EffectiveAccessModal`,
   the future scope engine). Not proposed to change now — flagged only so
   it's a known, deliberate constraint rather than an accidental one.

5. **Relative vs. absolute target matching being column-encoded**
   (`match_team: boolean` meaning "relative to caller" rather than a
   `target_org_team_id` meaning "this specific team"). This is
   comparatively cheap to change later — it's an additive column
   (`target_org_team_id`) if a rule ever needs "show me Falcon's advisors"
   regardless of the caller's own team — but is called out because it's the
   detail most likely to be gotten wrong by copying the caller-eligibility
   pattern (fixed values) onto target-matching (which is usually relative).

## 7. What this document deliberately does not do

- No enforcement code, no new tables, no new endpoints. Nothing in this
  session's schema or API changes as a result of this document.
- No concrete scope rules are proposed for any real feature — those get
  designed against actual requirements when they exist, per the earlier
  agreement to come back with specific cases.
- Does not decide UI/UX for a future "Scope Rules" admin tab — only the
  underlying storage shape, so that whenever that tab gets built it isn't
  fighting the data model.
