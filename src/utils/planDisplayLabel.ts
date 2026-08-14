/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cosmetic-only overrides for how a plan's name is DISPLAYED in the
 * Declaration Assistant's plan picker — the underlying plan key (used as
 * the map key everywhere else: categoryMap, plan_configs.planName,
 * ped_repository lookups, search history, flagged issues, etc.) is never
 * touched. "Optima Secure" and "Optima Secure Plus" share an identical
 * declaration questionnaire, so the dropdown shows both names on one
 * option rather than requiring a second, fully-duplicate plan entry.
 */
const PLAN_DISPLAY_LABEL_OVERRIDES: Record<string, string> = {
  "Optima Secure": "Optima Secure / Secure +",
};

/** Resolves the label to show in the plan picker for a given plan key —
 * falls back to the plan key itself for every plan without an override. */
export function getPlanDisplayLabel(planKey: string): string {
  return PLAN_DISPLAY_LABEL_OVERRIDES[planKey] || planKey;
}
