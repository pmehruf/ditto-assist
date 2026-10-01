/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, eq, or } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { userRelationships, type UserRelationshipRow } from "../schema.js";

export interface CreateUserRelationshipEntry {
  ownerEmail: string;
  subjectEmail: string;
  relationshipGroupId: number;
  createdBy: string;
}

/**
 * Data Access Layer for `user_relationships` — explicit person-to-person
 * mappings (e.g. mentor -> their mentees). See schema.ts's doc comment on
 * the table for the (owner, subject, relationship group) shape. Read by
 * Admin+Platform Admin+Developer; writes gated to Developer+Platform Admin
 * in the API route layer.
 */
export class UserRelationshipsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<UserRelationshipRow[]> {
    return this.db.select().from(userRelationships);
  }

  /** Single row by id — added 2026-09h so server.ts's ownership-aware
   * authorization (requireGroupAccessEditor) can look up which
   * relationshipGroupId a given mapping belongs to BEFORE deciding whether
   * DELETE /api/user-relationships/:id is allowed, without first requiring
   * blanket group_management Editor. */
  async get(id: number): Promise<UserRelationshipRow | undefined> {
    const [row] = await this.db.select().from(userRelationships).where(eq(userRelationships.id, id));
    return row;
  }

  /** Whether `email` is a mapped OWNER (not merely a subject) of at least
   * one roster row in `relationshipGroupId` — the ownership check behind
   * "a group owner must be able to view and modify their own group" (2026-09h,
   * at the user's explicit request). Deliberately does not check `active`
   * on either the relationship row or its group: an owner whose group was
   * just deactivated should still be able to reactivate it or manage its
   * roster, not get locked out the moment it's disabled. */
  async isOwnerOfGroup(relationshipGroupId: number, email: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: userRelationships.id })
      .from(userRelationships)
      .where(and(eq(userRelationships.relationshipGroupId, relationshipGroupId), eq(userRelationships.ownerEmail, email.toLowerCase())))
      .limit(1);
    return rows.length > 0;
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
        relationshipGroupId: entry.relationshipGroupId,
        createdBy: entry.createdBy,
      })
      .returning();
    return row;
  }

  /** Hard delete — unlike the catalog tables (org_teams/roles/
   * relationship_groups), a mapping row carries no history worth preserving
   * once it's no longer true; removing it is a normal, safe operation. */
  async delete(id: number): Promise<void> {
    await this.db.delete(userRelationships).where(eq(userRelationships.id, id));
  }

  /**
   * Moves an owner's ENTIRE roster within one group to a new owner, in a
   * single transaction — the "Reassign Owner" action, so an admin never has
   * to delete-then-recreate every mapping by hand (and risk a partial
   * failure leaving the roster half-moved). Group access itself is
   * completely unaffected either way — access is keyed by
   * relationshipGroupId, not ownerEmail (migration 0081) — this purely
   * changes who's shown as managing the roster.
   *
   * If the new owner already has some of the same subjects mapped in this
   * same group (a pre-existing overlap), those specific old-owner rows are
   * dropped instead of updated, rather than colliding with the unique
   * (owner, subject, group) index — reassignment always succeeds for every
   * OTHER row rather than failing the whole operation over one duplicate.
   * Returns how many rows actually moved vs. were dropped as
   * already-present duplicates, so the caller can report an accurate
   * summary.
   */
  async reassignOwner(
    relationshipGroupId: number,
    fromOwnerEmail: string,
    toOwnerEmail: string
  ): Promise<{ reassigned: number; duplicatesDropped: number }> {
    const from = fromOwnerEmail.toLowerCase();
    const to = toOwnerEmail.toLowerCase();
    return this.db.transaction(async (tx) => {
      const existingForFrom = await tx
        .select()
        .from(userRelationships)
        .where(and(eq(userRelationships.relationshipGroupId, relationshipGroupId), eq(userRelationships.ownerEmail, from)));
      if (existingForFrom.length === 0) return { reassigned: 0, duplicatesDropped: 0 };

      const existingForTo = await tx
        .select()
        .from(userRelationships)
        .where(and(eq(userRelationships.relationshipGroupId, relationshipGroupId), eq(userRelationships.ownerEmail, to)));
      const toSubjects = new Set(existingForTo.map((r) => r.subjectEmail));

      let reassigned = 0;
      let duplicatesDropped = 0;
      for (const row of existingForFrom) {
        if (toSubjects.has(row.subjectEmail)) {
          await tx.delete(userRelationships).where(eq(userRelationships.id, row.id));
          duplicatesDropped++;
        } else {
          await tx.update(userRelationships).set({ ownerEmail: to }).where(eq(userRelationships.id, row.id));
          reassigned++;
        }
      }
      return { reassigned, duplicatesDropped };
    });
  }
}
