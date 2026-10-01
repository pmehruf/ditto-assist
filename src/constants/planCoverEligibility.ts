/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plan-wise Sum Insured eligibility (2026-09).
 *
 * Single source of truth for which cover amounts (Sum Insured, in lakhs)
 * are valid for each plan, keyed by the plan's existing `PlanDef.id` from
 * coverageProjectionEngine.ts. This is a UI eligibility/validation concern
 * only -- it must stay separate from the calculation engine and must never
 * be imported by it.
 *
 * Values are transcribed exactly from the advisor-provided spec. `Cr`
 * labels are converted to lakhs (1Cr = 100L) so they line up with the
 * existing SI_PRESETS representation in CoverageProjectionStudioPage.tsx.
 * Do not add, remove, or "correct" any value here without an explicit
 * updated spec -- some plans below include amounts (e.g. 2L, 3L, 7.5L,
 * 30L, 75L, 3Cr+) that have no corresponding chip in the current fixed
 * SI_PRESETS set; those simply can never show as enabled today, since the
 * existing Sum Insured chip options must not be invented or modified.
 */
export const PLAN_COVER_ELIGIBILITY_LAKHS: Record<string, number[]> = {
  // HDFC Ergo
  hdfc_secure: [5, 10, 15, 20, 25, 50, 100, 200], // Optima Secure
  hdfc_super_secure: [10, 15, 20, 25, 50, 100, 200], // Optima Super Secure
  hdfc_secure_plus: [10, 15, 20, 25, 50, 100, 200], // Optima Secure+

  // Care Health
  care_supreme: [5, 7, 10, 15, 25, 50, 100], // Care Supreme
  care_ultimate: [5, 7, 10, 15, 20, 25, 50, 100], // Ultimate Care
  care_freedom: [3, 5, 7, 10], // Freedom Care
  care_heart: [3, 5, 7, 10], // Heart Care
  care_care: [5, 7, 10, 15, 20, 25, 30, 40, 50, 60, 75], // Care Care

  // Aditya Birla
  ab_yuva: [5, 10, 15, 20, 25, 50, 100], // Activ Yuva
  ab_max: [2, 3, 4, 5, 7, 10, 15, 20, 25, 50, 75, 100, 200, 300, 400, 500, 600], // Activ One MAX
  ab_nxt: [2, 3, 4, 5, 7, 10, 15, 20, 25, 50, 75, 100, 200, 300, 400, 500, 600], // Activ One NXT

  // Niva Bupa
  nb_reassure2: [5, 7.5, 10, 15, 20, 25, 50, 100], // ReAssure 2.0
  nb_reassure3: [5, 10], // ReAssure 3.0 (Black)
  nb_aspire: [3, 5, 7.5, 10, 15, 20, 25, 50, 100], // Aspire
};

/**
 * True only when `siLakhs` is one of `planId`'s exact eligible amounts.
 * Returns false for an unknown/empty planId so "no plan selected" always
 * means "nothing is eligible" -- callers don't need a separate check.
 */
export function isCoverAmountEligible(planId: string | undefined, siLakhs: number): boolean {
  if (!planId) return false;
  const eligible = PLAN_COVER_ELIGIBILITY_LAKHS[planId];
  if (!eligible) return false;
  return eligible.includes(siLakhs);
}
