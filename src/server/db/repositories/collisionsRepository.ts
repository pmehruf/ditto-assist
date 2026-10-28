/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { collisionRepository, type CollisionRepositoryRow, type NewCollisionRepositoryRow } from "../schema.js";

export type CollisionType = "alias" | "category" | "plan" | "ai" | "regression";

export type CreateCollisionEntry = Omit<NewCollisionRepositoryRow, "id" | "createdAt">;

/**
 * Data Access Layer for `collision_repository` — institutional memory of
 * alias/category/plan/AI/regression collisions
 * (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.8). Named `CollisionsRepository`
 * (plural, matching AnnouncementsRepository/FlaggedIssuesRepository) rather
 * than mirroring the table name exactly, since `CollisionRepositoryRepository`
 * would be nonsense.
 *
 * Advisory-only for now: nothing in the routing engine (src/mapping) reads from this class at
 * match time yet. `severity`/`active` already support a later enforcement
 * layer without a schema change — see "Approved Decisions" #1 in
 * PED_REPOSITORY_DB_MIGRATION_DESIGN.md.
 */
export class CollisionsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(options?: { collisionType?: CollisionType; activeOnly?: boolean }): Promise<CollisionRepositoryRow[]> {
    const filters = [];
    if (options?.collisionType) filters.push(eq(collisionRepository.collisionType, options.collisionType));
    if (options?.activeOnly) filters.push(eq(collisionRepository.active, true));

    const base = this.db.select().from(collisionRepository);
    const query = filters.length ? base.where(and(...filters)) : base;
    return query.orderBy(desc(collisionRepository.createdAt));
  }

  async listByPed(pedId: number): Promise<CollisionRepositoryRow[]> {
    return this.db.select().from(collisionRepository).where(eq(collisionRepository.pedId, pedId));
  }

  /** All active `regression`-type rows for a PED — the exact query a future
   * enforcement layer would run before returning a match, per the "guardrail
   * without a schema change" design. Not called by anything yet. */
  async activeGuardrailsForPed(pedId: number): Promise<CollisionRepositoryRow[]> {
    return this.db
      .select()
      .from(collisionRepository)
      .where(
        and(
          eq(collisionRepository.pedId, pedId),
          eq(collisionRepository.collisionType, "regression"),
          eq(collisionRepository.severity, "guardrail"),
          eq(collisionRepository.active, true)
        )
      );
  }

  async record(entry: CreateCollisionEntry): Promise<CollisionRepositoryRow> {
    const [row] = await this.db.insert(collisionRepository).values(entry).returning();
    return row;
  }

  async setActive(id: number, active: boolean): Promise<CollisionRepositoryRow | undefined> {
    const [row] = await this.db
      .update(collisionRepository)
      .set({ active })
      .where(eq(collisionRepository.id, id))
      .returning();
    return row;
  }
}
