/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA DASHBOARD — REQUEST-LEVEL SERVICE
 * ---------------------------------------------------------------
 * Node port of BackendAPI.gs's role-aware entry points (getDashboardData,
 * listAdvisorsForAdmin, getFeedbackRows, getReviewRows,
 * getAdvisorsDashboardList) — combines qaRoles.ts (who is calling) with
 * qaDataEngine.ts (what they're allowed to see) exactly like the original.
 *
 * Identity here comes from the WebApp's own verified session (req.user,
 * set by the existing Google OAuth login — see src/server/auth/middleware.ts)
 * instead of Apps Script's Session.getActiveUser(). Same trust model in
 * spirit: both rely on a server-verified Google identity that the caller
 * can't spoof, just established differently (session cookie here vs.
 * domain-restricted deployment there — see the QA Dashboard integration
 * memory for why porting this natively avoids that deployment's
 * iframe/third-party-cookie risk).
 */

import {
  getAdvisorByEmail,
  findAdvisorByTactId,
  findAdvisorByTactIdAsOf,
  getAllAdvisors,
  getAllAdvisorsAsOf,
  getAdvisorsForGuide,
  getAdvisorsForMentor,
  getAdvisorsForGuideAsOf,
  getAdvisorsForMentorAsOf,
  getAdvisorMetrics,
  getAdvisorsBatchMetrics,
  getAdvisorFeedback,
  getAdvisorReviews,
  parseDateFilters,
  type Advisor,
  type DateFilters,
} from "./qaDataEngine.js";
import { resolveQaCallerRole } from "./qaRoles.js";

type ErrorResult = { error: string; message: string };
function isError(x: unknown): x is ErrorResult {
  return !!x && typeof x === "object" && "error" in (x as object);
}

async function resolveTargetTactId(
  email: string,
  requestedTactId: string | null
): Promise<{ tactId: string } | ErrorResult> {
  const role = await resolveQaCallerRole(email);

  if ((role.isAdmin || role.isGuide || role.isMentor) && requestedTactId) {
    const target = await findAdvisorByTactId(requestedTactId);
    if (!target) return { error: "NOT_FOUND", message: "No advisor with that TACT ID" };

    if (role.isGuide) {
      const team = await getAdvisorsForGuide(role.callerName);
      const inTeam = team.some((a) => String(a.tactId).trim() === String(target.tactId).trim());
      if (!inTeam) return { error: "FORBIDDEN", message: "That advisor is not on your team" };
    } else if (role.isMentor) {
      const mentees = await getAdvisorsForMentor(role.callerName);
      const inTeam = mentees.some((a) => String(a.tactId).trim() === String(target.tactId).trim());
      if (!inTeam) return { error: "FORBIDDEN", message: "That advisor is not one of your mentees" };
    }
    return { tactId: target.tactId };
  }

  const own = await getAdvisorByEmail(email);
  if (own) return { tactId: own.tactId };
  if (role.isAdmin || role.isGuide || role.isMentor) return { error: "NO_SELECTION", message: "Select an advisor first" };
  return { error: "NOT_AN_ADVISOR", message: `No advisor record for ${email}` };
}

export interface DashboardDataResult {
  advisor: Advisor | null;
  metrics: Awaited<ReturnType<typeof getAdvisorMetrics>> | null;
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  callerName?: string;
  error?: string;
  message?: string;
}

export async function getDashboardData(
  email: string,
  requestedTactId: string | null,
  dateFilters: DateFilters
): Promise<DashboardDataResult> {
  try {
    const role = await resolveQaCallerRole(email);
    const ownAdvisor = await getAdvisorByEmail(email);

    let targetTactId: string;

    if ((role.isAdmin || role.isGuide || role.isMentor) && requestedTactId) {
      const target = await findAdvisorByTactId(requestedTactId);
      if (!target) return { advisor: null, metrics: null, isAdmin: false, isGuide: false, isMentor: false, error: "NOT_FOUND", message: "No advisor with that TACT ID" };

      if (role.isGuide) {
        const team = await getAdvisorsForGuide(role.callerName);
        if (!team.some((a) => String(a.tactId).trim() === String(target.tactId).trim())) {
          return { advisor: null, metrics: null, isAdmin: false, isGuide: false, isMentor: false, error: "FORBIDDEN", message: "That advisor is not on your team" };
        }
      } else if (role.isMentor) {
        const mentees = await getAdvisorsForMentor(role.callerName);
        if (!mentees.some((a) => String(a.tactId).trim() === String(target.tactId).trim())) {
          return { advisor: null, metrics: null, isAdmin: false, isGuide: false, isMentor: false, error: "FORBIDDEN", message: "That advisor is not one of your mentees" };
        }
      }
      targetTactId = target.tactId;
    } else if (ownAdvisor) {
      targetTactId = ownAdvisor.tactId;
    } else if (role.isAdmin) {
      return { advisor: null, metrics: null, isAdmin: true, isGuide: false, isMentor: false, callerName: role.callerName };
    } else if (role.isGuide) {
      return { advisor: null, metrics: null, isAdmin: false, isGuide: true, isMentor: false, callerName: role.callerName };
    } else if (role.isMentor) {
      return { advisor: null, metrics: null, isAdmin: false, isGuide: false, isMentor: true, callerName: role.callerName };
    } else {
      return { advisor: null, metrics: null, isAdmin: false, isGuide: false, isMentor: false, error: "NOT_AN_ADVISOR", message: `No advisor record found for ${email}` };
    }

    // Which Mentor/Guide is SHOWN for this advisor reflects the period
    // being viewed (dateFilters.checkedFrom), not today's relationship —
    // "who they belonged to" is reporting, same as the metrics beside it
    // (see qaDataEngine.ts's "Rewire Advisor Mapping" section comment). The
    // team-membership ACCESS check above this stays on the CURRENT
    // relationship by design — a Guide/Mentor's own ability to open this
    // advisor never depends on which period they happen to be viewing.
    const advisor = await findAdvisorByTactIdAsOf(targetTactId, dateFilters.checkedFrom);
    const parsed = parseDateFilters(dateFilters);
    const metrics = await getAdvisorMetrics(targetTactId, parsed, dateFilters);

    return { advisor, metrics, isAdmin: role.isAdmin, isGuide: role.isGuide, isMentor: role.isMentor };
  } catch (err: any) {
    return { advisor: null, metrics: null, isAdmin: false, isGuide: false, isMentor: false, error: "SERVER_ERROR", message: err.message };
  }
}

export async function listAdvisorsForCaller(
  email: string
): Promise<{ advisors: Advisor[]; isGuide: boolean; isMentor: boolean } | ErrorResult> {
  try {
    const role = await resolveQaCallerRole(email);
    if (!role.isAdmin && !role.isGuide && !role.isMentor) {
      return { error: "FORBIDDEN", message: "Not authorized to list advisors" };
    }
    let pool: Advisor[];
    if (role.isAdmin) pool = await getAllAdvisors();
    else if (role.isGuide) pool = await getAdvisorsForGuide(role.callerName);
    else pool = await getAdvisorsForMentor(role.callerName);

    // No further allowlist filtering (2026-08-07) — eligibility is now
    // entirely "Currently Employed" on master_advisors, applied once inside
    // getAllAdvisors/getAdvisorsForGuide/getAdvisorsForMentor. See
    // EMPLOYED_STATUS_VALUES's comment in qaDataEngine.ts for why the old
    // hardcoded TACT ID allowlist was removed from this and the two call
    // sites below.
    return { advisors: pool, isGuide: role.isGuide, isMentor: role.isMentor };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

export async function getFeedbackRowsFor(
  email: string,
  requestedTactId: string | null,
  checkedFrom: string | null = null,
  checkedTo: string | null = null
): Promise<Awaited<ReturnType<typeof getAdvisorFeedback>> | ErrorResult> {
  try {
    const resolved = await resolveTargetTactId(email, requestedTactId);
    if (isError(resolved)) return resolved;
    return await getAdvisorFeedback(resolved.tactId, checkedFrom, checkedTo);
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

export async function getReviewRowsFor(
  email: string,
  requestedTactId: string | null,
  checkedFrom: string | null,
  checkedTo: string | null
): Promise<Awaited<ReturnType<typeof getAdvisorReviews>> | ErrorResult> {
  try {
    const resolved = await resolveTargetTactId(email, requestedTactId);
    if (isError(resolved)) return resolved;
    return await getAdvisorReviews(resolved.tactId, checkedFrom, checkedTo);
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

export interface AdvisorSummaryRow {
  tactId: string;
  name: string;
  guide: string | null;
  mentor: string | null;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  paymentsAvg: number | null;
  paymentsInstances: number;
  chatAvg: number | null;
  chatInstances: number;
  callAvg: number | null;
  callInstances: number;
}

export async function getAdvisorsDashboardListFor(
  email: string,
  dateFilters: DateFilters
): Promise<{ advisors: AdvisorSummaryRow[]; isAdmin: boolean; isGuide: boolean; isMentor: boolean; callerName: string } | ErrorResult> {
  try {
    const role = await resolveQaCallerRole(email);
    if (!role.isAdmin && !role.isGuide && !role.isMentor) {
      return { error: "FORBIDDEN", message: "Not authorized to list advisors" };
    }
    // Period-based (2026-09 "Rewire Advisor Mapping"): this roster is a
    // reporting view, not an access-control check, so it's resolved as of
    // the selected period's own START date rather than today — an advisor
    // who has since moved to a different Guide/Mentor, or left the
    // company, still shows up here for a period during which they were
    // active and under this Guide/Mentor. See qaDataEngine.ts's "Advisor
    // Relationship Mapping" section comment.
    let pool: Advisor[];
    if (role.isAdmin) pool = await getAllAdvisorsAsOf(dateFilters.checkedFrom);
    else if (role.isGuide) pool = await getAdvisorsForGuideAsOf(role.callerName, dateFilters.checkedFrom);
    else pool = await getAdvisorsForMentorAsOf(role.callerName, dateFilters.checkedFrom);
    // No allowlist filter — see the comment on listAdvisorsForCaller above.

    const tactIds = pool.map((a) => String(a.tactId).trim());
    const parsed = parseDateFilters(dateFilters);
    const metricsByTact = await getAdvisorsBatchMetrics(tactIds, parsed.checkedFrom, parsed.checkedTo, parsed.tillDate, dateFilters);

    const advisors: AdvisorSummaryRow[] = pool.map((a) => {
      const tact = String(a.tactId).trim();
      const m = metricsByTact[tact] || {
        paymentsAvg: null,
        paymentsInstances: 0,
        paymentsBlunders: 0,
        leadScoreAvg: null,
        leadScoreInstances: 0,
        leadScoreBlunders: 0,
        chatAvg: null,
        chatInstances: 0,
        chatBlunders: 0,
        callAvg: null,
        callInstances: 0,
        callBlunders: 0,
      };
      return {
        tactId: a.tactId,
        name: a.name,
        guide: a.guide,
        mentor: a.mentor,
        leadScoreAvg: m.leadScoreAvg,
        leadScoreInstances: m.leadScoreInstances,
        paymentsAvg: m.paymentsAvg,
        paymentsInstances: m.paymentsInstances,
        chatAvg: m.chatAvg,
        chatInstances: m.chatInstances,
        callAvg: m.callAvg,
        callInstances: m.callInstances,
      };
    });

    return { advisors, isAdmin: role.isAdmin, isGuide: role.isGuide, isMentor: role.isMentor, callerName: role.callerName };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

/**
 * Aggregate-only, ANY-authenticated-caller company-wide QA summary —
 * deliberately no role check. Added so the Home page's QA Performance Peek
 * widget can show a real number to a user with no assigned QA Dashboard
 * role (not Admin/Guide/Mentor, and not an advisor with their own QA
 * record) instead of an empty "not tracked" state, while the actual QA
 * Dashboard page stays exactly as restricted as before. This intentionally
 * does NOT reuse getAdvisorsDashboardListFor's return shape — it only ever
 * returns 4 aggregate numbers, never the per-advisor roster/names/
 * individual scores that a real QA Dashboard role is needed to see.
 */
export async function getCompanyWideQaAggregateFor(
  dateFilters: DateFilters
): Promise<
  | {
      lead: number | null;
      payments: number | null;
      leadCount: number;
      paymentsCount: number;
      chat: number | null;
      chatCount: number;
      call: number | null;
      callCount: number;
    }
  | ErrorResult
> {
  try {
    // Period-based, same reasoning as getAdvisorsDashboardListFor above.
    const pool = await getAllAdvisorsAsOf(dateFilters.checkedFrom);
    // No allowlist filter — see the comment on listAdvisorsForCaller above.

    const tactIds = pool.map((a) => String(a.tactId).trim());
    const parsed = parseDateFilters(dateFilters);
    const metricsByTact = await getAdvisorsBatchMetrics(tactIds, parsed.checkedFrom, parsed.checkedTo, parsed.tillDate, dateFilters);

    const leadVals: number[] = [];
    const paymentsVals: number[] = [];
    const chatVals: number[] = [];
    const callVals: number[] = [];
    let leadCount = 0;
    let paymentsCount = 0;
    let chatCount = 0;
    let callCount = 0;
    for (const tact of tactIds) {
      const m = metricsByTact[tact];
      if (!m) continue;
      if (m.leadScoreAvg !== null) {
        leadVals.push(m.leadScoreAvg);
        leadCount += m.leadScoreInstances || 0;
      }
      if (m.paymentsAvg !== null) {
        paymentsVals.push(m.paymentsAvg);
        paymentsCount += m.paymentsInstances || 0;
      }
      if (m.chatAvg !== null) {
        chatVals.push(m.chatAvg);
        chatCount += m.chatInstances || 0;
      }
      if (m.callAvg !== null) {
        callVals.push(m.callAvg);
        callCount += m.callInstances || 0;
      }
    }
    const avg = (vals: number[]) => (vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null);

    return {
      lead: avg(leadVals),
      payments: avg(paymentsVals),
      leadCount,
      paymentsCount,
      chat: avg(chatVals),
      chatCount,
      call: avg(callVals),
      callCount,
    };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}
