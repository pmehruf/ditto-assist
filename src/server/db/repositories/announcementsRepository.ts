/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, gte } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { announcements, type AnnouncementRow, type NewAnnouncementRow } from "../schema.js";

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
}
