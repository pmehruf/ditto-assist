# Product Playbook Mirror — Step 1 Spike Report (field coverage)

**Status:** Step 1 done. Waiting for your review before Step 2.
**Date:** 2026-10-29
**Design:** `docs/PRODUCT_PLAYBOOK_PHASE1_DESIGN.md`

## What was done (and not done)

- **Done:**
  - Read-only checks against the **staging** database. Every query ran inside a read-only transaction (`BEGIN READ ONLY`), and the script refuses to run if pointed at the production host.
  - A handful of **read-only** Google Sheets API calls (`spreadsheets.get`, GET only), using the existing stored Playbook connection.
  - The raw response (14 MB, real Playbook content) is saved **only** in the scratch folder (`_scratch_playbook_migration/output/spike_response.json`, not committed).
- **Not done:** no app code written or changed, no migration created or applied, no database writes, no changes to the current sync or mappings, nothing on production.
- Scripts: `_scratch_playbook_migration/scripts/spike_step1.ts`, `spike_probe.ts`, `spike_coverage.cjs`, `spike_diffdetail.cjs`, `spike_colours.cjs`, `spike_migrations.ts`.

---

## 1. Headline

**The Google Sheets API gives us everything the design needs, except the AD46 picture (as expected).** Every cell, note, merged cell, hidden flag, formatting run and link came back. Compared with the Excel copy, the counts match exactly, and **G29 is the only real content difference** (the Excel was edited by accident; the live sheet is correct).

The spike also found three design adjustments and three risks (§4, §5). One is important: **the stored Google login has spreadsheet *write* permission, not just read**. This was already the case before this work.

---

## 2. D1 — the connected Google account

| Check | Result |
|---|---|
| Identity | Stored connection on staging: **mehruf.p@joinditto.in**, connected by mehruf.p@joinditto.in on 2026-09-17. Google's own token check returns the same email. |
| Continued view access | ✅ The API read succeeded today (2026-10-29) in 2.6 s. |
| Permissions actually granted | ⚠️ `spreadsheets.readonly` **plus `spreadsheets` (full read/write on all your spreadsheets)** and `script.processes`, along with openid/email/profile. Cause [CODE]: every "Connect Google Sheets" flow in `src/server/auth/googleOAuth.ts` uses `include_granted_scopes: true`. That makes Google merge in permissions the same person granted elsewhere in the app; the Product Assist log export asks for write access, and the QA dashboard asks for `script.processes`. The Playbook flow itself only asks for read-only. |
| Existing sync-failure handling [CODE + staging data] | On error, the Playbook resource is set to `status = error` with a message shown on the Connections card. Automatic refresh runs only when someone uses Product Assist and data is older than 6 hours. A failed refresh is only written to the server log. **No staleness warning exists.** On staging, the last Playbook fetch was **2026-09-23 (36 days ago)**, yet its status says `active`. Production was not checked (out of scope). |
| Staging copy is out of date | Staging's `kb_playbook_plan_facts` has **26 plans**; the live sheet shows **28 visible**. Missing: **Care Supreme Freedom** and **Care Supreme Heart**. One stored name is outdated: "Activ Yuva (Not live yet with Ditto)" vs live "Aditya Birla Activ Yuva". This only affects staging's existing Product Assist data. The new mirror doesn't use it. |

**Recommendation for D1:** keep this account, but **reconnect it with a read-only-only grant** before Step 3. That needs a small change to the Playbook connect flow (`include_granted_scopes: false` for this flow only), which is a change to existing code. **It needs your separate approval** and isn't part of Step 2. Until then the mirror's code will only ever send read requests, but the token itself could write.

---

## 3. Field coverage — design need vs what the API returned

| Design need | API field | Result (tab 1 / tab 2) |
|---|---|---|
| Tab titles, IDs | `sheets.properties` | ✅ "Ditto's Recommended Policies" (id 0) / "Recommendation specifics" (id 213972291) |
| Frozen rows/cols | `gridProperties` | ✅ 1 row + 3 cols / 2 rows + 3 cols |
| Hidden columns | `columnMetadata.hiddenByUser` | ✅ **A and S** / none |
| Hidden rows | `rowMetadata.hiddenByUser` | ✅ none / **13–18, 29–30**. No rows hidden by filters. |
| **Hidden content readable** | (same read) | ✅ Column A (22 cells), column S (1 cell) and tab 2's hidden rows all came back, and all match the Excel. |
| Merges | `merges` | ✅ 46 / 147, **identical** to the Excel |
| Cell values | `userEnteredValue` | ✅ 1,524 (1,422 text, 102 numbers) / 174 (159 text, 15 numbers): same as the Excel |
| Displayed value | `formattedValue` | ✅ e.g. D23 stored `1`, shown `"100%"` (17 such cells) |
| Rich text (bold, colour, etc.) | `textFormatRuns` | ✅ 206 cells, 3,059 runs / 11 cells, 30 runs: same as the Excel |
| Notes | `note` | ✅ 139 / 7, **every note identical** to the Excel (after line-break normalisation) |
| Links | `textFormatRuns[].format.link` | ✅ 17 / **4**. **Links come inside the text, not on the whole cell** (`hyperlink` is empty everywhere). Tab 2 **D24 has 3 different links** (three Apps Script tools); the Excel kept only one. |
| Smart chips | `chipRuns` | none in either tab |
| Formulas | `userEnteredValue.formulaValue` | none in either tab |
| Floating picture (AD46) | — | ❌ **not in the API**, as expected. AD46 has no data. Handled by D5. |
| Version history | — | ❌ not available to viewers, as expected |

### Cell-by-cell comparison with the Excel (main tab, all 1,524 cells)

| Result | Cells |
|---|---|
| Text identical | 1,198 |
| Identical except line-break encoding (Excel CR+LF vs live LF) | 311 |
| Identical except **lone CR characters in the live sheet** that Excel converted (R13, AD29, R30, R33, L41, M42, Z47 + 7 more) | 14 |
| **Real content difference** | **1: G29**. Live `"50% to 100%"`; Excel has stray cell references typed after it. |
| Tab 2 (174 cells, including hidden rows) | all identical |
| Bold | 1 difference: **A30** (hidden QA column). Google says "1." inherits bold from the cell; the Excel export wrote it as not bold. Minor and not advisor-facing. The mirror stores Google's version. |
| Colours | 0 real differences. All differences were "theme colour 1" or "no colour" in the Excel vs explicit black (`#000000`) from Google: the same colour written two ways. |

**Conclusion:** the API is a complete, exact source for everything except the AD46 picture.

---

## 4. Design adjustments found by the spike (for the Step 2 checkpoint)

1. **Links live inside text runs.** `playbook_cells.hyperlink` is always empty for this sheet, so links must be stored per run (already in `resolved_runs.link`). The reconciliation must count run links: 17 + 4.
2. **Line breaks:** the sheet mixes LF and lone CR. Store exactly as received. Display treats CR, LF and CR+LF as one line break, at display time only.
3. **Style inheritance:** a run with no format **inherits the cell's format** (seen in H9 and A30). `resolved_runs` must apply that rule. The checker path must apply it independently.
4. **Response size: 14 MB** for whole tabs, because about 51,000 empty cells carry formatting (43,928 on tab 1, 7,120 on tab 2). Proposal:
   - read the formatted grid only for the used area plus a margin (tab 1 `A1:AR80`, tab 2 `A1:M60`);
   - also do a cheap values-and-notes-only scan of the whole tab (about 0.3 MB) to prove nothing exists outside that area. **If anything does, the snapshot is rejected**, keeping the fail-closed rule.
5. **Comparison rule for colours:** "theme colour 1", "no colour" and `#000000` are treated as the same colour **only when comparing**. The raw value is stored unchanged.
6. **The field list must be fully nested** (`rowData(values(...))`). A comma slip in my first attempt produced "invalid argument". The final working field list is in `spike_step1.ts`.

---

## 5. Collision and regression risks (report before proceeding)

| # | Risk | Severity | Finding / mitigation |
|---|---|---|---|
| R1 | **Stored Playbook token can write to spreadsheets** | **High (security)** | Already the case (§2). The mirror sends GET requests only, and the code has no write path. Proper fix: read-only-only reconnect (needs your approval; changes existing connect code). |
| R2 | Migration runner skips migrations it thinks are "old" | Medium | [CODE] `src/server/db/migrate.ts` applies a migration only if its journal `when` is **greater than the newest applied `created_at`**. Staging's newest is `1792300000000` (= 0089). 0090 must use a larger `when` (e.g. `1792400000000`). If another branch later adds a migration with a smaller `when`, it is **silently skipped**. Check at Step 2. |
| R3 | Staging's migration history doesn't line up with this branch | Low–medium | Staging has **90** applied migration rows; this branch's journal has **65** (files jump from 0056 to 0082, and 0057–0081 never existed in git). Fingerprints can't be compared reliably on this Windows checkout (`core.autocrlf=true`). It doesn't block 0090, but someone should explain the 25 extra rows before Step 2. |
| R4 | Name clashes | None found | No `playbook*` tables or types on staging; no `/api/playbook` routes; no `product_playbook*` permission ids; no other branch has a migration numbered 0090+. |
| R5 | Effect on Product Assist | None (by design) | The mirror uses new tables and routes only. It does not read or write `kb_playbook_plan_facts` or `kb_chunks`, and does not call `syncPlaybook`. |
| R6 | Google API quota | Low | One read every 6 hours plus manual fetches is far below the limits. The extra reads share the same Google account as the existing sync. |
| R7 | Existing sync is stale with no warning (staging) | Medium (existing issue) | Not caused by this work. The mirror will show staleness and failures straight away (D9). Fixing the *existing* sync's warning is a separate change. |
| R8 | Real Playbook content on disk | Low | The 14 MB response is kept in the scratch folder only (not committed, D7). Delete it when Phase 1 is done, or keep it for the go-live cross-check (your call). |

---

## 6. Decisions recorded (D1–D9, approved 2026-10-29 with your clarifications)

| # | Approved as |
|---|---|
| D1 | Reuse the existing account after confirming identity, continued access and failure handling. Confirmed: mehruf.p@joinditto.in, access works. Failure handling has gaps (§2). Read-only reconnect recommended (R1). |
| D2 | Manual publishing through Phase 3. No auto-publish during the initial rollout. |
| D3 | Proposed access model, enforced **server-side**; pilot group explicitly controlled. |
| D4 | All plan statuses and visibility are **provisional** until the product team confirms. Recommendation eligibility is **never** inferred from header text or sheet visibility. |
| D5 | Retype the AD46 information into the sheet. The warning stays until this is resolved **and verified**. |
| D6 | Column A kept in snapshots, **excluded from every advisor-facing API response and screen**. |
| D7 | Synthetic test fixtures only. No real Playbook content committed without explicit approval. |
| D8 | Keep all published snapshots plus the latest 30 non-published. **Never delete** a snapshot referenced by the published pointer or needed for rollback. |
| D9 | Staleness limit 24 h. **Immediate warning** when a sync fails or the latest snapshot is rejected. |

---

## 7. What I need from you for the next checkpoint

1. **Approve Step 2** (migration `0090` + `schema.ts` + repositories, applied to **staging only**), including the adjustments in §4.
2. **Decide on R1:** approve a separate small change to make the Playbook connection read-only-only, then you reconnect. Or accept the risk for now.
3. **R3:** do you know where staging's 25 extra migration rows came from? If not, I'll investigate read-only as the first part of Step 2.
