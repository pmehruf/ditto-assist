/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { guideMentorAdvisorMappings, type GuideMentorAdvisorMappingRow } from "../schema.js";
import { GuideMentorRelationshipHistoryRepository } from "./guideMentorRelationshipHistoryRepository.js";

/** One master_advisors row, as read by the sync — see
 * guideMentorRelationshipsSync.ts. */
export interface SyncGuideMentorAdvisorMappingEntry {
  tactId: string;
  name: string;
  email: string | null;
  guideName: string | null;
  mentorName: string | null;
  status: string | null;
  skillDomain: string | null;
  batchNumber: string | null;
  dateOfMovingOut: string | null;
  lastWorkingDay: string | null;
}

export interface EditGuideMentorAdvisorMappingEntry {
  name?: string;
  guideName?: string | null;
  mentorName?: string | null;
  status?: string | null;
  skillDomain?: string | null;
  batchNumber?: string | null;
  dateOfMovingOut?: string | null;
  lastWorkingDay?: string | null;
  /** "yyyy-MM-dd" — the date a Mentor/Guide relationship CHANGE recorded by
   * this edit takes effect (used as both the old relationship's history
   * endDate and the new one's startDate; see
   * GuideMentorRelationshipHistoryRepository.changeRelationship()).
   * Defaults to today when omitted. Ignored unless the corresponding
   * guideName/mentorName field is also present in this patch. */
  guideEffectiveDate?: string;
  mentorEffectiveDate?: string;
}

/**
 * Data Access Layer for `guide_mentor_advisor_mappings` — see schema.ts's
 * table comment for the full reasoning. One row per advisor (by tact_id),
 * upserted wholesale on each sync run, editable by hand in between.
 *
 * Guide/Mentor changes made here (via update() or upsertFromSync()) are
 * also recorded into guide_mentor_relationship_history through the
 * injected `history` repository — see that table's schema.ts comment for
 * why this table alone (current value only, overwritten in place) isn't
 * enough to answer "who was this advisor's Mentor/Guide during [past
 * period]".
 */
export class GuideMentorAdvisorMappingsRepository {
  constructor(private readonly db: AnyDb, private readonly history: GuideMentorRelationshipHistoryRepository) {}

  async list(): Promise<GuideMentorAdvisorMappingRow[]> {
    return this.db.select().from(guideMentorAdvisorMappings);
  }

  async get(id: number): Promise<GuideMentorAdvisorMappingRow | undefined> {
    const [row] = await this.db.select().from(guideMentorAdvisorMappings).where(eq(guideMentorAdvisorMappings.id, id));
    return row;
  }

  /** Upserts every entry by tact_id — sheet-derived fields always overwrite
   * whatever was there before (including a prior manual edit; see
   * schema.ts's table comment on why that's intentional), resets
   * manuallyEdited to false, and refreshes lastSyncedAt/lastSyncedBy. Does
   * NOT delete rows missing from `entries` this run — an advisor who
   * disappears from the sheet keeps their last-known mapping visible
   * rather than vanishing silently; their lastSyncedAt simply stops
   * advancing, which the UI can surface as "stale" if needed later.
   *
   * A Guide/Mentor value that actually differs from the timeline's current
   * active person also goes through the same terminate-and-replace history
   * lifecycle a manual edit uses (source "sync", effective the date of
   * this run) — see guide_mentor_relationship_history's schema.ts comment.
   * changeRelationship() itself is the one that detects "did this really
   * change" (against the history table, not this one), so a routine
   * re-sync of an unchanged value writes no history row. */
  async upsertFromSync(entries: SyncGuideMentorAdvisorMappingEntry[], triggeredBy: string): Promise<number> {
    if (entries.length === 0) return 0;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let written = 0;
    // Drizzle's onConflictDoUpdate doesn't batch a multi-row VALUES list
    // against a unique-index target cleanly across every driver this app
    // supports, and a sync run is a rare, admin-triggered, bounded-size
    // (one row per advisor) operation — not a hot path — so a plain loop
    // keeps this simple and easy to reason about over a micro-optimized
    // batch upsert.
    for (const entry of entries) {
      const values = {
        tactId: entry.tactId,
        name: entry.name,
        email: entry.email,
        guideName: entry.guideName,
        mentorName: entry.mentorName,
        status: entry.status,
        skillDomain: entry.skillDomain,
        batchNumber: entry.batchNumber,
        dateOfMovingOut: entry.dateOfMovingOut,
        lastWorkingDay: entry.lastWorkingDay,
        manuallyEdited: false,
        lastSyncedAt: now,
        lastSyncedBy: triggeredBy,
      };
      await this.db
        .insert(guideMentorAdvisorMappings)
        .values(values)
        .onConflictDoUpdate({ target: guideMentorAdvisorMappings.tactId, set: values });
      written++;

      await this.history.changeRelationship(entry.tactId, "mentor", entry.mentorName, today, "sync", triggeredBy);
      await this.history.changeRelationship(entry.tactId, "guide", entry.guideName, today, "sync", triggeredBy);
    }
    return written;
  }

  async update(id: number, patch: EditGuideMentorAdvisorMappingEntry, editedBy: string): Promise<GuideMentorAdvisorMappingRow | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    const { guideEffectiveDate, mentorEffectiveDate, ...fieldPatch } = patch;
    const [row] = await this.db
      .update(guideMentorAdvisorMappings)
      .set({ ...fieldPatch, manuallyEdited: true, lastEditedAt: new Date(), lastEditedBy: editedBy })
      .where(eq(guideMentorAdvisorMappings.id, id))
      .returning();
    if (!row) return row;

    const today = new Date().toISOString().slice(0, 10);
    // Only touch history for a field this patch actually intended to set —
    // "in fieldPatch" (not a truthiness check) so explicitly clearing a
    // Mentor/Guide to null still records a termination.
    if ("mentorName" in fieldPatch) {
      await this.history.changeRelationship(row.tactId, "mentor", fieldPatch.mentorName ?? null, mentorEffectiveDate || today, "manual", editedBy);
    }
    if ("guideName" in fieldPatch) {
      await this.history.changeRelationship(row.tactId, "guide", fieldPatch.guideName ?? null, guideEffectiveDate || today, "manual", editedBy);
    }
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(guideMentorAdvisorMappings).where(eq(guideMentorAdvisorMappings.id, id));
  }
}
