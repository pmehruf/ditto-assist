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
 * reimplementing it. Creating/editing a session stays Guide/Mentor/Admin
 * only, as canAccessAdvisorForCoaching alone enforces — but reading
 * history and updating an actionable's own status ALSO allow a plain
 * Advisor acting on their own tactId (see authorize's `allowSelf`), since
 * QaDashboardPage.tsx's ActionablesFromInsightSection needs exactly that
 * for the advisor's own self-view.
 *
 * Persistence is intentionally thin: a session is written ONLY when the
 * caller explicitly Saves (see coachingRepository.ts) — there is no
 * autosave/draft endpoint here. Drafts live entirely in the browser's own
 * localStorage until then, so an accidental refresh doesn't lose unsaved
 * notes without ever hitting the database. Once saved, an actionable's
 * status can be changed later via updateActionableStatus (Feedback
 * Summary's own status control) — new actionables always start "Open".
 */

import { findAdvisorByTactId, getAdvisorByEmail } from "../qaDashboard/qaDataEngine.js";
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

/** `allowSelf` lets a plain Advisor through for their OWN tactId only —
 * used by the two read paths the Advisor QA Dashboard's own self-view
 * needs (getCoachingHistory, updateActionableStatus). Every other caller
 * (create/edit a session, QA Feedback discussed marks) stays
 * Guide/Mentor/Admin-only via canAccessAdvisorForCoaching alone, same as
 * before — a plain Advisor still can't author or edit their own feedback,
 * only read it and move an assigned actionable's status. Without this, a
 * plain Advisor got FORBIDDEN on their own coaching history (bug: the
 * Guide/Mentor/Admin-only comment above predates ActionablesFromInsightSection
 * in QaDashboardPage.tsx, which needs exactly this self-access). */
async function authorize(email: string, tactId: string, opts: { allowSelf?: boolean } = {}): Promise<{ callerName: string } | ErrorResult> {
  const { allowed, callerName } = await canAccessAdvisorForCoaching(email, tactId);
  if (allowed) return { callerName };
  if (opts.allowSelf) {
    const own = await getAdvisorByEmail(email);
    if (own && String(own.tactId).trim().toLowerCase() === String(tactId).trim().toLowerCase()) {
      return { callerName: own.name };
    }
  }
  return { error: "FORBIDDEN", message: "You don't have coaching access to this advisor." };
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
 * Team Tracker's Coaching History section, and (self only) the Advisor QA
 * Dashboard's own ActionablesFromInsightSection. */
export async function getCoachingHistory(email: string, tactId: string): Promise<CoachingSessionWithActionables[] | ErrorResult> {
  try {
    const target = (tactId || "").trim();
    if (!target) return { error: "INVALID_INPUT", message: "An advisor is required" };

    const auth = await authorize(email, target, { allowSelf: true });
    if (isErr(auth)) return auth;

    const { coaching } = createRepositories(getDb());
    return await coaching.listByTactId(target);
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

export interface UpdateCoachingSessionInput {
  meetingDate: string; // "yyyy-MM-dd"
  discussionPoints: string;
  meetingNotes: string;
  actionables: Array<{ id?: number; description: string; dueDate: string | null; status: CoachingActionableStatus }>;
}

/** Edit option for saved session feedback (Task 7) — same
 * at-least-one-field validation as a fresh Save, applied to the edited
 * content. Authorization joins through the session's own tactId (see
 * coachingRepository.ts's getSessionTactId) rather than trusting whatever
 * tactId the client happens to send. */
export async function updateCoachingSession(email: string, sessionId: number, input: UpdateCoachingSessionInput): Promise<CoachingSessionWithActionables | ErrorResult> {
  try {
    if (!Number.isFinite(sessionId) || sessionId <= 0) return { error: "INVALID_INPUT", message: "A valid session is required" };
    if (!input.meetingDate) return { error: "INVALID_INPUT", message: "Meeting date is required" };

    const { coaching } = createRepositories(getDb());
    const tactId = await coaching.getSessionTactId(sessionId);
    if (!tactId) return { error: "NOT_FOUND", message: "No session with that ID" };

    const auth = await authorize(email, tactId);
    if (isErr(auth)) return auth;

    const discussionPoints = (input.discussionPoints || "").trim();
    const meetingNotes = (input.meetingNotes || "").trim();
    const actionables = (input.actionables || [])
      .filter((a) => (a.description || "").trim())
      .map((a) => ({ id: a.id, description: a.description.trim(), dueDate: a.dueDate || null, status: a.status }));

    if (!discussionPoints && !meetingNotes && actionables.length === 0) {
      return { error: "INVALID_INPUT", message: "Add discussion points, meeting notes, or an actionable before saving" };
    }

    const updated = await coaching.updateSession(sessionId, {
      meetingDate: input.meetingDate,
      discussionPoints: discussionPoints || null,
      meetingNotes: meetingNotes || null,
      actionables,
    });
    if (!updated) return { error: "NOT_FOUND", message: "No session with that ID" };
    return updated;
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

/** Feedback Summary's own status control — moves one actionable along
 * Open -> In Progress -> Completed/Failed. Authorization joins through
 * the actionable's parent session to find the owning tactId (actionables
 * don't carry tactId directly — see schema.ts), then applies the same
 * Guide/Mentor/Admin-or-self scope getCoachingHistory uses — both Team
 * Tracker's own status control AND the advisor's own QA Dashboard status
 * dropdown call this same route. */
export async function updateActionableStatus(email: string, actionableId: number, status: CoachingActionableStatus): Promise<CoachingSessionWithActionables["actionables"][number] | ErrorResult> {
  try {
    if (!Number.isFinite(actionableId) || actionableId <= 0) return { error: "INVALID_INPUT", message: "A valid actionable is required" };

    const { coaching } = createRepositories(getDb());
    const tactId = await coaching.getActionableTactId(actionableId);
    if (!tactId) return { error: "NOT_FOUND", message: "No actionable with that ID" };

    const auth = await authorize(email, tactId, { allowSelf: true });
    if (isErr(auth)) return auth;

    const updated = await coaching.updateActionableStatus(actionableId, status);
    if (!updated) return { error: "NOT_FOUND", message: "No actionable with that ID" };
    return updated;
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

/** QA Feedback's "Mark as Discussed" checkbox (Advisor Insight Page) —
 * backend-persisted (not localStorage) so the mark is visible to every
 * Guide/Mentor/Admin who opens that advisor, not just the browser that set
 * it. Same access scope as the rest of Team Tracker's coaching endpoints.
 * See qaFeedbackDiscussedMarksRepository.ts's header comment for why this
 * is its own tiny table rather than a column on the feedback rows
 * themselves (those come from an external sheet this app doesn't own). */
export async function listDiscussedFeedback(email: string, tactId: string): Promise<string[] | ErrorResult> {
  try {
    const target = (tactId || "").trim();
    if (!target) return { error: "INVALID_INPUT", message: "An advisor is required" };

    const auth = await authorize(email, target);
    if (isErr(auth)) return auth;

    const { qaFeedbackDiscussedMarks } = createRepositories(getDb());
    return await qaFeedbackDiscussedMarks.listForTactId(target);
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

export async function setFeedbackDiscussed(email: string, tactId: string, rowIdentity: string, discussed: boolean): Promise<{ ok: true } | ErrorResult> {
  try {
    const target = (tactId || "").trim();
    const row = (rowIdentity || "").trim();
    if (!target || !row) return { error: "INVALID_INPUT", message: "An advisor and a feedback row are required" };

    const auth = await authorize(email, target);
    if (isErr(auth)) return auth;

    const { qaFeedbackDiscussedMarks } = createRepositories(getDb());
    if (discussed) {
      await qaFeedbackDiscussedMarks.mark(target, row, email);
    } else {
      await qaFeedbackDiscussedMarks.unmark(target, row);
    }
    return { ok: true };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}
