/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createMappingTestEnv, fixtureDump, type MappingTestEnv } from "./helpers/mappingTestDb";
import { loadMappingSnapshot } from "../server/mappingSnapshot";
import { evaluateWorld } from "../mapping/impact";
import { runDeterministicPipeline } from "../mapping/routingEngine";
import { RESULT_LABEL, pedNamedInQuestion, resultKind } from "../utils/resultKind";
import { getLookupResultInfo } from "../utils/matchTier";

/**
 * Result names (Direct match, Category match, Fallback, AI generated) with real examples from the production data
 * the engine is tested against. A category route must never be shown as a Direct match, whatever its internal type.
 */

let env: MappingTestEnv;
let world: { snapshot: Awaited<ReturnType<typeof loadMappingSnapshot>>; plans: MappingTestEnv["plans"] };
beforeAll(async () => {
  env = await createMappingTestEnv();
  world = { snapshot: await loadMappingSnapshot(env.repos, await env.repos.mappingState.getVersion()), plans: env.plans };
}, 60_000);

const outcome = (plan: string, term: string) => evaluateWorld(world as never, [term], [plan]).get(`${plan}\u0000${term}`)!;
const raw = (plan: string, term: string) => runDeterministicPipeline(term, plan, env.plans.get(plan)!, world.snapshot);

describe("result names from the real engine", () => {
  it("Direct match: the condition itself is listed in the plan's question", () => {
    const o = outcome("Optima Secure", "asthma");
    expect(o.matchType).toBe("P0");
    expect(o.decidedBy).toBe("primitive.p0_wording");
    expect(o.kind).toBe("direct");
    expect(RESULT_LABEL[o.kind]).toBe("Direct match");
    expect(o.question!.toLowerCase()).toContain("asthma");
  });

  it("Category match: Appendix is not named by any question, but a question covers the digestive system", () => {
    const plan = "Optima Secure";
    const o = outcome(plan, "appendix");
    expect(o.kind).toBe("category");
    expect(o.question!.toLowerCase()).not.toContain("appendix");
    expect(o.question!.toLowerCase()).toContain("digestive");
    const anyNamed = env.plans.get(plan)!.questions.some((q) => /appendix/i.test(q));
    expect(anyNamed).toBe(false);
  });

  it("a category-based plan-specific mapping is a Category match unless its question itself names the condition", () => {
    const categoryPins = (fixtureDump.planOverrides as Array<{ planName: string; pedId: number; categoryKey: string | null; targetQuestion: string | null }>).filter((p) => p.categoryKey && !p.targetQuestion);
    expect(categoryPins.length).toBeGreaterThan(0);
    let checked = 0;
    let unnamed = 0;
    for (const pin of categoryPins.slice(0, 40)) {
      const ped = (fixtureDump.pedRepository as Array<{ id: number; canonicalName: string }>).find((x) => x.id === pin.pedId);
      if (!ped || !env.plans.has(pin.planName)) continue;
      const { result, trace } = raw(pin.planName, ped.canonicalName);
      if (!result || trace.decidedBy !== "primitive.plan_override") continue;
      const o = outcome(pin.planName, ped.canonicalName);
      expect(result.match_type === "P1" || result.match_type === "FALLBACK").toBe(true);
      const named = pedNamedInQuestion(ped.canonicalName, result.matched_question, env.plans.get(pin.planName)!.anyOther);
      // Direct match only when the chosen question itself names the condition; otherwise by what the engine chose.
      expect(o.kind).toBe(named ? "direct" : result.match_type === "P1" ? "category" : "fallback");
      if (!named) unnamed++;
      // The impact gate still counts a plan-specific mapping as P0 (unchanged); only the shown name differs.
      if (result.match_type === "P1") expect(o.tier).toBe("P0");
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(unnamed).toBeGreaterThan(0);
  });

  it("a result the engine types P1 is a Direct match when the chosen question itself names the condition", () => {
    for (const term of ["ulcer", "Obstructive sleep apnea"]) {
      const { result } = raw("Activ Fit Preferred", term);
      expect(result!.match_type, term).toBe("P1"); // the engine type is not changed
      expect(pedNamedInQuestion(term, result!.matched_question), term).toBe(true);
      const o = outcome("Activ Fit Preferred", term);
      expect(o.matchType, term).toBe("P1");
      expect(o.kind, term).toBe("direct");
      expect(getLookupResultInfo(result!.match_type, "Deterministic Engine", { ped: term, question: result!.matched_question, anyOther: env.plans.get("Activ Fit Preferred")!.anyOther }).label).toBe("Direct match");
    }
    // Same plan, same question, but the condition is not literally listed: still a Category match.
    const { result } = raw("Activ Fit Preferred", "sleep apnea");
    expect(pedNamedInQuestion("sleep apnea", result!.matched_question)).toBe(false);
    expect(outcome("Activ Fit Preferred", "sleep apnea").kind).toBe("category");
  });

  it("Fallback: the result is the plan's Others question; Umbrella questions are a separate list", () => {
    const plan = "Optima Secure";
    const config = env.plans.get(plan)!;
    const { result } = raw(plan, "typhoid fever");
    expect(result!.match_type).toBe("FALLBACK");
    expect(result!.matched_question).toBe(config.anyOther);
    expect(result!.secondary_recommendation!.length).toBeGreaterThan(0);
    expect(result!.secondary_recommendation).not.toContain(result!.matched_question);
    expect(outcome(plan, "typhoid fever").kind).toBe("fallback");
  });

  it("Umbrella questions can also accompany a category match (they are not exclusive to Fallback)", () => {
    const { result } = raw("Optima Secure", "angioplasty");
    expect(result!.match_type).toBe("P1");
    expect(result!.secondary_recommendation!.length).toBeGreaterThan(0);
  });

  it("not a condition and unresolved", () => {
    expect(outcome("Optima Secure", "pregnancy").kind).toBe("notCondition");
    expect(resultKind(null)).toBe("ai");
  });
});

describe("Lookup result names", () => {
  it("names a result by what the defined rules found, and AI answers as AI generated", () => {
    expect(getLookupResultInfo("P0", "Deterministic Engine").label).toBe("Direct match");
    expect(getLookupResultInfo("P1", "Deterministic Engine").label).toBe("Category match");
    expect(getLookupResultInfo("FALLBACK", "Deterministic Engine").label).toBe("Fallback");
    expect(getLookupResultInfo("P1", "Live Gemini API").label).toBe("AI generated");
    expect(getLookupResultInfo("FALLBACK", "AI Memory (Approved)").label).toBe("AI generated");
    expect(getLookupResultInfo("ESCALATE", "Live Gemini API").label).toBe("Needs clarification");
    expect(getLookupResultInfo("NON_AILMENT", "Deterministic Engine").label).toBe("Not a condition");
  });

  it("Direct match and Category match are primary; Fallback is secondary; no Level 1/2/3 wording", () => {
    expect(getLookupResultInfo("P0", "Deterministic Engine").role).toBe("Primary result");
    expect(getLookupResultInfo("P1", "Deterministic Engine").role).toBe("Primary result");
    expect(getLookupResultInfo("FALLBACK", "Deterministic Engine").role).toBe("Secondary result");
    for (const t of ["P0", "P1", "FALLBACK"]) {
      const i = getLookupResultInfo(t, "Deterministic Engine");
      expect(`${i.label} ${i.meaning}`).not.toMatch(/level \d|catch-all/i);
    }
  });
});

describe("closing advice wording", () => {
  it("says Declaration Guide, never Declaration Framework, on real results", () => {
    for (const [plan, term] of [["Optima Secure", "asthma"], ["Optima Secure", "appendix"], ["Optima Secure", "typhoid fever"], ["Optima Secure", "angioplasty"]] as const) {
      const text = String(runDeterministicPipeline(term, plan, env.plans.get(plan)!, world.snapshot).result?.explanation);
      expect(text, `${plan} :: ${term}`).toContain("Please cross-check the Declaration Guide personally before taking the final disclosure call.");
      expect(text).not.toContain("Declaration Framework");
    }
  });
});
