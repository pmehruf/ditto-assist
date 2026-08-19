/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DraftPlan {
  name: string;
  submittedBy: string;
  submittedAt: string;
  status: "Pending Approval" | "Approved";
  testReport?: string;
  questions: string[];
}

export type PlanQuestionTag = "Specific" | "Umbrella" | "Catch-all";

export interface PlanQuestionEntry {
  text: string;
  tag: PlanQuestionTag;
}

/** One entry in a plan's Specific Illness List — the same shape the
 * hardcoded SPECIFIC_ILLNESSES dictionary in App.tsx already uses for the
 * 4 built-in plans, now editable per-plan from the Add/Edit Plan wizard and
 * persisted in Postgres alongside `questions`. */
export interface SpecificIllnessEntry {
  category?: string;
  illness: string;
}

/** A plan's declaration questionnaire as stored in Postgres (plan_configs
 * table) and served by /api/plan-configs — the live source of truth the
 * Plan Management page reads/writes, and that /api/match merges on top of
 * the hardcoded getPlanConfig() defaults (types.ts). */
export interface DbPlanConfigEntry {
  planName: string;
  insurerName: string;
  questions: PlanQuestionEntry[];
  categoryMap: Record<string, string>;
  anyOther: string;
  hasUmbrella: boolean;
  umbrellaQuestions: string[];
  /** This plan's own Specific Illness List — matched against a looked-up
   * PED (via matchesPhrase in specificIllnessEngine.ts) additively
   * alongside the legacy hardcoded MASTER_ILLNESSES catalog. Optional/
   * defaults to [] since it postdates plan_configs (migration 0011) —
   * older rows fetched before a re-save won't have it set client-side. */
  specificIllnesses?: SpecificIllnessEntry[];
  overrides?: { excludePrediabetes?: boolean; requiresInsulinForDiabetes?: boolean; bypassBenignTumors?: boolean };
  /** Takes this plan out of service for advisors — see schema.ts's
   * plan_configs.disabled comment. Optional/defaults to false since it
   * postdates plan_configs (migration 0036) — older rows fetched before a
   * re-save won't have it set client-side. */
  disabled?: boolean;
  /** Shown to the advisor in the declaration dropdown once they select a
   * disabled plan — why it's disabled and/or what to do instead. */
  disabledNote?: string | null;
  addedBy: string;
}
