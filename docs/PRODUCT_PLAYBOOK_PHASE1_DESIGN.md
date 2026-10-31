# Product Playbook Mirror — Phase 1 Design (for review)

**Status:** Draft for review. No code, migrations or database changes have been made.
**Date:** 2026-10-29
**Builds on:** `docs/PRODUCT_PLAYBOOK_MIGRATION_ANALYSIS.md` (Option A approved 2026-10-29)

---

## 1. What Phase 1 delivers

An exact, read-only copy of the two Playbook tabs inside Ditto Assist, on **staging only**, with:

1. A **sync** that reads the live sheet through the Google Sheets API (read-only) and stores it as a numbered **snapshot**.
2. **Automatic checks** on every snapshot: a structure check, a cell-by-cell reconciliation and a difference report.
3. An **admin review screen** to inspect a snapshot, see what changed, then publish or reject it.
4. A **read API** that returns published cells by plan + feature. Phase 2's advisor screens will use it.

**Not in Phase 1:**
- no advisor-facing screens;
- no changes to Product Assist, `kb_playbook_plan_facts`, `kb_chunks`, or the existing Playbook sync;
- nothing on production.

Existing behaviour stays exactly as it is.

---

## 2. Ground rules (apply to every step)

| Rule | What it means in practice |
|---|---|
| Read-only | Only `spreadsheets.readonly` access. No code path can write to the sheet. |
| Exact | Text is stored exactly as received: no trimming, no case change, no line-break changes, no renumbering, no rounding. Numbers keep both the number and what the sheet displays. |
| Fail closed | If the sheet's layout doesn't match the approved structure, the snapshot is **rejected** and the last published snapshot stays live. The system never guesses. |
| Separate | New tables only. The existing Playbook tables and sync are untouched. |
| Pointed, not rewritten | The plan/feature layer only points at source cells. Advisors will always see the original text. |
| Folder rule | All files stay inside `D:\Ditto Assist WebApp`. |

---

## 3. Reading the sheet

**Login:** reuse the existing Playbook connection (`kb_playbook_connection`, "Connect Google Sheets"). A new function sits next to the existing ones in `playbookSheetsClient.ts`; the existing functions are not changed. **Viewer access is enough.**

**One request** per sync: `spreadsheets.get` for both tabs, asking only for the fields below.

```
ranges = 'Ditto''s Recommended Policies', 'Recommendation specifics'
fields =
  properties.title,
  sheets(
    properties(sheetId,title,index,hidden,
               gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)),
    merges,
    data(startRow,startColumn,
      rowMetadata(hiddenByUser,hiddenByFilter),
      columnMetadata(hiddenByUser,hiddenByFilter),
      rowData.values(
        userEnteredValue, effectiveValue, formattedValue,
        textFormatRuns, note, hyperlink, chipRuns,
        userEnteredFormat(backgroundColorStyle,textFormat,numberFormat,wrapStrategy),
        effectiveFormat(textFormat,numberFormat))))
```

| Need | API field | Status |
|---|---|---|
| Exact text | `userEnteredValue.stringValue` | standard |
| Numbers + display | `effectiveValue.numberValue` + `formattedValue` (e.g. 1 → "100%") | standard |
| Bold / colour / underline inside a cell | `textFormatRuns` (each run carries on until the next one) + cell `effectiveFormat.textFormat` | standard |
| Several links in one cell | `textFormatRuns[].format.link` | standard |
| Notes | `note` | already used by the current sync |
| Merges | `merges` | standard |
| Hidden rows/columns | `rowMetadata` / `columnMetadata.hiddenByUser` | standard |
| Floating picture over AD46 | **not available in the API** | handled by hand (§9) |
| Threaded comments | not in this API (Drive API, extra permission) | out of scope; the sheet uses notes |
| Google version history | not available to viewers | the app keeps its own snapshots instead |

**Step 1 of the build is a spike.** One real read on staging confirms every field above comes back as expected, before any table is built. Its result is a "field coverage report" for you to review.

---

## 4. Data model (draft SQL — not a migration yet)

The tables would become one hand-written migration, `drizzle/0090_playbook_mirror.sql`. It follows the project convention: `--> statement-breakpoint` between statements, run with `npm run db:migrate`, manually per environment. Matching definitions are added to `schema.ts`, with new repositories in `src/server/db/repositories/`.

```sql
CREATE TYPE playbook_snapshot_status AS ENUM
  ('fetched','rejected','verified','published','superseded');
CREATE TYPE playbook_value_kind AS ENUM
  ('empty','text','number','boolean','formula','error');
CREATE TYPE playbook_plan_status AS ENUM
  ('active','discontinued_fresh_porting','brochure_only','hidden');

-- One row per sync attempt.
CREATE TABLE playbook_snapshots (
  id                   serial PRIMARY KEY,
  domain               announcement_team NOT NULL DEFAULT 'Health',
  spreadsheet_id       text NOT NULL,
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  fetched_via          text NOT NULL,              -- connected Google email
  trigger              text NOT NULL,              -- 'manual:<email>' | 'auto' | 'cron'
  raw_response         bytea NOT NULL,             -- gzip of the API response, exactly as received
  raw_sha256           text NOT NULL,
  parser_version       text NOT NULL,
  status               playbook_snapshot_status NOT NULL DEFAULT 'fetched',
  structure_report     jsonb,                      -- §5
  reconciliation_report jsonb,                     -- §6
  diff_vs_published    jsonb,                      -- §7
  rejected_reason      text,
  published_by         text,
  published_at         timestamptz
);

-- One row per tab per snapshot.
CREATE TABLE playbook_snapshot_tabs (
  snapshot_id   integer NOT NULL REFERENCES playbook_snapshots(id) ON DELETE CASCADE,
  sheet_gid     bigint  NOT NULL,
  title         text    NOT NULL,                  -- exact, e.g. Ditto's Recommended Policies
  frozen_rows   integer, frozen_cols integer,
  hidden_rows   integer[] NOT NULL DEFAULT '{}',   -- 1-based sheet row numbers
  hidden_cols   integer[] NOT NULL DEFAULT '{}',   -- 1-based (A=1)
  PRIMARY KEY (snapshot_id, sheet_gid)
);

-- Every cell that has a value, note, link or formatting run.
CREATE TABLE playbook_cells (
  snapshot_id     integer NOT NULL,
  sheet_gid       bigint  NOT NULL,
  row_num         integer NOT NULL,                -- 1-based
  col_num         integer NOT NULL,                -- 1-based
  a1              text    NOT NULL,                -- e.g. 'U40'
  value_kind      playbook_value_kind NOT NULL,
  raw_text        text,                            -- exact; NULL only when truly empty
  number_value    numeric,
  formatted_value text,                            -- what the sheet displays
  formula         text,
  text_runs       jsonb,                           -- runs as received from Google
  resolved_runs   jsonb,                           -- [{start,end,text,bold,italic,underline,strike,color,link}]
  cell_format     jsonb,                           -- background, base text format, wrap, number format
  note            text,
  hyperlink       text,
  merge_range     text,                            -- set on the top-left cell of a merge, e.g. 'G34:G38'
  covered_by      text,                            -- set on cells inside someone else's merge, e.g. 'G34'
  PRIMARY KEY (snapshot_id, sheet_gid, row_num, col_num),
  FOREIGN KEY (snapshot_id, sheet_gid) REFERENCES playbook_snapshot_tabs ON DELETE CASCADE
);

-- Approved structure (edited only by admins; versioned through change_logs).
CREATE TABLE playbook_plans (
  plan_key             text PRIMARY KEY,           -- e.g. 'abhi_activ_yuva'
  insurer              text NOT NULL,
  display_name         text NOT NULL,
  expected_header      text NOT NULL UNIQUE,       -- exact row-1 text incl. status text/spaces
  status               playbook_plan_status NOT NULL,
  show_to_advisors     boolean NOT NULL DEFAULT false,
  kb_plan_name         text,                       -- link to kb_categories.plan_names (no new plan list)
  sort_order           integer NOT NULL DEFAULT 0
);

CREATE TABLE playbook_features (
  feature_key          text NOT NULL,              -- e.g. 'ambulance'
  sub_key              text NOT NULL DEFAULT '',   -- e.g. 'road'; '' = no sub-row
  expected_label       text NOT NULL,              -- exact column-B text (incl. 'Co- payment ')
  expected_sub_label   text,                       -- exact column-C text; NULL = blank
  sort_order           integer NOT NULL,
  PRIMARY KEY (feature_key, sub_key)
);

-- Which snapshot advisors see. Rollback = point this back.
CREATE TABLE playbook_published (
  domain       announcement_team PRIMARY KEY,
  snapshot_id  integer NOT NULL REFERENCES playbook_snapshots(id),
  updated_by   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Things the API cannot read (the AD46 picture), added by hand.
CREATE TABLE playbook_manual_assets (
  id           serial PRIMARY KEY,
  anchor_tab   text NOT NULL, anchor_a1 text NOT NULL,
  content_type text NOT NULL, bytes bytea NOT NULL, sha256 text NOT NULL,
  description  text NOT NULL, added_by text NOT NULL,
  approved_by  text, added_at timestamptz NOT NULL DEFAULT now()
);
```

**Size:** about 1,700 cell rows and roughly 1–2 MB of raw response per snapshot.

**Retention:** keep every published snapshot. Keep the last 30 rejected or superseded drafts. Retention clean-up is itself a decision for you (§12).

**Tab 2 (Recommendation specifics)** is stored cell by cell in the same tables. Phase 1 does not add the use-case → plan mapping. That needs the product team's approved mapping and belongs in Phase 2.

---

## 5. Structure check (fail closed)

Every snapshot is checked against the approved structure before anything else.

| Check | Pass rule | If it fails |
|---|---|---|
| Tab titles | Exactly "Ditto's Recommended Policies" and "Recommendation specifics" | Reject |
| Plan headers | Every `playbook_plans.expected_header` is found exactly once in row 1 | Reject; report missing or renamed headers |
| New plan column | Any row-1 header not in `playbook_plans` | Reject: "new plan column found". An admin adds it, then re-runs. |
| Feature labels | Every `playbook_features` label/sub-label pair is found, in the same order | Reject. If labels only **moved rows** but are otherwise identical: pass, flagged "layout moved" for review. |
| Hidden columns/rows | Same as the last published snapshot | Pass, but flagged **"needs review"** (never auto-published) |
| Merges in label columns B/C | Each feature's rows are still grouped the same way | Reject |

**Plan columns are found by their exact header text, never by column letter.** If the product team inserts a column, nothing breaks.

**First run:** there is no published snapshot yet. The admin screen shows the plan and feature lists *proposed from that snapshot* (draft below). A person accepts them, and that acceptance becomes the approved structure. No list is hard-coded from guesses.

### Proposed plan keys and statuses (status needs the product team / owner — decision D4)

| Col | Header (exact, live) | plan_key | Proposed status | Show to advisors |
|---|---|---|---|---|
| D | HDFC Ergo Optima Secure | hdfc_optima_secure | active | yes |
| E | HDFC Ergo Optima Super Secure | hdfc_optima_super_secure | active | yes |
| F | HDFC Ergo Optima Secure+ | hdfc_optima_secure_plus | active | yes |
| G | HDFC Ergo Optima Restore ⏎(Discontinued for Fresh & Porting applications) | hdfc_optima_restore | discontinued_fresh_porting | yes, with badge |
| H | HDFC Ergo Energy Silver | hdfc_energy_silver | active | yes |
| I | HDFC Ergo Arogya Sanjeevani | hdfc_arogya_sanjeevani | active | yes |
| J | Care Supreme | care_supreme | active | yes |
| K | Ultimate Care | care_ultimate_care | active | yes |
| L | Care Supreme Freedom | care_supreme_freedom | active | yes |
| M | Care Supreme Heart | care_supreme_heart | active | yes |
| N | Care Freedom | care_freedom | active | yes |
| O | ` Care Heart` (leading space) | care_heart | active | yes |
| P | Care Care ⏎(Discontinued…) | care_care | discontinued_fresh_porting | yes, with badge |
| Q | Care Advantage ⏎(Discontinued…) | care_advantage | discontinued_fresh_porting | yes, with badge |
| R | Care Supreme Shine ⏎(Brochure) | care_supreme_shine | brochure_only | **ask** |
| S | Care Senior Health Advantage (**hidden live, empty**) | care_senior_health_advantage | hidden | **no** |
| T | Aditya Birla Activ Fit Plus/Preferred | abhi_activ_fit_plus_preferred | active | yes |
| U | Aditya Birla Activ Yuva | abhi_activ_yuva | active | yes |
| V | Aditya Birla Activ One Max | abhi_activ_one_max | active | yes |
| W | Aditya Birla Activ One VYTL | abhi_activ_one_vytl | active | yes |
| X | Aditya Birla Activ One NXT | abhi_activ_one_nxt | active | yes |
| Y | Niva Bupa ReAssure 2.0 | niva_reassure_2_0 | active | yes |
| Z | Niva Bupa ReAssure 3.0 ⏎(Black Variant available with Ditto) | niva_reassure_3_0 | active | yes |
| AA | Niva Bupa Aspire | niva_aspire | active | yes |
| AB | Niva Bupa Health Premia | niva_health_premia | active | yes |
| AC | HDFC Ergo Medisure | hdfc_medisure | active | yes |
| AD | Care Supreme Enhance | care_supreme_enhance | active | yes |
| AE | Niva Bupa Recharge | niva_recharge | active | yes |
| AF | `Care Enhance ` (trailing space) | care_enhance | active | yes |

"Active" is my proposal. The sheet itself only says something for G, P, Q, R and Z.

### Proposed feature keys (labels exactly as live)

| feature_key | Column B label | Sub-rows (column C) → sub_key |
|---|---|---|
| entry_age_adults | Entry Age for Adults | Min→min, Max→max, Exit age→exit_age |
| entry_age_children | Entry Age for Children | Min→min, Max→max, Exit age→exit_age |
| ff_structure | FF Structure | — |
| variants | Variants | — |
| waiting_periods | Waiting periods | — |
| loadings | Loadings | — |
| co_payment | `Co- payment ` | Yes/No→yes_no, Limits if there are any→limits |
| disease_sublimits | Disease wise sub-limits | Yes/No→yes_no, Limits if there are any→limits |
| room_rent | Room rent restrictions | Yes/No→yes_no, Limits if there are any→limits |
| pre_post_hospitalisation | Pre and post hospitalization | — |
| domiciliary | Domiciliary | — |
| day_care | Day Care | — |
| ayush | AYUSH | — |
| modern_treatments | Modern treatments | — |
| restoration | Restoration | % of SI→pct_of_si, Exhaustion, Illness, Frequency |
| consumables | Consumables | — |
| bonus | Bonus | NCB→ncb, Loyalty→loyalty |
| annual_health_checkup | Annual health Check-up | `In- built / Add-on`→builtin_or_addon, `Can be used from `→usable_from, Cashless / Reimbursement→cashless_or_reimbursement, Limits |
| opd | OPD | same four as above + Coverage→coverage |
| maternity | Maternity | — |
| ambulance | Ambulance | Road, Air |
| organ_donor | Organ Donor | — |
| special_features | Special features | — |
| add_ons | Add-ons | — (rows 44–45; row 45 is the lower half of a merge) |
| cover | Cover | — |
| premiums | Premiums | Zonal Premium→zonal, Age bands→age_bands, Other details→other_details |
| fitness_wellness | Fitness & Wellness Benefits | Benefit Overview, Eligibility & Earning, Rewards & Calculation, Utilisation & Conditions |
| porting | Porting | — |
| migration | Migration | — |
| other_points | `Other Points⏎⏎Moratorium period is now reduced from 8 years to 5 years` | — (**the label itself holds content**: shown to advisors as a note on the feature) |

Column A (QA rating guide) is stored as cells, but is not part of any feature and is never shown to advisors (decision D6).

---

## 6. Reconciliation (proof nothing changed)

Every snapshot runs two independent paths over the same raw response:

1. **Main path:** raw response → `playbook_cells` rows (§4).
2. **Checker path:** separate, deliberately simple code. It walks the raw JSON again and compares every cell with the stored row.

Compared for every cell:
- value kind, exact text, number, displayed value;
- every formatting run (text, bold, italic, underline, strikethrough, colour, link);
- note and hyperlink;
- merge membership;
- hidden flags.

Totals must also match: non-empty cells, notes, merges, links, hidden rows and columns.

**Pass = 0 differences.** Any difference rejects the snapshot. The full report is stored in `reconciliation_report`.

**Mutation tests** (automated, in the test suite): the same 10 deliberate corruptions as the experiment must each be caught. These include one character changed in a 9,922-character cell, bold removed, a colour changed, "-" turned into blank, a trailing space trimmed, a note dropped, a merge dropped, and a cell deleted.

**One-off go-live cross-check:** compare the first published snapshot against a fresh `.xlsx` download that has never been opened in Excel, using the experiment's second reader. This also captures the AD46 picture.

---

## 7. Difference report (vs the published snapshot)

Stored with each snapshot and shown on the review screen, grouped as:
- plans added / removed / header text changed;
- feature labels changed or moved;
- cells: text changed, formatting-only changed, newly filled, emptied;
- notes added / changed / removed; links changed;
- merges changed; hidden rows/columns changed.

Each change shows the cell address, plan, feature, and before/after text exactly as written.

---

## 8. Publishing, rollback and triggers

```
fetched → (structure check) → (reconciliation) → verified → [person clicks Publish] → published
            ↘ rejected                ↘ rejected                                     ↘ previous one becomes superseded
```

- **Phase 1–3:** a person always publishes. Auto-publishing content-only changes can be switched on later (decision D2).
- **Rollback:** "Re-publish" any earlier published snapshot, which moves the `playbook_published` pointer. It takes effect instantly; nothing is deleted.
- **Audit:** every publish, reject, rollback and structure acceptance is written to `change_logs` (existing table).
- **Triggers:**
  - (a) a "Fetch now" button on the review screen;
  - (b) an automatic check every 6 hours, same pattern as `maybeRefreshPlaybookIfStale`;
  - (c) an optional Cloud Scheduler route protected by a secret, same pattern as `/api/announcements/sync-cron`.
- **Duplicates:** if the raw response's fingerprint matches the latest snapshot, no new snapshot is made. Only "last checked" is updated.
- **One sync at a time:** a database lock stops two syncs overlapping.

---

## 9. The picture over AD46

The API can't see it. Two options, both needing the owner (decision D5):
1. **Preferred:** the product team types the picture's table into the sheet as text (in AD46 or a note). It is then mirrored like everything else.
2. An admin uploads the picture into `playbook_manual_assets`, anchored to AD46. A second person approves it, and it is shown with "added by hand from the sheet's picture".

Until then, the review screen shows a permanent warning: "Cover for Care Supreme Enhance: the sheet has a picture here that is not mirrored."

---

## 10. Admin review screen (staging)

Lives under Knowledge Base Management, next to the existing Product Playbook connection card. It reuses `ConnectionRowCard` styling where it fits.

- **Snapshots list:** time, trigger, status, counts, number of changes, reason for rejection.
- **Snapshot view:** the difference report; a grid view of either tab with formatting, notes and merged cells as in the sheet; click a cell to see its address, exact text, runs, note and link.
- **Actions:** Publish, Reject (with reason), Re-publish (rollback), Fetch now.
- **Structure:** view plan and feature lists; accept a proposed change (with confirmation).
- **Access:** new feature ids `product_playbook_admin` (Viewer = look, Editor = publish and accept structure) and `product_playbook` (Phase 2 advisor view). Wired through the existing `hasAccess` / `requireFeatureAccess` (decision D3).

---

## 11. Read API (defined now, used by Phase 2)

```
GET /api/playbook/meta
  → { snapshotId, publishedAt, fetchedAt, stale: boolean, plans:[{planKey, displayName, status, header}],
      features:[{featureKey, subKey, label, subLabel}] }

GET /api/playbook/cells?plans=abhi_activ_yuva,care_supreme&features=ambulance,add_ons
  → for each plan × feature × sub-row:
    { planKey, featureKey, subKey, a1, readFrom (anchor if merged), valueKind,
      rawText, formattedValue, resolvedRuns, note, hyperlink, isEmpty }
```

- Maximum 4 plans per request.
- Only the **published** snapshot is read.
- Only plans with `show_to_advisors = true` are returned.
- Every response carries the snapshot time, so screens can show "Playbook as of …" and a staleness banner.

---

## 12. Build steps and checkpoints

| Step | Work | Size | Checkpoint for you |
|---|---|---|---|
| 1 | Spike: one real API read on staging; field coverage report; save the response in the scratch folder | S | Review the field coverage report |
| 2 | Migration `0090` + `schema.ts` + repositories; applied to **staging only** | S | Approve the SQL before it runs |
| 3 | Fetch → store raw → transform to cells | M | — |
| 4 | Structure check + first-run proposal of plan/feature lists | M | **Accept plan list, statuses and feature list** |
| 5 | Checker path, reconciliation, mutation tests, difference report | M | Review a reconciliation report |
| 6 | Admin review screen + read API + access ids | M | Try it on staging |
| 7 | Dry run: several syncs; one deliberate sheet-side change seen in the difference report; `.xlsx` cross-check; product spot checks | S | **"Migration passed" sign-off** |

**"Migration passed" (unchanged from the analysis):**
- 100% of non-empty cells, notes, merges, links and hidden flags accounted for, with 0 unexplained differences;
- the mutation tests pass;
- the structure is accepted;
- the AD46 picture is handled;
- the product team has signed off the spot checks.

**Tests:**
- unit tests for transform, merged cells, run styles, reconciliation and mutations;
- database tests using the existing test baseline.

Test fixtures: real sheet content should not be committed to git without your OK. By default I'd use a **small synthetic fixture** that copies the sheet's shapes (merges, runs, notes, "-" vs blank), plus the real response kept only in the scratch folder (decision D7).

**What stays untouched in Phase 1:**
- `playbookIngest.ts` and its parsing;
- `kb_playbook_plan_facts` and `kb_chunks`;
- Product Assist prompts and answers;
- the Term Playbook;
- production.

---

## 13. Decisions

> **Approved 2026-10-29** with clarifications. The binding wording is in `docs/PRODUCT_PLAYBOOK_STEP1_SPIKE_REPORT.md` §6. The table below shows the original suggestions. Step 1 findings that adjust this design are in that report's §4 (links stored inside text runs, lone CR characters, style inheritance, limited read range + full-tab scan, colour comparison rule).

| # | Decision | My suggestion |
|---|---|---|
| D1 | Which Google account the sync uses. It must keep view access long-term. | Keep the existing connected account. Check whose it is on the Connections page. |
| D2 | Who may publish; when auto-publish is allowed | You (or a named product lead) publish by hand through Phase 3 |
| D3 | Access ids and who gets them | `product_playbook_admin`: Admin and above; `product_playbook`: pilot group in Phase 2 |
| D4 | Plan statuses and "show to advisors" (table in §5), especially S, R and the discontinued plans | Product team / owner confirms |
| D5 | AD46 picture: retype into the sheet, or upload by hand | Retype into the sheet |
| D6 | Column A (QA rating guide): never shown to advisors? | Never shown; kept in snapshots only |
| D7 | May real sheet content be committed as test fixtures? | No; synthetic fixtures only |
| D8 | Snapshot retention | Keep all published; last 30 others |
| D9 | Staleness limit for the "may be out of date" banner (Phase 2) | 24 hours |

Once D1–D7 are answered I'll start with Step 1 (the spike), then stop at each checkpoint above.
