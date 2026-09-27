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

export type CoachingActionableStatus = "Open" | "In Progress" | "Completed" | "Failed";

export interface NewCoachingActionable {
  description: string;
  dueDate: string | null; // "yyyy-MM-dd"
  status: CoachingActionableStatus;
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

  /** The tactId that owns a given session — used to authorize an Edit
   * (Task 7's "Enable an Edit option for saved session feedback") the same
   * way getActionableTactId authorizes a status change: join through the
   * owning record rather than trusting a client-supplied tactId. null when
   * the session doesn't exist. */
  async getSessionTactId(sessionId: number): Promise<string | null> {
    const [row] = await this.db.select({ tactId: coachingSessions.tactId }).from(coachingSessions).where(eq(coachingSessions.id, sessionId)).limit(1);
    return row?.tactId ?? null;
  }

  /** Edits a previously-saved session (Task 7 — there was previously no
   * way to modify a saved entry, only its actionables' status). Actionables
   * are reconciled against the submitted list: one carrying an existing id
   * is updated in place, one without an id is inserted as new, and any
   * existing actionable NOT present in the submitted list is deleted —
   * mirrors how the edit form itself works (the whole actionables list for
   * that session is submitted each time, add/remove/edit all included).
   * Returns null if the session doesn't exist. */
  async updateSession(
    sessionId: number,
    patch: {
      meetingDate: string;
      discussionPoints: string | null;
      meetingNotes: string | null;
      actionables: Array<{ id?: number; description: string; dueDate: string | null; status: CoachingActionableStatus }>;
    }
  ): Promise<CoachingSessionWithActionables | null> {
    return this.db.transaction(async (tx) => {
      const [session] = await tx
        .update(coachingSessions)
        .set({ meetingDate: patch.meetingDate, discussionPoints: patch.discussionPoints, meetingNotes: patch.meetingNotes })
        .where(eq(coachingSessions.id, sessionId))
        .returning();
      if (!session) return null;

      const existing = await tx.select().from(coachingActionables).where(eq(coachingActionables.sessionId, sessionId));
      const keptIds = new Set(patch.actionables.filter((a) => a.id != null).map((a) => a.id as number));
      const toDeleteIds = existing.filter((a) => !keptIds.has(a.id)).map((a) => a.id);
      if (toDeleteIds.length) {
        await tx.delete(coachingActionables).where(inArray(coachingActionables.id, toDeleteIds));
      }
      for (const a of patch.actionables) {
        if (a.id != null && keptIds.has(a.id)) {
          await tx.update(coachingActionables).set({ description: a.description, dueDate: a.dueDate, status: a.status }).where(eq(coachingActionables.id, a.id));
        } else {
          await tx.insert(coachingActionables).values({ sessionId, description: a.description, dueDate: a.dueDate, status: a.status });
        }
      }
      const actionables = await tx.select().from(coachingActionables).where(eq(coachingActionables.sessionId, sessionId));
      return { ...session, actionables };
    });
  }

  /** Resolves the tactId that owns a given actionable, via its parent
   * session — actionables don't carry tactId directly (see schema.ts),
   * so a status-update's authorization check joins through here first.
   * null when the actionable doesn't exist. */
  async getActionableTactId(actionableId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ tactId: coachingSessions.tactId })
      .from(coachingActionables)
      .innerJoin(coachingSessions, eq(coachingActionables.sessionId, coachingSessions.id))
      .where(eq(coachingActionables.id, actionableId))
      .limit(1);
    return row?.tactId ?? null;
  }

  /** Feedback Summary's own status control — Open -> In Progress ->
   * Completed/Failed. Actionables created via the Session Feedback form
   * always start "Open"; this is the only place status changes after
   * that. Returns the updated row, or null if the actionable doesn't
   * exist. */
  async updateActionableStatus(actionableId: number, status: CoachingActionableStatus): Promise<CoachingActionableRow | null> {
    const [row] = await this.db
      .update(coachingActionables)
      .set({ status })
      .where(eq(coachingActionables.id, actionableId))
      .returning();
    return row ?? null;
  }
}
