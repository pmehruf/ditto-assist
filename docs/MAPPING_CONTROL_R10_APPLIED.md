# R10 corrections: applied batch (Phase 5)

Owner approval: given in chat on 2026-10-05 for the existing R10 findings list (Phase 1 report). Scope applied: items marked High confidence with a plan-wording match. Items marked "needs decision", Low confidence, or "wording silent" were NOT applied (see "Not applied").

All changes were made through Mapping Control → Plans & Questions → Category Mapping, with the impact preview, change-control fields and confirmation. Each save is one change set in Mapping Control → History and can be undone there with **Undo**.

## Applied on staging (2026-10-05)

| ID | Plan | Category | Before | After | Basis |
|----|------|----------|--------|-------|-------|
| A1 | Activ Fit Preferred | Kidney / Renal / Urinary | Q19 "History of Renal Artery Stenosis" | Q6 "Disease of Kidney, Digestive tract, Liver …" | Q6 names kidney disease; Q19 is one narrow history item |
| A2 | Activ Fit Preferred | Diabetes / Blood Sugar | Q16 "Diabetic Foot" | Q2 "Diabetes, High blood pressure, High Cholesterol, Anaemia …" | Q2 names diabetes; Q16 is one complication |
| A3 | Activ Fit Preferred | Hypertension / Blood Pressure | Q18 "Malignant Hypertension" | Q2 | Q2 names High blood pressure; Q18 is the severe form only |
| A7 | Activ One Max | Blood Disorder | not mapped (AI step) | Q11 "HIV / SLE / Rheumatoid Arthritis … bleeding or clotting disorders or any other diseases of Blood …" | Q11 names blood disorders |
| A8 | Activ One Max | Eye / ENT (Ear, Nose & Throat) | not mapped (AI step) | Q12 "Disease or disorder of eye, ear, nose or throat …" | Q12 names eye, ear, nose, throat |
| C-AOM | Activ One Max | Systemic Granulomatous Disease | not mapped (AI step) | Q11 | Q11 names Sarcoidosis |

Change sets: Activ Fit Preferred (A1–A3) = 1 change set, 102 lookups affected; Activ One Max (A7, A8, C-AOM) = 1 change set, 81 lookups affected. Both were rated "High impact" by the preview and confirmed with the approval recorded as "Mehruf P (chat approval of R10 batch, 2026-10-05)".

## Staging verification (live lookups after the change)

| Plan | Condition | After | Before (from the preview) |
|------|-----------|-------|---------------------------|
| Activ Fit Preferred | acute kidney injury | Q6 | Q19 |
| Activ Fit Preferred | preeclampsia | Q2 | Q18 |
| Activ Fit Preferred | diabetes mellitus | Q2 | Q16 |
| Activ Fit Preferred | hypertension | Q2 | Q18 |
| Activ One Max | adenoid | Q12 | sent to the AI step |
| Activ One Max | meniere disease | Q12 | sent to the AI step |
| Activ One Max | sarcoidosis | Q11 | sent to the AI step |
| Activ One Max | anemia | Q11 | sent to the AI step |
| Aspire / Reassure 2.0 / Optima Secure | hypertension / thalassemia | unchanged | unchanged |

Staging is otherwise unchanged: Aspire, Care Supreme, Care Supreme V2, Optima Secure and Reassure 2.0 keep the same mapped counts (24 / 22 / 14 / 24 / 23). No temporary data remains.

## Not applied, with reasons

| ID | Reason |
|----|--------|
| A10 Reassure 2.0 Blood → catch-all | The preview showed 1 lookup (G6PD deficiency) would lose its specific question and fall to "Others", and 51 would move from the AI step to "Others". Not applied. Needs your decision. |
| A4 neuro → Q9 (Activ Fit Preferred) | Q10 is a competing candidate; the findings list put it on the needs-decision list. |
| A5, A6, A9 | Low/Medium confidence; wording is silent or the question covers test findings, not disease. |
| All "needs decision" items (B, C, D lists, E, F) | R10 forbids proposing an answer for Business Decision items. |

## Undo (staging or production)

Mapping Control → History → find the change set labelled "Edited a plan" with the reason starting "R10 correction (owner-approved)" → **Undo**.

## Production: exact batch to apply after you approve

Re-verified read-only against production on 2026-10-05: every precondition below still holds.

| Plan | Category | Current (production) | Set to |
|------|----------|---------------------|--------|
| Activ Fit Preferred | Kidney / Renal / Urinary | Q19 | Q6 |
| Activ Fit Preferred | Diabetes / Blood Sugar | Q16 | Q2 |
| Activ Fit Preferred | Hypertension / Blood Pressure | Q18 | Q2 |
| Activ One Max | Blood Disorder | not mapped | Q11 |
| Activ One Max | Eye / ENT (Ear, Nose & Throat) | not mapped | Q12 |
| Activ One Max | Systemic Granulomatous Disease | not mapped | Q11 |

Steps (production, two saves):
1. Mapping Control → Plans & Questions → Category Mapping → select **Activ Fit Preferred** → Edit → set the three rows above → Save Category Mapping.
2. In the dialog: Reason = "R10 correction (owner-approved): A1 kidney, A2 diabetes, A3 hypertension on Activ Fit Preferred now use the plan's general questions (Q6, Q2, Q2) that name them"; Change category = Regression fix; Business-Decision check = "approved by" with your name; tick the confirmation; Save change. Expect "High impact", about 100 lookups.
3. Repeat for **Activ One Max** (Blood Disorder → Q11, Eye / ENT → Q12, Systemic Granulomatous Disease → Q11). Expect "High impact", about 80 lookups.
4. Check afterwards: Declaration Assist on Activ Fit Preferred for "acute kidney injury" (Q6) and on Activ One Max for "adenoid" (Q12).

Production plan data differs from staging (production still has Care Supreme; it has no Care Supreme V2), so the numbers in the preview may differ slightly from the staging numbers above. Compare the preview with this table before confirming.

## Applied on production (2026-10-05) — Phase 5 closed

Approved by Mehruf P in chat for exactly these six corrections; A10 and every skipped / needs-decision item were not applied.

| Change set | Plan | Corrections | Preview | Advisor lookups of these, last 90 days |
|------------|------|-------------|---------|-----------------------------------------|
| #32 | Activ Fit Preferred | A1 kidney Q19→Q6, A2 diabetes Q16→Q2, A3 hypertension Q18→Q2 | High impact, 116 lookups, 1 plan, no specificity loss | 0 |
| #33 | Activ One Max | A7 blood →Q11, A8 eyeEnt →Q12, sarcoidosis →Q11 | High impact, 94 lookups, 1 plan, no specificity loss | 97 |

Undo: Mapping Control → History → #33 then #32 → Undo.

### Production verification (read-only, after saving)

- Mapped plan data: Activ Fit Preferred kidney=Q6, diabetes=Q2, hypertension=Q2; Activ One Max blood=Q11, eyeEnt=Q12, sarcoidosis=Q11.
- Live lookups: Activ Fit Preferred acute kidney injury / chronic kidney disease → Q6, diabetes mellitus → Q2, hypertension → Q2; Activ One Max adenoid / meniere disease → Q12, sarcoidosis → Q11, anemia → Q11.
- Unaffected plans: mapped counts unchanged (Aspire 24, Care Supreme 16, Optima Secure 24, Reassure 2.0 23); Aspire / Optima Secure / Care Supreme / Reassure 2.0 lookups return the same questions as before.
- Both previews reported only the plan being saved ("across 1 plan") and no "loses a specific question" warning, so no other plan or condition was affected.
- Not run: the offline baseline-equality tool against production (production database reads from this session are blocked); the preview's measured before/after comparison is the evidence for the regression check.
