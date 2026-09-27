/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GUIDE/MENTOR -> ADVISOR RELATIONSHIP SYNC — master_advisors ->
 * guide_mentor_advisor_mappings (2026-09)
 * ---------------------------------------------------------------
 * Mirrors master_advisors' Guide/Mentor columns (plus each advisor's own
 * Tact ID/Name/Email/Status/Product) into the Master Advisors page, so that
 * section has something real to display and edit instead of the "0
 * mappings" empty state. Reuses
 * getMasterAdvisorsRowsForSync() — the exact same cached sheet read
 * advisorDirectorySync.ts already uses — adds no new connection, no new
 * spreadsheet.
 *
 * Deliberately NOT the read path Team Tracker/the QA Dashboard use for
 * their own Guide/Mentor scoping (qaDataEngine.ts's
 * getAdvisorsForGuide/getAdvisorsForMentor still read the live sheet
 * directly, unchanged) — this is phase 1, build + display only. Migrating
 * those pages to read from this table instead is a deliberate later
 * follow-up once this sync has been run and spot-checked for real.
 *
 * Unlike Advisor Directory Sync, this never requires (or even looks at) a
 * `users` row — every advisor with a Tact ID on the sheet gets a mapping
 * row here, logged in or not (see schema.ts's table comment).
 */

import type { Repositories, SyncGuideMentorAdvisorMappingEntry } from "../db/repositories/index.js";
import { getMasterAdvisorsRowsForSync, invalidateQaSheetCache } from "./qaDataEngine.js";

export interface GuideMentorRelationshipsSyncResult {
  recordsRead: number;
  /** Rows with no Tact ID at all — nothing to key a mapping row on, so
   * these are skipped entirely (not written, not counted below). */
  skippedNoTactId: number;
  mappingsWritten: number;
  withGuide: number;
  withMentor: number;
  withBoth: number;
  withNeither: number;
  syncedAt: string;
}

export async function syncGuideMentorRelationships(repos: Repositories, triggeredBy: string): Promise<GuideMentorRelationshipsSyncResult> {
  // Same "never trust a stale cache for an admin-triggered sync" rule as
  // Advisor Directory Sync.
  invalidateQaSheetCache();

  const { totalRows, rows } = await getMasterAdvisorsRowsForSync();

  const entries: SyncGuideMentorAdvisorMappingEntry[] = [];
  let skippedNoTactId = 0;
  let withGuide = 0;
  let withMentor = 0;
  let withBoth = 0;
  let withNeither = 0;

  for (const row of rows) {
    const tactId = row.tactId.trim();
    if (!tactId) {
      skippedNoTactId++;
      continue;
    }
    const guideName = row.guide?.trim() || null;
    const mentorName = row.mentor?.trim() || null;
    if (guideName && mentorName) withBoth++;
    else if (guideName) withGuide++;
    else if (mentorName) withMentor++;
    else withNeither++;

    entries.push({
      tactId,
      name: row.name?.trim() || tactId,
      email: row.email,
      guideName,
      mentorName,
      status: row.statusRaw?.trim() || null,
      skillDomain: row.skillDomain,
      batchNumber: row.batchNumber,
      dateOfMovingOut: row.dateOfMovingOut,
      lastWorkingDay: row.lastWorkingDay,
    });
  }

  const mappingsWritten = await repos.guideMentorAdvisorMappings.upsertFromSync(entries, triggeredBy);

  return {
    recordsRead: totalRows,
    skippedNoTactId,
    mappingsWritten,
    withGuide,
    withMentor,
    withBoth,
    withNeither,
    syncedAt: new Date().toISOString(),
  };
}
