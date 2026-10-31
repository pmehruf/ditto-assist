# Product Playbook Mirror — Fixed Ranges, Hidden Content, AD46 Recheck

**Date:** 2026-10-30. **Status:** Done on the branch, and tested. Nothing published, no advisor access, no production change, nothing committed. Existing mappings and plan statuses unchanged.

## 1. Fixed, explicitly configured source ranges

**One place to change them:** `src/server/playbookMirror/config.ts`, block "SOURCE RANGES":

```ts
export const MIRROR_TABS: MirrorTabConfig[] = [
  { title: "Ditto's Recommended Policies", range: "B1:AF56" },
  { title: "Recommendation specifics", range: "A1:G33" },
];
```

**What changed:**
- **One request only:** the mirror makes exactly one Google request, for exactly these ranges.
- **Scan removed:** the whole-tab scan, the "content outside the area" check, and the "used area plus a margin" ranges are gone. No automatic range detection or expansion remains anywhere.
- **Storage:** cells outside the configured range are never stored. Merge-filler cells are never created outside it.
- **Fail closed:**
  - a malformed range in the config;
  - Google returning data that doesn't start at the configured range.

  Either one rejects the snapshot.
- **Versioning:** the raw evidence now records the ranges requested (envelope `playbook-mirror-raw-v2`), and the parser version is `mirror-2026-10-30.3`. Older snapshots (v1, with scan) are still checked correctly by the independent checker.
- **When you change a range,** bump `MIRROR_PARSER_VERSION` next to it, so the next fetch makes a new snapshot.

**Dry run against the live sheet** (one read-only request; nothing stored; staging only read). Script `_scratch_playbook_migration/scripts/ranges_dry_run.ts`, output `_scratch_playbook_migration/output/ranges_dry_run.json`.

| Check | Result |
|---|---|
| Ranges requested | `'Ditto''s Recommended Policies'!B1:AF56`, `'Recommendation specifics'!A1:G33`: **1 request** |
| Where Google's data starts | main tab row 1, column B; tab 2 row 1, column A (matches) |
| Cells outside the configured ranges | **0** |
| Cells with a value / notes / links | 1,676 / 146 / 21. 1,676 is the earlier 1,698 minus column A's 22 cells, which are outside B1:AF56 by your choice. |
| Merges | main tab 45 (all except A2:A8, which is in column A); tab 2: 36 (those inside A1:G33) |
| Structure check against the accepted structure | **passed**: 29 plans, 54 categories, no problems |
| Independent reconciliation | **0 differences** |

**Consequence to be aware of:** with fixed ranges and no scan, if the sheet grows beyond B1:AF56 or A1:G33, the new content is **not** mirrored and nothing warns about it. For example, a new plan in column AG wouldn't be noticed. That follows from your decision to manage ranges by hand. A rename or edit **inside** the range is still caught.

## 2. Hidden rows and columns are never displayed

Both "hidden by the user" and "hidden by a filter" count as hidden. The sheet's own visibility decides; **there is no override**.

| Place | Behaviour now |
|---|---|
| Admin grid | The server doesn't send hidden rows' or columns' cells. A visible cell inside a merge whose anchor is hidden comes through blank. The screen lists only the hidden row and column numbers ("Hidden in the source sheet and not displayed: columns S; rows 13–18, 29, 30"). |
| Plans list (admin) | A plan whose column is hidden keeps its key, but its header isn't sent ("Column hidden in the source sheet — not displayed"). Today that's `care_senior_health_advantage` (column S). |
| Structure proposal (admin) | Same masking. Acceptance still uses the full data internally. |
| Structure-check messages | Never quote text from a hidden row or column, and never quote an accepted header. |
| Difference report | Changes in rows or columns hidden in **either** snapshot are only counted ("changes in hidden rows/columns (not shown)"), never listed. |
| Read API (advisor-facing, still admin-only) | Never serves a plan in a hidden column, even if confirmed and enabled. Never serves hidden rows. Doesn't list a category whose rows are all hidden. |
| Raw snapshot | Still stores everything with the visibility metadata, for verification and audit. Never rendered. |

Live dry run: column S's header and tab-2 row 13 are **not** displayable; 56 main-tab cells and 56 tab-2 cells are excluded from display. Column A isn't fetched at all now.

## 3. AD46 recheck (live sheet, read-only, 2026-10-30)

| Question | Finding |
|---|---|
| Does the picture exist in the live sheet now? | **Yes.** There is exactly **one** floating picture on "Ditto's Recommended Policies" (not inside a cell), 350 × 105 pixels, the same size as in the Excel copy. "Recommendation specifics" has **no** pictures. |
| Where is it? | Entirely within **AD46** (Care Supreme Enhance → Cover); it overlaps no other cell. AD46 itself is **empty**. |
| What does it show? | A small table headed **"Plan 2"**. A header row of values 3 Lac, 4 Lac, 5 Lac, 7 Lac, 10 Lac, 15 Lac. Under them: 3 Lac → 20 Lac, 50 Lac, 100 Lac · 4 Lac → 20 Lac · 5 Lac → 45 Lac, 95 Lac · 7 Lac → 93 Lac · 10 Lac → 90 Lac · 15 Lac → 85 Lac. I'm reporting the text as shown, without interpreting it. |
| Does the API see it? | **No.** The API returns AD46 with formatting only, no value. So this information is **not in the mirror**. |
| Status in the mirror | Unchanged: source issue `ad46_picture`, **open**, warning visible. **Not** classified as a publishing blocker; that stays your decision. Suggestion as before (D5): the product team types this table into the sheet as text, then a second person verifies the mirrored text. |

## 4. Exact files changed in this change

| File | Change |
|---|---|
| `src/server/playbookMirror/config.ts` | Fixed ranges in one "SOURCE RANGES" block; `parseRange` (fail closed); scan settings removed; parser version `.3` |
| `src/server/playbookMirror/sync.ts` | One ranged request only; envelope v2 with ranges; data-start check; scan and outside-area logic removed |
| `src/server/playbookMirror/transform.ts` | Optional range bounds: nothing stored or created outside them; unused outside-area scanner removed |
| `src/server/playbookMirror/reconcile.ts` | Reads v1 and v2 envelopes; range-aware (flags anything stored outside the configured range) |
| `src/server/playbookMirror/visibility.ts` | **New:** one shared rule for what may be displayed |
| `src/server/playbookMirror/adminService.ts` | Grid without hidden cells; hidden plans' headers withheld; filter-hidden rows count as hidden; read API category filter |
| `src/server/playbookMirror/diff.ts`, `verifyService.ts` | Hidden-row and column changes counted, never listed |
| `src/server/playbookMirror/structure.ts`, `structureService.ts` | Messages never quote hidden or accepted-header text; `proposalForDisplay` (masked view) |
| `server.ts` | Proposal route now serves `proposalForDisplay` (2 lines inside the mirror routes added earlier; whole-file diff vs `main` still additions only) |
| `src/pages/PlaybookMirrorAdminPage.tsx` | Grid skips hidden rows and columns, with spans counting visible ones only; hidden-plans wording |
| Tests | `visibility.test.ts` (**new**); updated: `transform`, `sync`, `structureService`, `reconcile`, `verifyService`, `publishService`, `readService`; fixture `syntheticSheet.ts` (+ `SYNTHETIC_TABS`) |

**Tests removed or replaced because the behaviour was deliberately removed:**
- 2 tests of the outside-area scanner;
- the "rejects content outside the mirrored area" sync test, replaced by "rejects data not starting at the configured range" and "never stores outside the range";
- the "merges from the whole-tab scan" test, replaced by the proposal-masking test.

**Not touched:** Product Assist, `playbookIngest.ts` and the rest of the current Playbook sync, knowledge tables, the existing Google connection, mappings, plan statuses, migrations, production.

## 5. Zero Regression Audit

| Check | Result |
|---|---|
| Full test suite | **87 files passed, 1 skipped; 1,116 passed**, 1 skipped (Step 6 end: 1,108). The only previously passing tests not still passing are the 4 deliberately removed or replaced above. |
| Type check (`tsc --noEmit`, whole project including tests) | **0 errors** |
| Lint (all mirror code, tests, admin page) | **0 problems** |
| Existing app files vs `main` | Same as at Step 6: `server.ts` +349/−0, `App.tsx` +21/−2 (2 extended lists), `schema.ts` +211/−0, `testUtils.ts` +19/−0, `googleOAuth.ts` +68/−0, `featurePermissions.ts` +16/−0, `repositories/index.ts` +12/−0. Knowledge-base sync, Product Assist page and the other existing files: no diff. |
| Staging database | **No writes in this change.** Fingerprint identical to the end of Step 6 (schema, Product Assist Playbook data, sheet resources, existing connection, migrations, mirror objects). |
| Mirror state | snapshots 1 (fetched) and 2 (verified) unchanged; published **0**; statuses confirmed **0**; plans shown to advisors **0** |
| Production | untouched |

**Correction to the Step 6 report:** it said the type check had 0 errors. That check ran *before* I added the Step 6 test files, and three of them didn't type-check (this project's TypeScript settings don't narrow `if (!r.ok)`). It's fixed in this change, and the type check is now genuinely 0 errors for the whole project.

## 6. Before any publishing or integration

- **Snapshot 2 was made with the old ranges** (A1:AR80, including column A). It should **not** be the snapshot that gets published. The next fetch would create snapshot 3 with the fixed ranges. Suggestion: reject snapshot 2 with reason "superseded by fixed ranges" once snapshot 3 is verified. Both stay as audit evidence.
- **AD46:** your decision on whether an open picture gap blocks publishing.
- **Statuses:** product-team confirmation, still pending.
