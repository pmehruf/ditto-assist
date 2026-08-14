/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, cosineDistance, eq, inArray, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbChunks, kbResources, type KbChunkRow, type NewKbChunkRow } from "../schema.js";

export type CreateKbChunkEntry = Omit<NewKbChunkRow, "id" | "createdAt">;

export interface SimilarKbChunk {
  chunk: KbChunkRow;
  resourceId: number;
  resourceTitle: string;
  categoryId: number;
  /** Cosine distance to the query embedding — lower is more similar (0 =
   * identical direction). Not a percentage; useful for relative ranking
   * and for filtering out weak matches with a distance ceiling. */
  distance: number;
}

const INSERT_BATCH_SIZE = 200;

/** Data Access Layer for `kb_chunks` — embedded text chunks (from PDFs and
 * web resources only; the live Product Playbook Sheet is never embedded,
 * see schema.ts's comment above kbChunks). */
export class KbChunksRepository {
  constructor(private readonly db: AnyDb) {}

  async bulkInsert(entries: CreateKbChunkEntry[]): Promise<void> {
    for (let i = 0; i < entries.length; i += INSERT_BATCH_SIZE) {
      await this.db.insert(kbChunks).values(entries.slice(i, i + INSERT_BATCH_SIZE));
    }
  }

  async listByResource(resourceId: number): Promise<KbChunkRow[]> {
    return this.db.select().from(kbChunks).where(eq(kbChunks.resourceId, resourceId)).orderBy(asc(kbChunks.chunkIndex));
  }

  async deleteByResource(resourceId: number): Promise<void> {
    await this.db.delete(kbChunks).where(eq(kbChunks.resourceId, resourceId));
  }

  /**
   * Nearest-neighbor search over every chunk belonging to an ACTIVE
   * resource, optionally narrowed to a set of category ids (e.g. the
   * insurer(s) mentioned in the advisor's question, plus "general").
   * Joins kb_resources so a resource archived/erroring after its chunks
   * were embedded doesn't keep surfacing in answers.
   */
  async findSimilar(
    queryEmbedding: number[],
    options: { limit?: number; categoryIds?: number[]; resourceIds?: number[] } = {}
  ): Promise<SimilarKbChunk[]> {
    const limit = options.limit ?? 12;
    const distanceExpr = sql<number>`${cosineDistance(kbChunks.embedding, queryEmbedding)}`;
    const conditions = [eq(kbResources.status, "active")];
    if (options.categoryIds && options.categoryIds.length > 0) {
      conditions.push(inArray(kbResources.categoryId, options.categoryIds));
    }
    // Narrows to a pre-filtered eligible resource set — e.g. Query Assist's
    // plan-tag scoping (a resource with plan_tags applies only when its
    // tags overlap the advisor's selected plan(s); the caller resolves
    // that eligibility set in JS since it's a small in-memory filter over
    // one category's resources, not worth a raw array-overlap SQL op here).
    if (options.resourceIds) {
      if (options.resourceIds.length === 0) {
        return [];
      }
      conditions.push(inArray(kbResources.id, options.resourceIds));
    }
    const rows = await this.db
      .select({
        chunk: kbChunks,
        resourceId: kbResources.id,
        resourceTitle: kbResources.title,
        categoryId: kbResources.categoryId,
        distance: distanceExpr,
      })
      .from(kbChunks)
      .innerJoin(kbResources, eq(kbChunks.resourceId, kbResources.id))
      .where(and(...conditions))
      .orderBy(asc(distanceExpr))
      .limit(limit);
    return rows;
  }
}
