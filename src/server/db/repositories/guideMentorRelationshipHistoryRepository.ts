/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { guideMentorRelationshipHistory, type GuideMentorRelationshipHistoryRow } from "../schema.js";

export type GuideMentorRelationshipKind = "guide" | "mentor";
export type GuideMentorRelationshipSource = "manual" | "sync";

/**
 * Data Access Layer for `guide_mentor_relationship_history` — see
 * schema.ts's table comment for the full reasoning. Both
 * GuideMentorAdvisorMappingsRepository.update() (manual edits) and
 * .upsertFromSync() (sheet-detected changes) call changeRelationship() here
 * as a side effect whenever an advisor's Guide or Mentor actually changes,
 * so the two call sites share one lifecycle implementation instead of
 * duplicating the terminate-then-create logic.
 */
export class GuideMentorRelationshipHistoryRepository {
  constructor(private readonly db: AnyDb) {}

  /** Every history row, unfiltered — used by qaDataEngine.ts's
   * buildAdvisorSnapshotAsOf() to resolve every advisor's Guide/Mentor as
   * of a given date in one query instead of one query per advisor. Small
   * table (a handful of rows per advisor), so a full scan here is cheap
   * and simpler than a per-tactId lookup loop. */
  async listAll(): Promise<GuideMentorRelationshipHistoryRow[]> {
    return this.db.select().from(guideMentorRelationshipHistory);
  }

  /** Full timeline for one advisor, newest first — used by the
   * Master Advisors page's per-advisor History view. */
  async listForAdvisor(tactId: string): Promise<GuideMentorRelationshipHistoryRow[]> {
    return this.db
      .select()
      .from(guideMentorRelationshipHistory)
      .where(eq(guideMentorRelationshipHistory.tactId, tactId))
      .orderBy(desc(guideMentorRelationshipHistory.startDate), desc(guideMentorRelationshipHistory.id));
  }

  /** The single row currently marked active for (tactId, kind), if any —
   * at most one should ever exist per the invariant this repository
   * maintains in changeRelationship(). */
  async getActive(tactId: string, kind: GuideMentorRelationshipKind): Promise<GuideMentorRelationshipHistoryRow | undefined> {
    const rows = await this.db
      .select()
      .from(guideMentorRelationshipHistory)
      .where(
        and(
          eq(guideMentorRelationshipHistory.tactId, tactId),
          eq(guideMentorRelationshipHistory.kind, kind),
          eq(guideMentorRelationshipHistory.isActive, true)
        )
      )
      .orderBy(desc(guideMentorRelationshipHistory.id))
      .limit(1);
    return rows[0];
  }

  /**
   * Terminates the current active relationship of this kind (if one
   * exists and its person differs from newPersonName — a no-op edit that
   * re-saves the same name never touches history) and, if newPersonName is
   * non-empty, starts a new active one in its place. This is the single
   * lifecycle implementation both the manual-edit and sync-detected-change
   * call sites share (see class doc comment above).
   *
   * effectiveDate ("yyyy-MM-dd") is the date recorded as both the old
   * row's endDate and the new row's startDate — for a manual edit this is
   * whatever date the editor chose (defaulting to today in the UI); for a
   * sync-detected change it's the sync run's own date, since the sheet
   * doesn't carry a per-relationship effective date to read instead.
   *
   * Does nothing (no rows written) when newPersonName already matches the
   * current active person, trimmed/case-sensitively equal — this is the
   * "no real change" guard that keeps a re-save from generating a
   * meaningless history entry.
   */
  async changeRelationship(
    tactId: string,
    kind: GuideMentorRelationshipKind,
    newPersonName: string | null,
    effectiveDate: string,
    source: GuideMentorRelationshipSource,
    recordedBy: string
  ): Promise<void> {
    const current = await this.getActive(tactId, kind);
    const nextName = (newPersonName || "").trim() || null;
    const currentName = current?.personName?.trim() || null;
    if (nextName === currentName) return; // no real change — nothing to record

    if (current) {
      await this.db
        .update(guideMentorRelationshipHistory)
        .set({ endDate: effectiveDate, isActive: false })
        .where(eq(guideMentorRelationshipHistory.id, current.id));
    }
    if (nextName) {
      await this.db.insert(guideMentorRelationshipHistory).values({
        tactId,
        kind,
        personName: nextName,
        startDate: effectiveDate,
        endDate: null,
        isActive: true,
        source,
        recordedBy,
      });
    }
  }
}
