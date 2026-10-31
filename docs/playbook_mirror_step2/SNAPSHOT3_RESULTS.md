# Product Playbook Mirror — Snapshot 3 (fixed ranges) on Staging

**Date:** 2026-10-30. **Status:** snapshot 3 fetched and **verified**. **Not published.** Snapshot 2 left unchanged, as you asked. No advisor access, no production change, nothing committed.

## 1. Snapshot 3

| Item | Result |
|---|---|
| Ranges requested (recorded on the snapshot) | `'Ditto''s Recommended Policies'!B1:AF56`, `'Recommendation specifics'!A1:G33`: one request, read-only grant |
| Parser / raw format | `mirror-2026-10-30.3` / `playbook-mirror-raw-v2`; SHA-256 `33ee15e3…1492` matches, size matches |
| Structure check | **passed**: all 29 accepted plans at their columns, all 54 categories at their rows |
| Independent reconciliation | **0 differences**. Cells with a value 1,676 = 1,676 · notes 146 = 146 · formatting runs 2,953 = 2,953 · links 21 = 21 · merges 81 = 81. |
| Status | **verified** (not published) |
| Stored cell rows | 1,967 (all inside the configured ranges) |
| Hidden in the source (stored, never displayed) | main tab: column **S**; tab 2: rows **13–18, 29–30** |
| Sync health | last success 15:59 UTC, no error |

**"Needs review" note, explained:** the structure check reported "Hidden columns on the main tab changed: A,S → S". This is **not** a change in the sheet. Column A is no longer read (it is outside `B1:AF56`), so it no longer appears in the hidden list. Column S is still hidden. A small follow-up could make that comparison ignore columns outside the configured range, so this note doesn't appear after a range change. I haven't changed it.

## 2. Cross-check against snapshot 2 (read-only)

- **Inside the fixed ranges, snapshots 2 and 3 are identical cell for cell:**
  - main tab: 1,736 = 1,736 cells, **0 differing**;
  - tab 2: 231 = 231 cells, **0 differing**.

  Compared: value, user and effective formatting, formatting runs, displayed value, note, merge range and covered-by.
- **All 1,676 cells with content** in snapshot 3 match snapshot 2 exactly (text, number, note, formatting runs).
- **Plan columns and category rows** are in identical positions.
- **The difference report (3 vs 2) shows only the effect of the narrower ranges:**
  - 2,026 empty formatted cells and 112 merges that were outside the new ranges (e.g. AG1–AR1, rows 57–80, tab-2 columns H–M);
  - column A dropped from the hidden list;
  - 150 entries in hidden rows and columns, counted but not shown.
- So the change of ranges altered **nothing** within the mirrored area, and the live sheet's content is unchanged since yesterday.

## 3. Staging before/after

| Check | Result |
|---|---|
| Everything outside the mirror tables (schema, Product Assist Playbook data, sheet resources, existing Playbook connection, text chunks, migrations) | **identical** |
| Mirror changes | +1 snapshot (#3) with its tab and cell rows; sync state updated |
| Published pointer / confirmed statuses / plans shown to advisors | **0 / 0 / 0** |
| Snapshot 2 | still `verified`, untouched |

## 4. Snapshots now

| # | Ranges | Status | Note |
|---|---|---|---|
| 1 | old A1:AR80 / A1:M60 + scan | fetched | older than the structure check; audit only |
| 2 | old A1:AR80 / A1:M60 + scan | **rejected** (2026-10-30) | "Rejected by mehruf.p@joinditto.in: superseded by fixed ranges (snapshot 3)…" entered by Claude on your request in chat. Kept as audit evidence (4,353 cells and raw copy intact). |
| 3 | **B1:AF56 / A1:G33** | **verified** | the candidate for publishing, once you decide |

## 5. Decisions still open (yours)

1. ~~Reject snapshot 2~~: done 2026-10-30. Nothing else on staging changed; published 0, confirmed statuses 0.
2. Whether the open AD46 picture gap blocks publishing.
3. Product-team confirmation of plan statuses (all 29 still unconfirmed).
4. Publishing snapshot 3: a manual action, only on your explicit go-ahead.
