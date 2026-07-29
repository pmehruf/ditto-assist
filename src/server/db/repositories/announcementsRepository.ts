/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { announcements, type AnnouncementRow, type NewAnnouncementRow } from "../schema.js";

/**
 * Retention ceiling per announcement type (QA vs General, tracked
 * independently — publishing one type never trims the other). No settings
 * UI exists for this yet, so it's a plain constant; raise/lower it here if
 * the org's needs change. Chosen generously so it only ever prunes genuine
 * long-tail backlog, never anything an advisor would still expect to see.
 */
export const ANNOUNCEMENT_RETENTION_LIMIT: Record<"QA Announcement" | "General Announcement", number> = {
  "QA Announcement": 100,
  "General Announcement": 100,
};

export interface AnnouncementFilter {
  category?: string;
  type?: NewAnnouncementRow["type"];
  /** Only announcements still valid on/after this ISO date (validTillDate >= this). */
  validAsOf?: string;
  limit?: number;
}

export type CreateAnnouncementEntry = Omit<NewAnnouncementRow, "id" | "createdAt">;
export type UpdateAnnouncementEntry = Partial<CreateAnnouncementEntry>;

/**
 * Data Access Layer for QA/general announcements (announcements table).
 */
export class AnnouncementsRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateAnnouncementEntry): Promise<AnnouncementRow> {
    const [row] = await this.db.insert(announcements).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdateAnnouncementEntry): Promise<AnnouncementRow | undefined> {
    const [row] = await this.db
      .update(announcements)
      .set(entry)
      .where(eq(announcements.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(announcements).where(eq(announcements.id, id));
  }

  async getById(id: number): Promise<AnnouncementRow | undefined> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id));
    return row;
  }

  async list(filter: AnnouncementFilter = {}): Promise<AnnouncementRow[]> {
    const conditions = [];
    if (filter.category) conditions.push(eq(announcements.category, filter.category));
    if (filter.type) conditions.push(eq(announcements.type, filter.type));
    if (filter.validAsOf) conditions.push(gte(announcements.validTillDate, filter.validAsOf));

    const query = this.db
      .select()
      .from(announcements)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(announcements.createdAt));

    return filter.limit ? query.limit(filter.limit) : query;
  }

  /**
   * Retention enforcement: deletes the oldest rows of `type` beyond
   * `ANNOUNCEMENT_RETENTION_LIMIT[type]`, keyed by createdAt (oldest-first),
   * so a burst of same-day announcements is trimmed by actual publish order
   * rather than by the (optional, user-editable) Announcement Date field.
   * QA and General are always counted and pruned independently — creating a
   * QA Announcement never trims General's backlog and vice versa, since
   * `type` is always part of the WHERE clause here.
   *
   * Called after every successful create (see POST /api/announcements) —
   * cheap for the normal case (one extra SELECT of just ids, no DELETE) and
   * self-correcting even if the limit is lowered later, since it always
   * checks the live count rather than assuming it only ever grows by one.
   *
   * Returns the ids of any rows deleted, so the caller can also drop them
   * from any client-side state that already optimistically holds them.
   *
   * `limitOverride` exists only so tests can exercise this against a small
   * number of rows instead of the real 100-row default — production call
   * sites should never pass it.
   */
  async enforceRetentionLimit(
    type: "QA Announcement" | "General Announcement",
    limitOverride?: number
  ): Promise<number[]> {
    const limit = limitOverride ?? ANNOUNCEMENT_RETENTION_LIMIT[type];
    const rows = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(eq(announcements.type, type))
      .orderBy(asc(announcements.createdAt));

    if (rows.length <= limit) return [];

    const excess = rows.slice(0, rows.length - limit).map((r) => r.id);
    await this.db.delete(announcements).where(inArray(announcements.id, excess));
    return excess;
  }
}
