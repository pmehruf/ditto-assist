/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, inArray } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { groupToolAccess, type GroupToolAccessRow } from "../schema.js";

/** One feature grant to save for a group — the redesigned (2026-09d),
 * additive, per-feature-level shape (see schema.ts's doc comment on
 * `group_tool_access`). `level` is always "Viewer" or "Editor" here — a
 * feature the admin doesn't want to grant simply has no entry at all,
 * rather than an explicit "None" entry. */
export interface GroupToolAccessEntry {
  featureId: string;
  level: "Viewer" | "Editor";
}

/**
 * Data Access Layer for `group_tool_access` — see schema.ts's doc comment
 * on the table. Keyed by relationshipGroupId (migration 0081, 2026-09):
 * access is a property of the GROUP, not whoever currently owns it — one
 * owner can manage several groups, each with its own independently
 * configured grant set. Read by Admin+Platform Admin+Developer (Groups
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
   * query — used to compute a member's granted levels (see
   * evaluateAccess.ts's getGroupFeatureLevels) without a per-group round
   * trip when a member belongs to more than one active group-access
   * relationship. */
  async listForGroups(relationshipGroupIds: number[]): Promise<GroupToolAccessRow[]> {
    if (relationshipGroupIds.length === 0) return [];
    return this.db.select().from(groupToolAccess).where(inArray(groupToolAccess.relationshipGroupId, relationshipGroupIds));
  }

  /**
   * Replaces this group's entire grant set in one delete+insert, same
   * "replace the whole set" pattern as kbPlaybookPlanFactsRepository's
   * replaceForResource — the Groups tab always saves a complete Access
   * Control selection (feature + level per row), never a single toggle, so
   * there's no partial-update case to support.
   */
  async replaceForGroup(relationshipGroupId: number, entries: GroupToolAccessEntry[], createdBy: string): Promise<void> {
    await this.db.delete(groupToolAccess).where(eq(groupToolAccess.relationshipGroupId, relationshipGroupId));
    if (entries.length === 0) return;
    // De-dupe by featureId (last one wins) — same defensive intent the old
    // `Array.from(new Set(featureIds))` had, just level-aware now.
    const byFeatureId = new Map<string, GroupToolAccessEntry>();
    for (const entry of entries) byFeatureId.set(entry.featureId, entry);
    await this.db.insert(groupToolAccess).values(
      Array.from(byFeatureId.values()).map(({ featureId, level }) => ({ relationshipGroupId, featureId, level, createdBy }))
    );
  }
}
