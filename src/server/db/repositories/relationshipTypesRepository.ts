/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { relationshipTypes, type RelationshipTypeRow } from "../schema.js";

export interface CreateRelationshipTypeEntry {
  name: string;
  description: string | null;
  createdBy: string;
}

export type UpdateRelationshipTypeEntry = Partial<Pick<RelationshipTypeRow, "name" | "description" | "active">>;

/**
 * Data Access Layer for `relationship_types` (Mentor / Guide / ...) — the
 * vocabulary usable in user_relationships. Read by Admin+Platform
 * Admin+Developer; writes gated to Developer+Platform Admin in the API
 * route layer.
 */
export class RelationshipTypesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<RelationshipTypeRow[]> {
    return this.db.select().from(relationshipTypes).orderBy(asc(relationshipTypes.name));
  }

  async get(id: number): Promise<RelationshipTypeRow | undefined> {
    const [row] = await this.db.select().from(relationshipTypes).where(eq(relationshipTypes.id, id));
    return row;
  }

  async create(entry: CreateRelationshipTypeEntry): Promise<RelationshipTypeRow> {
    const [row] = await this.db
      .insert(relationshipTypes)
      .values({ name: entry.name, description: entry.description, createdBy: entry.createdBy })
      .returning();
    return row;
  }

  async update(id: number, patch: UpdateRelationshipTypeEntry): Promise<RelationshipTypeRow | undefined> {
    const [row] = await this.db.update(relationshipTypes).set(patch).where(eq(relationshipTypes.id, id)).returning();
    return row;
  }
}
