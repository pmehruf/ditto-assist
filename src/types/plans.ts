/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlanRestriction } from "../types";

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
  /** @deprecated superseded by `restrictions` below (Plan-Specific
   * Restrictions, 2026-08) — see types.ts's PlanConfig doc comment. */
  overrides?: { excludePrediabetes?: boolean; requiresInsulinForDiabetes?: boolean; bypassBenignTumors?: boolean };
  /** This plan's active Plan-Specific Restrictions, embedded server-side by
   * GET /api/plan-configs (server.ts) from the plan_restrictions table —
   * merged into planConfigs[planName].restrictions in App.tsx so the
   * client-side deterministic path (executeLookupAll) sees the same live
   * restriction data /api/match applies server-side. Optional/defaults to
   * [] since it postdates plan_configs — older cached responses won't have
   * it set. */
  restrictions?: PlanRestriction[];
  /** Takes this plan out of service for advisors — see schema.ts's
   * plan_configs.disabled comment. Optional/defaults to false since it
   * postdates plan_configs (migration 0036) — older rows fetched before a
   * re-save won't have it set client-side. */
  disabled?: boolean;
  /** Genuine, permanent-looking removal (Plan Management's Delete action) —
   * see schema.ts's plan_configs.removed comment. Every consumer of
   * dbPlanConfigs must filter these out; the row is kept only so a
   * built-in plan's removal survives a page reload. */
  removed?: boolean;
  /** Shown to the advisor in the declaration dropdown once they select a
   * disabled plan — why it's disabled and/or what to do instead. */
  disabledNote?: string | null;
  addedBy: string;
}
