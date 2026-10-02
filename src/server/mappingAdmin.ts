/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Worker } from "node:worker_threads";
import type { Action, ChainItem, Cond, Clause, Msg, RoutingRuleRow, RuleDefinition, StepStage } from "../mapping/ruleTypes.js";

/**
 * Phase 3B-ii — administration of the routing pipeline (routing_rules) and the category list.
 *
 * Pure validation + helpers; the Express routes in server.ts call these and run every write through
 * `mappingGate` (impact preview, change-control fields, confirmation, change set + undo).
 *
 * What an admin may do with RULES (decided from the engine's structure, not a behaviour change):
 *  - built-in rules: enable/disable, reorder inside their stage, edit description / definition;
 *  - new rules ("custom.*"): create in a stage that takes rules, edit, reorder, delete;
 *  - NEVER: change a rule's stage, touch a primitive (the named algorithms that form the pipeline skeleton),
 *    delete a built-in rule, or move a rule outside its stage's position band.
 * Every definition is validated structurally (only the Cond/Action shapes of ruleTypes.ts), regexes are probed in a
 * worker with a time budget (catastrophic patterns and match-everything patterns are refused), category / rule
 * references must exist, and `ref` chains may not loop. An admin edit therefore cannot be a loop, a rule that
 * matches everything, or a shape the engine cannot run.
 */

// ── stage bands ──────────────────────────────────────────────────────────

export interface StageBand {
  stage: StepStage;
  min: number;
  max: number;
  /** Whether admins may create new rules in this stage. */
  allowsNew: boolean;
  /** Ordering group: post-guards are ordered among themselves, separately from the main pipeline. */
  group: "main" | "post_guard";
  label: string;
}

export const STAGE_BANDS: StageBand[] = [
  { stage: "plan_override", min: 10, max: 19, allowsNew: false, group: "main", label: "Plan-specific PED mappings (built-in step)" },
  { stage: "firewall", min: 20, max: 29, allowsNew: false, group: "main", label: "Life-stage firewall" },
  { stage: "plan_rule", min: 30, max: 99, allowsNew: true, group: "main", label: "Plan-specific rules" },
  { stage: "shield", min: 100, max: 199, allowsNew: true, group: "main", label: "Shields" },
  { stage: "wording", min: 200, max: 299, allowsNew: false, group: "main", label: "Exact plan wording (built-in step)" },
  { stage: "dictionary", min: 300, max: 399, allowsNew: false, group: "main", label: "Dictionary stage" },
  { stage: "plan_decision", min: 400, max: 499, allowsNew: false, group: "main", label: "Plan decision (built-in step)" },
  { stage: "family", min: 500, max: 999, allowsNew: true, group: "main", label: "Disease-family rules" },
  { stage: "generic", min: 1000, max: 1999, allowsNew: true, group: "main", label: "Generic shields" },
  { stage: "post_guard", min: 10, max: 99, allowsNew: true, group: "post_guard", label: "Post-guards (applied to the chosen answer)" },
];

export const bandFor = (stage: string): StageBand | undefined => STAGE_BANDS.find((b) => b.stage === stage);

export const CUSTOM_PREFIX = "custom.";
export const isCustom = (ruleKey: string): boolean => ruleKey.startsWith(CUSTOM_PREFIX);

// ── structural validation ────────────────────────────────────────────────

const MATCH_TYPES = new Set(["P0", "P1", "FALLBACK", "NON_AILMENT", "ESCALATE", "INVALID"]);
const BASE_TOKENS = new Set(["ped", "rawPed", "plan", "anyOther"]);
const MAX_REGEX_LEN = 1000;
const MAX_DEPTH = 6;
const MAX_CLAUSES = 25;
const MAX_CONDS = 40;
const MAX_BYTES = 30_000;

export interface RuleContext {
  categories: Set<string>;
  plans: Set<string>;
  /** Every existing rule, by key (the candidate may be among them; it is replaced by the candidate when checking loops). */
  rules: Map<string, RoutingRuleRow>;
}

interface RegexRef {
  re: string;
  flags: string;
  where: string;
}

class Collector {
  errors: string[] = [];
  regexes: RegexRef[] = [];
  refs: string[] = [];
  err(msg: string) {
    if (this.errors.length < 20) this.errors.push(msg);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function regexSpec(c: Collector, re: unknown, flags: unknown, where: string) {
  if (typeof re !== "string" || !re.length) return c.err(`${where}: a pattern is required.`);
  if (re.length > MAX_REGEX_LEN) return c.err(`${where}: pattern is longer than ${MAX_REGEX_LEN} characters.`);
  if (flags !== undefined && (typeof flags !== "string" || !/^[imsu]*$/.test(flags))) return c.err(`${where}: flags may only contain i, m, s, u.`);
  try {
    new RegExp(re, (flags as string | undefined) ?? "");
  } catch (e: any) {
    return c.err(`${where}: invalid pattern (${e.message}).`);
  }
  c.regexes.push({ re, flags: (flags as string | undefined) ?? "", where });
}

function checkCategory(c: Collector, key: unknown, ctx: RuleContext, where: string) {
  if (typeof key !== "string" || !ctx.categories.has(key)) c.err(`${where}: unknown category "${String(key)}".`);
}

function checkCond(c: Collector, cond: unknown, ctx: RuleContext, where: string, depth: number, counter: { n: number }, allowMatchedQ: boolean) {
  if (!isObj(cond)) return c.err(`${where}: a condition must be an object.`);
  if (depth > MAX_DEPTH) return c.err(`${where}: conditions are nested too deeply.`);
  if (++counter.n > MAX_CONDS) return c.err("Too many conditions in one rule.");
  switch (cond.t) {
    case "plan":
      if (typeof cond.is !== "string" || !ctx.plans.has(cond.is)) c.err(`${where}: unknown plan "${String(cond.is)}".`);
      return;
    case "text":
      if (cond.on !== undefined && cond.on !== "text" && cond.on !== "raw") c.err(`${where}: "on" must be text or raw.`);
      return regexSpec(c, cond.re, cond.flags, where);
    case "flag":
      if (!["insulinQualifier", "excludesPrediabetes", "benignBypassed"].includes(String(cond.name))) c.err(`${where}: unknown plan flag.`);
      return;
    case "qCat":
      checkCategory(c, cond.cat, ctx, where);
      if (typeof cond.exists !== "boolean") c.err(`${where}: "exists" must be true or false.`);
      return;
    case "qWording":
      checkCategory(c, cond.cat, ctx, where);
      return regexSpec(c, cond.re, cond.flags, where);
    case "qIsCatchAll":
      return checkCategory(c, cond.cat, ctx, where);
    case "category":
      return checkCategory(c, cond.is, ctx, where);
    case "matchedQ":
      if (!allowMatchedQ) c.err(`${where}: "matched question" conditions are only valid in post-guards.`);
      return regexSpec(c, cond.re, cond.flags, where);
    case "not":
      return checkCond(c, cond.c, ctx, where, depth + 1, counter, allowMatchedQ);
    case "all":
    case "any":
      if (!Array.isArray(cond.of) || !cond.of.length) return c.err(`${where}: "${cond.t}" needs at least one condition.`);
      cond.of.forEach((x, i) => checkCond(c, x, ctx, `${where}.${cond.t}[${i}]`, depth + 1, counter, allowMatchedQ));
      return;
    default:
      return c.err(`${where}: unknown condition type "${String(cond.t)}".`);
  }
}

function checkChain(c: Collector, chain: unknown, ctx: RuleContext, where: string, optional = false) {
  if (chain === undefined && optional) return;
  if (!Array.isArray(chain) || !chain.length) return c.err(`${where}: the route needs at least one category or question pattern.`);
  if (chain.length > 20) return c.err(`${where}: route is too long.`);
  (chain as ChainItem[]).forEach((item, i) => {
    if (typeof item === "string") checkCategory(c, item, ctx, `${where}[${i}]`);
    else if (isObj(item)) regexSpec(c, (item as any).findQ, (item as any).flags, `${where}[${i}]`);
    else c.err(`${where}[${i}]: must be a category key or a { findQ } pattern.`);
  });
}

function checkMsg(c: Collector, msg: unknown, ctx: RuleContext, where: string, extraTokens: Set<string>, counter: { n: number }, allowMatchedQ: boolean) {
  const tokens = (s: string) => {
    for (const m of s.matchAll(/\{(\w+)\}/g)) if (!BASE_TOKENS.has(m[1]) && !extraTokens.has(m[1])) c.err(`${where}: unknown placeholder {${m[1]}}.`);
  };
  if (typeof msg === "string") {
    if (msg.length > 4000) c.err(`${where}: message is too long.`);
    return tokens(msg);
  }
  if (!isObj(msg) || typeof msg.default !== "string" || !Array.isArray(msg.variants)) return c.err(`${where}: a message is text or { variants, default }.`);
  tokens(msg.default);
  (msg as Extract<Msg, object>).variants.forEach((v, i) => {
    if (!isObj(v) || typeof v.msg !== "string" || !Array.isArray(v.when)) return c.err(`${where}.variants[${i}]: needs { when, msg }.`);
    tokens(v.msg);
    v.when.forEach((w, j) => checkCond(c, w, ctx, `${where}.variants[${i}].when[${j}]`, 1, counter, allowMatchedQ));
  });
}

function checkAction(c: Collector, a: unknown, ctx: RuleContext, where: string, counter: { n: number }, postGuard: boolean) {
  if (!isObj(a)) return c.err(`${where}: an action must be an object.`);
  const type = (t: unknown) => {
    if (typeof t !== "string" || !MATCH_TYPES.has(t)) c.err(`${where}: result type must be one of ${[...MATCH_TYPES].join(", ")}.`);
  };
  switch (a.a) {
    case "emit": {
      type(a.type);
      const q = a.question;
      if (!(q === "anyOther" || (isObj(q) && typeof q.literal === "string" && q.literal.length > 0 && q.literal.length <= 600))) c.err(`${where}: question must be the plan's catch-all or a literal text (up to 600 characters).`);
      const vars = new Set<string>();
      if (a.vars !== undefined) {
        if (!Array.isArray(a.vars) || a.vars.length > 10) c.err(`${where}: invalid variables.`);
        else
          a.vars.forEach((v: any, i: number) => {
            if (!isObj(v) || typeof v.name !== "string" || !/^\w+$/.test(v.name) || typeof v.default !== "string" || !Array.isArray(v.variants)) return c.err(`${where}.vars[${i}]: needs { name, variants, default }.`);
            vars.add(v.name);
            v.variants.forEach((x: any, j: number) => {
              if (!isObj(x) || typeof x.value !== "string") return c.err(`${where}.vars[${i}].variants[${j}]: needs { re, value }.`);
              regexSpec(c, x.re, x.flags, `${where}.vars[${i}].variants[${j}]`);
            });
          });
      }
      return checkMsg(c, a.msg, ctx, `${where}.msg`, vars, counter, postGuard);
    }
    case "route":
      type(a.type);
      checkChain(c, a.chain, ctx, `${where}.chain`);
      if (a.allowEmpty !== undefined && typeof a.allowEmpty !== "boolean") c.err(`${where}: allowEmpty must be true or false.`);
      return checkMsg(c, a.msg, ctx, `${where}.msg`, new Set(), counter, postGuard);
    case "setCategory":
      return checkCategory(c, a.to, ctx, `${where}.to`);
    case "ref":
      if (typeof a.rule !== "string" || !ctx.rules.has(a.rule)) return c.err(`${where}: rule "${String(a.rule)}" does not exist.`);
      c.refs.push(a.rule);
      return;
    case "rewrite":
      if (!postGuard) return c.err(`${where}: "rewrite" is only valid in post-guards.`);
      type(a.type);
      checkChain(c, a.chain, ctx, `${where}.chain`, true);
      if (a.question !== undefined && a.question !== "anyOther") c.err(`${where}: question may only be anyOther.`);
      if (a.setExplanation !== undefined && (typeof a.setExplanation !== "string" || a.setExplanation.length > 4000)) c.err(`${where}: invalid explanation.`);
      return;
    default:
      return c.err(`${where}: unknown action "${String(a.a)}".`);
  }
}

export interface ValidatedRule {
  errors: string[];
  regexes: RegexRef[];
  refs: string[];
}

/** Structural validation of a rule definition (no regex timing yet — see `probeRegexes`). */
export function validateDefinition(definition: unknown, stage: StepStage, ctx: RuleContext): ValidatedRule {
  const c = new Collector();
  if (!isObj(definition)) return { errors: ["The rule definition must be an object."], regexes: [], refs: [] };
  if (JSON.stringify(definition).length > MAX_BYTES) c.err("The rule definition is too large.");
  const postGuard = stage === "post_guard";
  const counter = { n: 0 };
  const def = definition as RuleDefinition;
  if (def.params !== undefined) c.err("Rules do not take parameters (only built-in steps do).");
  if (def.when !== undefined) {
    if (!Array.isArray(def.when)) c.err("'when' must be a list of conditions.");
    else def.when.forEach((w, i) => checkCond(c, w, ctx, `when[${i}]`, 0, counter, postGuard));
  }
  if (!Array.isArray(def.clauses) || def.clauses.length === 0) c.err("A rule needs at least one clause (an action to take).");
  else if (def.clauses.length > MAX_CLAUSES) c.err(`A rule can have at most ${MAX_CLAUSES} clauses.`);
  else
    (def.clauses as Clause[]).forEach((cl, i) => {
      if (!isObj(cl)) return c.err(`clauses[${i}] must be an object.`);
      if (cl.when !== undefined) {
        if (!Array.isArray(cl.when)) c.err(`clauses[${i}].when must be a list.`);
        else cl.when.forEach((w, j) => checkCond(c, w, ctx, `clauses[${i}].when[${j}]`, 0, counter, postGuard));
      }
      checkAction(c, cl.then, ctx, `clauses[${i}].then`, counter, postGuard);
    });
  return { errors: c.errors, regexes: c.regexes, refs: c.refs };
}

/** `ref` loops: following `ref` actions from the candidate may never reach the candidate again. */
export function findRefLoop(ruleKey: string, candidateRefs: string[], rules: Map<string, RoutingRuleRow>): string | null {
  const refsOf = (key: string): string[] => {
    const def = rules.get(key)?.definition as RuleDefinition | undefined;
    const out: string[] = [];
    const walk = (a: unknown) => {
      if (isObj(a) && a.a === "ref" && typeof a.rule === "string") out.push(a.rule);
    };
    for (const cl of def?.clauses ?? []) walk(cl.then);
    return out;
  };
  const seen = new Set<string>();
  const stack = [...candidateRefs];
  while (stack.length) {
    const k = stack.pop()!;
    if (k === ruleKey) return "This rule refers back to itself (directly or through other rules), which would loop.";
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(...refsOf(k));
  }
  return null;
}

// ── regex probing (time budget, empty / match-everything) ──────────────────

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const out = [];
for (const spec of workerData.specs) {
  const r = { empty: false, matched: 0, slowMs: 0, error: null };
  try {
    const re = new RegExp(spec.re, spec.flags.replace(/[gy]/g, ""));
    r.empty = re.test("");
    const t0 = Date.now();
    for (const s of workerData.samples) if (re.test(s)) r.matched++;
    for (const s of workerData.adversarial) re.test(s);
    // inputs built from the pattern's own characters (long runs followed by a mismatch) expose backtracking blow-ups
    const chars = [...new Set(spec.re.replace(/\\\\./g, "").match(/[A-Za-z0-9]/g) || [])].slice(0, 8);
    for (const c of chars) re.test(c.repeat(40) + "!");
    for (let i = 0; i + 1 < chars.length; i++) re.test((chars[i] + chars[i + 1]).repeat(25) + "!");
    r.slowMs = Date.now() - t0;
  } catch (e) { r.error = String(e && e.message || e); }
  out.push(r);
}
parentPort.postMessage(out);
`;

export interface RegexProbe {
  empty: boolean;
  matched: number;
  slowMs: number;
  error: string | null;
}

const ADVERSARIAL = ["a".repeat(40) + "!", "ab".repeat(25) + "!", " ".repeat(40) + "x", "0".repeat(40) + "z", "word ".repeat(12) + "!"];
/** Wall-clock cap that only exists to kill a genuinely hung pattern (worker start-up is not counted against the pattern). */
export const REGEX_BUDGET_MS = 3000;
/** Execution time one pattern may take inside the worker over all probe strings before it is called too slow. */
export const REGEX_MAX_RUN_MS = 250;

/** Runs every regex against sample terms and adversarial strings in a worker; terminated if it exceeds the budget. */
export async function probeRegexes(specs: Array<{ re: string; flags: string }>, samples: string[]): Promise<{ timedOut: boolean; results: RegexProbe[] }> {
  if (!specs.length) return { timedOut: false, results: [] };
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { specs, samples, adversarial: ADVERSARIAL } });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ timedOut: true, results: [] });
    }, REGEX_BUDGET_MS);
    worker.once("message", (results: RegexProbe[]) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve({ timedOut: false, results });
    });
    worker.once("error", () => {
      clearTimeout(timer);
      resolve({ timedOut: true, results: [] });
    });
  });
}

/** Largest share of the dictionary one condition may match (a pattern matching more is treated as "matches everything"). */
export const MAX_MATCH_SHARE = 0.25;

/** A quantified group that itself contains an unbounded quantifier — the classic catastrophic-backtracking shape, e.g. (a+)+ or (x+x+)*. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;

export async function checkRegexSafety(regexes: RegexRef[], aliasKeys: string[], unchanged: Set<string>): Promise<string[]> {
  // Only patterns the admin is introducing or editing are probed; existing built-in text is trusted as-is.
  const toCheck = regexes.filter((r) => !unchanged.has(`${r.re}\u0000${r.flags}`));
  if (!toCheck.length) return [];
  const nested = toCheck.filter((r) => NESTED_QUANTIFIER.test(r.re));
  if (nested.length) return nested.map((r) => `${r.where}: a repeated group that itself repeats can make lookups extremely slow — simplify the pattern.`);
  const samples = aliasKeys.length > 600 ? aliasKeys.filter((_, i) => i % Math.ceil(aliasKeys.length / 600) === 0) : aliasKeys;
  const { timedOut, results } = await probeRegexes(toCheck, samples);
  if (timedOut) return ["A pattern is too slow or too complex (it exceeded the safety time limit) — simplify it."];
  if (results.some((r) => r.slowMs > REGEX_MAX_RUN_MS)) return ["A pattern is too slow or too complex (it took too long on the safety probe) — simplify it."];
  const errors: string[] = [];
  results.forEach((r, i) => {
    const where = toCheck[i].where;
    if (r.error) errors.push(`${where}: ${r.error}`);
    else if (r.empty) errors.push(`${where}: this pattern matches empty text, so it would match every condition.`);
    else if (samples.length && r.matched / samples.length > MAX_MATCH_SHARE) errors.push(`${where}: this pattern matches ${Math.round((100 * r.matched) / samples.length)}% of the dictionary — too broad.`);
  });
  return errors;
}

class AllSet extends Set<string> {
  has(): boolean {
    return true;
  }
}
class AllMap extends Map<string, RoutingRuleRow> {
  has(): boolean {
    return true;
  }
}

/** Regex (source + flags) keys found in an existing definition — those are trusted and not re-probed when unchanged. */
export function regexKeysOf(def: unknown, stage: StepStage): Set<string> {
  const v = validateDefinition(def, stage, { categories: new AllSet(), plans: new AllSet(), rules: new AllMap() });
  return new Set(v.regexes.map((r) => `${r.re} ${r.flags}`));
}

// ── position handling ────────────────────────────────────────────────────

export function checkPosition(rules: RoutingRuleRow[], rule: Pick<RoutingRuleRow, "ruleKey" | "stage">, position: unknown): string | null {
  const band = bandFor(rule.stage);
  if (!band) return `Unknown stage "${rule.stage}".`;
  if (!Number.isInteger(position)) return "Position must be a whole number.";
  const p = position as number;
  if (p < band.min || p > band.max) return `Position must stay inside the ${band.label} band (${band.min}–${band.max}).`;
  const clash = rules.find((r) => r.ruleKey !== rule.ruleKey && bandFor(r.stage)?.group === band.group && r.position === p);
  if (clash) return `Position ${p} is already used by "${clash.ruleKey}".`;
  return null;
}

/** Position of the adjacent rule-kind row in `direction`, refusing to jump over a built-in algorithm step. */
export function movePosition(rules: RoutingRuleRow[], ruleKey: string, direction: "up" | "down"): { swapWith: RoutingRuleRow; error?: undefined } | { error: string; swapWith?: undefined } {
  const rule = rules.find((r) => r.ruleKey === ruleKey);
  if (!rule) return { error: "Rule not found." };
  const band = bandFor(rule.stage)!;
  const sameGroup = rules.filter((r) => bandFor(r.stage)?.group === band.group).sort((a, b) => a.position - b.position || a.ruleKey.localeCompare(b.ruleKey));
  const i = sameGroup.findIndex((r) => r.ruleKey === ruleKey);
  const neighbour = sameGroup[direction === "up" ? i - 1 : i + 1];
  if (!neighbour) return { error: `Already ${direction === "up" ? "first" : "last"}.` };
  if (neighbour.stage !== rule.stage) return { error: "A rule can only be reordered within its own stage." };
  if (neighbour.kind !== "rule") return { error: "A built-in algorithm step sits next to it here; it cannot be moved past that step." };
  return { swapWith: neighbour };
}

// ── category usage ────────────────────────────────────────────────────────

export interface CategoryUsage {
  peds: number;
  aliasOverrides: number;
  aliasFallbacks: number;
  planMappings: number;
  planOverrides: number;
  restrictions: number;
  rules: number;
  total: number;
}

export function emptyUsage(): CategoryUsage {
  return { peds: 0, aliasOverrides: 0, aliasFallbacks: 0, planMappings: 0, planOverrides: 0, restrictions: 0, rules: 0, total: 0 };
}

/** Category keys referenced anywhere inside a rule definition (chains, setCategory, category / qCat / qWording / qIsCatchAll conditions). */
export function categoriesInDefinition(def: unknown): Set<string> {
  const found = new Set<string>();
  const cond = (x: any) => {
    if (!isObj(x)) return;
    if (typeof x.cat === "string") found.add(x.cat);
    if (x.t === "category" && typeof x.is === "string") found.add(x.is);
    if (isObj(x.c)) cond(x.c);
    if (Array.isArray(x.of)) x.of.forEach(cond);
    if (Array.isArray(x.variants)) x.variants.forEach((v: any) => (v?.when ?? []).forEach(cond));
  };
  const d = def as RuleDefinition;
  (d?.when ?? []).forEach(cond);
  for (const cl of d?.clauses ?? []) {
    (cl.when ?? []).forEach(cond);
    const a = cl.then as Action;
    if (a?.a === "setCategory") found.add(a.to);
    if ((a?.a === "route" || a?.a === "rewrite") && Array.isArray((a as any).chain)) for (const it of (a as any).chain) if (typeof it === "string") found.add(it);
    if ((a as any)?.msg && isObj((a as any).msg)) ((a as any).msg.variants ?? []).forEach((v: any) => (v?.when ?? []).forEach(cond));
  }
  return found;
}

export const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
