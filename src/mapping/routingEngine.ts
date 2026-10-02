/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MatchOutput, PlanConfig } from "../types.js";
import {
  applyPlanPedOverride,
  finalizeOutput,
  findQuestion,
  isCategoryRestrictedForPed,
  makeOutput,
  normalizeDictionaryKey,
  normalizeText,
  questionForCategory,
  sanitizeOutput,
} from "../engine.js";
import type {
  Action,
  CategoryChainTrace,
  ChainItem,
  Clause,
  Cond,
  DictionaryTrace,
  MappingSnapshot,
  Msg,
  RegexSpec,
  RoutingRuleRow,
} from "./ruleTypes.js";

/**
 * Data-driven routing engine (mapping-control Phase 2). Interprets the
 * routing_rules / alias / category data in a MappingSnapshot and reproduces
 * the legacy classifyDeterministic + applyPostGuards pipeline exactly.
 *
 * Reuses the legacy engine's PURE helper functions (normalisation, question
 * lookup, plan-override matching, sanitize/finalize) unchanged, so those
 * algorithms exist once. Everything that was a regex, a plan name, a message
 * or a category choice is read from the snapshot instead.
 *
 * Named primitives (algorithms with no editable mapping data of their own):
 *   plan_override, p0_wording, dictionary_lookup, plan_decision,
 *   diabetes_confirmed, hypertension_family, diabetes_restriction_guard.
 */

export interface DecisionTrace {
  /** ruleKey of the step that produced the result ("unresolved" when none did). */
  decidedBy: string;
  /** How the dictionary stage resolved the alias, when it ran. */
  dictionary?: DictionaryTrace;
  /** ruleKey of the post-guard that rewrote the result, if any. */
  postGuard?: string;
}

export interface SnapshotResult {
  output: MatchOutput | null;
  trace: DecisionTrace;
}

interface Ctx {
  ped: string;
  pedText: string;
  text: string;
  planName: string;
  config: PlanConfig;
  snap: MappingSnapshot;
  categoryKey: string | undefined;
  cleanInputLower: string;
  dictionary?: DictionaryTrace;
  output?: MatchOutput;
  /** Second pass only: the alias's last-resort category, used instead of the primary one. */
  forcedCategory?: string;
}

type Step = { output: MatchOutput | null } | null;

// ── helpers ────────────────────────────────────────────────────────────

const regexCache = new Map<string, RegExp>();
function re(spec: { re: string; flags?: string }): RegExp {
  const key = `${spec.flags ?? ""}/${spec.re}`;
  let r = regexCache.get(key);
  if (!r) {
    r = new RegExp(spec.re, spec.flags ?? "");
    regexCache.set(key, r);
  }
  return r;
}

function hasActiveRestriction(config: PlanConfig, categoryKey: string, mode: "require_keywords" | "exclude_keywords" | "block_category"): boolean {
  return !!config.restrictions?.some((r) => r.isActive && r.categoryKey === categoryKey && r.mode === mode);
}
function flag(config: PlanConfig, name: "insulinQualifier" | "excludesPrediabetes" | "benignBypassed"): boolean {
  switch (name) {
    case "insulinQualifier":
      return hasActiveRestriction(config, "diabetes", "require_keywords") || !!config.overrides?.requiresInsulinForDiabetes;
    case "excludesPrediabetes":
      return hasActiveRestriction(config, "diabetes", "exclude_keywords") || !!config.overrides?.excludePrediabetes;
    case "benignBypassed":
      return hasActiveRestriction(config, "benign_growth", "block_category") || !!config.overrides?.bypassBenignTumors;
  }
}

function evalCond(c: Cond, ctx: Ctx): boolean {
  switch (c.t) {
    case "plan":
      return ctx.planName === c.is;
    case "text":
      return re(c).test(c.on === "raw" ? ctx.pedText : ctx.text);
    case "flag":
      return flag(ctx.config, c.name);
    case "qCat":
      return !!questionForCategory(ctx.config, c.cat) === c.exists;
    case "qWording": {
      const q = questionForCategory(ctx.config, c.cat);
      if (!q) return false;
      return c.not ? !re(c).test(q) : re(c).test(q);
    }
    case "qIsCatchAll": {
      const q = questionForCategory(ctx.config, c.cat);
      return !!q && q === ctx.config.anyOther;
    }
    case "category":
      return ctx.categoryKey === c.is;
    case "matchedQ":
      return re(c).test(normalizeText(ctx.output?.matched_question || ""));
    case "not":
      return !evalCond(c.c, ctx);
    case "all":
      return c.of.every((x) => evalCond(x, ctx));
    case "any":
      return c.of.some((x) => evalCond(x, ctx));
  }
}
const allHold = (conds: Cond[] | undefined, ctx: Ctx) => !conds || conds.every((c) => evalCond(c, ctx));

function resolveChain(chain: ChainItem[], ctx: Ctx): string {
  for (const item of chain) {
    const q = typeof item === "string" ? questionForCategory(ctx.config, item) : findQuestion(ctx.config, re({ re: item.findQ, flags: item.flags }));
    if (q) return q;
  }
  return "";
}

function renderTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => (name in tokens ? tokens[name] : whole));
}

function baseTokens(ctx: Ctx, extra?: Record<string, string>): Record<string, string> {
  return { ped: ctx.pedText, rawPed: ctx.ped, plan: ctx.planName, anyOther: ctx.config.anyOther, ...extra };
}

function pickMsg(msg: Msg, ctx: Ctx): string {
  if (typeof msg === "string") return msg;
  for (const v of msg.variants) if (allHold(v.when, ctx)) return v.msg;
  return msg.default;
}

function categoryLabel(ctx: Ctx, key: string, defaultLabel: string): string {
  return ctx.snap.categoryLabels.get(key) || defaultLabel;
}

// ── declarative rules ───────────────────────────────────────────────────

function runAction(action: Action, ctx: Ctx): Step {
  switch (action.a) {
    case "emit": {
      const extra: Record<string, string> = {};
      for (const v of action.vars ?? []) {
        const hit = v.variants.find((x) => re(x).test(ctx.text));
        extra[v.name] = hit ? hit.value : v.default;
      }
      const question = action.question === "anyOther" ? ctx.config.anyOther : action.question.literal;
      return { output: makeOutput(ctx.pedText, action.type, question, renderTokens(pickMsg(action.msg, ctx), baseTokens(ctx, extra))) };
    }
    case "route": {
      const q = resolveChain(action.chain, ctx);
      if (!q && !action.allowEmpty) return null;
      return { output: makeOutput(ctx.pedText, action.type, q, renderTokens(pickMsg(action.msg, ctx), baseTokens(ctx))) };
    }
    case "setCategory":
      ctx.categoryKey = action.to;
      return null;
    case "ref": {
      const target = ctx.snap.steps.find((s) => s.ruleKey === action.rule);
      const out = target ? evalRule(target, ctx) : null;
      // The referenced rule's result — including "no match" — ends classification.
      return { output: out ? out.output : null };
    }
    case "rewrite":
      return null; // handled by runPostGuard
  }
}

function evalRule(step: RoutingRuleRow, ctx: Ctx): Step {
  const def = step.definition;
  if (!allHold(def.when, ctx)) return null;
  for (const clause of def.clauses ?? []) {
    if (!allHold(clause.when, ctx)) continue;
    const res = runAction(clause.then, ctx);
    if (res) return res;
  }
  return null;
}

// ── primitives ──────────────────────────────────────────────────────────

function primP0(ctx: Ctx): Step {
  const clean = ctx.text.replace(/[^\w\s]/g, "").trim();
  if (clean.length <= 2) return null;
  for (const question of ctx.config.questions) {
    if (question === ctx.config.anyOther) continue;
    const chunks = question.toLowerCase().split(/[/,()]|\bor\b/);
    for (let chunk of chunks) {
      chunk = chunk.replace(/^\s*\d+\.\s*/, "").replace(/[^\w\s]/g, "").trim();
      if (chunk === clean) {
        return { output: makeOutput(ctx.pedText, "P0", question, `Exact condition match🎯: "${ctx.pedText}" is explicitly listed in this plan's questionnaire.`) };
      }
    }
  }
  return null;
}

function primDictionaryLookup(ctx: Ctx): Step {
  const entry = ctx.snap.aliases.get(ctx.cleanInputLower);
  let effective: string | null = null;
  let source: DictionaryTrace["source"] = "none";
  if (ctx.forcedCategory !== undefined) {
    effective = ctx.forcedCategory;
    source = "fallback_category";
  } else if (entry) {
    if (!entry.routingEnabled) {
      source = "not_routed";
    } else if (entry.categoryOverride) {
      effective = entry.categoryOverride;
      source = "alias_override";
    } else if (entry.pedCategory) {
      effective = entry.pedCategory;
      source = "ped_category";
    }
  }
  ctx.dictionary = {
    alias: ctx.cleanInputLower,
    source,
    pedCategory: entry?.pedCategory ?? null,
    categoryOverride: entry?.categoryOverride ?? null,
    effectiveCategory: effective,
  };
  // Phase 4 / R11 — ordered category fallback. Applies only to a PED whose category comes from the PED itself and
  // which has a configured chain; every other lookup (single-category PEDs, alias overrides, the last-resort second
  // pass) skips this block and routes exactly as before.
  if (source === "ped_category" && ctx.forcedCategory === undefined && entry?.categoryChain && entry.categoryChain.length > 0 && effective) {
    const chain = chooseFromChain(effective, entry.categoryChain, ctx);
    ctx.dictionary.chain = chain;
    if (chain.selected) {
      effective = chain.selected;
      if (chain.selected !== ctx.dictionary.pedCategory) ctx.dictionary.source = "category_chain";
      ctx.dictionary.effectiveCategory = effective;
    }
  }
  ctx.categoryKey = effective ?? undefined;
  return null;
}

/**
 * R11: walk the configured categories in order and take the FIRST that has a real question on this plan — a question
 * that exists and is not the plan's Others / catch-all question. Exactly one category is chosen, so there is only ever
 * one declaration. When none qualifies, `selected` is null and the caller keeps the PED's primary category, i.e. the
 * existing fallback behaviour runs unchanged (nothing new is invented).
 */
function chooseFromChain(primary: string, fallbacks: string[], ctx: Ctx): CategoryChainTrace {
  const configured = [primary, ...fallbacks];
  const skipped: CategoryChainTrace["skipped"] = [];
  for (const category of configured) {
    const q = questionForCategory(ctx.config, category);
    if (q && q !== ctx.config.anyOther) return { configured, selected: category, skipped };
    skipped.push({ category, reason: q ? "catch_all" : "no_question" });
  }
  return { configured, selected: null, skipped };
}

function primPlanDecision(step: RoutingRuleRow, ctx: Ctx): Step {
  const categoryKey = ctx.categoryKey;
  if (!categoryKey) return null;
  const p = step.definition.params as {
    rootRescue: Record<string, { rootCategoryKey: string; rootLabel: string }>;
    rootRescueMsg: string;
    explicitCatchAllMsg: string;
    directMsg: string;
    defaultLabel: string;
    insulinQualifier: { category: string; allow: RegexSpec; msg: string };
  };
  const config = ctx.config;
  const targetQ = questionForCategory(config, categoryKey);
  if (!targetQ) return null; // no_mapping → keep evaluating the family rules
  const label = categoryLabel(ctx, categoryKey, p.defaultLabel);

  let question: string;
  let explanation: string;
  let isCatchAll = false;
  if (targetQ === config.anyOther) {
    const root = Object.prototype.hasOwnProperty.call(p.rootRescue, ctx.cleanInputLower) ? p.rootRescue[ctx.cleanInputLower] : undefined;
    const rootQ = root ? questionForCategory(config, root.rootCategoryKey) : "";
    if (root && rootQ && rootQ !== config.anyOther) {
      question = rootQ;
      explanation = renderTokens(p.rootRescueMsg, baseTokens(ctx, { rootLabel: root.rootLabel, label }));
    } else {
      question = config.anyOther;
      explanation = renderTokens(p.explicitCatchAllMsg, baseTokens(ctx, { label }));
      isCatchAll = true;
    }
  } else {
    question = targetQ;
    explanation = renderTokens(p.directMsg, baseTokens(ctx, { label }));
  }

  if (isCatchAll) return { output: makeOutput(ctx.pedText, "FALLBACK", question, explanation) };
  if (categoryKey === p.insulinQualifier.category && flag(config, "insulinQualifier")) {
    if (!re(p.insulinQualifier.allow).test(ctx.pedText)) {
      return { output: makeOutput(ctx.pedText, "FALLBACK", config.anyOther, renderTokens(p.insulinQualifier.msg, baseTokens(ctx))) };
    }
  }
  return { output: makeOutput(ctx.pedText, "P1", question, explanation) };
}

function primDiabetesConfirmed(step: RoutingRuleRow, ctx: Ctx): Step {
  const p = step.definition.params as {
    pattern: RegexSpec;
    complicationOrgans: Array<[string, string]>;
    complicationMsg: string;
    plainMsg: string;
    qualifier: RegexSpec;
    qualifiedMsg: string;
    unqualifiedMsg: string;
    routedMsg: string;
  };
  if (!re(p.pattern).test(ctx.text)) return null;
  const hit = p.complicationOrgans.find(([term]) => ctx.text.includes(term));
  const description = hit
    ? renderTokens(p.complicationMsg, baseTokens(ctx, { organ: hit[1], organBare: hit[1].replace(/^an?\s+/, "") }))
    : renderTokens(p.plainMsg, baseTokens(ctx));
  const config = ctx.config;
  if (flag(config, "insulinQualifier")) {
    if (re(p.qualifier).test(ctx.text)) {
      const q = questionForCategory(config, "diabetes");
      if (q) return { output: makeOutput(ctx.pedText, "P1", q, renderTokens(p.qualifiedMsg, baseTokens(ctx, { description }))) };
    }
    return { output: makeOutput(ctx.pedText, "FALLBACK", config.anyOther, renderTokens(p.unqualifiedMsg, baseTokens(ctx))) };
  }
  const q = questionForCategory(config, "diabetes");
  if (q) return { output: makeOutput(ctx.pedText, "P1", q, renderTokens(p.routedMsg, baseTokens(ctx, { description }))) };
  return null;
}

function primHypertension(step: RoutingRuleRow, ctx: Ctx): Step {
  const p = step.definition.params as {
    pattern: RegexSpec;
    complications: Array<[string, { organCategoryKey: string; organLabel: string; organQuestionName: string }]>;
    eyeChain: string[];
    organMsg: string;
    rootMsg: string;
    plainMsg: string;
  };
  if (!re(p.pattern).test(ctx.text)) return null;
  const config = ctx.config;
  const q = questionForCategory(config, "hypertension");
  if (!q) return null;
  const hit = p.complications.find(([term]) => ctx.text.includes(term));
  if (hit) {
    const info = hit[1];
    const organQ = info.organCategoryKey === "eye" ? resolveChain(p.eyeChain, ctx) : questionForCategory(config, info.organCategoryKey);
    const tokens = baseTokens(ctx, { organLabel: info.organLabel, organQuestionName: info.organQuestionName });
    if (organQ && organQ !== config.anyOther) {
      return { output: makeOutput(ctx.pedText, "P1", organQ, renderTokens(p.organMsg, tokens)) };
    }
    return { output: makeOutput(ctx.pedText, "P1", q, renderTokens(p.rootMsg, tokens)) };
  }
  return { output: makeOutput(ctx.pedText, "P1", q, renderTokens(p.plainMsg, baseTokens(ctx))) };
}

function runStep(step: RoutingRuleRow, ctx: Ctx): Step {
  if (step.kind === "rule") return evalRule(step, ctx);
  switch (step.primitive) {
    case "plan_override": {
      const o = applyPlanPedOverride(ctx.pedText, ctx.config);
      return o ? { output: o } : null;
    }
    case "p0_wording":
      return primP0(ctx);
    case "dictionary_lookup":
      return primDictionaryLookup(ctx);
    case "plan_decision":
      return primPlanDecision(step, ctx);
    case "diabetes_confirmed":
      return primDiabetesConfirmed(step, ctx);
    case "hypertension_family":
      return primHypertension(step, ctx);
    default:
      return null;
  }
}

// ── public API ──────────────────────────────────────────────────────────

/** Data-driven equivalent of classifyDeterministic (legacy engine, stage order preserved). */
export function classifyFromSnapshot(ped: string, planName: string, config: PlanConfig, snap: MappingSnapshot): SnapshotResult {
  const first = classifyPass(ped, planName, config, snap);
  if (first.output) return first;
  const entry = snap.aliases.get(normalizeDictionaryKey(normalizeText(ped)));
  if (entry?.fallbackCategory) {
    const second = classifyPass(ped, planName, config, snap, entry.fallbackCategory);
    if (second.output) return second;
  }
  return first;
}

function classifyPass(ped: string, planName: string, config: PlanConfig, snap: MappingSnapshot, forcedCategory?: string): SnapshotResult {
  const text = normalizeText(ped);
  const pedText = String(ped || "").trim();
  const ctx: Ctx = {
    forcedCategory,
    ped,
    pedText,
    text,
    planName,
    config,
    snap,
    categoryKey: undefined,
    cleanInputLower: normalizeDictionaryKey(text),
  };
  for (const step of snap.steps) {
    if (step.stage === "post_guard") continue;
    const res = runStep(step, ctx);
    if (res) {
      return { output: res.output, trace: { decidedBy: res.output ? step.ruleKey : "unresolved", dictionary: ctx.dictionary } };
    }
  }
  return { output: null, trace: { decidedBy: "unresolved", dictionary: ctx.dictionary } };
}

function primDiabetesRestrictionGuard(step: RoutingRuleRow, ctx: Ctx, output: MatchOutput): boolean {
  const p = step.definition.params as {
    legacyGestationalOrType2: RegexSpec;
    legacyHasInsulinOrType1: RegexSpec;
    legacyMsg: string;
  };
  const config = ctx.config;
  const diabetesQuestion = questionForCategory(config, "diabetes");
  if (!diabetesQuestion || normalizeText(output.matched_question) !== normalizeText(diabetesQuestion)) return false;
  const restriction = isCategoryRestrictedForPed("diabetes", ctx.text, config.restrictions);
  if (restriction) {
    output.match_type = "FALLBACK";
    output.matched_question = config.anyOther;
    output.explanation = restriction.explanation;
    return true;
  }
  if (config.overrides?.requiresInsulinForDiabetes) {
    const isGestationalOrType2 = re(p.legacyGestationalOrType2).test(ctx.text);
    const hasInsulinOrType1 = re(p.legacyHasInsulinOrType1).test(ctx.text);
    if (isGestationalOrType2 && !hasInsulinOrType1) {
      output.match_type = "FALLBACK";
      output.matched_question = config.anyOther;
      output.explanation = renderTokens(p.legacyMsg, baseTokens(ctx));
      return true;
    }
  }
  return false;
}

function applyRewrite(action: Extract<Action, { a: "rewrite" }>, ctx: Ctx, output: MatchOutput): boolean {
  let question = "";
  if (action.chain) {
    question = resolveChain(action.chain, ctx);
    if (!question) return false;
  } else if (action.question === "anyOther") {
    question = ctx.config.anyOther;
  }
  output.match_type = action.type;
  output.matched_question = question;
  if (action.setExplanation !== undefined) output.explanation = renderTokens(action.setExplanation, baseTokens(ctx));
  return true;
}

/** Data-driven equivalent of applyPostGuards. Returns the (possibly rewritten) output and the guard that fired. */
export function applyPostGuardsFromSnapshot(
  output: MatchOutput,
  ped: string,
  planName: string,
  config: PlanConfig,
  snap: MappingSnapshot
): { output: MatchOutput; guard?: string } {
  if (output.plan_override) return { output };
  const ctx: Ctx = {
    ped,
    pedText: String(ped || "").trim(),
    text: normalizeText(ped),
    planName,
    config,
    snap,
    categoryKey: undefined,
    cleanInputLower: "",
    output,
  };
  for (const step of snap.steps) {
    if (step.stage !== "post_guard") continue;
    if (step.kind === "primitive") {
      if (step.primitive === "diabetes_restriction_guard" && primDiabetesRestrictionGuard(step, ctx, output)) return { output, guard: step.ruleKey };
      continue;
    }
    if (!allHold(step.definition.when, ctx)) continue;
    for (const clause of step.definition.clauses ?? ([] as Clause[])) {
      if (!allHold(clause.when, ctx)) continue;
      if (clause.then.a === "rewrite" && applyRewrite(clause.then, ctx, output)) return { output, guard: step.ruleKey };
    }
  }
  return { output };
}

export interface FullResult {
  result: MatchOutput | null;
  trace: DecisionTrace;
}

/**
 * The complete deterministic pipeline server.ts runs for /api/match:
 * classify → sanitize → post-guards → finalize. `result` is null when no
 * deterministic rule matched (the caller then continues to AI Memory / AI,
 * exactly as before).
 */
export function runDeterministicPipeline(ped: string, planName: string, config: PlanConfig, snap: MappingSnapshot): FullResult {
  const { output, trace } = classifyFromSnapshot(ped, planName, config, snap);
  if (!output) return { result: null, trace };
  let o = sanitizeOutput(output, ped, config);
  const guarded = applyPostGuardsFromSnapshot(o, ped, planName, config, snap);
  o = guarded.output;
  const finalResult = finalizeOutput(o, ped, config, config.questions);
  return { result: finalResult, trace: guarded.guard ? { ...trace, postGuard: guarded.guard } : trace };
}
