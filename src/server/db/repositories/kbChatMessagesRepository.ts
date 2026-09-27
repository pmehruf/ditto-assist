/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { kbChatMessages, type KbChatMessageRow, type NewKbChatMessageRow } from "../schema.js";

export type CreateKbChatMessageEntry = Omit<NewKbChatMessageRow, "id" | "createdAt">;

/** Data Access Layer for `kb_chat_messages` — one row per turn (user
 * question or assistant answer) in a Product Assist session. */
export class KbChatMessagesRepository {
  constructor(private readonly db: AnyDb) {}

  async listBySession(sessionId: number): Promise<KbChatMessageRow[]> {
    return this.db.select().from(kbChatMessages).where(eq(kbChatMessages.sessionId, sessionId)).orderBy(asc(kbChatMessages.createdAt));
  }

  async create(entry: CreateKbChatMessageEntry): Promise<KbChatMessageRow> {
    const [row] = await this.db.insert(kbChatMessages).values(entry).returning();
    return row;
  }
}
