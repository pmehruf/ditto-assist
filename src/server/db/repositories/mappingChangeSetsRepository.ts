/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { desc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { mappingChangeSets, type MappingChangeSetRow, type NewMappingChangeSetRow } from "../schema.js";

export type CreateMappingChangeSet = Omit<NewMappingChangeSetRow, "id" | "performedAt" | "undoneBy" | "undoneAt" | "undoNote">;

/** Audit + undo records for admin mapping actions (see schema.ts mapping_change_sets). */
export class MappingChangeSetsRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateMappingChangeSet): Promise<MappingChangeSetRow> {
    const [row] = await this.db.insert(mappingChangeSets).values(entry).returning();
    return row;
  }

  async get(id: number): Promise<MappingChangeSetRow | undefined> {
    const [row] = await this.db.select().from(mappingChangeSets).where(eq(mappingChangeSets.id, id));
    return row;
  }

  /** Newest first. */
  async listByAiMemory(aiMemoryId: number): Promise<MappingChangeSetRow[]> {
    return this.db.select().from(mappingChangeSets).where(eq(mappingChangeSets.relatedAiMemoryId, aiMemoryId)).orderBy(desc(mappingChangeSets.id));
  }

  async listRecent(limit = 50): Promise<MappingChangeSetRow[]> {
    return this.db.select().from(mappingChangeSets).orderBy(desc(mappingChangeSets.id)).limit(limit);
  }

  async setStatus(id: number, status: "applied" | "undone" | "failed_verification", extra?: { verification?: unknown; undoneBy?: string; undoNote?: string }): Promise<MappingChangeSetRow | undefined> {
    const set: Partial<NewMappingChangeSetRow> = { status };
    if (extra?.verification !== undefined) set.verification = extra.verification;
    if (status === "undone") {
      set.undoneBy = extra?.undoneBy ?? null;
      set.undoneAt = new Date();
      set.undoNote = extra?.undoNote ?? null;
    }
    const [row] = await this.db.update(mappingChangeSets).set(set).where(eq(mappingChangeSets.id, id)).returning();
    return row;
  }
}
