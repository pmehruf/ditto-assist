# Product Playbook → Ditto Assist: Analysis and Recommendation

**Status:** **Option A approved on 2026-10-29.** The next step is the Phase 1 design in `docs/PRODUCT_PLAYBOOK_PHASE1_DESIGN.md` (for review). No app code, database, schema or migrations have been changed.
**Date:** 2026-10-29
**Scope:** Only the tabs "Dittos Recommended Policies" (main tab) and "Recommendation specifics". All other tabs ignored.
**Scratch work:** `_scratch_playbook_migration/` (inside this project; not committed). Scripts in `scripts/`, results in `output/`.

### How to read the source labels in this report

| Label | Meaning |
|---|---|
| **[EXCEL]** | Checked in the attached Excel file only (a working copy, never the original). |
| **[LIVE]** | Checked in the live Google Sheet on 2026-10-29, strictly read-only, through your signed-in Chrome (Claude in Chrome). I used Google's read-only web view (`/htmlview`) plus the normal sheet in "View only" mode (hovering only). See §2.3 and §2.4. |
| **[CODE]** | Found in this project's code or git history. |
| **[ASSUMPTION]** | My judgement. Needs confirming. |
| **[OPEN]** | An open question for you or the sheet owner. |

---

## 1. Summary

**Recommendation (lead):** Keep the Google Sheet as the place where the product team edits. Make the app a **read-only, exact mirror** that advisors use instead of the sheet. The app copies the whole sheet cell by cell, including formatting, notes, merged cells and hidden flags, into versioned "snapshots" in PostgreSQL. A snapshot is only shown to advisors after it passes a cell-by-cell check against the source. On top of the exact copy sits a structured layer: plan × feature × sub-feature, used for the single-plan view and the compare-up-to-four view. The structured layer only *points at* the original cells. It never rewrites them. In-app editing (moving the source into the app) should be a separate, later decision, made after a few months of the mirror running.

Why:
1. **The app already reads this sheet.** [CODE] `src/server/knowledgeBase/playbookSheetsClient.ts` reads spreadsheet `1BT5ugkkfxUDIlaPkM5G2IW6Kuxt-eHsrXkZk_GruIOk` through the Google Sheets API. It uses read-only permission and a stored Google login ("Connect Google Sheets" in Knowledge Base Management). It feeds Product Assist through `kb_playbook_plan_facts`. So this is not new ground. The plan is to make the existing read **complete and exact**, then give advisors a proper view.
2. Most of the load on the sheet comes from **people reading it**. If advisors read the app instead, the sheet should become stable again without changing how the product team works. [ASSUMPTION]
3. A one-time move to the app creates two copies that drift apart during the switch-over, and needs a rich-text editor good enough for 9,900-character add-on cells. That is the riskiest and most expensive option.

**What I proved on the Excel copy:** a lookup by plan + feature + sub-feature works, including merged cells. Formatting and notes come out with nothing lost. A second, independent reader agrees with the extraction on every cell (1,524 + 174 cells, 139 + 7 notes, 46 + 147 merges, 17 + 2 links). It also caught all 10 deliberate corruptions I planted.

**Live sheet check (R1), done read-only:** the Excel matches the live sheet very closely, but not perfectly. Of 55 data rows on the main tab, 53 match character for character. On tab 2, all 126 visible cells match. Merges, plan names, category labels and add-on heading colours all match. The Excel is out of date or damaged in three ways:
- the main tab's name has lost its apostrophe;
- **columns A and S are hidden in the live sheet**, but not in the Excel;
- **cell G29 in the Excel was accidentally typed into.** It holds cell references after the real text.

Details in §2.3. Not checked live: all 139 notes (1 spot check only), and the contents of hidden rows and columns.

---

## 2. Key Findings

### 2.1 Corrections to your description

| Your description | What the file actually shows | Source |
|---|---|---|
| "28 plans" / list of 29 | **29 plan columns, D to AF.** Your list of 29 is right, and so are all the names. | [EXCEL] |
| Hidden columns appear to be A and S | **Live: A and S are hidden. You were right.** The Excel file has lost this: tab 1 has no column settings at all, so A and S show as visible there. | [LIVE] [EXCEL] |
| Care Advantage (Q) is hidden | **Not hidden, live or in the Excel.** Column Q is visible with 51 filled cells. It is "Discontinued for Fresh & Porting", not hidden. | [LIVE] [EXCEL] |
| Care Senior Health Advantage (S) | **Column S is empty except for its name in S1.** It is also the only plan whose Add-ons cells (S44:S45) are not merged. | [EXCEL] |
| Merges B40:B41, B2:B4, B5:B7, B12:B13, B23:B26, B30:B33, B34:B38, B47:B49, B50:B53 | All correct, but **missing B14:B15, B16:B17, B28:B29, B44:B45**, plus C44:C45, A2:A8 and B1:C1. Full list in §2.2. | [EXCEL] |
| Category labels | Same 30 categories in the same order. **Exact spellings differ:** `"Co- payment "` (space after the hyphen, plus a trailing space); `"In- built / Add-on"` (space after the hyphen); `"Can be used from "` (trailing space). Add-ons covers rows 44–45 but has **no** sub-categories. Row 45 is just the lower half of a merge. | [EXCEL] |
| "Other Points" label carries data | Confirmed: B56 = `"Other Points\n\nMoratorium period is now reduced from 8 years to 5 years"`. No other label cell has data *in its text*, but **15 label cells in column B carry notes** with definitions and disclaimers (e.g. B12: "Co-pay means paying a part of the bill. It could be 20%, 30%, or any other figure."). | [EXCEL] |
| ~124 notes in the plan area | **Confirmed: 124 in D–AF**, plus 15 on column-B labels = **139** on tab 1. Tab 2 has 7. | [EXCEL] |
| "18.0 next to 91 Days" | The file stores **18** (a plain number, "General" format), not "18.0". "18.0" is how some tools *display* it. 102 cells on tab 1 are numbers. Everything else is text. | [EXCEL] |
| Column A | Header **"Rating"**. It is a **QA marking guide** for chat audits, not product information. Example: A12 = "1. Not explaining the feature when the customer asks about this feature specifically would be Rated-1…". The current app sync already throws it away on purpose. | [EXCEL] [CODE] |
| Colours carry meaning (green = "Available with Ditto", gold = …) | **Not consistently.** Green, gold and red headings all appear next to "(Available with Ditto)". Colour roughly follows the written **"Ditto Recommendation: ✅ / ⚠️ / ❌"** line, but with exceptions. 135 of 219 headings have no recommendation line at all. Details in §2.2. | [EXCEL] |
| Numbering 1), 2), 3) | Mostly, but with slips: F44 goes `1),2),4),4)…` (no 3, two 4s). AA44 jumps `9) → 11)`. D44 switches from `1)…6)` to `7.,8.,9.`. L44 uses `01)…04)`. **The app must never renumber anything.** | [EXCEL] |
| Status text in the plan-name cell | Confirmed in G1, P1, Q1 ("Discontinued for Fresh & Porting applications"), R1 ("(Brochure)", where the word Brochure is underlined and the cell links to a brochure PDF) and Z1 ("(Black Variant available with Ditto)"). The status is free text after a line break. Also: O1 is `" Care Heart"` with a leading space, and AF1 is `"Care Enhance "` with a trailing space. | [EXCEL] |

### 2.2 Data inventory

**Main tab "Dittos Recommended Policies"** [EXCEL]

| Item | Finding |
|---|---|
| Used area | A1:AF56. Nothing outside it. The file says A1:AR1033, but that is empty formatting. |
| Rows | Row 1 = plan names. Rows 2–56 = 30 categories over 55 rows. |
| Columns | A = QA rating guide. B = category. C = sub-category. D–AF = 29 plans. |
| Frozen | Columns A–C and row 1. |
| Filled cells | 1,524 (1,422 text, 102 numbers). No formulas, filters, dropdowns or conditional colours. |
| Rich text (mixed formatting inside one cell) | 206 cells, e.g. every add-on cell. |
| Notes | 139. All have a **blank author**: the export dropped authors. |
| Links | 17, each attached to a whole cell (R1, D22, E22, D34–F34, D39–F39, J44, D49–F49, V49, X49, D54, E54). One (J44) is a security-scanner wrapped link (`protect2.fireeye.com/...bit.ly...`). |
| Merges (46) | B1:C1, A2:A8, B2:B4, B5:B7, B12:B13, B14:B15, B16:B17, B23:B26, B28:B29, B30:B33, B34:B38, B40:B41, B44:B45, C44:C45, B47:B49, B50:B53, **G34:G38, H34:H38** (OPD inside plan columns), and **D44:D45 … AF44:AF45 for 28 plans (every plan except S)**. |
| "-" cells | 265 cells are exactly `"-"`. One is `"- "` (Y28, with a trailing space). |
| Truly empty cells in D2:AF56 | 189. These include all 29 cells of row 45 (28 covered by merges, plus S45), all 55 of column S below the header, and many in column R and in Fitness rows 50–53. |
| Whitespace | 118 cells start or end with spaces or line breaks. B1 is 31 spaces. AA21 is three line breaks. |
| Long cells | E44 has 9,922 characters. Also U44 9,332, J44 9,256, F44 9,210, D44 9,093. |
| Line breaks | Stored as Windows line breaks (CR+LF). This shows the file was **re-saved in desktop Excel** (see 2.3). Google Sheets itself uses plain line breaks (LF). |
| **Picture** | **One picture floats over AD46** (Care Supreme Enhance → Cover). It shows a table headed "Plan 2" with values 3 Lac, 4 Lac, 5 Lac, 7 Lac, 10 Lac, 15 Lac and 20–100 Lac. **Cell AD46 itself is empty.** Any cell-based import loses this, including the Google Sheets API. |

**Add-on heading colours vs the written verdict** (219 numbered bold headings in row 44; found by a script, so treat the counts as approximate) [EXCEL]:

| Heading colour family | ✅ Recommended | ⚠️ Case-dependent | ❌ Not recommended | No verdict line |
|---|---|---|---|---|
| Green (#38761D, #6AA84F) | 21 | 0 | 0 | 30 |
| Gold/yellow (#BF9000, #F1C232) | 0 | 16 | 7 | 36 |
| Red (#FF0000, #CC0000, #990000, #E21526) | 0 | 1 | 38 | 56 |
| Black/orange | 0 | 0 | 0 | 14 |

Reading: green is never ❌, and red is almost always ❌. But gold is used for both ⚠️ and ❌, and most headings have no written verdict. **Colour must be kept and shown exactly, but the app must not turn it into a "status".** The product team should confirm the colour rule. [OPEN]

Plan-name header colours follow the insurer's brand (HDFC red #E21526, Care yellow #FCDF00, Aditya Birla #C91429, Niva Bupa #00B0F6), not plan status.

**Second tab "Recommendation specifics"** [EXCEL]

| Item | Finding |
|---|---|
| Layout | A = SNo., B = use case (B:C merged in the header), C = "Policy" / "Add-ons" label, D:F = **one merged header "Recommendation" over 3 unlabelled columns**, G = "Customer wants more options". |
| Use cases | **15 pairs of rows (rows 3–32)**, but the serial numbers read 1, **2, 2, 3, 3**, 4 … 13. Two use cases share "2" (Fresh policy >35y; Maternity) and two share "3" (Maternity single female; OPD). Row 33 is a general note, merged D33:G33. |
| **Hidden rows** | **13–18 and 29–30**: use cases "Diabetes Type 1", "Diabetes Type 2 ≤65", "Diabetes Type 2 >65" and "Unlimited sum insured". |
| Merges | 147, of which about 100 are empty leftovers far below the data (A40:A41 … A1003:A1004) plus J1:M1, J2:K2, L2:M2. |
| Notes / links / rich text | 7 notes. 2 links (B19 "NRI Guidelines" → a Google Doc; D24 → porting tool web app). 11 rich-text cells. |
| Dropdown | The "Policy" cells have a pick-list of 21 short names, including some that **do not appear on the main tab**: "Optima Secure (Global)", "Aspire Titanium+", "Enhance", "Optima Restore", "Aspire". |
| International | D31:G32 merged: "We are currently not helping with international coverage…". |

**How tab 2 relates to tab 1:** tab 2 uses **short names**. Only "Care Supreme", "Care Freedom" and "Care Supreme Enhance" exactly match a tab 1 header. Every other name needs an explicit mapping table that the product team approves:
- "Optima Secure+ till age 60Y & Optima Secure above 60Y" → **two** plans (F and D) with an age rule
- "Activ Yuva" → U, "Activ One Max" → V, "ReAssure 3.0" → Z, "Medisure" → AC, "Recharge" → AE, "Optima Secure" → D
- "Energy Silver (Up to 55Y only)" → H, with an age rule
- "Aspire Titanium+" → AA, which is a *variant*. Tab 1's header just says "Niva Bupa Aspire".

No automatic fuzzy matching. [ASSUMPTION about the intended mapping; OPEN for confirmation]

### 2.3 Excel vs live sheet (R1): results [LIVE]

**How I compared:** I read the live sheet in Google's read-only web view, worked out each cell's address (including merged cells), and fingerprinted every cell's text with SHA-256 inside the browser. I did the same for the Excel copy. To compare like with like, I converted the Excel's Windows line breaks to plain line breaks (the Excel uses Windows line breaks because it was re-saved in Excel). Only fingerprints were compared, so no text was copied out of the sheet.

| Check | Live | Excel | Match? |
|---|---|---|---|
| Tab names (scope) | **"Ditto's Recommended Policies"**, "Recommendation specifics" | "**Dittos** Recommended Policies", "Recommendation specifics" | ❌ main tab name. **The app's sync uses the live name, so it is correct** [CODE]. The Excel is wrong. |
| Hidden columns, main tab | **A and S hidden** | none hidden | ❌ Excel lost the hidden flags |
| Hidden rows, main tab | none | none | ✅ |
| Hidden rows, tab 2 | 13–18 and 29–30 | 13–18 and 29–30 | ✅ |
| Plan count / names (visible) | 28 visible (D–R, T–AF) + S hidden = **29 total** | 29 | ✅ names identical (row 1 fingerprint identical, incl. `" Care Heart"` and `"Care Enhance "`) |
| Category / sub-category labels | — | — | ✅ identical |
| Merges, main tab | 45 visible | 46 (incl. A2:A8 in hidden col A) | ✅ |
| Main tab cell text (55 rows, visible columns) | — | — | ✅ 53 rows identical. Row 23: same data (Excel stores 1 formatted as %, live displays "100%"). **Row 29: G29 differs** (below). |
| Tab 2 visible cells | 126 | 126 | ✅ all identical |
| Add-on heading colours and numbering (D44, F44, J44, AA44) | — | — | ✅ identical, including the slips (F44 "2), 4), 4)"; AA44 "9) → 11)") |
| Links | R1 and J44 links present | present | ✅ spot check |
| Floating picture | 1 picture on the main tab | 1 picture over AD46 | ✅ present (position not re-checked live) |
| Notes | D10 note = "Initial \| Specific Illness \| PED"; note markers visible on B10, D10, E10, F10 | same | ✅ spot check only; it is a plain Google "note", not a comment thread |

**G29 (Optima Restore → Bonus → Loyalty):**
- Live: `"50% to 100%"`
- Excel: `"50% to 100%+G29:L29A30G29:J29G29:M29A30G29:J29G29:N29A30G29:J29G29:O29A30G29:J29G29:P29G29:J29"`

The Excel file opened with G29:J29 selected, so this looks like an accidental edit made in Excel before the file was shared. **The live sheet is correct.**

**What in the Excel is out of date or damaged:** the main tab's name (apostrophe missing), the hidden flags on columns A and S, cell G29, and Windows-style line breaks. It was also re-saved in desktop Excel on 2026-10-29, so note authors are blank. **For the real migration, use only data read straight from Google.**

Other live observations:
- The sheet showed **about 40+ people viewing at the same time** (avatar strip "+38"). This supports the idea that the instability comes from readers.
- **File → Download is enabled for viewers.**
- **Version history is greyed out for viewers.**

### 2.4 What I could and could not verify

- ✅ Everything marked [EXCEL] and [CODE], and everything in the §2.3 table.
- ❌ **All 139 + 7 notes.** The read-only web view doesn't show notes, and checking each one by hovering wasn't practical. One spot check matched. A read through the Sheets API (or a fresh, unopened download) would cover them all.
- ❌ **Contents of hidden columns A and S and hidden tab-2 rows.** The read-only view leaves them out, so they were not compared.
- ❌ Formatting of every rich-text cell. Only the add-on headings of 4 cells were compared.
- How I got access: the app's built-in browser wasn't signed in, and the Drive connector couldn't see the file. You then approved Claude in Chrome. I viewed pages and hovered only. The one menu I opened (File) was closed without choosing anything.

---

## 3. Experiment Results (on the Excel copy, scratch folder only)

| # | Experiment | Result | Evidence |
|---|---|---|---|
| a | Read a cell by plan + category + sub-category, resolving merged cells, using only the labels in B/C (no searching the whole grid) | **Works.** Ambulance for "Aditya Birla Activ Yuva" → U40 (Road) and U41 (Air), both "Covered up to SI". OPD for Optima Restore → all 5 sub-rows read from merged G34 ("Not covered"). Add-ons for Care Supreme → J44 (J45 is covered by the merge). | `output/exp_a_lookup.txt` |
| a | Exact-label matching | **Fails on purpose** for `"Co-payment"` (the sheet says `"Co- payment "`) and for `"Care Advantage"` (the header includes the status text). So the app needs **fixed keys** (e.g. `co_payment`) mapped to the exact labels, checked on every sync. | same |
| b | Rich text + notes extracted without loss | **Works.** 206 + 11 rich-text cells. The pieces of every cell join back to its exact text. Converting to display HTML and back gives identical formatting. 139 + 7 notes, 46 + 147 merges, 17 + 2 links. | `output/exp_bc_results.txt`, `output/staging_sheet*.json` |
| c | Cell-by-cell reconciliation with a second, independent reader | **PASS: 0 differences** on both tabs (text, number vs text, formatting pieces, bold, colour, notes, merges, link count). | same |
| c | Planted 10 corruptions (1 character in a 9,922-character cell; bold removed; heading colour changed; "-" → blank; 18 → "18.0"; trailing space trimmed; note dropped; merge dropped; line endings changed; cell deleted) | **All 10 caught.** | same |

**Not yet proven:**
- Reading the **live** sheet through the Google API with full formatting (`textFormatRuns`, notes, merges, hidden flags, links). The existing app connection only asks for values and notes today. The same read-only permission covers the rest [CODE comment cites the API docs], but I have not run it.
- The **floating picture**: the Google Sheets API does not return pictures that float over cells. It needs a manual decision.
- **Links inside part of a cell's text** (Google allows several links per cell). The Excel only keeps whole-cell links, so I could not test this.
- Reconciliation check 2 compares bold and colour only. Italic, underline and strikethrough are checked by reader 1 only.

---

## 4. Options Compared

| | **A. Sheet stays the editing source; app keeps an exact read-only mirror** (recommended) | **B. One-time move; the app becomes the source with in-app editing** | **C. Fix the sheet only** (protected ranges, filter views, fewer viewers) |
|---|---|---|---|
| What changes for the product team | Nothing. They keep editing the sheet. | Must learn a new editor. The sheet is frozen and then retired. | Small changes to habits. |
| Fixes instability | Mostly. Advisors stop opening the sheet. [ASSUMPTION: load is mainly readers] | Yes. | Partly. Filter views stop people breaking each other's filters, but many viewers still share one sheet. |
| Structured plan/compare view | Yes. | Yes. | No. |
| Accuracy risk | Low. Every snapshot is checked cell by cell. One source, no drift. | Highest. Two copies during the switch-over, and the editor must handle rich text in 9,900-character cells without damage. | Lowest (no copy), but no new value. |
| Effort | Medium. Builds on the existing sync, connection and Product Assist. | High. Editor, approvals, history, training, switch-over. | Low. |
| Version history | The app keeps every snapshot, so it has its own history even though viewers can't see Google's. | Full in-app history. | Google history only (owner/editors). |
| Breaks if the sheet layout changes | Yes, so the sync must **stop and alert, keeping the last good snapshot**, rather than guess. | No. | No. |
| **Needs from the sheet owner** | A Google account with at least **view** access connected once to the app (read-only). One may already be connected [CODE: `kb_playbook_connection`]; whose account is unknown [OPEN]. Owner agreement on tab names and layout stability, the colour rule, and the picture. | Owner/product head sign-off to retire the sheet. Edit rights to lock it. | **Editor or owner rights** for protected ranges and filter views. You cannot do this as a viewer. |

**Assumptions of yours I'd challenge:**
- *"Move the playbook into the app."* The instability is a reading problem more than a data problem. Moving advisors (readers) solves it without moving the official source, and without the drift that a move creates.
- *"Colour carries meaning."* Only loosely. Show colour exactly, but rely on the written ✅/⚠️/❌ lines, and only once the product team confirms them.
- *"Plan status is in the header."* It is free text. Keep it word-for-word, and **add** a status field set by the product team (active / discontinued for fresh & porting / brochure only / hidden). Never work the status out by parsing the text.
- *"The Excel is a good stand-in."* It was re-saved in Excel and may have a different tab name. It is fine for experiments, but not as evidence.
- *Hidden ≠ inactive.* Tab 2's hidden use cases (rows 13–18, 29–30) are probably being fed to Product Assist today, because the Sheets "values" read ignores hidden flags. [CODE + ASSUMPTION — confirm whether these rows are hidden in the live sheet, and why.]

---

## 5. Recommendation

Choose **Option A**, in phases (§11). Add **Option C's filter views and protected ranges** as a cheap extra *if the owner agrees*. Revisit Option B only after the mirror has run for 2–3 months and the product team asks for it.

Rules the mirror must follow:
1. Store the **exact** source: text, formatting pieces, notes, links, merges and hidden flags. No trimming, no fixed-up line breaks, no renumbering, no rounding. (The current sync trims text and converts line breaks [CODE `cellText`]. The new path must not.)
2. The structured layer (plan / feature / sub-feature) **points at** source cells. Advisors always see the source text.
3. **Nothing changes in Product Assist at first.** `kb_playbook_plan_facts.content` is documented as needing to "stay byte-identical" [CODE]. Any later switch to the new data goes through a before/after comparison of answers.
4. A snapshot is only shown after reconciliation passes, and a person can approve it if you want (§8).

---

## 6. Proposed Data Model (proposal only — no migration written)

A "snapshot" is one complete, fixed copy of the two tabs at one moment.

```
playbook_snapshots        one row per sync
  id, domain ('Health'), spreadsheet_id, fetched_at, connection_email,
  source_payload_sha256, source_payload (full API response, stored as-is),
  parser_version, status (staged | verified | published | rejected | superseded),
  reconciliation_report jsonb, diff_vs_previous jsonb, approved_by, approved_at

playbook_tabs             per snapshot × tab
  snapshot_id, sheet_gid, tab_name (exact), frozen_rows, frozen_cols,
  hidden_rows int[], hidden_cols int[]

playbook_cells            every cell that has a value, a note or a link (exact copy)
  snapshot_id, sheet_gid, row, col, a1_ref
  value_kind            empty | text | number | boolean | error
  raw_text              exact text, never trimmed (null = truly empty)
  number_value          numeric, when value_kind = number
  formatted_value       what the sheet displays (e.g. "18")
  text_runs jsonb       [{start, text, bold, italic, underline, strike, color, link}]
  cell_format jsonb     background, font, wrap
  note                  exact note text
  hyperlink
  merge_range           e.g. "G34:G38" when this cell is the top-left of a merge
  covered_by            e.g. "G34" when this cell sits inside someone else's merge

playbook_assets           pictures that float over cells (supplied by hand, see §7)
  snapshot_id, sheet_gid, anchor_ref, image_bytes / url, sha256, description

-- Structured layer: small, edited and approved by the product team, versioned --
playbook_plans            plan_key (stable, e.g. hdfc_optima_secure), insurer,
                          display_name, kb_plan_name (link to kb_categories.planNames),
                          status (active | discontinued_fresh_porting | brochure_only | hidden),
                          show_to_advisors bool, expected_header_text (exact)
playbook_features         feature_key, sub_key, expected_label (exact B text),
                          expected_sub_label (exact C text), display_order
playbook_use_cases        sno_as_written, condition_ref, policy_row, addons_row, hidden
playbook_use_case_links   use-case cell text → plan_key[] (+ condition such as "till 60Y")

playbook_current          domain → published snapshot_id   (rollback = point it back)
```

How a lookup works: (plan_key, feature_key, sub_key) → find the plan's column by its **exact** header in that snapshot → find the row(s) by the **exact** B/C labels → follow `covered_by` for merged cells → return the source cell (text, formatting pieces, note, link). If any expected header or label is missing or changed, the snapshot **fails checking** instead of guessing.

Optional, clearly marked "derived": split add-on cells into items at their numbered headings, as start/end positions in the source text, to allow jumping to an add-on. Always shown alongside the full original text, never instead of it.

Fit: hand-written numbered SQL migrations in `drizzle/` (each runs in its own transaction, `npm run db:migrate`, run manually per environment). New tables only. Existing tables untouched.

---

## 7. Migration and Verification Plan

### 7.1 Ways to get the data out

| Method | Keeps | Loses | Permission needed |
|---|---|---|---|
| **Google Sheets API, read-only** (recommended for repeat syncs) | Values, displayed values, formatting pieces (incl. partial-cell links), notes, merges, hidden rows/cols, frozen panes, tab IDs | **Floating pictures**, threaded comments (separate Drive API), Google version history | Any Google account that can **view** the sheet, consenting once to read-only access. The app's Connect button already does this. No owner needed. |
| **File → Download → .xlsx** (one independent cross-check at switch-over) | Values, formatting pieces, notes, merges, hidden flags, whole-cell links, **floating pictures** | Note authors, comment threads; possibly partial-cell links | Viewer. **Download is currently enabled for viewers** [LIVE]. **Never open or save it in Excel before importing**: the current Excel shows what that does (lost hidden flags, an accidental edit in G29, changed line breaks). |
| **Export arranged with the owner** | Anything above, plus confirmation of hidden-column intent, the picture, and a version-history snapshot | — | Owner. |

### 7.2 Pipeline
1. **Raw staging:** store the API response exactly as received, plus its fingerprint (hash).
2. **Transform** with fixed, documented rules: no trimming, no case changes, keep line breaks as received, keep both number and displayed value, record merges and hidden flags, keep "-" vs `"- "` vs blank distinct.
3. **Structure check:** expected tab names; plan headers match `playbook_plans.expected_header_text` exactly; B/C labels match `playbook_features` exactly. Any mismatch → snapshot `rejected`, alert, the last published snapshot stays live.
4. **Reconciliation:** every non-empty cell, note, merge, link and hidden flag in the raw response must be in the snapshot, and vice versa (as in experiment c). At switch-over, also reconcile against an untouched .xlsx download using the second reader.
5. **Difference report** vs the previous published snapshot: cells added / removed / changed, notes, merges, plans, labels.
6. **Product-team spot checks** (first switch-over and any structural change): all add-on cells for 5 plans, every merged plan cell, all notes for 3 plans, every discontinued/brochure plan, tab 2 in full, plus 10 random cells.
7. **Dry run** on the staging database first (the `.env` database is staging; production migrations are run by hand).
8. **Rollback:** point `playbook_current` back to the previous snapshot. Product Assist is not affected.

### 7.3 "Migration passed" means
- 100% of non-empty cells, notes, merges, links and hidden flags accounted for, with **0 unexplained differences**;
- the planted-corruption tests still all get caught;
- structure checks pass against the approved plan/feature lists;
- the floating picture is handled (moved into the sheet as text or a link by the owner, or attached by hand and signed off);
- the product team signs off the spot checks.

---

## 8. Governance

- **Who edits:** the product team, in the Google Sheet (unchanged). The app is read-only. [Decision: owner]
- **Approval:** choose either *auto-publish if every check passes* or *publish after one product-team click*. I suggest a click for structural changes and auto-publish for content-only changes. [Decision: you + owner]
- **Version history:** the app keeps every snapshot with time, fingerprint and difference report. That gives an audit trail even though you, as a viewer, cannot see Google's version history.
- **The Google Sheet afterwards:** stays the official source. The owner may reduce advisor access and point advisors to the app, and add protected ranges and filter views. [Decision: owner]
- **No stale or unofficial data:** every view shows "Playbook as of <time>". If the last successful sync is older than an agreed limit (e.g. 24h), or the latest sync was rejected, show a clear "may be out of date" banner. Hidden plans are not shown as recommendations unless the product team marks them visible.
- **Decisions needing the sheet owner:** tab-name and layout stability (or advance notice of changes); meaning of colours; the status of hidden or empty plans (S, and Q if hidden); hidden use-case rows; the picture over AD46; whether viewers can download; which Google account the app uses to connect; reducing advisor access to the sheet.

---

## 9. Advisor Experience

Reuse what exists [CODE]: Product Assist's plan-scope picker (`kb_categories.planNames`, disabled-plan handling), its Library sidebar (the "Product Playbook" button currently opens the Google Sheet in a new tab; it could open the in-app view instead), insurer logos (`INSURER_LOGOS`), and the access checks (`hasAccess(featureId, Viewer/Editor)`). New feature id needed, e.g. `product_playbook` [OPEN]. Avoid a fourth plan list: link `playbook_plans` to the existing Knowledge Base plan names.

- **Plan picker:** insurer → plan, as in Product Assist. Status badge (e.g. "Discontinued for fresh & porting") plus the header text word-for-word.
- **Compare up to 4:** plans as columns on desktop. The feature label column stays fixed on the left.
- **Feature picker:** chips by category (Restoration, Bonus, Room rent, Add-ons …). Selecting a category shows all its sub-rows.
- **Long cells:** always shown **in full** with the original bold, colours and line breaks. Add-on cells get a small "jump to add-on" list built from their headings, never cut short.
- **Notes:** shown as a visible "Note" block under the cell (hovering doesn't work on phones), not hidden in a tooltip.
- **"-" vs blank:** "-" is shown as "-". A truly blank cell is shown as "Not filled in the Playbook" in grey.
- **Source line:** "Playbook cell U40 · synced 29 Oct 14:00".
- **Phone screens:** one plan at a time. Swipe between compared plans, with the feature label pinned at the top.

### Text mockups

Single plan:
```
┌ Aditya Birla Activ Yuva ─────────────── Active ┐
│ Playbook as of 29 Oct 2026 14:00              │
│ [Ambulance] [Restoration] [Bonus] [+ features]│
├───────────────────────────────────────────────┤
│ AMBULANCE                                     │
│  Road  Covered up to SI          (cell U40)   │
│  Air   Covered up to SI          (cell U41)   │
│ RESTORATION                                   │
│  % of SI …   Exhaustion …   Illness …         │
│  Frequency …                                  │
│  📝 Note: <note text exactly as in sheet>     │
└───────────────────────────────────────────────┘
```

Compare four:
```
Feature ▸ Ambulance        | Optima Secure | Care Supreme | Activ Yuva      | ReAssure 3.0
---------------------------+---------------+--------------+-----------------+-------------
Road                       | <D40 exact>   | <J40 exact>  | Covered up to SI| <Z40 exact>
Air                        | <D41 exact>   | <J41 exact>  | Covered up to SI| <Z41 exact>
Feature ▸ Add-ons          | full D44 text | full J44 text| full U44 text   | full Z44 text
                           | (all items, original colours, no cut-off)
```

---

## 10. Fit with the App

| Area | Fit / conflict |
|---|---|
| Existing Playbook sync [CODE] | **Fits and is reused.** Same connection, same read-only permission. **Conflict:** the current parser trims text, converts line breaks, drops formatting and links, and only puts a merged plan value (G34:G38) on its first sub-row. That is fine for Product Assist's AI text, but not good enough for an exact advisor view. Proposal: a new, parallel exact path. **The existing path stays untouched.** |
| Product Assist [CODE] | Playbook facts are injected in full and take precedence ("exclusive precedence", commit 86aea32). Any change there changes AI answers, so it is out of scope until a later, regression-checked phase. |
| Tab name [CODE + LIVE] | Resolved: the live tab is "Ditto's Recommended Policies", which is what the app's sync uses. Only the Excel is wrong. |
| Hidden columns [CODE + LIVE] | The current sync reads hidden column S (empty, so no effect today) and skips column A on purpose. It would include any plan column that gets hidden in future. The new path must respect hidden flags. |
| MASTER_CONSTITUTION.md | It governs the Declaration Assistant mapping engine. It does not cover the Playbook. Its principle of "no silent production behaviour change" applies to Product Assist. No conflict. |
| Plan lists | Plans already live in several places (`plan_configs`, `kb_categories.planNames`, `INSURER_LOGOS`, `planCoverEligibility`). Link to these rather than adding another list. |
| Access levels | General / Admin / Platform Admin / Developer, through `hasAccess`. A new feature id is needed. |
| Migrations | Hand-written SQL in `drizzle/`, run by hand per environment (production before deploy). |

No documented decisions need changing for Option A.

---

## 11. Phased Rollout

| Phase | What | Effort | Risk | Your decision at the end |
|---|---|---|---|---|
| 0 | Live-vs-Excel check ✅ done; owner decisions in §8 | Small | Low | Go/no-go on Option A; approve plan/feature key lists |
| 1 | Exact snapshot pipeline (new tables, sync, reconciliation, difference report) on **staging only**; no advisor UI | Medium | Low (read-only, separate tables) | Approve the migration and the "passed" result |
| 2 | Advisor view (single + compare) behind a feature id for a pilot group | Medium | Low–medium (display bugs) | Pilot group; staleness limit |
| 3 | Product-team validation + pilot feedback; fixes | Small–medium | Low | Wider rollout; owner reduces sheet access |
| 4 | Production rollout (migration run by hand on prod first) | Small | Medium (switch-over) | — |
| 5 (optional) | Point Product Assist at snapshots (with answer-regression check); or start Option B | Medium–high | Medium–high | Separate approval |

---

## 12. Risks

1. **Copies drift from the live sheet.** This has already happened: the Excel has an accidental edit in G29 and has lost the hidden columns. *Fix:* only import directly from Google; never use a re-saved file.
2. **Hidden content is sent to Product Assist today.** Tab 2's hidden rows 13–18 and 29–30 are hidden live [LIVE], but the app's values read includes them [CODE]. *Fix:* owner confirms intent; the new path respects hidden flags.
3. **Sheet layout changes** (renamed category, new plan column) → wrong cell shown. *Fix:* exact-label structure checks; reject and alert instead of guessing.
4. **Floating picture** (AD46) is invisible to the API → lost data. *Fix:* owner moves it into text or a link, or it is attached by hand.
5. **Hidden rows/columns** shown to advisors as active → wrong recommendation. *Fix:* hidden flags stored; `show_to_advisors` set by the product team.
6. **Colour read as meaning** → advisor told the wrong verdict. *Fix:* show colour, don't interpret it.
7. **Tab 2 short names wrongly mapped** → wrong plan linked. *Fix:* approved mapping table, no fuzzy matching.
8. **Stale data** → *Fix:* "as of" stamp, staleness banner.
9. **Connected Google account loses access** (person leaves) → sync stops. *Fix:* alert on failure; agree an owner-held account or service account [owner decision].
10. **Excel re-save artefacts** used as evidence → false differences. *Fix:* only use files straight from Google.

---

## 13. Open Decisions

**For you:**
1. Approve Option A, or tell me what to change.
2. Whether to tell the product team about the Excel copy's G29 damage, in case that file is being passed around.
3. Auto-publish vs one-click approval of snapshots.
4. Pilot group and feature id/access level for the advisor view.
5. Whether to add a short `CLAUDE.md` with the folder rule (see Part A note below).

**For the sheet owner:**
1. Tab names and layout: freeze them, or notify before changes.
2. Meaning of heading colours in add-on cells.
3. Status of Care Senior Health Advantage (S, empty), Care Advantage (Q) and the other "Discontinued"/"Brochure" plans; whether any column is hidden in the live sheet, and why.
4. Hidden use-case rows on tab 2 (13–18, 29–30): retired or temporarily hidden?
5. The picture over AD46.
6. Whether viewers can download; which Google account the app should connect with.
7. Whether to cut advisor access to the sheet once the app view is live; protected ranges and filter views.
8. The tab 2 short-name → plan mapping, and the duplicate SNo. 2 and 3.

---

## 14. Action Items

| # | Item | Owner |
|---|---|---|
| 1 | ✅ Done: live read access via Claude in Chrome, read-only. | — |
| 2 | ✅ Done: R1 comparison (§2.3). | — |
| 3 | Optional: check all notes and hidden-cell contents. Either I read them with a fresh download you make (straight from Google, not opened in Excel), or it happens in Phase 1 through the Sheets API. | You decide |
| 4 | Take the §8 / §13 owner questions to the sheet owner. | You |
| 5 | On approval: draft the Phase 1 design (tables + sync) for review before any code. | Me |

---

### Part A note (folder rule)
- Added to `MASTER_CONSTITUTION.md` (top of the file, nothing else changed) on this worktree's branch. It reaches the main checkout only when this branch is merged.
- No `CLAUDE.md` exists in the project. Claude Code automatically reads `CLAUDE.md`, but not `MASTER_CONSTITUTION.md`. A one-line `CLAUDE.md` would make the rule apply to every session. You asked me not to create a new file when a suitable one exists, so I have not created it. [OPEN]
- The Claude Project copy of the constitution is not reachable from here. It **needs a manual update**.
- Exceptions to the rule during this task: reading your attached file in `Downloads` once, to make the copy (as you instructed); and the browser loading a Google sign-in page. Everything written stayed inside `D:\Ditto Assist WebApp`.
