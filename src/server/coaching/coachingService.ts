/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * COACHING WORKSPACE — REQUEST-LEVEL SERVICE
 * ---------------------------------------------------------------
 * Backs the Advisor QA Dashboard's Session Feedback panel + Feedback
 * Summary section (QaDashboardPage.tsx — relocated here from Team Tracker,
 * see that page's own header comment). Access control reuses
 * teamTrackerService.ts's canAccessAdvisorForCoaching (the same
 * Guide-owns-their-team / Mentor-owns-their-mentees / Admin-sees-everyone
 * scope the rest of Team Tracker already enforces) instead of
 * reimplementing it — a plain Advisor is never allowed here either, per
 * that function's own comment.
 *
 * Persistence is intentionally thin: a session is written ONLY when the
 * caller explicitly Saves (see coachingRepository.ts) — there is no
 * autosave/draft endpoint here. Drafts live entirely in the browser's own
 * localStorage until then, so an accidental refresh doesn't lose unsaved
 * notes without ever hitting the database. Once saved, an actionable's
 * status can be changed later via updateActionableStatus (Feedback
 * Summary's own status control) — new actionables always start "Open".
 */

import { findAdvisorByTactId } from "../qaDashboard/qaDataEngine.js";
import { canAccessAdvisorForCoaching } from "../qaDashboard/teamTrackerService.js";
import { getDb } from "../db/client.js";
import { createRepositories } from "../db/repositories/index.js";
import type { CoachingSessionWithActionables, NewCoachingActionable, CoachingActionableStatus } from "../db/repositories/coachingRepository.js";

type ErrorResult = { error: string; message: string };
function isErr(x: unknown): x is ErrorResult {
  return !!x && typeof x === "object" && "error" in (x as object);
}

export interface SaveCoachingActionableInput {
  description: string;
  dueDate: string | null; // "yyyy-MM-dd", optional
  status: CoachingActionableStatus;
}

export interface SaveCoachingSessionInput {
  tactId: string;
  meetingDate: string; // "yyyy-MM-dd"
  discussionPoints: string;
  meetingNotes: string;
  actionables: SaveCoachingActionableInput[];
}

async function authorize(email: string, tactId: string): Promise<{ callerName: string } | ErrorResult> {
  const { allowed, callerName } = await canAccessAdvisorForCoaching(email, tactId);
  if (!allowed) return { error: "FORBIDDEN", message: "You don't have coaching access to this advisor." };
  return { callerName };
}

/** Explicit Save — the only way a coaching_sessions row is ever created.
 * Requires at least one of discussion points / meeting notes / an
 * actionable, so an empty draft can't be saved as a blank history entry. */
export async function saveCoachingSession(email: string, input: SaveCoachingSessionInput): Promise<CoachingSessionWithActionables | ErrorResult> {
  try {
    const tactId = (input.tactId || "").trim();
    if (!tactId) return { error: "INVALID_INPUT", message: "An advisor is required" };
    if (!input.meetingDate) return { error: "INVALID_INPUT", message: "Meeting date is required" };

    const auth = await authorize(email, tactId);
    if (isErr(auth)) return auth;

    const advisor = await findAdvisorByTactId(tactId);
    if (!advisor) return { error: "NOT_FOUND", message: "No advisor with that TACT ID" };

    const discussionPoints = (input.discussionPoints || "").trim();
    const meetingNotes = (input.meetingNotes || "").trim();
    const actionables: NewCoachingActionable[] = (input.actionables || [])
      .filter((a) => (a.description || "").trim())
      .map((a) => ({ description: a.description.trim(), dueDate: a.dueDate || null, status: a.status }));

    if (!discussionPoints && !meetingNotes && actionables.length === 0) {
      return { error: "INVALID_INPUT", message: "Add discussion points, meeting notes, or an actionable before saving" };
    }

    const { coaching } = createRepositories(getDb());
    return await coaching.createSession({
      tactId: advisor.tactId,
      advisorName: advisor.name,
      authorEmail: email,
      authorName: auth.callerName,
      meetingDate: input.meetingDate,
      discussionPoints: discussionPoints || null,
      meetingNotes: meetingNotes || null,
      actionables,
    });
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

/** Every saved coaching session for one advisor, newest meeting first —
 * Team Tracker's Coaching History section. */
export async function getCoachingHistory(email: string, tactId: string): Promise<CoachingSessionWithActionables[] | ErrorResult> {
  try {
    const target = (tactId || "").trim();
    if (!target) return { error: "INVALID_INPUT", message: "An advisor is required" };

    const auth = await authorize(email, target);
    if (isErr(auth)) return auth;

    const { coaching } = createRepositories(getDb());
    return await coaching.listByTactId(target);
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

/** Feedback Summary's own status control — moves one actionable along
 * Open -> In Progress -> Completed/Failed. Authorization joins through
 * the actionable's parent session to find the owning tactId (actionables
 * don't carry tactId directly — see schema.ts), then applies the same
 * Guide/Mentor/Admin scope as every other coaching endpoint. */
export async function updateActionableStatus(email: string, actionableId: number, status: CoachingActionableStatus): Promise<CoachingSessionWithActionables["actionables"][number] | ErrorResult> {
  try {
    if (!Number.isFinite(actionableId) || actionableId <= 0) return { error: "INVALID_INPUT", message: "A valid actionable is required" };

    const { coaching } = createRepositories(getDb());
    const tactId = await coaching.getActionableTactId(actionableId);
    if (!tactId) return { error: "NOT_FOUND", message: "No actionable with that ID" };

    const auth = await authorize(email, tactId);
    if (isErr(auth)) return auth;

    const updated = await coaching.updateActionableStatus(actionableId, status);
    if (!updated) return { error: "NOT_FOUND", message: "No actionable with that ID" };
    return updated;
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}
