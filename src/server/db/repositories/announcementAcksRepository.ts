/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, eq, gte, isNull, notInArray, or, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import {
  announcementAcks,
  announcements,
  users,
  type AnnouncementRow,
} from "../schema.js";

/**
 * Data Access Layer for the mandatory read-and-acknowledge flow
 * (announcement_acks table). See schema.ts's announcementAcks comment for
 * the eligibility rules this encodes:
 *
 *   - requires_ack = true only (everything pre-dating the feature was
 *     grandfathered to false by migration 0023);
 *   - announcements.created_at >= users.created_at — a newly joined user is
 *     never asked to acknowledge announcements from before they joined;
 *   - still-valid only (valid_till_date null or >= today) — an expired
 *     notice must not keep blocking the app;
 *   - not already acknowledged by this user.
 */
export class AnnouncementAcksRepository {
  constructor(private readonly db: AnyDb) {}

  /**
   * Every announcement `userEmail` must still acknowledge before using the
   * app, oldest first (so the modal walks through them in posting order).
   *
   * A user with no row in the users directory gets an empty list (fail
   * open, same as fetchPageVisibility's pattern client-side) — the gate is
   * a compliance nicety, not an auth boundary, and blocking someone the
   * directory doesn't know about would lock them out with no way to ack.
   */
  async listUnackedForUser(userEmail: string): Promise<AnnouncementRow[]> {
    const email = userEmail.toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user) return [];

    const ackedIds = this.db
      .select({ id: announcementAcks.announcementId })
      .from(announcementAcks)
      .where(eq(announcementAcks.userEmail, email));

    const todayIso = new Date().toISOString().slice(0, 10);

    return this.db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.requiresAck, true),
          gte(announcements.createdAt, user.createdAt),
          or(isNull(announcements.validTillDate), gte(announcements.validTillDate, todayIso)),
          notInArray(announcements.id, ackedIds)
        )
      )
      .orderBy(asc(announcements.createdAt));
  }

  /**
   * Records that `userEmail` has read announcement `announcementId`.
   * Idempotent — double-clicks / re-submits hit the (announcement, user)
   * unique constraint and are silently ignored rather than erroring.
   */
  async acknowledge(announcementId: number, userEmail: string): Promise<void> {
    await this.db
      .insert(announcementAcks)
      .values({ announcementId, userEmail: userEmail.toLowerCase() })
      .onConflictDoNothing();
  }

  /** All acknowledgements for one announcement (audit/reporting use). */
  async listForAnnouncement(announcementId: number) {
    return this.db
      .select()
      .from(announcementAcks)
      .where(eq(announcementAcks.announcementId, announcementId))
      .orderBy(asc(announcementAcks.ackedAt));
  }

  /** Per-announcement ack counts (audit/reporting use). */
  async countByAnnouncement(): Promise<Record<number, number>> {
    const rows = await this.db
      .select({
        announcementId: announcementAcks.announcementId,
        count: sql<number>`count(*)::int`,
      })
      .from(announcementAcks)
      .groupBy(announcementAcks.announcementId);
    return Object.fromEntries(rows.map((r) => [r.announcementId, r.count]));
  }
}
