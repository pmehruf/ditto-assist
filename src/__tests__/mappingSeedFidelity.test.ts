/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LEGACY_RULE_SEED } from "../mapping/legacyRuleSeed";

/**
 * Gate G1 — rule fidelity. The seeded routing rules are the legacy engine's
 * regexes, copied verbatim. This asserts every seeded regex still exists,
 * byte-for-byte, as a literal in src/engine.ts (the untouched migration
 * oracle), and that the pipeline order is the legacy order.
 */

const engineSource = readFileSync(new URL("../engine.ts", import.meta.url), "utf8");

function collectRegexSpecs(node: unknown, out: Array<{ re: string; flags: string }> = []) {
  if (Array.isArray(node)) node.forEach((n) => collectRegexSpecs(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.re === "string") out.push({ re: o.re, flags: typeof o.flags === "string" ? o.flags : "" });
    // A findQ entry is a regex source too.
    if (typeof o.findQ === "string") out.push({ re: o.findQ, flags: typeof o.flags === "string" ? o.flags : "" });
    for (const v of Object.values(o)) collectRegexSpecs(v, out);
  }
  return out;
}

/**
 * Seeded conditions whose legacy form is not a regex literal but an exactly
 * equivalent string test. Each entry names the legacy expression that must
 * still exist in engine.ts.
 */
const EQUIVALENT_LEGACY_FORMS: Record<string, string> = {
  "/nervous/i": `.toLowerCase().includes("nervous")`,
};

describe("legacy rule seed fidelity (G1)", () => {
  it("every seeded regex literal exists verbatim in the legacy engine source", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const rule of LEGACY_RULE_SEED) {
      for (const spec of collectRegexSpecs(rule.definition)) {
        checked++;
        const literal = `/${spec.re}/${spec.flags}`;
        const equivalent = EQUIVALENT_LEGACY_FORMS[literal];
        if (equivalent !== undefined) {
          if (!engineSource.includes(equivalent)) missing.push(`${rule.ruleKey}: legacy form ${equivalent} not found`);
          continue;
        }
        if (!engineSource.includes(literal)) missing.push(`${rule.ruleKey}: ${literal.slice(0, 120)}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

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
