/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMappingTestEnv, type MappingTestEnv } from "./helpers/mappingTestDb";
import { applyAiApproval, revertAiApproval, undoChangeSet, inferCategoryKeyForQuestion, type PromotionDeps } from "../server/aiMappingPromotion";
import type { PlanConfig } from "../types";
import { pedAliases, pedMappingOverrides, pedRepository } from "../server/db/schema";
import { questionForCategory } from "../mapping/helpers";

/**
 * Phase 3A — AI Mapping Review approve / reject on the AUTHORITATIVE tables,
 * with live-lookup verification, audit and undo. Admin-writer / no-silent-no-op
 * tests from the Phase 3 plan (docs/MAPPING_CONTROL_PLAN.md).
 */

const PLAN = "Optima Secure";
let env: MappingTestEnv;
let instanceA: ReturnType<MappingTestEnv["newInstance"]>;
let instanceB: ReturnType<MappingTestEnv["newInstance"]>;
let deps: PromotionDeps;
let heartQuestion: string;
let kidneyQuestion: string;

const approve = (condition: string, categoryKey: string, expectedQuestion: string, aiMemoryId = 1) =>
  applyAiApproval(deps, { condition, planName: PLAN, categoryKey, expectedQuestion, aiMemoryId, performedBy: "Tester (Admin)" });

async function legacyOverrideRows() {
  return (await env.db.select().from(pedMappingOverrides)).length;
}

beforeAll(async () => {
  env = await createMappingTestEnv();
  instanceA = env.newInstance();
  instanceB = env.newInstance();
  deps = { repos: env.repos, verify: (t, p) => instanceA.lookup(t, p) };
  heartQuestion = questionForCategory(env.plans.get(PLAN)!, "heart");
  kidneyQuestion = questionForCategory(env.plans.get(PLAN)!, "kidney");
}, 120_000);

describe("AI Mapping Review — Approve", () => {
  it("applies on the authoritative tables, is confirmed by a live lookup, and is live on every instance", async () => {
    const legacyBefore = await legacyOverrideRows();
    const before = await instanceB.lookup("Quirkelzorb 4417", PLAN);
    expect(before.question).toBeNull(); // unknown today -> would go to AI

    const r = await approve("Quirkelzorb 4417", "heart", heartQuestion, 101);
    expect(r).toMatchObject({ applied: true, verified: true, categoryKey: "heart" });
    expect(r.changeSetId).toBeGreaterThan(0);
    expect(r.observed?.effectiveCategory).toBe("heart");

    // next lookup on a DIFFERENT instance (its own cache) sees it
    const after = await instanceB.lookup("Quirkelzorb 4417", PLAN);
    expect(after.question).toBe(heartQuestion);
    expect(after.effectiveCategory).toBe("heart");
    expect(after.snapshotVersion).toBeGreaterThan(before.snapshotVersion);

    // authoritative rows exist; the old table was NOT written (no parallel source of truth)
    const alias = await env.repos.pedAliases.getByNormalizedAlias("quirkelzorb 4417");
    expect(alias).toBeDefined();
    expect((await env.repos.pedRepository.get(alias!.pedId))?.categoryKey).toBe("heart");
    expect(await legacyOverrideRows()).toBe(legacyBefore);

    // audit: change set + history
    const sets = await env.repos.mappingChangeSets.listByAiMemory(101);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ status: "applied", performedBy: "Tester (Admin)" });
    expect((await env.repos.mappingHistory.listByPed(alias!.pedId)).some((h) => h.action === "ai_approval_applied")).toBe(true);
  });

  it("approving the same term again is a confirmed no-op (nothing duplicated)", async () => {
    const sets = (await env.repos.mappingChangeSets.listRecent(100)).length;
    const r = await approve("Quirkelzorb 4417", "heart", heartQuestion, 101);
    expect(r).toMatchObject({ applied: true, verified: true, alreadyLive: true });
    expect((await env.repos.mappingChangeSets.listRecent(100)).length).toBe(sets);
  });

  it("sets the category on an existing PED that has none, and undo restores 'none'", async () => {
    const ped = await env.repos.pedRepository.create({ canonicalName: "Quirkelzorb 5521", categoryKey: null, status: "approved", notes: null, addedBy: "t" });
    await env.repos.pedAliases.create({ pedId: ped.id, aliasText: "Quirkelzorb 5521", isPrimary: true, isVisible: true, addedBy: "t" });
    const r = await approve("Quirkelzorb 5521", "kidney", kidneyQuestion, 102);
    expect(r).toMatchObject({ applied: true, verified: true });
    expect((await env.repos.pedRepository.get(ped.id))?.categoryKey).toBe("kidney");
    const undo = await undoChangeSet(deps, r.changeSetId!, "Tester (Admin)");
    expect(undo).toMatchObject({ reverted: true, verified: true });
    expect((await env.repos.pedRepository.get(ped.id))?.categoryKey).toBeNull(); // original restored, PED kept
  });

  it("never overwrites a category that already exists (no silent change to an existing mapping)", async () => {
    const alias = await env.repos.pedAliases.getByNormalizedAlias("diabetes");
    const ped = await env.repos.pedRepository.get(alias!.pedId);
    expect(ped?.categoryKey).toBe("diabetes");
    const r = await approve("diabetes", "heart", heartQuestion, 103);
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/already mapped/i);
    expect((await env.repos.pedRepository.get(alias!.pedId))?.categoryKey).toBe("diabetes");
  });

  it("does not claim success for a term whose matching options mean the category would be ignored", async () => {
    const all = await env.db.select().from(pedAliases);
    const peds = new Set((await env.db.select().from(pedRepository)).map((p) => p.id));
    const notRouted = all.find((a) => a.routingEnabled === false && peds.has(a.pedId));
    expect(notRouted).toBeDefined();
    const r = await approve(notRouted!.aliasText, "heart", heartQuestion, 104);
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/matching options/i);
  });

  it("does not claim success for an alias whose PED no longer exists", async () => {
    const r = await approve("cigarette", "heart", heartQuestion, 1041); // one of the orphan aliases in production
    expect(r.applied).toBe(false);
    expect(r.reason).toMatch(/no longer exists/i);
  });

  it("does not report success when a built-in rule decides first — the change is reverted and the reason given", async () => {
    const peds = (await env.db.select().from(pedRepository)).length;
    const versionBefore = await env.repos.mappingState.getVersion();
    const r = await approve("mri brain", "heart", heartQuestion, 105);
    expect(r.applied).toBe(false);
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/built-in rule/i);
    expect((await env.db.select().from(pedRepository)).length).toBe(peds); // nothing left behind
    expect(await env.repos.pedAliases.getByNormalizedAlias("mri brain")).toBeUndefined();
    expect(await env.repos.mappingState.getVersion()).toBeGreaterThan(versionBefore); // instances reload the reverted state
    const sets = await env.repos.mappingChangeSets.listByAiMemory(105);
    expect(sets[0].status).toBe("failed_verification");
    expect((await instanceB.lookup("mri brain", PLAN)).decidedBy).toBe("shield.A_tests"); // behaviour unchanged
  });

  it("refuses an unknown category", async () => {
    const r = await approve("Quirkelzorb 9001", "not_a_category", heartQuestion, 106);
    expect(r).toMatchObject({ applied: false });
    expect(await env.repos.pedAliases.getByNormalizedAlias("quirkelzorb 9001")).toBeUndefined();
  });
});

describe("AI Mapping Review — Reject / Undo", () => {
  it("Reject reverts the approval and the very next lookup on every instance no longer uses it", async () => {
    expect((await instanceB.lookup("Quirkelzorb 4417", PLAN)).question).toBe(heartQuestion);
    const r = await revertAiApproval(deps, 101, "Tester (Admin)");
    expect(r).toMatchObject({ reverted: true, verified: true });
    for (const inst of [instanceA, instanceB, env.newInstance()]) {
      const live = await inst.lookup("Quirkelzorb 4417", PLAN);
      expect(live.question).toBeNull();
      expect(live.effectiveCategory).toBeNull();
    }
    expect(await env.repos.pedAliases.getByNormalizedAlias("quirkelzorb 4417")).toBeUndefined();
    const sets = await env.repos.mappingChangeSets.listByAiMemory(101);
    expect(sets[0]).toMatchObject({ status: "undone", undoneBy: "Tester (Admin)" });
  });

  it("Reject of an approval that never changed a live mapping says so truthfully", async () => {
    const r = await revertAiApproval(deps, 9999, "Tester (Admin)");
    expect(r).toMatchObject({ reverted: false, noMappingApplied: true });
    expect(r.reason).toMatch(/had not changed any live mapping/i);
  });

  it("Undo cannot be applied twice", async () => {
    const sets = await env.repos.mappingChangeSets.listByAiMemory(101);
    const again = await undoChangeSet(deps, sets[0].id, "Tester (Admin)");
    expect(again).toMatchObject({ reverted: false });
    expect(again.reason).toMatch(/already been undone/i);
  });

  it("Undo refuses (and changes nothing) when someone edited the mapping afterwards", async () => {
    const r = await approve("Quirkelzorb 7742", "heart", heartQuestion, 107);
    expect(r.applied).toBe(true);
    const alias = await env.repos.pedAliases.getByNormalizedAlias("quirkelzorb 7742");
    await env.repos.pedRepository.update(alias!.pedId, { categoryKey: "liver" }); // an admin re-categorises it in the PED Library
    await env.repos.mappingState.bump();
    const undo = await undoChangeSet(deps, r.changeSetId!, "Tester (Admin)");
    expect(undo.reverted).toBe(false);
    expect(undo.reason).toMatch(/changed after it was applied/i);
    expect((await env.repos.pedRepository.get(alias!.pedId))?.categoryKey).toBe("liver"); // their edit is intact
    expect((await env.repos.mappingChangeSets.get(r.changeSetId!))?.status).toBe("applied");
  });

  it("Undo refuses when aliases were added to the created PED afterwards", async () => {
    const r = await approve("Quirkelzorb 8810", "heart", heartQuestion, 108);
    const alias = await env.repos.pedAliases.getByNormalizedAlias("quirkelzorb 8810");
    await env.repos.pedAliases.create({ pedId: alias!.pedId, aliasText: "Quirkelzorb eight eight one zero", isPrimary: false, isVisible: true, addedBy: "t" });
    const undo = await undoChangeSet(deps, r.changeSetId!, "Tester (Admin)");
    expect(undo.reverted).toBe(false);
    expect(await env.repos.pedAliases.getByNormalizedAlias("quirkelzorb 8810")).toBeDefined();
  });

  it("every change is audited with who, what and the live lookup that confirmed it", async () => {
    const [applied] = await env.repos.mappingChangeSets.listByAiMemory(107);
    expect(applied.verification).toMatchObject({ term: "Quirkelzorb 7742", planName: PLAN, expectedCategory: "heart" });
    expect((applied.verification as { observed: { effectiveCategory: string } }).observed.effectiveCategory).toBe("heart");
    const rows = await env.db.select().from(pedAliases).where(eq(pedAliases.normalizedAlias, "quirkelzorb 7742"));
    expect(rows).toHaveLength(1);
  });
});

describe("inferCategoryKeyForQuestion", () => {
  const cfg: PlanConfig = {
    questions: ["Question A", "Question B", "Question C"],
    anyOther: "Other",
    hasUmbrella: false,
    umbrellaQuestions: [],
    categoryMap: { cat_unique: 0, cat_ambig_1: 1, cat_ambig_2: 1 },
  } as unknown as PlanConfig;

  it("returns the single categoryKey that resolves to the given question", () => {
    expect(inferCategoryKeyForQuestion(cfg, "Question A")).toBe("cat_unique");
  });

  it("returns null when more than one categoryKey resolves to the same question (ambiguous)", () => {
    expect(inferCategoryKeyForQuestion(cfg, "Question B")).toBeNull();
  });

  it("returns null when no categoryKey resolves to the given question", () => {
    expect(inferCategoryKeyForQuestion(cfg, "Question Z — never mapped")).toBeNull();
  });

  it("returns null for empty question text or a plan with no categoryMap", () => {
    expect(inferCategoryKeyForQuestion(cfg, "")).toBeNull();
    expect(inferCategoryKeyForQuestion({ ...cfg, categoryMap: {} } as unknown as PlanConfig, "Question A")).toBeNull();
  });
});
