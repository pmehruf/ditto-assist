/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbChatSessions, type KbChatSessionRow, type NewKbChatSessionRow } from "../schema.js";

export type CreateKbChatSessionEntry = Omit<NewKbChatSessionRow, "id" | "createdAt" | "updatedAt">;

/** Data Access Layer for `kb_chat_sessions` — Query Assist's per-advisor
 * conversation threads (each scoped to one insurer/plan selection, or
 * "General" — see schema.ts's comment above kbChatSessions). */
export class KbChatSessionsRepository {
  constructor(private readonly db: AnyDb) {}

  async listForUser(userEmail: string): Promise<KbChatSessionRow[]> {
    return this.db
      .select()
      .from(kbChatSessions)
      .where(eq(kbChatSessions.userEmail, userEmail))
      .orderBy(desc(kbChatSessions.updatedAt));
  }

  /** Fetches a session, scoped to its owner so one advisor can never load
   * another's conversation by guessing an id. */
  async getForUser(id: number, userEmail: string): Promise<KbChatSessionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(kbChatSessions)
      .where(and(eq(kbChatSessions.id, id), eq(kbChatSessions.userEmail, userEmail)));
    return row;
  }

  async create(entry: CreateKbChatSessionEntry): Promise<KbChatSessionRow> {
    const [row] = await this.db.insert(kbChatSessions).values(entry).returning();
    return row;
  }

  async touch(id: number): Promise<void> {
    await this.db.update(kbChatSessions).set({ updatedAt: new Date() }).where(eq(kbChatSessions.id, id));
  }

  async deleteForUser(id: number, userEmail: string): Promise<void> {
    await this.db.delete(kbChatSessions).where(and(eq(kbChatSessions.id, id), eq(kbChatSessions.userEmail, userEmail)));
  }
}
