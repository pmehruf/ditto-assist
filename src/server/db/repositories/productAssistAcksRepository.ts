/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { productAssistAcks, type ProductAssistAckRow } from "../schema.js";

/**
 * Data Access Layer for the Product Assist daily AI-awareness warning's
 * server-persisted per-user state (see schema.ts's productAssistAcks
 * comment) — deliberately NOT browser localStorage alone, so the state
 * survives a cleared cache or a new device.
 */
export class ProductAssistAcksRepository {
  constructor(private readonly db: AnyDb) {}

  /** No row yet = this user has never acknowledged nor been shown the
   * daily reminder. */
  async get(userEmail: string): Promise<ProductAssistAckRow | undefined> {
    const [row] = await this.db
      .select()
      .from(productAssistAcks)
      .where(eq(productAssistAcks.userEmail, userEmail.toLowerCase()));
    return row;
  }

  /**
   * Records the one-time first-ever acknowledgement (the 10-second warning
   * + checkbox + Proceed flow). Also stamps `lastReminderDate` to the same
   * local date so the lightweight daily reminder doesn't ALSO fire later
   * that same day — the advisor just did the full version, which already
   * covers today. Idempotent — a repeat call just re-stamps both fields,
   * harmless since the client-side flow can only be completed once.
   */
  async acknowledge(userEmail: string, localDate: string): Promise<void> {
    const email = userEmail.toLowerCase();
    const now = new Date();
    await this.db
      .insert(productAssistAcks)
      .values({ userEmail: email, ackedAt: now, lastReminderDate: localDate })
      .onConflictDoUpdate({
        target: productAssistAcks.userEmail,
        set: { ackedAt: now, lastReminderDate: localDate, updatedAt: now },
      });
  }

  /** Records that today's lightweight daily reminder was shown —
   * `localDate` is the advisor's own local calendar date (YYYY-MM-DD), not
   * the server's, so "today" always matches what they actually see. */
  async recordReminderShown(userEmail: string, localDate: string): Promise<void> {
    const email = userEmail.toLowerCase();
    await this.db
      .insert(productAssistAcks)
      .values({ userEmail: email, lastReminderDate: localDate })
      .onConflictDoUpdate({
        target: productAssistAcks.userEmail,
        set: { lastReminderDate: localDate, updatedAt: new Date() },
      });
  }

  /**
   * Deletes the caller's own row, putting them back in "never acknowledged"
   * state so the next visit to Product Assist replays the first-ever 10-second
   * warning exactly as a brand-new user would see it. Self-service QA/demo
   * tool only — every caller can only reset their own row (the route this
   * backs takes the email from the authenticated session, never a body
   * param), so there's no cross-user reset surface here.
   */
  async reset(userEmail: string): Promise<void> {
    const email = userEmail.toLowerCase();
    await this.db.delete(productAssistAcks).where(eq(productAssistAcks.userEmail, email));
  }
}
