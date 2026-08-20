/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, desc, eq, ilike } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { specialInstructions, type SpecialInstructionRow, type NewSpecialInstructionRow } from "../schema.js";

export type CreateSpecialInstructionEntry = Omit<NewSpecialInstructionRow, "id" | "createdAt" | "updatedAt">;
export type UpdateSpecialInstructionEntry = Partial<
  Pick<
    NewSpecialInstructionRow,
    "topic" | "instructionText" | "instructionType" | "insurerCategoryId" | "productPlanName" | "topicEmbedding" | "isActive" | "updatedBy"
  >
>;

export interface SpecialInstructionFilter {
  topic?: string;
  instructionType?: SpecialInstructionRow["instructionType"];
  insurerCategoryId?: number;
  isActive?: boolean;
}

/** Data Access Layer for `special_instructions` — Product Assist's
 * controlled instruction-override layer. See schema.ts's doc comment on
 * the table for the full design. */
export class SpecialInstructionsRepository {
  constructor(private readonly db: AnyDb) {}

  /** UI listing — supports the Knowledge Hub table's search/filter (Topic,
   * Instruction Type, Insurer, Status). Product/Plan filtering is done
   * client-side (small dataset, and matching is case-insensitive substring
   * on a free-text field — not worth a query round trip per keystroke). */
  async list(filter: SpecialInstructionFilter = {}): Promise<SpecialInstructionRow[]> {
    const conditions = [];
    if (filter.topic) conditions.push(ilike(specialInstructions.topic, `%${filter.topic}%`));
    if (filter.instructionType) conditions.push(eq(specialInstructions.instructionType, filter.instructionType));
    if (filter.insurerCategoryId !== undefined) conditions.push(eq(specialInstructions.insurerCategoryId, filter.insurerCategoryId));
    if (filter.isActive !== undefined) conditions.push(eq(specialInstructions.isActive, filter.isActive));
    return this.db
      .select()
      .from(specialInstructions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(specialInstructions.updatedAt), asc(specialInstructions.topic));
  }

  /** Every active instruction, for query-time matching — see
   * src/server/knowledgeBase/specialInstructions.ts. Deliberately fetches
   * ALL active rows rather than pre-filtering by scope in SQL: this table
   * is admin-curated and expected to stay small (tens, not thousands of
   * rows), topic relevance has to be computed in JS via embedding cosine
   * similarity anyway (pgvector isn't used for ranking here, just storage),
   * and doing the scope+topic resolution together in one place keeps the
   * specificity-ladder and conflict-detection logic auditable in one
   * function instead of split across SQL and JS. */
  async listActive(): Promise<SpecialInstructionRow[]> {
    return this.db.select().from(specialInstructions).where(eq(specialInstructions.isActive, true));
  }

  async get(id: number): Promise<SpecialInstructionRow | undefined> {
    const [row] = await this.db.select().from(specialInstructions).where(eq(specialInstructions.id, id));
    return row;
  }

  async create(entry: CreateSpecialInstructionEntry): Promise<SpecialInstructionRow> {
    const [row] = await this.db.insert(specialInstructions).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdateSpecialInstructionEntry): Promise<SpecialInstructionRow | undefined> {
    const [row] = await this.db
      .update(specialInstructions)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(specialInstructions.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(specialInstructions).where(eq(specialInstructions.id, id));
  }
}
