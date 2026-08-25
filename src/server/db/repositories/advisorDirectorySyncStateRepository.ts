/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, inArray } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { advisorDirectorySyncState, type AdvisorDirectorySyncStateRow } from "../schema.js";

export interface UpsertAdvisorSyncStateEntry {
  userEmail: string;
  sheetTactId: string | null;
  currentlyEmployed: boolean;
  appliedDepartmentId: number | null;
  appliedOrgTeamId: number | null;
  appliedRoleId: number | null;
  appliedProductTags: string[];
  lastSyncedBy: string;
}

/**
 * Data Access Layer for `advisor_directory_sync_state` — see schema.ts's
 * table comment for the full "why". One row per user the Advisor Directory
 * Sync has ever touched; a missing row means the sync has never applied
 * anything to that user.
 */
export class AdvisorDirectorySyncStateRepository {
  constructor(private readonly db: AnyDb) {}

  /** Every tracked row — read once per sync run and looked up in memory by
   * email, rather than one query per matched user. */
  async list(): Promise<AdvisorDirectorySyncStateRow[]> {
    return this.db.select().from(advisorDirectorySyncState);
  }

  async get(userEmail: string): Promise<AdvisorDirectorySyncStateRow | undefined> {
    const [row] = await this.db
      .select()
      .from(advisorDirectorySyncState)
      .where(eq(advisorDirectorySyncState.userEmail, userEmail.toLowerCase()));
    return row;
  }

  async upsert(entry: UpsertAdvisorSyncStateEntry): Promise<AdvisorDirectorySyncStateRow> {
    const email = entry.userEmail.toLowerCase();
    const values = {
      userEmail: email,
      sheetTactId: entry.sheetTactId,
      currentlyEmployed: entry.currentlyEmployed,
      appliedDepartmentId: entry.appliedDepartmentId,
      appliedOrgTeamId: entry.appliedOrgTeamId,
      appliedRoleId: entry.appliedRoleId,
      appliedProductTags: entry.appliedProductTags,
      lastSyncedBy: entry.lastSyncedBy,
      lastSyncedAt: new Date(),
    };
    const [row] = await this.db
      .insert(advisorDirectorySyncState)
      .values(values)
      .onConflictDoUpdate({ target: advisorDirectorySyncState.userEmail, set: values })
      .returning();
    return row;
  }

  /** Every tracked row for a specific set of emails — used to find the
   * "previously tracked but no longer Currently Employed this run" set
   * without loading the whole table for large directories. Unused today
   * (list() is cheap enough at current directory size) but kept as the
   * scale-safe alternative if that ever changes. */
  async listByEmails(emails: string[]): Promise<AdvisorDirectorySyncStateRow[]> {
    if (emails.length === 0) return [];
    return this.db
      .select()
      .from(advisorDirectorySyncState)
      .where(inArray(advisorDirectorySyncState.userEmail, emails.map((e) => e.toLowerCase())));
  }
}
