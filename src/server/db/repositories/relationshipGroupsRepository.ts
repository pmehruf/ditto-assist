/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { relationshipGroups, type RelationshipGroupRow } from "../schema.js";

export interface CreateRelationshipGroupEntry {
  name: string;
  description: string | null;
  departmentId: number | null;
  createdBy: string;
  /** Which tier of member this group's usedForGroupAccess ceiling will
   * restrict (see schema.ts's doc comment on `relationshipGroups.groupTier`
   * for the full semantics) — optional, omit to take the column's own
   * default ("General") exactly as every group did before this field
   * existed. Never coerced/defaulted here in code so an explicit value is
   * never silently altered. */
  groupTier?: RelationshipGroupRow["groupTier"];
}

export type UpdateRelationshipGroupEntry = Partial<Pick<RelationshipGroupRow, "name" | "description" | "active" | "departmentId" | "usedForGroupAccess" | "groupTier">>;

/**
 * Data Access Layer for `relationship_groups` (Mentor / Guide / ...) — the
 * vocabulary usable in user_relationships. Read by Admin+Platform
 * Admin+Developer; writes gated to Developer+Platform Admin in the API
 * route layer. Renamed from RelationshipTypesRepository (migration 0078,
 * 2026-09) — same table/behavior, "group" instead of "type" throughout.
 */
export class RelationshipGroupsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<RelationshipGroupRow[]> {
    return this.db.select().from(relationshipGroups).orderBy(asc(relationshipGroups.name));
  }

  async get(id: number): Promise<RelationshipGroupRow | undefined> {
    const [row] = await this.db.select().from(relationshipGroups).where(eq(relationshipGroups.id, id));
    return row;
  }

  async create(entry: CreateRelationshipGroupEntry): Promise<RelationshipGroupRow> {
    const [row] = await this.db
      .insert(relationshipGroups)
      .values({
        name: entry.name,
        description: entry.description,
        departmentId: entry.departmentId,
        createdBy: entry.createdBy,
        // Omit the key entirely when not provided, same convention `active`
        // already relies on above — lets the column's own default
        // ("General") apply rather than this layer duplicating it.
        ...(entry.groupTier !== undefined ? { groupTier: entry.groupTier } : {}),
      })
      .returning();
    return row;
  }

  async update(id: number, patch: UpdateRelationshipGroupEntry): Promise<RelationshipGroupRow | undefined> {
    const [row] = await this.db.update(relationshipGroups).set(patch).where(eq(relationshipGroups.id, id)).returning();
    return row;
  }

  /** Hard delete — safe because the FK from user_relationships onto this
   * table is ON DELETE RESTRICT (see schema.ts), so Postgres itself refuses
   * this delete outright while any mapping still references the group. The
   * caller (server.ts's DELETE route) checks that up front for a clean
   * error message rather than surfacing the raw DB error. */
  async delete(id: number): Promise<void> {
    await this.db.delete(relationshipGroups).where(eq(relationshipGroups.id, id));
  }
}
