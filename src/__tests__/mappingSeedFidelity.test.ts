/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { LEGACY_RULE_SEED } from "../mapping/legacyRuleSeed";

/**
 * Gate G1 — rule fidelity. The seeded routing rules are the original engine's rules, copied verbatim at the Phase 2
 * migration (the engine itself was removed in Phase 6; the frozen baselines prove the behaviour). This keeps the seed
 * data's structure honest: unique rule keys, the original stage order, shield order and post-guard order.
 */

describe("legacy rule seed fidelity (G1)", () => {
  it("rule keys are unique", () => {
    const keys = LEGACY_RULE_SEED.map((r) => r.ruleKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("classification steps run in the legacy stage order, with strictly increasing positions", () => {
    const order = ["plan_override", "firewall", "plan_rule", "shield", "wording", "dictionary", "plan_decision", "family", "generic"];
    const steps = LEGACY_RULE_SEED.filter((r) => r.stage !== "post_guard").sort((a, b) => a.position - b.position);
    const positions = steps.map((s) => s.position);
    expect(new Set(positions).size).toBe(positions.length);
    const stageIndexes = steps.map((s) => order.indexOf(s.stage));
    expect(stageIndexes.every((i) => i >= 0)).toBe(true);
    expect([...stageIndexes].sort((a, b) => a - b)).toEqual(stageIndexes);
  });

  it("keeps the legacy shield order A–I and the four plan-specific rules", () => {
    const shields = LEGACY_RULE_SEED.filter((r) => r.stage === "shield").sort((a, b) => a.position - b.position).map((r) => r.ruleKey.split(".")[1][0]);
    expect(shields).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    const planRules = LEGACY_RULE_SEED.filter((r) => r.stage === "plan_rule").map((r) => r.planScope).sort();
    expect(planRules).toEqual(["Activ Fit Preferred", "Activ Fit Preferred", "Care Supreme", "Optima Secure"]);
  });

  it("post-guards keep the legacy order", () => {
    const guards = LEGACY_RULE_SEED.filter((r) => r.stage === "post_guard").sort((a, b) => a.position - b.position).map((r) => r.ruleKey);
    expect(guards).toEqual(["guard.diabetes_restriction", "guard.rheumatoid_reroute", "guard.systemic_autoimmune_containment"]);
  });
});
