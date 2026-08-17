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
