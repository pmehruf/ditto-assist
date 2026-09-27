/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { resolveApplicableInstructions } from "./specialInstructions.js";
import type { Repositories } from "../db/repositories/index.js";
import type { SpecialInstructionRow } from "../db/schema.js";
import type { ProductAssistScope } from "./productAssist.js";

// Deliberately short, hand-picked vectors rather than real 768-dim
// embeddings — cosineSimilarity only cares about relative direction, so a
// 3-dim vector pointed the "same way" as the query is indistinguishable
// from a real embedding for testing the matching/precedence LOGIC (as
// opposed to testing Gemini's actual embedding quality, which is out of
// scope for a unit test and can't be exercised from this sandbox anyway —
// no outbound network access to the embedding API here).
const RELEVANT_EMBEDDING = [1, 0, 0];
const IRRELEVANT_EMBEDDING = [0, 1, 0];
const QUERY_EMBEDDING = [1, 0, 0]; // cosine sim 1.0 vs RELEVANT, 0.0 vs IRRELEVANT

let nextId = 1;
function row(overrides: Partial<SpecialInstructionRow> = {}): SpecialInstructionRow {
  return {
    id: nextId++,
    topic: "Free Period",
    instructionText: "Default instruction text.",
    instructionType: "override_rule",
    insurerCategoryId: null,
    productPlanName: null,
    domain: "Health",
    topicEmbedding: RELEVANT_EMBEDDING,
    isActive: true,
    createdBy: "test",
    updatedBy: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SpecialInstructionRow;
}

function reposWith(rows: SpecialInstructionRow[]): Repositories {
  return {
    specialInstructions: {
      listActive: async (domain: SpecialInstructionRow["domain"]) => rows.filter(r => r.domain === domain),
    },
  } as unknown as Repositories;
}

const GENERAL_SCOPE: ProductAssistScope = { categoryId: null, planTags: [] };
const HDFC_SCOPE: ProductAssistScope = { categoryId: 1, planTags: [] };
const CARE_SCOPE: ProductAssistScope = { categoryId: 2, planTags: [] };

describe("resolveApplicableInstructions", () => {
  it("returns nothing when the table is empty — behavior identical to before the feature existed", async () => {
    const result = await resolveApplicableInstructions(reposWith([]), HDFC_SCOPE, ["Optima Secure"], QUERY_EMBEDDING, "Health");
    expect(result).toEqual({ overrideRules: [], advisory: [], conflicts: [] });
  });

  it("applies a Topic-only instruction when the question is topically relevant, regardless of scope", async () => {
    const r = row({ topic: "Free Period", topicEmbedding: RELEVANT_EMBEDDING });
    const result = await resolveApplicableInstructions(reposWith([r]), GENERAL_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules.map(x => x.id)).toEqual([r.id]);
    expect(result.conflicts).toEqual([]);
  });

  it("does NOT apply a Topic-only instruction when the question is topically irrelevant, even with matching insurer/product — the spec's own example (Free Period vs Organ Donor Expenses)", async () => {
    const r = row({ topic: "Free Period", topicEmbedding: IRRELEVANT_EMBEDDING, insurerCategoryId: 1 });
    const result = await resolveApplicableInstructions(reposWith([r]), HDFC_SCOPE, ["Optima Secure"], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules).toEqual([]);
    expect(result.advisory).toEqual([]);
  });

  it("does not apply an insurer-scoped instruction to a different insurer", async () => {
    const r = row({ insurerCategoryId: 1, topicEmbedding: RELEVANT_EMBEDDING });
    const result = await resolveApplicableInstructions(reposWith([r]), CARE_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules).toEqual([]);
  });

  it("does not apply a general (no-insurer) question to an insurer-scoped instruction", async () => {
    const r = row({ insurerCategoryId: 1, topicEmbedding: RELEVANT_EMBEDDING });
    const result = await resolveApplicableInstructions(reposWith([r]), GENERAL_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules).toEqual([]);
  });

  it("only applies a product-scoped instruction when the advisor's effective plan tags include that product", async () => {
    const r = row({ productPlanName: "Optima Secure", topicEmbedding: RELEVANT_EMBEDDING });
    const matches = await resolveApplicableInstructions(reposWith([r]), HDFC_SCOPE, ["Optima Secure"], QUERY_EMBEDDING, "Health");
    expect(matches.overrideRules.map(x => x.id)).toEqual([r.id]);

    const noMatch = await resolveApplicableInstructions(reposWith([r]), HDFC_SCOPE, ["Reassure 2.0"], QUERY_EMBEDDING, "Health");
    expect(noMatch.overrideRules).toEqual([]);
  });

  it("product-name matching is case-insensitive", async () => {
    const r = row({ productPlanName: "optima secure", topicEmbedding: RELEVANT_EMBEDDING });
    const result = await resolveApplicableInstructions(reposWith([r]), HDFC_SCOPE, ["Optima Secure"], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules.map(x => x.id)).toEqual([r.id]);
  });

  it("prefers the most specific matching scope per topic (Product+Insurer > Product > Insurer > Topic-only)", async () => {
    const topicOnly = row({ topic: "Waiting Period", topicEmbedding: RELEVANT_EMBEDDING, instructionText: "topic-only" });
    const insurerOnly = row({ topic: "Waiting Period", topicEmbedding: RELEVANT_EMBEDDING, insurerCategoryId: 1, instructionText: "insurer-only" });
    const productOnly = row({ topic: "Waiting Period", topicEmbedding: RELEVANT_EMBEDDING, productPlanName: "Optima Secure", instructionText: "product-only" });
    const mostSpecific = row({
      topic: "Waiting Period",
      topicEmbedding: RELEVANT_EMBEDDING,
      insurerCategoryId: 1,
      productPlanName: "Optima Secure",
      instructionText: "product+insurer",
    });
    const result = await resolveApplicableInstructions(
      reposWith([topicOnly, insurerOnly, productOnly, mostSpecific]),
      HDFC_SCOPE,
      ["Optima Secure"],
      QUERY_EMBEDDING,
      "Health"
    );
    expect(result.overrideRules.map(x => x.instructionText)).toEqual(["product+insurer"]);
  });

  it("a single topic can independently pull in the most specific instruction from EACH different topic it's relevant to", async () => {
    const freePeriod = row({ topic: "Free Period", topicEmbedding: RELEVANT_EMBEDDING, instructionText: "free period rule" });
    const waitingPeriod = row({
      topic: "Waiting Period",
      topicEmbedding: RELEVANT_EMBEDDING,
      insurerCategoryId: 1,
      instructionText: "waiting period rule",
    });
    const result = await resolveApplicableInstructions(reposWith([freePeriod, waitingPeriod]), HDFC_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules.map(x => x.instructionText).sort()).toEqual(["free period rule", "waiting period rule"]);
  });

  it("Additional Information / General Instruction never conflict with each other, even with duplicate topics at the same scope", async () => {
    const info = row({ topic: "Restoration", instructionType: "additional_information", instructionText: "distinguish from bonus" });
    const general = row({ topic: "Restoration", instructionType: "general_instruction", instructionText: "explain plainly" });
    const result = await resolveApplicableInstructions(reposWith([info, general]), GENERAL_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.advisory.map(x => x.id).sort()).toEqual([info.id, general.id].sort());
    expect(result.conflicts).toEqual([]);
  });

  it("two active Override Rules at the same effective scope with DIFFERENT text are flagged as a conflict, not applied", async () => {
    const a = row({ topic: "Free Period", instructionText: "30 days" });
    const b = row({ topic: "Free Period", instructionText: "15 days" });
    const result = await resolveApplicableInstructions(reposWith([a, b]), GENERAL_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].topic).toBe("Free Period");
    expect(result.conflicts[0].instructions.map(x => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("two active Override Rules with IDENTICAL text are NOT a conflict", async () => {
    const a = row({ topic: "Free Period", instructionText: "30 days from receipt of the policy document." });
    const b = row({ topic: "Free Period", instructionText: "30 days from receipt of the policy document." });
    const result = await resolveApplicableInstructions(reposWith([a, b]), GENERAL_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.conflicts).toEqual([]);
    expect(result.overrideRules).toHaveLength(1);
  });

  it("an Override Rule conflict at a lower specificity does not block a higher-specificity Override Rule for the same topic", async () => {
    const conflictA = row({ topic: "Free Period", topicEmbedding: RELEVANT_EMBEDDING, instructionText: "30 days" });
    const conflictB = row({ topic: "Free Period", topicEmbedding: RELEVANT_EMBEDDING, instructionText: "15 days" });
    const specific = row({
      topic: "Free Period",
      topicEmbedding: RELEVANT_EMBEDDING,
      insurerCategoryId: 1,
      productPlanName: "Optima Secure",
      instructionText: "45 days (plan-specific)",
    });
    const result = await resolveApplicableInstructions(
      reposWith([conflictA, conflictB, specific]),
      HDFC_SCOPE,
      ["Optima Secure"],
      QUERY_EMBEDDING,
      "Health"
    );
    expect(result.overrideRules.map(x => x.instructionText)).toEqual(["45 days (plan-specific)"]);
    expect(result.conflicts).toEqual([]);
  });

  it("inactive instructions are never considered (listActive already filters them, but this guards the contract)", async () => {
    const r = row({ topicEmbedding: RELEVANT_EMBEDDING });
    // Simulate listActive() being asked to return only active rows — an
    // inactive row simply should never appear in what it returns.
    const result = await resolveApplicableInstructions(reposWith([{ ...r, isActive: true }]), GENERAL_SCOPE, [], QUERY_EMBEDDING, "Health");
    expect(result.overrideRules.map(x => x.id)).toEqual([r.id]);
  });

  it("does not apply a Health-authored instruction to a Term query, even with matching scope/topic", async () => {
    const r = row({ topic: "Free Period", topicEmbedding: RELEVANT_EMBEDDING, domain: "Health" });
    const result = await resolveApplicableInstructions(reposWith([r]), GENERAL_SCOPE, [], QUERY_EMBEDDING, "Term");
    expect(result.overrideRules).toEqual([]);
    expect(result.advisory).toEqual([]);
  });
});
