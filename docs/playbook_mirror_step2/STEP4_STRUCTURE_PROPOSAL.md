# Product Playbook Mirror — Step 4: Structure Proposal

**Status:** **Accepted as proposed** by mehruf.p@joinditto.in on 2026-10-30, in chat. Claude entered it on staging at 14:01 UTC through the app's own first-acceptance function. Before writing, it confirmed the proposal was byte-identical to the one reviewed below. Nothing is published or shown to advisors.

## Acceptance result (staging, 2026-10-30)

| Check | Result |
|---|---|
| Accepted plans / category entries | **29 / 54**, recorded by mehruf.p@joinditto.in |
| Suggested statuses stored (provisional, **0 confirmed**) | active 24, discontinued_fresh_porting 3, brochure_only 1, hidden 1 |
| Plans shown to advisors | **0** (the database won't allow it until a named person confirms a status) |
| Snapshot 2 structure check | **passed**: every plan found at its expected column (D…AF), every category entry at its expected rows (Add-ons 44–45) |
| Snapshot 1 | left as it was (older parser, not re-checked) |
| Published pointer | empty |
| Staging outside the mirror tables | identical before/after |

Statuses still need the product team's confirmation (D4) before any plan can be shown to advisors. That will be part of the admin screen (Step 6).

## 1. What happened on staging

- **Fetched snapshot 2** with the structure check switched on (read-only grant only). Status `fetched`. Structure check: **"no accepted structure yet"**, as designed.
- **Every merge is now recorded:** the whole-tab scan now includes merges (Finding 2 from Step 3b).
  - Main tab: **46**.
  - Tab 2: **147**, including the 105 empty ones far below the data.
  - All **193** match the spike. Every merged cell (69 + 163) points to its anchor.
  - The parser version was bumped (`mirror-2026-10-29.2`), which is why a new snapshot was made.
- **Independent check of snapshot 2** (separate code):
  - raw fingerprint matches;
  - **4,143 cells compared, 0 differences**;
  - merges and hidden flags identical;
  - live sheet **unchanged** since this morning (1,698 cells);
  - G29 = "50% to 100%";
  - AD46 still empty in the API, so its issue stays open.
- **Staging before/after:** everything outside the mirror tables is **identical** (schema, Product Assist Playbook data, existing Playbook connection, migrations).
- **Proposal built from snapshot 2:**
  - **29 plans, 0 without a reviewed key**;
  - **54 category entries** (55 rows; Add-ons spans rows 44–45), **0 without a reviewed key**;
  - **no duplicate keys**.

## 2. What accepting does (and doesn't do)

Accepting stores these two lists as the **approved structure**. From then on:
- Every new snapshot must match it exactly, or it is **rejected**.
- Plan columns are located by their **exact header text**, never by column letter. Inserting a column is fine; renaming or adding a header is not.
- Category rows may move, but labels and order must match.
- Hidden-flag changes pass but are marked **"needs review"**.

Accepting does **not**:
- confirm any plan status (all stay **provisional**, with no confirmer);
- make anything visible to advisors (`show_to_advisors = false` for all 29; the database refuses to show a plan before a named person confirms its status);
- publish anything, or change Product Assist.

Statuses below are **suggestions** taken from the header text or hidden flag, shown so the product team can confirm or correct them later (D4). Nothing about recommendation eligibility is inferred.

Acceptance is recorded with your email and the time. It is a one-time first acceptance; later changes will be a separate, reviewed action.

**Things to look at closely:**
- **S, Care Senior Health Advantage:** hidden in the sheet and empty, so suggested `hidden`.
- **R, Care Supreme Shine (Brochure):** suggested `brochure_only`.
- **G, P, Q:** suggested `discontinued_fresh_porting`.
- **Z, ReAssure 3.0:** "(Black Variant available with Ditto)" is a note, not a status, so suggested `active`.
- **Keys:** these become permanent identifiers, so check you're happy with the names (e.g. `care_ultimate_care` for column K "Ultimate Care").

## 3. The proposal (generated from snapshot 2; text exactly as in the sheet)

| # | Col | Exact header (`\n` marks a line break inside the cell) | Proposed key | Insurer | Display name | Proposed status (provisional) | Why suggested |
|---|---|---|---|---|---|---|---|
| 1 | D | `HDFC Ergo Optima Secure` | `hdfc_optima_secure` | HDFC Ergo | HDFC Ergo Optima Secure | **active** | No status note in the header |
| 2 | E | `HDFC Ergo Optima Super Secure` | `hdfc_optima_super_secure` | HDFC Ergo | HDFC Ergo Optima Super Secure | **active** | No status note in the header |
| 3 | F | `HDFC Ergo Optima Secure+` | `hdfc_optima_secure_plus` | HDFC Ergo | HDFC Ergo Optima Secure+ | **active** | No status note in the header |
| 4 | G | `HDFC Ergo Optima Restore \n(Discontinued for Fresh & Porting applications)` | `hdfc_optima_restore` | HDFC Ergo | HDFC Ergo Optima Restore | **discontinued_fresh_porting** | Header text says discontinued for fresh & porting |
| 5 | H | `HDFC Ergo Energy Silver` | `hdfc_energy_silver` | HDFC Ergo | HDFC Ergo Energy Silver | **active** | No status note in the header |
| 6 | I | `HDFC Ergo Arogya Sanjeevani` | `hdfc_arogya_sanjeevani` | HDFC Ergo | HDFC Ergo Arogya Sanjeevani | **active** | No status note in the header |
| 7 | J | `Care Supreme` | `care_supreme` | Care | Care Supreme | **active** | No status note in the header |
| 8 | K | `Ultimate Care` | `care_ultimate_care` | Care | Ultimate Care | **active** | No status note in the header |
| 9 | L | `Care Supreme Freedom` | `care_supreme_freedom` | Care | Care Supreme Freedom | **active** | No status note in the header |
| 10 | M | `Care Supreme Heart` | `care_supreme_heart` | Care | Care Supreme Heart | **active** | No status note in the header |
| 11 | N | `Care Freedom` | `care_freedom` | Care | Care Freedom | **active** | No status note in the header |
| 12 | O | ` Care Heart` | `care_heart` | Care | Care Heart | **active** | No status note in the header |
| 13 | P | `Care Care\n(Discontinued for Fresh & Porting applications)` | `care_care` | Care | Care Care | **discontinued_fresh_porting** | Header text says discontinued for fresh & porting |
| 14 | Q | `Care Advantage\n(Discontinued for Fresh & Porting applications)` | `care_advantage` | Care | Care Advantage | **discontinued_fresh_porting** | Header text says discontinued for fresh & porting |
| 15 | R | `Care Supreme Shine\n(Brochure)` | `care_supreme_shine` | Care | Care Supreme Shine | **brochure_only** | Header text says (Brochure) |
| 16 | S | `Care Senior Health Advantage` | `care_senior_health_advantage` | Care | Care Senior Health Advantage | **hidden** | Column is hidden in the sheet (proposal only; visibility is never inferred) |
| 17 | T | `Aditya Birla Activ Fit Plus/Preferred` | `abhi_activ_fit_plus_preferred` | Aditya Birla | Aditya Birla Activ Fit Plus/Preferred | **active** | No status note in the header |
| 18 | U | `Aditya Birla Activ Yuva` | `abhi_activ_yuva` | Aditya Birla | Aditya Birla Activ Yuva | **active** | No status note in the header |
| 19 | V | `Aditya Birla Activ One Max` | `abhi_activ_one_max` | Aditya Birla | Aditya Birla Activ One Max | **active** | No status note in the header |
| 20 | W | `Aditya Birla Activ One VYTL` | `abhi_activ_one_vytl` | Aditya Birla | Aditya Birla Activ One VYTL | **active** | No status note in the header |
| 21 | X | `Aditya Birla Activ One NXT` | `abhi_activ_one_nxt` | Aditya Birla | Aditya Birla Activ One NXT | **active** | No status note in the header |
| 22 | Y | `Niva Bupa ReAssure 2.0` | `niva_reassure_2_0` | Niva Bupa | Niva Bupa ReAssure 2.0 | **active** | No status note in the header |
| 23 | Z | `Niva Bupa ReAssure 3.0\n(Black Variant available with Ditto)` | `niva_reassure_3_0` | Niva Bupa | Niva Bupa ReAssure 3.0 | **active** | No status note in the header |
| 24 | AA | `Niva Bupa Aspire` | `niva_aspire` | Niva Bupa | Niva Bupa Aspire | **active** | No status note in the header |
| 25 | AB | `Niva Bupa Health Premia` | `niva_health_premia` | Niva Bupa | Niva Bupa Health Premia | **active** | No status note in the header |
| 26 | AC | `HDFC Ergo Medisure` | `hdfc_medisure` | HDFC Ergo | HDFC Ergo Medisure | **active** | No status note in the header |
| 27 | AD | `Care Supreme Enhance` | `care_supreme_enhance` | Care | Care Supreme Enhance | **active** | No status note in the header |
| 28 | AE | `Niva Bupa Recharge` | `niva_recharge` | Niva Bupa | Niva Bupa Recharge | **active** | No status note in the header |
| 29 | AF | `Care Enhance ` | `care_enhance` | Care | Care Enhance | **active** | No status note in the header |

| # | Rows | Exact category label (column B) | Exact sub-label (column C) | Proposed key |
|---|---|---|---|---|
| 1 | 2 | `Entry Age for Adults` | `Min` | `entry_age_adults.min` |
| 2 | 3 | `Entry Age for Adults` | `Max` | `entry_age_adults.max` |
| 3 | 4 | `Entry Age for Adults` | `Exit age` | `entry_age_adults.exit_age` |
| 4 | 5 | `Entry Age for Children` | `Min` | `entry_age_children.min` |
| 5 | 6 | `Entry Age for Children` | `Max` | `entry_age_children.max` |
| 6 | 7 | `Entry Age for Children` | `Exit age` | `entry_age_children.exit_age` |
| 7 | 8 | `FF Structure` | *(blank)* | `ff_structure` |
| 8 | 9 | `Variants` | *(blank)* | `variants` |
| 9 | 10 | `Waiting periods` | *(blank)* | `waiting_periods` |
| 10 | 11 | `Loadings` | *(blank)* | `loadings` |
| 11 | 12 | `Co- payment ` | `Yes/No` | `co_payment.yes_no` |
| 12 | 13 | `Co- payment ` | `Limits if there are any` | `co_payment.limits` |
| 13 | 14 | `Disease wise sub-limits` | `Yes/No` | `disease_sublimits.yes_no` |
| 14 | 15 | `Disease wise sub-limits` | `Limits if there are any` | `disease_sublimits.limits` |
| 15 | 16 | `Room rent restrictions` | `Yes/No` | `room_rent.yes_no` |
| 16 | 17 | `Room rent restrictions` | `Limits if there are any` | `room_rent.limits` |
| 17 | 18 | `Pre and post hospitalization` | *(blank)* | `pre_post_hospitalisation` |
| 18 | 19 | `Domiciliary` | *(blank)* | `domiciliary` |
| 19 | 20 | `Day Care` | *(blank)* | `day_care` |
| 20 | 21 | `AYUSH` | *(blank)* | `ayush` |
| 21 | 22 | `Modern treatments` | *(blank)* | `modern_treatments` |
| 22 | 23 | `Restoration` | `% of SI` | `restoration.pct_of_si` |
| 23 | 24 | `Restoration` | `Exhaustion` | `restoration.exhaustion` |
| 24 | 25 | `Restoration` | `Illness` | `restoration.illness` |
| 25 | 26 | `Restoration` | `Frequency` | `restoration.frequency` |
| 26 | 27 | `Consumables` | *(blank)* | `consumables` |
| 27 | 28 | `Bonus` | `NCB` | `bonus.ncb` |
| 28 | 29 | `Bonus` | `Loyalty` | `bonus.loyalty` |
| 29 | 30 | `Annual health Check-up` | `In- built / Add-on` | `annual_health_checkup.builtin_or_addon` |
| 30 | 31 | `Annual health Check-up` | `Can be used from ` | `annual_health_checkup.usable_from` |
| 31 | 32 | `Annual health Check-up` | `Cashless / Reimbursement` | `annual_health_checkup.cashless_or_reimbursement` |
| 32 | 33 | `Annual health Check-up` | `Limits` | `annual_health_checkup.limits` |
| 33 | 34 | `OPD` | `In- built / Add-on` | `opd.builtin_or_addon` |
| 34 | 35 | `OPD` | `Can be used from ` | `opd.usable_from` |
| 35 | 36 | `OPD` | `Coverage` | `opd.coverage` |
| 36 | 37 | `OPD` | `Cashless / Reimbursement` | `opd.cashless_or_reimbursement` |
| 37 | 38 | `OPD` | `Limits` | `opd.limits` |
| 38 | 39 | `Maternity` | *(blank)* | `maternity` |
| 39 | 40 | `Ambulance` | `Road` | `ambulance.road` |
| 40 | 41 | `Ambulance` | `Air` | `ambulance.air` |
| 41 | 42 | `Organ Donor` | *(blank)* | `organ_donor` |
| 42 | 43 | `Special features` | *(blank)* | `special_features` |
| 43 | 44–45 | `Add-ons` | *(blank)* | `add_ons` |
| 44 | 46 | `Cover` | *(blank)* | `cover` |
| 45 | 47 | `Premiums` | `Zonal Premium` | `premiums.zonal` |
| 46 | 48 | `Premiums` | `Age bands` | `premiums.age_bands` |
| 47 | 49 | `Premiums` | `Other details` | `premiums.other_details` |
| 48 | 50 | `Fitness & Wellness Benefits` | `Benefit Overview` | `fitness_wellness.benefit_overview` |
| 49 | 51 | `Fitness & Wellness Benefits` | `Eligibility & Earning` | `fitness_wellness.eligibility_earning` |
| 50 | 52 | `Fitness & Wellness Benefits` | `Rewards & Calculation` | `fitness_wellness.rewards_calculation` |
| 51 | 53 | `Fitness & Wellness Benefits` | `Utilisation & Conditions` | `fitness_wellness.utilisation_conditions` |
| 52 | 54 | `Porting` | *(blank)* | `porting` |
| 53 | 55 | `Migration` | *(blank)* | `migration` |
| 54 | 56 | `Other Points\n\nMoratorium period is now reduced from 8 years to 5 years` | *(blank)* | `other_points` |

**Tab 2 ("Recommendation specifics") checks applied by the structure check:**
- Headers A1 `SNo.`, B1 `Specific Use cases`, D1 `Recommendation`, G1 `Customer wants more options`, exact.
- Column C alternates `Policy` / `Add-ons` from row 3.

The use-case to plan mapping is Phase 2 (it needs the product team's mapping).

## 4. What was built (branch, not committed)

| File | Purpose |
|---|---|
| `src/server/playbookMirror/structure.ts` | Extract exact plan headers and category rows (following merges); propose keys and provisional statuses; check a snapshot against the accepted structure (fail closed) |
| `src/server/playbookMirror/structureService.ts` | Run the check and record it on the snapshot; build the proposal; first-run acceptance. Refuses if any entry lacks a reviewed key or any key is duplicated. |
| `src/server/db/repositories/playbookMirrorStructureRepository.ts` (+ index) | Accepted lists (first acceptance only, all provisional and hidden from advisors); check results; previous hidden flags |
| `src/server/playbookMirror/sync.ts`, `transform.ts`, `config.ts` | Every new snapshot is structure-checked; merges come from the whole-tab scan (all of them), and a snapshot is rejected if the scan misses a merge the ranged read reported |
| `server.ts` | +61 lines, 0 changed. `GET /api/playbook-mirror/snapshots/:id/structure-proposal` (Viewer), `GET /api/playbook-mirror/structure` (Viewer), `POST /api/playbook-mirror/structure/accept` (Editor), `POST /api/playbook-mirror/snapshots/:id/check-structure` (Editor). All checked server-side on `product_playbook_admin`. |
| Tests (new) | structure (13), structure service + sync on a local database (4); synthetic data only |

## 5. Zero Regression Audit evidence

| Check | Result |
|---|---|
| Full test suite | **81 files passed, 1 skipped; 1,045 passed** (1,028 before + 17 new), 1 skipped |
| Type check / lint | 0 errors / 0 problems |
| `server.ts` | additions only |
| Staging outside the mirror tables | identical before/after |
| Published pointer / accepted plans / accepted features | 0 / 0 / 0 |
| Production | untouched |

## 6. Your decision

- **Accept as proposed:** I record the acceptance on staging with your email, re-run the check on snapshot 2 (it should pass), and report.
- **Request changes:** tell me which keys or suggested statuses to change. Statuses can also be left as they are now and confirmed later by the product team, since they stay provisional either way.
