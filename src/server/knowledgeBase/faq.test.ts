/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { resolveApplicableFaqs, FAQ_RELEVANCE_THRESHOLD } from "./faq.js";
import type { FaqRecordRow } from "../db/schema.js";

const RELEVANT_EMBEDDING = [1, 0, 0];
const IRRELEVANT_EMBEDDING = [0, 1, 0];
const SOMEWHAT_RELEVANT_EMBEDDING = [0.7, 0.3, 0]; // cosine sim with [1,0,0] ≈ 0.919, still above threshold
const QUERY_EMBEDDING = [1, 0, 0];

function faqRow(overrides: Partial<FaqRecordRow> = {}): FaqRecordRow {
  return {
    id: 1,
    resourceId: 1,
    category: "health_product",
    question: "Can we do mid-term inclusion through Ditto?",
    answer: "No, Ditto does not currently facilitate this.",
    isAnswerable: true,
    hasConflict: false,
    conflictGroupKey: null,
    questionEmbedding: RELEVANT_EMBEDDING as unknown as FaqRecordRow["questionEmbedding"],
    sourceRowNumber: 2,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("resolveApplicableFaqs", () => {
  it("returns nothing when the table is empty — behavior identical to before this feature existed", () => {
    const matches = resolveApplicableFaqs([], QUERY_EMBEDDING);
    expect(matches).toHaveLength(0);
  });

  it("matches a record whose question embedding is close to the query embedding", () => {
    const matches = resolveApplicableFaqs([faqRow()], QUERY_EMBEDDING);
    expect(matches).toHaveLength(1);
    expect(matches[0].question).toBe("Can we do mid-term inclusion through Ditto?");
    expect(matches[0].score).toBeGreaterThanOrEqual(FAQ_RELEVANCE_THRESHOLD);
  });

  it("does not match an unrelated question — no vague keyword-only matching", () => {
    const matches = resolveApplicableFaqs([faqRow({ questionEmbedding: IRRELEVANT_EMBEDDING as unknown as FaqRecordRow["questionEmbedding"] })], QUERY_EMBEDDING);
    expect(matches).toHaveLength(0);
  });

  it("matches a strong-but-not-exact semantic match above the threshold", () => {
    const matches = resolveApplicableFaqs(
      [faqRow({ questionEmbedding: SOMEWHAT_RELEVANT_EMBEDDING as unknown as FaqRecordRow["questionEmbedding"] })],
      QUERY_EMBEDDING
    );
    expect(matches).toHaveLength(1);
  });

  it("caps results and sorts by score descending", () => {
    const rows = [
      faqRow({ id: 1, question: "Q1", questionEmbedding: [1, 0, 0] as unknown as FaqRecordRow["questionEmbedding"] }),
      faqRow({ id: 2, question: "Q2", questionEmbedding: [0.99, 0.01, 0] as unknown as FaqRecordRow["questionEmbedding"] }),
      faqRow({ id: 3, question: "Q3", questionEmbedding: [0.95, 0.05, 0] as unknown as FaqRecordRow["questionEmbedding"] }),
      faqRow({ id: 4, question: "Q4", questionEmbedding: [0.9, 0.1, 0] as unknown as FaqRecordRow["questionEmbedding"] }),
    ];
    const matches = resolveApplicableFaqs(rows, QUERY_EMBEDDING);
    expect(matches.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  it("skips a record with a null question embedding (defensive — repository filter should already exclude these)", () => {
    const matches = resolveApplicableFaqs([faqRow({ questionEmbedding: null })], QUERY_EMBEDDING);
    expect(matches).toHaveLength(0);
  });
});
