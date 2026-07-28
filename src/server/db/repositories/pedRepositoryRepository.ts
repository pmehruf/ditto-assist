/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pedRepository, type PedRepositoryRow, type NewPedRepositoryRow } from "../schema.js";

export type CreatePedEntry = Omit<NewPedRepositoryRow, "id" | "pedCode" | "createdAt" | "updatedAt">;
export type UpdatePedEntry = Partial<
  Omit<NewPedRepositoryRow, "id" | "pedCode" | "createdAt" | "updatedAt" | "addedBy">
>;

/**
 * Data Access Layer for `ped_repository` — the master disease registry
 * (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.2). Stable internal `id`/
 * `pedCode` identity, independent of `canonicalName`, so renames/spelling
 * corrections never break `ped_aliases`, `plan_overrides`,
 * `mapping_history`, or `collision_repository` rows that reference this PED
 * by id.
 */
export class PedRepositoryRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<PedRepositoryRow[]> {
    return this.db.select().from(pedRepository).orderBy(asc(pedRepository.canonicalName));
  }

  async get(id: number): Promise<PedRepositoryRow | undefined> {
    const [row] = await this.db.select().from(pedRepository).where(eq(pedRepository.id, id));
    return row;
  }

  async getByCode(pedCode: string): Promise<PedRepositoryRow | undefined> {
    const [row] = await this.db.select().from(pedRepository).where(eq(pedRepository.pedCode, pedCode));
    return row;
  }

  async listByCategory(categoryKey: string): Promise<PedRepositoryRow[]> {
    return this.db.select().from(pedRepository).where(eq(pedRepository.categoryKey, categoryKey));
  }

  /**
   * Inserts the row, then formats and stamps `pedCode` ("PED-000421") from
   * the id Postgres just assigned — two statements, not one, since the code
   * is derived from an id that doesn't exist until after the insert.
   * `pedCode` is NOT NULL + unique, so the interim placeholder before the
   * id is known must itself be collision-proof under concurrent inserts —
   * a random UUID, not a shared blank string, guarantees that.
   */
  async create(entry: CreatePedEntry): Promise<PedRepositoryRow> {
    const placeholder = `PENDING-${crypto.randomUUID()}`;
    const [inserted] = await this.db
      .insert(pedRepository)
      .values({ ...entry, pedCode: placeholder } as NewPedRepositoryRow)
      .returning();
    const pedCode = `PED-${String(inserted.id).padStart(6, "0")}`;
    const [row] = await this.db
      .update(pedRepository)
      .set({ pedCode })
      .where(eq(pedRepository.id, inserted.id))
      .returning();
    return row;
  }

  async update(id: number, entry: UpdatePedEntry): Promise<PedRepositoryRow | undefined> {
    const [row] = await this.db
      .update(pedRepository)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(pedRepository.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(pedRepository).where(eq(pedRepository.id, id));
  }
}
