/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { snapshotFromDump } from "../mapping/seedBuilder";
import { planConfigsFromDump } from "../mapping/equalityHarness";
import { runDeterministicPipeline } from "../mapping/routingEngine";
import { questionForCategory } from "../engine";
import { categoriesInDefinition } from "../server/mappingAdmin";
import { validateCategoryChain, MAX_CHAIN_LENGTH } from "../server/categoryChain";
import { fixtureDump } from "./helpers/mappingTestDb";
import type { MappingSnapshot } from "../mapping/ruleTypes";
import type { PlanConfig } from "../types";

/**
 * Phase 4 / R11 — ordered category fallback per PED.
 *
 *   PED → [primary, secondary, tertiary…]; for the selected plan the FIRST category with a REAL question is used
 *   (a question that exists and is not the plan's Others/catch-all). One category, one declaration. If none qualifies,
 *   the existing behaviour (primary category, existing fallback) runs unchanged. A PED without a chain is untouched.
 */

const TERM = "xqzr11probe"; // matches no shield, wording or family rule
let base: MappingSnapshot;
let plans: Map<string, PlanConfig>;
let PLAN: string;
let config: PlanConfig;
let noQ1: string; // categories the plan has NO question for
let noQ2: string;
let real: string[]; // categories with a real question whose plain routing is decided by the plan decision
let catchAll: string | undefined; // a category the plan maps to its Others question

const withEntry = (chain: string[] | undefined, primary: string, extra: Record<string, unknown> = {}): MappingSnapshot => {
  const snap: MappingSnapshot = { ...base, aliases: new Map(base.aliases) };
  snap.aliases.set(TERM, { pedId: -1, pedCategory: primary, routingEnabled: true, categoryOverride: null, fallbackCategory: null, ...(chain ? { categoryChain: chain } : {}), ...extra });
  return snap;
};
const run = (snap: MappingSnapshot, cfg: PlanConfig = config, term = TERM) => runDeterministicPipeline(term, PLAN, cfg, snap);

beforeAll(() => {
  base = snapshotFromDump(fixtureDump);
  plans = new Map(planConfigsFromDump(fixtureDump).map((p) => [p.planName, p.config] as const));
  PLAN = "Optima Secure";
  config = plans.get(PLAN)!;
  const dictionaryRuleCategories = new Set<string>();
  for (const s of base.steps) if (s.stage === "dictionary" || s.stage === "firewall") for (const c of categoriesInDefinition(s.definition)) dictionaryRuleCategories.add(c);
  const keys = [...base.categoryLabels.keys()];
  const none = keys.filter((k) => !questionForCategory(config, k) && !dictionaryRuleCategories.has(k));
  [noQ1, noQ2] = none;
  catchAll = keys.find((k) => questionForCategory(config, k) === config.anyOther && !dictionaryRuleCategories.has(k));
  real = keys.filter((k) => {
    const q = questionForCategory(config, k);
    if (!q || q === config.anyOther || dictionaryRuleCategories.has(k) || k === "diabetes") return false;
    const out = run(withEntry(undefined, k));
    return out.trace.decidedBy === "primitive.plan_decision" && out.result?.match_type === "P1" && out.result.matched_question === q;
  });
});

describe("test data is meaningful", () => {
  it("the plan has categories with and without real questions", () => {
    expect(noQ1 && noQ2).toBeTruthy();
    expect(real.length).toBeGreaterThanOrEqual(2);
    expect(run(withEntry(undefined, noQ1)).result).toBeNull(); // today: a category without a question falls through (to the AI step)
  });
});

describe("R11 behaviour", () => {
  it("2. positive: the first category has no question on this plan, the second does → the second is used", () => {
    const [B] = real;
    const out = run(withEntry([B], noQ1));
    expect(out.result?.matched_question).toBe(questionForCategory(config, B));
    expect(out.result?.match_type).toBe("P1");
    expect(out.trace.dictionary).toMatchObject({ source: "category_chain", pedCategory: noQ1, effectiveCategory: B, chain: { configured: [noQ1, B], selected: B, skipped: [{ category: noQ1, reason: "no_question" }] } });
  });

  it("3. priority: both have real questions → the first wins and the second produces nothing", () => {
    const [A, B] = real;
    const out = run(withEntry([B], A));
    expect(out.result?.matched_question).toBe(questionForCategory(config, A));
    expect(out.result?.matched_question).not.toBe(questionForCategory(config, B));
    expect(out.trace.dictionary).toMatchObject({ source: "ped_category", effectiveCategory: A, chain: { selected: A, skipped: [] } });
  });

  it("4. reordering: reversing the chain changes the answer, using only the data (no code, no cache)", () => {
    const [A, B] = real;
    const ab = run(withEntry([B], A)).result?.matched_question;
    const ba = run(withEntry([A], B)).result?.matched_question;
    expect(ab).toBe(questionForCategory(config, A));
    expect(ba).toBe(questionForCategory(config, B));
    expect(ab).not.toBe(ba);
  });

  it("5. no valid category: the existing final fallback runs, exactly as without a chain (nothing is invented)", () => {
    const withChain = run(withEntry([noQ2], noQ1));
    const without = run(withEntry(undefined, noQ1));
    expect(withChain.result).toEqual(without.result); // today's behaviour for this category
    expect(withChain.trace.decidedBy).toBe(without.trace.decidedBy);
    expect(withChain.trace.dictionary).toMatchObject({ source: "ped_category", effectiveCategory: noQ1, chain: { selected: null } });
    expect(withChain.trace.dictionary?.chain?.skipped.map((s) => s.reason)).toEqual(["no_question", "no_question"]);
  });

  it("a category the plan maps to its Others question is not a 'real' question: it is skipped, and the next real one is used", () => {
    if (!catchAll) return; // the plan has no catch-all mapped category in this data
    const [B] = real;
    const out = run(withEntry([B], catchAll));
    expect(out.result?.matched_question).toBe(questionForCategory(config, B));
    expect(out.trace.dictionary?.chain?.skipped).toEqual([{ category: catchAll, reason: "catch_all" }]);
    // and when nothing real follows, today's explicit Others answer is preserved
    const only = run(withEntry([noQ1], catchAll));
    expect(only.result).toEqual(run(withEntry(undefined, catchAll)).result);
  });

  it("6. single-category regression: no chain, an empty chain, or a chain of nothing change a PED's result at all", () => {
    for (const k of [real[0], noQ1, catchAll ?? real[1]]) {
      const none = run(withEntry(undefined, k));
      expect(run(withEntry([], k)).result).toEqual(none.result);
      expect(run(withEntry([], k)).trace).toEqual(none.trace);
    }
  });

  it("7. exact plan-specific mapping stays authoritative over the chain", () => {
    const [A, B] = real;
    const cfg: PlanConfig = { ...config, pedOverrides: [{ pedId: -1, pedName: "R11 probe", aliases: [TERM], targetQuestion: null, categoryKey: B, reason: "test override" } as never] };
    const plain = run(withEntry(undefined, A), cfg);
    const chained = run(withEntry([noQ1], A), cfg);
    expect(plain.trace.decidedBy).toBe("primitive.plan_override");
    expect(chained.trace.decidedBy).toBe("primitive.plan_override");
    expect(chained.result).toEqual(plain.result);
    expect(chained.result?.matched_question).toBe(questionForCategory(config, B));
  });

  it("8. one PED, one declaration: the answer is a single question and no second recommendation appears", () => {
    const [A, B] = real;
    const out = run(withEntry([B, noQ2], noQ1));
    expect(typeof out.result?.matched_question).toBe("string");
    expect(out.result?.matched_question).toBe(questionForCategory(config, A === noQ1 ? B : B));
    expect(out.result?.secondary_recommendation ?? []).toEqual([]);
  });

  it("an alias-level category override or the last-resort category is never altered by a chain", () => {
    const [A, B] = real;
    const overridden = run(withEntry([B], noQ1, { categoryOverride: A }));
    expect(overridden.trace.dictionary?.source).toBe("alias_override");
    expect(overridden.trace.dictionary?.chain).toBeUndefined();
    expect(overridden.result?.matched_question).toBe(questionForCategory(config, A));
    // second (last-resort) pass: chain is ignored while the forced category is used
    const lastResort = run(withEntry([B], noQ1, { fallbackCategory: A }));
    expect(lastResort.result?.matched_question).toBe(questionForCategory(config, B)); // first pass already resolved via the chain
  });

  it("explainability: the trace carries the configured chain, the category used and why earlier ones were skipped", () => {
    const [B] = real;
    const t = run(withEntry([B], noQ1)).trace.dictionary!;
    expect(t.chain).toEqual({ configured: [noQ1, B], selected: B, skipped: [{ category: noQ1, reason: "no_question" }] });
  });

  it("does not leak into other terms: with a chain on one PED every other alias still routes exactly as before", () => {
    const [B] = real;
    const chained = withEntry([B], noQ1);
    let compared = 0;
    for (const alias of [...base.aliases.keys()].slice(0, 400)) {
      expect(run(chained, config, alias).result, alias).toEqual(run(base, config, alias).result);
      compared++;
    }
    expect(compared).toBeGreaterThan(300);
  });
});

describe("chain validation", () => {
  const known = new Set(["heart", "kidney", "blood", "ent"]);
  it("accepts a valid chain and normalises an empty one to none", () => {
    expect(validateCategoryChain("heart", ["kidney", "blood"], known)).toEqual({ ok: true, value: ["kidney", "blood"] });
    expect(validateCategoryChain("heart", [], known)).toEqual({ ok: true, value: null });
    expect(validateCategoryChain("heart", null, known)).toEqual({ ok: true, value: null });
  });
  it("refuses unknown categories, duplicates, the primary repeated, a chain without a primary, non-lists and over-long chains", () => {
    const bad = (chain: unknown, primary: string | null = "heart") => validateCategoryChain(primary, chain, known);
    expect(bad(["nope"])).toMatchObject({ ok: false });
    expect(bad(["kidney", "kidney"])).toMatchObject({ ok: false });
    expect(bad(["heart"])).toMatchObject({ ok: false });
    expect(bad(["kidney"], null)).toMatchObject({ ok: false });
    expect(bad("kidney")).toMatchObject({ ok: false });
    expect(bad([1])).toMatchObject({ ok: false });
    expect(bad(Array.from({ length: MAX_CHAIN_LENGTH + 1 }, (_, i) => `c${i}`))).toMatchObject({ ok: false });
  });
});

describe("R11 isolation", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  it("the legacy engine and the seeded legacy rules know nothing about chains", () => {
    expect(read("src/engine.ts")).not.toMatch(/categoryChain|chooseFromChain/);
    expect(read("src/mapping/legacyRuleSeed.ts")).not.toMatch(/categoryChain|chooseFromChain/);
  });
  it("the engine evaluates the chain in exactly one place (the dictionary stage), nowhere else", () => {
    const engine = read("src/mapping/routingEngine.ts");
    expect(engine.match(/chooseFromChain\(/g)?.length).toBe(2); // definition + the single call in primDictionaryLookup
    const dictionaryFn = engine.slice(engine.indexOf("function primDictionaryLookup"), engine.indexOf("function chooseFromChain"));
    expect(dictionaryFn).toContain("chooseFromChain(");
    expect(engine.slice(engine.indexOf("function primPlanDecision"))).not.toMatch(/categoryChain/);
  });
  it("the chain is applied only to PED-sourced categories: never to alias overrides or the forced last-resort pass", () => {
    const engine = read("src/mapping/routingEngine.ts");
    expect(engine).toMatch(/source === "ped_category" && ctx\.forcedCategory === undefined/);
  });
});

describe("Constitution v1.6 matches the R11 implementation", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const constitution = readFileSync(new URL("../../MASTER_CONSTITUTION.md", import.meta.url), "utf8");
  it("documents the chain, its single evaluation point, the limit and the history entry", () => {
    expect(constitution).toMatch(/\*\*Version:\*\* 1\.[6-9]/);
    expect(constitution).toContain("Ordered category fallback per PED");
    expect(constitution).toContain("primDictionaryLookup");
    expect(constitution).toContain(`at most ${MAX_CHAIN_LENGTH}`);
    expect(constitution).toMatch(/v1\.6 {2}\(2026-10-02\)/);
  });
});

describe("R11 admin screen is written for admins, not engineers", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const FORBIDDEN = /category chain|catch-all|catch all|dictionary stage|category key|categoryKey\b(?=[^"'`]*["'`]\s*[,}])|engine stage|decided by|primitive|snapshot|impact hash/i;
  const visibleText = (file: string) => {
    const src = strip(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
    // user-visible strings: JSX text and quoted/template strings that contain a space and a letter
    return [...src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).concat([...src.matchAll(/(["'`])((?:(?!\1)[^\\n])*\s(?:(?!\1)[^\\n])*)\1/g)].map((m) => m[2]));
  };
  it("the PED category editor and the trace wording contain no internal terms", () => {
    for (const file of ["src/components/PedCategoryChainEditor.tsx", "src/utils/categoryChainText.ts"]) {
      const bad = visibleText(file).filter((t) => FORBIDDEN.test(t) && !/className|\/api\//.test(t));
      expect(bad, file).toEqual([]);
    }
  });
  it("the editor says what the screen does in plain words and shows Primary / Fallback labels", () => {
    const src = readFileSync(new URL("../../src/components/PedCategoryChainEditor.tsx", import.meta.url), "utf8");
    expect(src).toContain("The Primary category is used first. If the selected plan has no declaration question for it, the system tries the next fallback.");
    expect(src).toContain("Currently saved:");
    expect(src).toContain("Fallback ${i + 1}");
    expect(src).toContain("Not saved yet");
  });
});
