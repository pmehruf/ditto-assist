# Product Playbook Mirror — Step 3b Results: Raw Snapshots on Staging

**Status:** Done on staging (2026-10-29). **Nothing published.** Waiting for your review before the next checkpoint.

## 1. Outcome

Ran one fetch on staging through the app's own code path, the same one behind `POST /api/playbook-mirror/fetch`:
- reading only through the verified read-only grant;
- refusing any database but staging.

**Snapshot 1: status `fetched`, no problems found, 8.8 s.**

| Item | Snapshot 1 | Expected (Step 1 spike) |
|---|---|---|
| Tabs | "Ditto's Recommended Policies", "Recommendation specifics" | same |
| Cells with a value | 1,524 + 174 = **1,698** | 1,524 + 174 |
| Notes | 139 + 7 = **146** | 139 + 7 |
| Rich-text cells / formatting runs | 206 + 11 / 3,059 + 30 | same |
| Links (inside text runs) | 17 + 4 = **21** | 17 + 4 |
| Hidden | main tab: columns **A and S**; tab 2: rows **13–18, 29–30** | same |
| Cells with lone CR line breaks | 25 (kept exactly) | 25 |
| Stored cell rows | 4,143 (values, notes, formatted-only cells, and every merge-covered cell) | — |
| Raw response | 5,975,437 bytes, stored as 231,379 bytes gzip; SHA-256 `d75c0228…5bcf` | — |
| Content outside the mirrored area (A1:AR80 / A1:M60) | **none** (whole-tab scan) | — |

**Live sheet unchanged since the Step 1 spike:** all 1,698 cells compared, 0 changed.

**Spot checks:**
- G29 = `"50% to 100%"`, the live text (the Excel copy is damaged; recorded as a known discrepancy);
- O1 = `" Care Heart"` (leading space kept);
- AF1 = `"Care Enhance "` (trailing space kept);
- D23 = number 1, shown "100%";
- G35 is covered by G34, and D45 by D44;
- S45 is stored as its own cell (S44:S45 isn't merged);
- AD46 is empty in the API, so the picture issue stays **open** with its warning.

## 2. Independent check (separate code, not the app's transform)

Script: `_scratch_playbook_migration/scripts/step3b_independent_check.ts`, read-only. Output: `_scratch_playbook_migration/output/step3b_independent_check.txt`.

- **Raw copy:** decompressed size and SHA-256 match what was stored.
- **Cells:** every cell was re-derived from the raw response and compared with `playbook_cells`: **4,143 compared, 0 differences**. Compared for each cell:
  - text, number and displayed value;
  - note;
  - the raw Google value, runs, formats and effective value;
  - the processed runs rejoin to the exact text;
  - the links inside the runs.
- **Tabs:** hidden flags and merges identical; every merged cell points to its anchor.

**Finding 1, how JSON is stored:** PostgreSQL's `jsonb` re-orders object keys. So the raw Google objects in the cell columns are *semantically* identical to Google's (0 differences once key order is ignored), but not byte-identical. The **byte-exact** response is kept in `raw_response_gzip` with its fingerprint. That copy is the evidence of record; the cell columns are the working copy.

**Finding 2, merges outside the area:** Google returns only merges that touch the requested area. The mirror holds all **46** merges on the main tab and **42** on tab 2. Tab 2's other 105 merges sit far below the data (rows 62–1004), and the whole-tab scan proved those rows have no values or notes. If you want every merge recorded anyway, Step 4 can add merges to the scan.

## 3. What was built (branch, not committed)

| File | Purpose |
|---|---|
| `src/server/playbookMirror/config.ts` | Spreadsheet id (a test asserts it equals the existing sync's), the two tabs, mirrored areas, field lists, parser version |
| `src/server/playbookMirror/transform.ts`, `a1.ts` | Exact transform (no trimming, lone CR kept, run inheritance, links per run, merge anchors and covered cells, hidden flags, formatted-only cells) and the outside-area check |
| `src/server/playbookMirror/sync.ts` | Fetch → store raw (gzip + SHA-256) → exact cells → sync health. Identical responses create no new snapshot. Wrong tab titles or content outside the area: stored but **rejected**, with a warning in sync health. Failures (e.g. the grant fails the read-only check): nothing stored, error recorded. |
| `src/server/playbookMirror/client.ts` | The only client the sync may use: verified read-only grant; **GET only**, to **this spreadsheet's** read endpoint only |
| `src/server/db/repositories/playbookMirrorSnapshotsRepository.ts` (+ index) | Insert-only snapshot storage in one transaction with a database lock (one sync at a time); list; sync state. Never touches the published pointer. |
| `server.ts` | +32 lines, 0 changed: `POST /api/playbook-mirror/fetch` (Editor), `GET /api/playbook-mirror/snapshots` (Viewer), both checked server-side on `product_playbook_admin` |
| Tests (new) | transform (14), sync on a local database (6), client guard (3); synthetic fixture only (D7) |

**No automatic schedule yet:** fetches only happen when someone with Editor access asks. The 6-hourly check from the design comes later, with your approval.

## 4. Zero Regression Audit evidence

| Check | Result |
|---|---|
| Full test suite | **79 files passed, 1 skipped; 1,028 passed** (1,005 before + 23 new), 1 skipped. No test that passed before fails. |
| Type check / lint | 0 errors / 0 problems |
| `server.ts` diff overall | additions only |
| Staging before/after the fetch | Schema, Product Assist Playbook facts, sheet resources, existing Playbook connection, text chunks, migrations: **all identical**. Changes only inside mirror tables: 1 snapshot, 2 tab rows, 4,143 cell rows, 1 sync-state row. |
| Published pointer / plans / features | 0 / 0 / 0 |
| Production | untouched |

Two small fixes during the work:
- a one-character offset in my *synthetic* test data;
- a lint warning about a loose type.

Neither affected app behaviour.

## 5. Next checkpoint (needs your approval)

**Step 4: structure check and first-run plan/feature lists.**
- From snapshot 1, propose the exact plan list (29 headers) and feature list (30 categories / 55 rows) **for you and the product team to accept**. Statuses stay provisional and nothing is shown to advisors (D4).
- Then check every snapshot against the accepted structure, failing closed.
- Optionally add merges to the whole-tab scan (Finding 2).

Still no publishing and no Product Assist changes.
