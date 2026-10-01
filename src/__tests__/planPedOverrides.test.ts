/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { getPlanConfig, type PlanConfig, type PlanPedOverride } from "../types";
import { classifyDeterministic, applyPostGuards, sanitizeOutput, finalizeOutput } from "../engine";

const SLEEP_Q = "Nervous, Psychiatric or Mental or Sleep disorder?";
const LUNG_Q = "Tuberculosis / Asthma or any other Lung disorder?";

const osaOverride: PlanPedOverride = {
  pedId: 2,
  pedName: "Obstructive sleep apnea",
  aliases: ["obstructive sleep apnea", "obstructive sleep apnoea", "sleep apnea", "osa"],
  targetQuestion: SLEEP_Q,
  categoryKey: null,
  reason: "This plan has a dedicated Sleep disorder question.",
};

function optima(overrides: PlanPedOverride[] = [osaOverride]): PlanConfig {
  return { ...getPlanConfig()["Optima Secure"], pedOverrides: overrides };
}

function lookup(ped: string, config: PlanConfig, plan = "Optima Secure") {
  const out = classifyDeterministic(ped, plan, config);
  expect(out).not.toBeNull();
  return finalizeOutput(applyPostGuards(sanitizeOutput(out, ped, config), ped, plan, config), ped, config, config.questions);
}

describe("Plan-specific PED mappings (plan_overrides → applyPlanPedOverride)", () => {
  it("without an override, OSA follows its Respiratory category on Optima Secure", () => {
    expect(lookup("osa", optima([])).matched_question).toBe(LUNG_Q);
  });

  it("an override pins OSA (and its aliases) to the plan's Sleep disorder question", () => {
    for (const ped of ["osa", "OSA", "Sleep Apnea", "obstructive sleep apnoea"]) {
      const result = lookup(ped, optima());
      expect(result.matched_question).toBe(SLEEP_Q);
      expect(result.match_type).toBe("P1");
      expect(result.explanation).toContain("plan-specific PED mapping");
    }
  });

  it("matches the PED inside free text", () => {
    expect(lookup("OSA since 2019 on CPAP", optima()).matched_question).toBe(SLEEP_Q);
  });

  it("only affects the plan it was added to", () => {
    const careSupreme = { ...getPlanConfig()["Care Supreme"], pedOverrides: [] };
    expect(lookup("osa", careSupreme, "Care Supreme").matched_question).not.toBe(SLEEP_Q);
  });

  it("is ignored when its target question no longer exists on the plan", () => {
    const stale = { ...osaOverride, targetQuestion: "A question that was reworded?" };
    expect(lookup("osa", optima([stale])).matched_question).toBe(LUNG_Q);
  });

  it("falls back to the override's category when it has no target question (legacy rows)", () => {
    const legacy = { ...osaOverride, targetQuestion: null, categoryKey: "psychiatric" };
    expect(lookup("osa", optima([legacy])).matched_question).toBe(SLEEP_Q);
  });
});
