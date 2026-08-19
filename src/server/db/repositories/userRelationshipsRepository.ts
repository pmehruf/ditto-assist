/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, or } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { userRelationships, type UserRelationshipRow } from "../schema.js";

export interface CreateUserRelationshipEntry {
  ownerEmail: string;
  subjectEmail: string;
  relationshipTypeId: number;
  createdBy: string;
}

/**
 * Data Access Layer for `user_relationships` — explicit person-to-person
 * mappings (e.g. mentor -> their mentees). See schema.ts's doc comment on
 * the table for the (owner, subject, relationship type) shape. Read by
 * Admin+Platform Admin+Developer; writes gated to Developer+Platform Admin
 * in the API route layer.
 */
export class UserRelationshipsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<UserRelationshipRow[]> {
    return this.db.select().from(userRelationships);
  }

  /** Every relationship where `email` is either the owner or the subject —
   * used to show "who is this person mapped to/from" on their directory
   * row, and (in a future enforcement phase) to resolve an owner's scoped
   * subject list. */
  async listForEmail(email: string): Promise<UserRelationshipRow[]> {
    return this.db
      .select()
      .from(userRelationships)
      .where(or(eq(userRelationships.ownerEmail, email.toLowerCase()), eq(userRelationships.subjectEmail, email.toLowerCase())));
  }

  async create(entry: CreateUserRelationshipEntry): Promise<UserRelationshipRow> {
    const [row] = await this.db
      .insert(userRelationships)
      .values({
        ownerEmail: entry.ownerEmail.toLowerCase(),
        subjectEmail: entry.subjectEmail.toLowerCase(),
        relationshipTypeId: entry.relationshipTypeId,
        createdBy: entry.createdBy,
      })
      .returning();
    return row;
  }

  /** Hard delete — unlike the catalog tables (org_teams/roles/
   * relationship_types), a mapping row carries no history worth preserving
   * once it's no longer true; removing it is a normal, safe operation. */
  async delete(id: number): Promise<void> {
    await this.db.delete(userRelationships).where(eq(userRelationships.id, id));
  }
}
