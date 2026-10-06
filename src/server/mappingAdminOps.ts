/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRepositories, normalizeCondition } from "./db/repositories/index.js";
import type { AnyDb } from "./db/client.js";
import { planOverrides as planOverridesTable, planRestrictions as planRestrictionsTable } from "./db/schema.js";
import {
  bandFor,
  categoriesInDefinition,
  CATEGORY_KEY_RE,
  checkPosition,
  checkRegexSafety,
  CUSTOM_PREFIX,
  emptyUsage,
  findRefLoop,
  isCustom,
  movePosition,
  regexKeysOf,
  validateDefinition,
  type CategoryUsage,
  type RuleContext,
} from "./mappingAdmin.js";
import type { RoutingRuleRow, StepStage } from "../mapping/ruleTypes.js";
import type { MappingSnapshot } from "../mapping/ruleTypes.js";
import { runDeterministicPipeline } from "../mapping/routingEngine.js";
import type { PlanConfig } from "../types.js";

/**
 * The testable core of the Phase 3B-ii admin routes (server.ts keeps authentication, access checks, the impact gate and
 * the mapping-version bump; everything that decides what is allowed lives here).
 */

type Repos = ReturnType<typeof createRepositories>;
export interface OpResult {
  status: number;
  body: Record<string, unknown>;
}
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): OpResult => ({ status, body: { error, ...extra } });

export async function adminContext(repos: Repos): Promise<RuleContext & { aliasKeys: string[]; ruleList: RoutingRuleRow[] }> {
  const [cats, plans, ruleList, aliasRows] = await Promise.all([repos.categories.list(), repos.planConfigs.list(), repos.routingRules.listAll(), repos.pedAliases.listAll()]);
  return {
    categories: new Set(cats.map((c) => c.categoryKey)),
    plans: new Set(plans.filter((p: any) => !p.removed).map((p) => p.planName)),
    rules: new Map(ruleList.map((r) => [r.ruleKey, r] as const)),
    aliasKeys: aliasRows.map((a) => a.normalizedAlias),
    ruleList,
  };
}

export const ruleToJson = (r: RoutingRuleRow) => ({ ...r, band: bandFor(r.stage) ?? null, builtIn: !isCustom(r.ruleKey), editable: r.kind === "rule" });

/** Shape, references, loops and regex safety. Returns the problems found (empty = acceptable). */
export async function validateRuleCandidate(repos: Repos, candidate: { ruleKey: string; stage: StepStage; definition: unknown; planScope: string | null }, previous: RoutingRuleRow | undefined): Promise<string[]> {
  const ctx = await adminContext(repos);
  const errors: string[] = [];
  if (candidate.planScope && !ctx.plans.has(candidate.planScope)) errors.push(`Unknown plan "${candidate.planScope}".`);
  const v = validateDefinition(candidate.definition, candidate.stage, ctx);
  errors.push(...v.errors);
  if (errors.length) return errors;
  const loop = findRefLoop(candidate.ruleKey, v.refs, ctx.rules);
  if (loop) return [loop];
  const trusted = previous ? regexKeysOf(previous.definition, previous.stage) : new Set<string>();
  errors.push(...(await checkRegexSafety(v.regexes, ctx.aliasKeys, trusted)));
  return errors;
}

const RULE_KEY_RE = /^[a-z0-9][a-z0-9_.-]{2,59}$/;
const DESCRIPTION_MSG = "Describe what the step does, in plain words (up to 300 characters).";

export async function createRule(repos: Repos, body: any): Promise<OpResult> {
  const { suffix, stage, position, planScope, description, definition } = body ?? {};
  const band = bandFor(stage);
  if (!band || !band.allowsNew) return fail(400, "New steps can be added to: plan-specific rules, safety checks, disease-group rules, last safety checks and final adjustments.");
  if (typeof suffix !== "string" || !RULE_KEY_RE.test(suffix)) return fail(400, "Give the step a short name: lowercase letters, digits, dots, dashes or underscores (3–60 characters).");
  if (typeof description !== "string" || !description.trim() || description.length > 300) return fail(400, DESCRIPTION_MSG);
  const ruleKey = `${CUSTOM_PREFIX}${suffix}`;
  if (await repos.routingRules.getByKey(ruleKey)) return fail(409, `A step named "${ruleKey}" already exists.`);
  const posError = checkPosition(await repos.routingRules.listAll(), { ruleKey, stage }, position);
  if (posError) return fail(400, posError);
  const errors = await validateRuleCandidate(repos, { ruleKey, stage, definition, planScope: planScope || null }, undefined);
  if (errors.length) return fail(400, errors[0], { errors });
  const rule: RoutingRuleRow = { ruleKey, kind: "rule", stage, primitive: null, position, planScope: planScope || null, enabled: true, description: description.trim(), definition };
  await repos.routingRules.upsert(rule);
  return { status: 200, body: { rule: ruleToJson(rule) } };
}

export async function patchRule(repos: Repos, ruleKey: string, body: any): Promise<OpResult> {
  const existing = await repos.routingRules.getByKey(ruleKey);
  if (!existing) return fail(404, "Rule not found.");
  if (existing.kind !== "rule") return fail(400, "This is a fixed part of the system; it cannot be edited, switched off or moved.");
  const { enabled, position, description, planScope, definition } = body ?? {};
  const next: RoutingRuleRow = { ...existing };
  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") return fail(400, "enabled must be true or false.");
    next.enabled = enabled;
  }
  if (description !== undefined) {
    if (typeof description !== "string" || !description.trim() || description.length > 300) return fail(400, DESCRIPTION_MSG);
    next.description = description.trim();
  }
  if (planScope !== undefined) next.planScope = planScope || null;
  if (position !== undefined) {
    const posError = checkPosition(await repos.routingRules.listAll(), existing, position);
    if (posError) return fail(400, posError);
    next.position = position;
  }
  if (definition !== undefined || planScope !== undefined) {
    next.definition = definition !== undefined ? definition : existing.definition;
    const errors = await validateRuleCandidate(repos, { ruleKey: next.ruleKey, stage: next.stage, definition: next.definition, planScope: next.planScope }, existing);
    if (errors.length) return fail(400, errors[0], { errors });
  }
  await repos.routingRules.upsert(next);
  return { status: 200, body: { rule: ruleToJson(next) } };
}

export async function moveRule(repos: Repos, ruleKey: string, direction: unknown): Promise<OpResult> {
  if (direction !== "up" && direction !== "down") return fail(400, "direction must be up or down.");
  const all = await repos.routingRules.listAll();
  const rule = all.find((r) => r.ruleKey === ruleKey);
  if (!rule) return fail(404, "Rule not found.");
  if (rule.kind !== "rule") return fail(400, "A fixed step cannot be moved.");
  const moved = movePosition(all, rule.ruleKey, direction);
  if (moved.error !== undefined) return fail(400, moved.error);
  const other = moved.swapWith;
  await repos.routingRules.upsert({ ...rule, position: other.position });
  await repos.routingRules.upsert({ ...other, position: rule.position });
  return { status: 200, body: { moved: [rule.ruleKey, other.ruleKey] } };
}

export async function deleteRule(repos: Repos, ruleKey: string): Promise<OpResult> {
  const existing = await repos.routingRules.getByKey(ruleKey);
  if (!existing) return fail(404, "Rule not found.");
  if (!isCustom(existing.ruleKey) || existing.kind !== "rule") return fail(400, "Built-in steps cannot be deleted — switch them off instead.");
  const users = (await repos.routingRules.listAll()).filter((r) => r.ruleKey !== existing.ruleKey && JSON.stringify(r.definition).includes(`"rule":"${existing.ruleKey}"`));
  if (users.length) return fail(409, `Other steps still depend on this step: ${users.map((u) => u.ruleKey).join(", ")}.`);
  await repos.routingRules.delete(existing.ruleKey);
  return { status: 200, body: { deleted: existing.ruleKey } };
}

// ── categories ──

export async function categoryUsage(db: AnyDb, repos: Repos): Promise<Map<string, CategoryUsage>> {
  const usage = new Map<string, CategoryUsage>();
  const at = (k: string) => {
    let u = usage.get(k);
    if (!u) usage.set(k, (u = emptyUsage()));
    return u;
  };
  const [peds, aliases, plans, overrides, restrictions, rules] = await Promise.all([
    repos.pedRepository.list(),
    repos.pedAliases.listAll(),
    repos.planConfigs.list(),
    db.select({ k: planOverridesTable.categoryKey }).from(planOverridesTable),
    db.select({ k: planRestrictionsTable.categoryKey }).from(planRestrictionsTable),
    repos.routingRules.listAll(),
  ]);
  for (const p of peds) if (p.categoryKey) at(p.categoryKey).peds++;
  for (const a of aliases) {
    if (a.categoryKeyOverride) at(a.categoryKeyOverride).aliasOverrides++;
    if (a.fallbackCategoryKey) at(a.fallbackCategoryKey).aliasFallbacks++;
  }
  for (const pl of plans as any[]) for (const k of Object.keys(pl.categoryMap ?? {})) at(k).planMappings++;
  for (const o of overrides) if (o.k) at(o.k).planOverrides++;
  for (const r of restrictions) if (r.k) at(r.k).restrictions++;
  for (const r of rules) for (const k of categoriesInDefinition(r.definition)) at(k).rules++;
  for (const u of usage.values()) u.total = u.peds + u.aliasOverrides + u.aliasFallbacks + u.planMappings + u.planOverrides + u.restrictions + u.rules;
  return usage;
}

export async function listCategories(db: AnyDb, repos: Repos): Promise<OpResult> {
  const [cats, usage] = await Promise.all([repos.categories.list(), categoryUsage(db, repos)]);
  return { status: 200, body: { categories: cats.map((c) => ({ ...c, usage: usage.get(c.categoryKey) ?? emptyUsage() })) } };
}

export async function createCategory(repos: Repos, body: any): Promise<OpResult> {
  const { categoryKey, label, description } = body ?? {};
  if (typeof categoryKey !== "string" || !CATEGORY_KEY_RE.test(categoryKey)) return fail(400, "The category's short code must be lowercase letters, digits and underscores, starting with a letter (2–40 characters).");
  if (typeof label !== "string" || !label.trim() || label.length > 120) return fail(400, "Give the category a name (up to 120 characters).");
  if (await repos.categories.get(categoryKey)) return fail(409, `Category "${categoryKey}" already exists.`);
  const all = await repos.categories.list();
  const row = await repos.categories.upsert({ categoryKey, label: label.trim(), description: typeof description === "string" && description.trim() ? description.trim() : null, sortOrder: Math.max(0, ...all.map((c) => c.sortOrder)) + 10 });
  return { status: 200, body: { category: row } };
}

export async function patchCategory(repos: Repos, categoryKey: string, body: any): Promise<OpResult> {
  const existing = await repos.categories.get(categoryKey);
  if (!existing) return fail(404, "Category not found.");
  const { label, description } = body ?? {};
  const patch: { label?: string; description?: string | null } = {};
  if (label !== undefined) {
    if (typeof label !== "string" || !label.trim() || label.length > 120) return fail(400, "Give the category a name (up to 120 characters).");
    patch.label = label.trim();
  }
  if (description !== undefined) patch.description = typeof description === "string" && description.trim() ? description.trim() : null;
  return { status: 200, body: { category: await repos.categories.update(existing.categoryKey, patch) } };
}

export async function deleteCategory(db: AnyDb, repos: Repos, categoryKey: string): Promise<OpResult> {
  const existing = await repos.categories.get(categoryKey);
  if (!existing) return fail(404, "Category not found.");
  const usage = (await categoryUsage(db, repos)).get(existing.categoryKey) ?? emptyUsage();
  if (usage.total > 0) {
    return fail(409, `"${existing.label}" is still used (${usage.peds} conditions, ${usage.aliasOverrides + usage.aliasFallbacks} name settings, ${usage.planMappings} plan question mappings, ${usage.planOverrides} plan-specific condition mappings, ${usage.restrictions} restrictions, ${usage.rules} decision steps). Move those first.`, { usage });
  }
  await repos.categories.delete(existing.categoryKey);
  return { status: 200, body: { deleted: existing.categoryKey } };
}

/** Read-only: which rule decides a lookup. No AI call, no search history, no AI Memory write. */
export async function traceLookup(repos: Repos, input: { term: string; planName: string; config: PlanConfig; snapshot: MappingSnapshot; engineVersion: string }): Promise<OpResult> {
  const { term, planName, config, snapshot, engineVersion } = input;
  const { result, trace } = runDeterministicPipeline(term, planName, config, snapshot);
  const step = snapshot.steps.find((x) => x.ruleKey === trace.decidedBy);
  let aiMemory: { status: string; question: string | null } | null = null;
  if (!result) {
    const cached = await repos.aiMemory.findCached(normalizeCondition(term), planName, engineVersion);
    if (cached && cached.status !== "archived") aiMemory = { status: cached.status, question: cached.status === "rejected" ? null : ((cached.aiResponse as any)?.result?.matched_question ?? null) };
  }
  return {
    status: 200,
    body: {
      resolved: !!result,
      matchType: result?.match_type ?? null,
      question: result?.matched_question ?? null,
      decidedBy: trace.decidedBy,
      postGuard: trace.postGuard ?? null,
      dictionary: trace.dictionary ?? null,
      rule: step ? { ruleKey: step.ruleKey, kind: step.kind, stage: step.stage, position: step.position, description: step.description, builtIn: !isCustom(step.ruleKey) } : null,
      aiMemory,
      snapshotVersion: snapshot.version,
    },
  };
}
