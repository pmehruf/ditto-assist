/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pedSuggestions, type PedSuggestionRow, type NewPedSuggestionRow } from "../schema.js";

export type CreatePedSuggestionEntry = Omit<NewPedSuggestionRow, "id" | "createdAt">;
export type UpdatePedSuggestionEntry = Partial<Omit<NewPedSuggestionRow, "id" | "createdAt" | "addedBy">>;

/**
 * Data Access Layer for the Lookup page's autocomplete dropdown source list
 * (the `ped_directory` table, renamed from `ped_suggestions` via migration
 * 0010 — this class/file kept its original name to avoid an app-wide rename
 * churn). Deliberately separate from PedMappingOverrides —
 * this only feeds the suggestion dropdown, not PED classification/matching
 * (see schema.ts's comment on the ped_suggestions table for why). Read by
 * everyone; writes are gated to Admin/Owner in the API route layer, same
 * pattern as ExternalResourcesRepository.
 */
export class PedSuggestionsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<PedSuggestionRow[]> {
    return this.db.select().from(pedSuggestions).orderBy(asc(pedSuggestions.term));
  }

  /**
   * Single row by id. Used by the API layer to capture the "before" state of
   * an edit or delete so the Modification History entry can describe what
   * actually changed rather than just naming the row id.
   */
  async get(id: number): Promise<PedSuggestionRow | undefined> {
    const [row] = await this.db.select().from(pedSuggestions).where(eq(pedSuggestions.id, id));
    return row;
  }

  async create(entry: CreatePedSuggestionEntry): Promise<PedSuggestionRow> {
    const [row] = await this.db.insert(pedSuggestions).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdatePedSuggestionEntry): Promise<PedSuggestionRow | undefined> {
    const [row] = await this.db
      .update(pedSuggestions)
      .set(entry)
      .where(eq(pedSuggestions.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(pedSuggestions).where(eq(pedSuggestions.id, id));
  }
}
