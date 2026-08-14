/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbAnnouncements, type KbAnnouncementRow, type NewKbAnnouncementRow } from "../schema.js";

export type CreateKbAnnouncementEntry = Omit<NewKbAnnouncementRow, "id" | "createdAt">;
export type UpdateKbAnnouncementEntry = Partial<
  Pick<NewKbAnnouncementRow, "title" | "body" | "effectiveDate" | "isActive" | "categoryId">
>;

/** Data Access Layer for `kb_announcements` — dated product-team
 * announcements that always win over PDF/web/Playbook content when they
 * conflict (see schema.ts's comment above kbAnnouncements). */
export class KbAnnouncementsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<KbAnnouncementRow[]> {
    return this.db.select().from(kbAnnouncements).orderBy(desc(kbAnnouncements.effectiveDate));
  }

  /** Active announcements relevant to a query: general (categoryId null)
   * plus any belonging to the given category ids. Injected into every
   * "Ask the Playbook" prompt regardless of similarity ranking. */
  async listActiveFor(categoryIds: number[]): Promise<KbAnnouncementRow[]> {
    const categoryCondition = categoryIds.length > 0 ? or(isNull(kbAnnouncements.categoryId), ...categoryIds.map((id) => eq(kbAnnouncements.categoryId, id))) : isNull(kbAnnouncements.categoryId);
    return this.db
      .select()
      .from(kbAnnouncements)
      .where(and(eq(kbAnnouncements.isActive, true), categoryCondition))
      .orderBy(desc(kbAnnouncements.effectiveDate));
  }

  async create(entry: CreateKbAnnouncementEntry): Promise<KbAnnouncementRow> {
    const [row] = await this.db.insert(kbAnnouncements).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdateKbAnnouncementEntry): Promise<KbAnnouncementRow | undefined> {
    const [row] = await this.db.update(kbAnnouncements).set(entry).where(eq(kbAnnouncements.id, id)).returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(kbAnnouncements).where(eq(kbAnnouncements.id, id));
  }
}
