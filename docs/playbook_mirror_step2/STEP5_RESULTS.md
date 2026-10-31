# Product Playbook Mirror — Step 5 Results: Reconciliation and Difference Report

**Status:** Done on staging (2026-10-30). **Snapshot 2 is `verified`.** Nothing is published. Waiting for your review before the next checkpoint.

## 1. Outcome on staging

| Item | Result |
|---|---|
| Snapshot 2 | **verified**: structure check passed (Step 4) **and** independent reconciliation found **0 differences** |
| Raw evidence | SHA-256 matches, size matches, format `playbook-mirror-raw-v1` |
| Totals, Google's response vs stored | cells with a value 1,698 = 1,698 · notes 146 = 146 · formatting runs 3,089 = 3,089 · links in text 21 = 21 · merges 193 = 193 |
| Time | 4.7 s |
| Snapshot 1 | **not eligible** (its structure was never checked, being older than Step 4); left as `fetched` |
| Difference report (stored with snapshot 2) | baseline **none**: nothing has been published yet |
| Informational report, snapshot 2 vs 1 | **0 cell changes**. Tab 2: 105 merges added (42 → 147, from Step 4's complete merge list). Plan/category positions **not compared**, stated in the report, because snapshot 1 has no passed structure check. |
| Published pointer / confirmed statuses / plans shown to advisors | 0 / 0 / 0 |
| Staging outside the mirror tables | identical before/after |

**A flaw I caught and fixed during the run:** the first version of the difference report listed all 29 plans as "added" when the older snapshot had no structure check to compare against. That would have been misleading. The report now records a note saying plan and category positions weren't compared and why, and treats the comparison as not identical. A test covers this.

## 2. How "verified" is decided

A snapshot moves from `fetched` to `verified` only when **all** of these hold:
1. its structure check passed against the accepted structure;
2. the **independent checker** finds **zero** differences;
3. it is still `fetched` (a rejected, verified or published snapshot is never re-verified).

If the checker finds any difference, the snapshot becomes `rejected` with the reason. Sync health then shows the warning straight away (D9). Verification **never publishes**. New snapshots go through this automatically right after a passed structure check.

**The independent checker** (`reconcile.ts`) does **not** use the code that wrote the snapshot (`transform.ts`). It re-reads the stored byte-exact Google response and compares field by field:
- **Raw copy:** fingerprint and size.
- **Tabs:** title, index, frozen rows/columns, grid size, hidden rows/columns, rows hidden by filters, every merge.
- **Every cell Google sent:** text, number literal, formula, displayed value, note, cell link, the raw Google value, runs, formats, effective value and chips, and merge membership.
- **Formatting runs:** rebuilt independently (boundaries, bold, italic, underline, strikethrough, colour, link, with Google's inheritance rule) and compared.
- **Stored rows Google didn't send:** must be empty merge-filler cells.
- **Totals:** must match on both sides.

## 3. Proof the checker catches damage (automated tests, synthetic data)

**24 kinds of damage, each caught:**
- one character changed;
- leading space trimmed;
- lone CR turned into LF;
- trailing space trimmed;
- "-" turned into blank;
- "- " turned into "-";
- number 1 → 1.0;
- displayed "100%" → "1";
- bold removed from a heading;
- heading colour changed;
- link dropped;
- raw run altered;
- note dropped;
- note text altered;
- cell deleted;
- extra cell invented;
- merge pointer broken;
- merge-filler cell given content;
- merge list shortened;
- hidden column lost;
- hidden tab-2 row lost;
- background colour of an empty cell lost;
- raw response swapped (fingerprint);
- wrong recorded fingerprint.

## 4. Difference report

- **Baseline:** compares a snapshot with the **published** one, or with any chosen snapshot.
- **What it lists:**
  - plans added, removed or moved;
  - category rows moved;
  - hidden-flag and merge changes;
  - every cell change: text changed, newly filled, emptied, formatting only, link changed, and note added/changed/removed.
- **Labels and text:** each cell change carries its tab, cell address, **plan key and category key** (from the accepted structure), and the **text before and after exactly as written**.
- **Example from the tests:** E3 → plan `plan_E`, category `feature_1.sub_b`, "-" → "--".

## 5. What was built (branch, not committed)

| File | Purpose |
|---|---|
| `src/server/playbookMirror/reconcile.ts` | Independent checker (no import of the transform) |
| `src/server/playbookMirror/diff.ts` | Difference report with plan/category labels and exact before/after text; states what it couldn't compare |
| `src/server/playbookMirror/verifyService.ts` | Verify (fetched → verified/rejected, never published); difference report against the published or a chosen snapshot |
| `src/server/playbookMirror/sync.ts` | Runs verification automatically after a passed structure check |
| `src/server/db/repositories/playbookMirrorSnapshotsRepository.ts` | Full snapshot read; published-pointer read; record verification (only from `fetched`) |
| `server.ts` | +41 lines, 0 changed: `POST /api/playbook-mirror/snapshots/:id/verify` (Editor), `GET /api/playbook-mirror/snapshots/:id/diff[?base=]` (Viewer); server-side `product_playbook_admin` checks |
| Tests (new) | reconciliation (26 incl. 24 damage cases), verification + difference report (5) |

## 6. Zero Regression Audit evidence

| Check | Result |
|---|---|
| Full test suite (final, after the difference-report fix) | **83 files passed, 1 skipped; 1,075 passed** (1,045 before Step 5 + 30 new), 1 skipped. No test that passed before fails. |
| Type check / lint | 0 errors / 0 problems |
| `server.ts` | additions only |
| Staging outside the mirror tables | identical before/after |
| Production | untouched |

## 7. Next checkpoint (needs your approval)

**Step 6: admin review screen + read API.**
- A screen (admin only, server-enforced) to:
  - see snapshots, sync health and warnings, including the open AD46 issue;
  - view a snapshot as a grid with formatting, notes and merges;
  - open difference reports;
  - fetch now;
  - publish or reject with a reason, and roll back;
  - **confirm plan statuses** (D4).
- The read API Phase 2's advisor views will use.

Publishing stays a **manual click** (D2). I'd build it to work on staging only and stop before anyone publishes.
