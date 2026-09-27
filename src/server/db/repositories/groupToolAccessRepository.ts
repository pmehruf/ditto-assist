/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, inArray } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { groupToolAccess, type GroupToolAccessRow } from "../schema.js";

/**
 * Data Access Layer for `group_tool_access` — see schema.ts's doc comment
 * on the table. Keyed by relationshipGroupId (migration 0081, 2026-09):
 * access is a property of the GROUP, not whoever currently owns it — one
 * owner can manage several groups, each with its own independently
 * configured tool set. Read by Admin+Platform Admin+Developer (Group Access
 * tab); writes gated to "group_management" Editor in the API route layer
 * (Developer/Platform Admin always, plus anyone holding an explicit Custom
 * Grant for it — see featurePermissions.ts).
 */
export class GroupToolAccessRepository {
  constructor(private readonly db: AnyDb) {}

  async listAll(): Promise<GroupToolAccessRow[]> {
    return this.db.select().from(groupToolAccess);
  }

  async listForGroup(relationshipGroupId: number): Promise<GroupToolAccessRow[]> {
    return this.db.select().from(groupToolAccess).where(eq(groupToolAccess.relationshipGroupId, relationshipGroupId));
  }

  /** Every group-access row for the given set of relationship groups in one
   * query — used to compute a member's allowed set (see
   * evaluateAccess.ts's getGroupAllowedFeatureIds) without a per-group round
   * trip when a member belongs to more than one active group-access
   * relationship. */
  async listForGroups(relationshipGroupIds: number[]): Promise<GroupToolAccessRow[]> {
    if (relationshipGroupIds.length === 0) return [];
    return this.db.select().from(groupToolAccess).where(inArray(groupToolAccess.relationshipGroupId, relationshipGroupIds));
  }

  /**
   * Replaces this group's entire tool set in one delete+insert, same
   * "replace the whole set" pattern as kbPlaybookPlanFactsRepository's
   * replaceForResource — the Groups tab always saves a complete
   * checkbox selection, never a single toggle, so there's no partial-update
   * case to support.
   */
  async replaceForGroup(relationshipGroupId: number, featureIds: string[], createdBy: string): Promise<void> {
    await this.db.delete(groupToolAccess).where(eq(groupToolAccess.relationshipGroupId, relationshipGroupId));
    if (featureIds.length === 0) return;
    await this.db.insert(groupToolAccess).values(
      Array.from(new Set(featureIds)).map((featureId) => ({ relationshipGroupId, featureId, createdBy }))
    );
  }
}
