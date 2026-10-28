/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeDictionaryKey, questionForCategory } from "../mapping/helpers.js";
import type { PlanConfig } from "../types.js";
import type { Repositories } from "./db/repositories/index.js";

/**
 * Authoritative admin mapping mechanism for AI Mapping Review (Phase 3A).
 *
 * With the database-backed engine the live engine reads ped_repository / ped_aliases
 * (and routing_rules, plan_overrides, …) — never ped_mapping_overrides. So
 * approving an AI answer must change THOSE tables, and an admin must only be
 * told it worked once a fresh lookup through the live engine shows it did.
 *
 *  - applyAiApproval: sets the term's category (creating the PED + alias if the
 *    term is unknown), bumps the mapping version, runs a fresh live lookup, and
 *    reports success only if that lookup returns the approved question via the
 *    new category. If it doesn't, the change is reverted and the reason given.
 *  - revertAiApproval / undoChangeSet: reverse exactly what an approval did,
 *    refusing (never forcing) when the rows have changed since, and verify the
 *    next lookup no longer uses the mapping.
 * Every change is recorded as a mapping_change_sets row (audit + undo) plus
 * mapping_history entries.
 *
 * Deliberately does NOT write ped_mapping_overrides and never overwrites a
 * category that already exists for the term.
 */

type Repos = Pick<Repositories, "pedRepository" | "pedAliases" | "categories" | "mappingChangeSets" | "mappingState" | "mappingHistory">;

export interface LiveLookup {
  question: string | null;
  matchType: string | null;
  decidedBy: string;
  effectiveCategory: string | null;
  dictionarySource: string | null;
  snapshotVersion: number;
}

/** Runs a FRESH lookup through the live engine (the same path /api/match uses). */
export type VerifyFn = (term: string, planName: string) => Promise<LiveLookup>;

export interface PromotionDeps {
  repos: Repos;
  verify: VerifyFn;
}

type Op =
  | { type: "create_ped"; pedId: number; aliasId: number; aliasText: string; category: string }
  | { type: "set_ped_category"; pedId: number; before: string | null; after: string };

export interface PromotionResult {
  /** True only when a fresh live lookup confirmed the mapping now takes effect. */
  applied: boolean;
  verified: boolean;
  categoryKey?: string;
  changeSetId?: number;
  /** The term already routed this way; nothing was changed. */
  alreadyLive?: boolean;
  reason?: string;
  observed?: LiveLookup;
}

export interface RevertResult {
  reverted: boolean;
  verified: boolean;
  /** The approval never changed any live mapping, so there was nothing to revert. */
  noMappingApplied?: boolean;
  changeSetId?: number;
  reason?: string;
  observed?: LiveLookup;
}

async function applyInverse(repos: Repos, ops: Op[]): Promise<void> {
  for (const op of [...ops].reverse()) {
    if (op.type === "create_ped") {
      await repos.pedAliases.delete(op.aliasId);
      await repos.pedRepository.delete(op.pedId);
    } else {
      await repos.pedRepository.update(op.pedId, { categoryKey: op.before });
    }
  }
}

async function record(repos: Repos, pedId: number | null, action: string, previous: unknown, next: unknown, reason: string | null, by: string) {
  try {
    await repos.mappingHistory.record({ pedId, entityType: "ped", action, previousValue: previous as never, newValue: next as never, reason, performedBy: by });
  } catch (err) {
    console.error("Failed to write mapping history for an AI mapping change:", err);
  }
}

function whyNotEffective(live: LiveLookup, expectedQuestion: string): string {
  if (live.decidedBy && !live.decidedBy.startsWith("dict.") && live.decidedBy !== "primitive.plan_decision") {
    return `A built-in rule ("${live.decidedBy}") decides this condition on this plan before category mapping, so approving it would not change the result.`;
  }
  if (live.question && live.question !== expectedQuestion) {
    return "A live lookup gives a different question than the approved answer, so nothing was changed.";
  }
  return "A live lookup did not pick up the new mapping, so nothing was changed.";
}

export async function applyAiApproval(
  deps: PromotionDeps,
  input: { condition: string; planName: string; categoryKey: string; expectedQuestion: string; aiMemoryId: number; performedBy: string }
): Promise<PromotionResult> {
  const { repos, verify } = deps;
  const term = input.condition.trim();
  const key = normalizeDictionaryKey(term);
  if (!key) return { applied: false, verified: false, reason: "The condition text is empty." };

  const known = new Set((await repos.categories.list()).map((c) => c.categoryKey));
  if (!known.has(input.categoryKey)) {
    return { applied: false, verified: false, reason: `The category "${input.categoryKey}" no longer exists.` };
  }

  const alias = await repos.pedAliases.getByNormalizedAlias(key);
  const ops: Op[] = [];

  if (!alias) {
    const ped = await repos.pedRepository.create({
      canonicalName: term,
      categoryKey: input.categoryKey,
      status: "approved",
      notes: "Created from an approved AI Mapping Review answer.",
      addedBy: input.performedBy,
    });
    const created = await repos.pedAliases.create({ pedId: ped.id, aliasText: term, isPrimary: true, isVisible: true, addedBy: input.performedBy });
    ops.push({ type: "create_ped", pedId: ped.id, aliasId: created.id, aliasText: term, category: input.categoryKey });
  } else {
    const ped = await repos.pedRepository.get(alias.pedId);
    if (!ped) return { applied: false, verified: false, reason: "This term points at a PED that no longer exists. Fix it in the PED Library." };
    if (alias.routingEnabled === false || alias.categoryKeyOverride) {
      return { applied: false, verified: false, reason: "This term has matching options set in the PED Library, so its category cannot be changed here." };
    }
    if (ped.categoryKey && ped.categoryKey !== input.categoryKey) {
      return { applied: false, verified: false, reason: `This term is already mapped to "${ped.categoryKey}" in the PED Library. Change it there if that is wrong.` };
    }
    if (ped.categoryKey === input.categoryKey) {
      const live = await verify(term, input.planName);
      const ok = live.question === input.expectedQuestion && live.effectiveCategory === input.categoryKey;
      return ok
        ? { applied: true, verified: true, alreadyLive: true, categoryKey: input.categoryKey, observed: live }
        : { applied: false, verified: false, reason: whyNotEffective(live, input.expectedQuestion), observed: live };
    }
    await repos.pedRepository.update(ped.id, { categoryKey: input.categoryKey });
    ops.push({ type: "set_ped_category", pedId: ped.id, before: ped.categoryKey ?? null, after: input.categoryKey });
  }

  await repos.mappingState.bump();
  const live = await verify(term, input.planName);
  const verification = { term, planName: input.planName, expectedQuestion: input.expectedQuestion, expectedCategory: input.categoryKey, observed: live };
  const ok = live.question === input.expectedQuestion && live.effectiveCategory === input.categoryKey;

  if (!ok) {
    await applyInverse(repos, ops);
    await repos.mappingState.bump();
    const reason = whyNotEffective(live, input.expectedQuestion);
    await repos.mappingChangeSets.create({
      kind: "ai_approval",
      summary: `AI approval of "${term}" (${input.planName}) did not take effect and was reverted`,
      status: "failed_verification",
      relatedAiMemoryId: input.aiMemoryId,
      ops,
      verification: { ...verification, reason },
      performedBy: input.performedBy,
    });
    return { applied: false, verified: false, reason, observed: live };
  }

  const cs = await repos.mappingChangeSets.create({
    kind: "ai_approval",
    summary: `Approved AI answer: "${term}" → category "${input.categoryKey}" (confirmed on ${input.planName})`,
    status: "applied",
    relatedAiMemoryId: input.aiMemoryId,
    ops,
    verification,
    performedBy: input.performedBy,
  });
  await record(repos, ops[0]?.pedId ?? null, "ai_approval_applied", { ops: ops.map((o) => (o.type === "set_ped_category" ? { before: o.before } : { created: true })) }, { category: input.categoryKey, changeSetId: cs.id }, `AI Mapping Review #${input.aiMemoryId}`, input.performedBy);
  return { applied: true, verified: true, categoryKey: input.categoryKey, changeSetId: cs.id, observed: live };
}

export async function undoChangeSet(deps: PromotionDeps, changeSetId: number, performedBy: string, note?: string): Promise<RevertResult> {
  const { repos, verify } = deps;
  const cs = await repos.mappingChangeSets.get(changeSetId);
  if (!cs) return { reverted: false, verified: false, reason: "That change was not found." };
  if (cs.status !== "applied") {
    return { reverted: false, verified: false, changeSetId, reason: cs.status === "undone" ? "That change has already been undone." : "That change did not take effect, so there is nothing to undo." };
  }
  const ops = cs.ops as Op[];
  const verification = cs.verification as { term: string; planName: string; expectedCategory: string } | null;

  // Refuse to undo when the rows have changed since (never force over someone else's edit).
  for (const op of ops) {
    const ped = await repos.pedRepository.get(op.pedId);
    const category = op.type === "create_ped" ? op.category : op.after;
    if (!ped || ped.categoryKey !== category) {
      return { reverted: false, verified: false, changeSetId, reason: "This mapping was changed after it was applied. Change it in the PED Library instead." };
    }
    if (op.type === "create_ped") {
      const aliases = await repos.pedAliases.listByPed(op.pedId);
      if (aliases.length !== 1 || aliases[0].id !== op.aliasId) {
        return { reverted: false, verified: false, changeSetId, reason: "This PED was edited after it was created. Change it in the PED Library instead." };
      }
    }
  }

  await applyInverse(repos, ops);
  await repos.mappingState.bump();

  let observed: LiveLookup | undefined;
  let verified = true;
  if (verification) {
    observed = await verify(verification.term, verification.planName);
    verified = observed.effectiveCategory !== verification.expectedCategory;
  }
  await repos.mappingChangeSets.setStatus(changeSetId, "undone", { undoneBy: performedBy, undoNote: note });
  await record(repos, ops[0]?.pedId ?? null, "ai_approval_undone", { changeSetId }, { reverted: true, verified }, note ?? null, performedBy);
  return verified
    ? { reverted: true, verified: true, changeSetId, observed }
    : { reverted: true, verified: false, changeSetId, observed, reason: "The change was reversed, but a live lookup still uses that category (another rule or mapping sets it)." };
}

export async function revertAiApproval(deps: PromotionDeps, aiMemoryId: number, performedBy: string): Promise<RevertResult> {
  const sets = await deps.repos.mappingChangeSets.listByAiMemory(aiMemoryId);
  const live = sets.find((s) => s.kind === "ai_approval" && s.status === "applied");
  if (!live) return { reverted: false, verified: false, noMappingApplied: true, reason: "This approval had not changed any live mapping." };
  return undoChangeSet(deps, live.id, performedBy, `Rejected in AI Mapping Review #${aiMemoryId}`);
}

/**
 * Given a plan's config and a question STRING (as stored on a cached AI answer), finds the single categoryKey that
 * resolves to it, if any. Used to infer a plan-agnostic categoryKey from an AI Mapping Review entry's plan-specific
 * matched_question before promoting it: a PED's category is read by every plan, so promotion only proceeds when exactly
 * one categoryKey explains the AI's answer (ambiguous or fallback answers are left for manual assignment).
 */
export function inferCategoryKeyForQuestion(config: PlanConfig, questionText: string): string | null {
  if (!config?.categoryMap || !questionText) return null;
  const matches = Object.keys(config.categoryMap).filter((key) => questionForCategory(config, key) === questionText);
  return matches.length === 1 ? matches[0] : null;
}
