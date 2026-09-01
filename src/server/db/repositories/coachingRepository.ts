/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, desc, inArray } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import {
  coachingSessions,
  coachingActionables,
  type CoachingSessionRow,
  type CoachingActionableRow,
} from "../schema.js";

export interface NewCoachingActionable {
  description: string;
  dueDate: string | null; // "yyyy-MM-dd"
  status: "Open" | "In Progress" | "Completed";
}

export interface NewCoachingSession {
  tactId: string;
  advisorName: string;
  authorEmail: string;
  authorName: string;
  meetingDate: string; // "yyyy-MM-dd"
  discussionPoints: string | null;
  meetingNotes: string | null;
  actionables: NewCoachingActionable[];
}

export interface CoachingSessionWithActionables extends CoachingSessionRow {
  actionables: CoachingActionableRow[];
}

/**
 * Data Access Layer for `coaching_sessions` / `coaching_actionables` — see
 * schema.ts's table comment for the full "why". A session is always
 * created together with its actionables (possibly zero) in one
 * transaction, and always read back the same way — there is no standalone
 * "actionables for an arbitrary session" query outside that shape, since
 * the current UI (Team Tracker's Coaching History) only ever needs
 * "sessions for this advisor, each with its own actionables".
 */
export class CoachingRepository {
  constructor(private readonly db: AnyDb) {}

  async createSession(entry: NewCoachingSession): Promise<CoachingSessionWithActionables> {
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .insert(coachingSessions)
        .values({
          tactId: entry.tactId,
          advisorName: entry.advisorName,
          authorEmail: entry.authorEmail.toLowerCase(),
          authorName: entry.authorName,
          meetingDate: entry.meetingDate,
          discussionPoints: entry.discussionPoints,
          meetingNotes: entry.meetingNotes,
        })
        .returning();

      const actionables = entry.actionables.length
        ? await tx
            .insert(coachingActionables)
            .values(
              entry.actionables.map((a) => ({
                sessionId: session.id,
                description: a.description,
                dueDate: a.dueDate,
                status: a.status,
              }))
            )
            .returning()
        : [];

      return { ...session, actionables };
    });
  }

  /** Every saved coaching session for one advisor, newest meeting first,
   * each with its own actionables attached — Team Tracker's Coaching
   * History section (TeamTrackerPage.tsx's Insights view). */
  async listByTactId(tactId: string): Promise<CoachingSessionWithActionables[]> {
    const sessions = await this.db
      .select()
      .from(coachingSessions)
      .where(eq(coachingSessions.tactId, tactId))
      .orderBy(desc(coachingSessions.meetingDate), desc(coachingSessions.createdAt));
    if (sessions.length === 0) return [];

    const actionableRows = await this.db
      .select()
      .from(coachingActionables)
      .where(
        inArray(
          coachingActionables.sessionId,
          sessions.map((s) => s.id)
        )
      );
    const bySession = new Map<number, CoachingActionableRow[]>();
    for (const row of actionableRows) {
      if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, []);
      bySession.get(row.sessionId)!.push(row);
    }
    return sessions.map((s) => ({ ...s, actionables: bySession.get(s.id) || [] }));
  }
}
