/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { kbCategories, kbResources } from "../schema.js";
import { KbChunksRepository } from "./kbChunksRepository.js";

function fakeEmbedding(seed: number): number[] {
  // 768-dim vector, mostly zeros with one component nudged by `seed` — cheap
  // to construct and gives cosineDistance a clear, deterministic ranking
  // between vectors without needing real embeddings for this test.
  const v = new Array(768).fill(0);
  v[0] = 1;
  v[1] = seed;
  return v;
}

describe("KbChunksRepository.findSimilar", () => {
  let db: TestDb;
  let repo: KbChunksRepository;
  let resourceId: number;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new KbChunksRepository(db);

    const [category] = await db.insert(kbCategories).values({ name: "Test Insurer", type: "insurer" }).returning();
    const [resource] = await db
      .insert(kbResources)
      .values({
        categoryId: category.id,
        type: "pdf",
        title: "Test Brochure",
        documentType: "brochure",
        sourceUrl: "https://example.com/brochure.pdf",
        status: "active",
        addedBy: "test@joinditto.in",
      })
      .returning();
    resourceId = resource.id;

    await repo.bulkInsert([
      { resourceId, chunkIndex: 0, content: "closest chunk", embedding: fakeEmbedding(0) },
      { resourceId, chunkIndex: 1, content: "farther chunk", embedding: fakeEmbedding(5) },
    ]);
  });

  describe("documentTypes filter — progressive source-priority retrieval", () => {
    let policyWordingResourceId: number;

    beforeEach(async () => {
      const [category] = await db.select().from(kbCategories);
      const [pwResource] = await db
        .insert(kbResources)
        .values({
          categoryId: category.id,
          type: "pdf",
          title: "Test Policy Wording",
          documentType: "policy_wording",
          status: "active",
          addedBy: "test@joinditto.in",
        })
        .returning();
      policyWordingResourceId = pwResource.id;
      await repo.bulkInsert([
        { resourceId: policyWordingResourceId, chunkIndex: 0, content: "policy wording chunk", embedding: fakeEmbedding(0) },
      ]);
    });

    it("narrows results to only the requested document type(s), even when a closer-matching chunk exists on another type", async () => {
      // fakeEmbedding(0) is the exact vector both the brochure's "closest
      // chunk" (set up in the outer beforeEach) and this policy_wording
      // chunk were embedded with — without the documentTypes filter, both
      // would be top matches. With it, only the policy_wording one may
      // return.
      const results = await repo.findSimilar(fakeEmbedding(0), { limit: 12, documentTypes: ["policy_wording"] });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.documentType).toBe("policy_wording");
      }
      expect(results.some(r => r.resourceId === policyWordingResourceId)).toBe(true);
    });

    it("supports multiple document types in one call (e.g. the brochure/addon/other fallback tier)", async () => {
      const results = await repo.findSimilar(fakeEmbedding(0), { limit: 12, documentTypes: ["brochure", "addon", "other"] });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(["brochure", "addon", "other"]).toContain(r.documentType);
      }
    });

    it("an empty/omitted documentTypes filter behaves exactly as before — no restriction", async () => {
      const results = await repo.findSimilar(fakeEmbedding(0), { limit: 12 });
      const types = new Set(results.map(r => r.documentType));
      expect(types.has("brochure")).toBe(true);
      expect(types.has("policy_wording")).toBe(true);
    });

    it("limit 0 (a fully-consumed retrieval budget) returns no rows without erroring", async () => {
      const results = await repo.findSimilar(fakeEmbedding(0), { limit: 0, documentTypes: ["policy_wording"] });
      expect(results).toEqual([]);
    });
  });

  afterEach(async () => {
    await db.$client.close();
  });

  it("never returns the embedding column, but keeps content and the rest of the chunk", async () => {
    const results = await repo.findSimilar(fakeEmbedding(0), { limit: 12 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.chunk).not.toHaveProperty("embedding");
      expect(typeof r.chunk.content).toBe("string");
      expect(r.chunk).toHaveProperty("id");
      expect(r.chunk).toHaveProperty("chunkIndex");
    }
  });

  it("similarity ordering is unaffected — closest vector still ranks first", async () => {
    const results = await repo.findSimilar(fakeEmbedding(0), { limit: 12 });
    expect(results[0].chunk.content).toBe("closest chunk");
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it("still surfaces documentType and sourceUrl for citations", async () => {
    const results = await repo.findSimilar(fakeEmbedding(0), { limit: 12 });
    expect(results[0].documentType).toBe("brochure");
    expect(results[0].sourceUrl).toBe("https://example.com/brochure.pdf");
  });
});
