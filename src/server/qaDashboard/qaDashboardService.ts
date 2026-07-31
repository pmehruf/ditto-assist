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
  getAllAdvisors,
  getAdvisorsForGuide,
  getAdvisorsForMentor,
  getAdvisorMetrics,
  getAdvisorsBatchMetrics,
  getAdvisorFeedback,
  getAdvisorReviews,
  isInScoreDashboardAllowlist,
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

    const advisor = await findAdvisorByTactId(targetTactId);
    const parsed = parseDateFilters(dateFilters);
    const metrics = await getAdvisorMetrics(targetTactId, parsed);

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

    pool = pool.filter((a) => isInScoreDashboardAllowlist(a.tactId));
    return { advisors: pool, isGuide: role.isGuide, isMentor: role.isMentor };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}

export async function getFeedbackRowsFor(
  email: string,
  requestedTactId: string | null
): Promise<Awaited<ReturnType<typeof getAdvisorFeedback>> | ErrorResult> {
  try {
    const resolved = await resolveTargetTactId(email, requestedTactId);
    if (isError(resolved)) return resolved;
    return await getAdvisorFeedback(resolved.tactId);
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
  leadScoreAvg: number | null;
  paymentsAvg: number | null;
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
    let pool: Advisor[];
    if (role.isAdmin) pool = await getAllAdvisors();
    else if (role.isGuide) pool = await getAdvisorsForGuide(role.callerName);
    else pool = await getAdvisorsForMentor(role.callerName);
    pool = pool.filter((a) => isInScoreDashboardAllowlist(a.tactId));

    const tactIds = pool.map((a) => String(a.tactId).trim());
    const parsed = parseDateFilters(dateFilters);
    const metricsByTact = await getAdvisorsBatchMetrics(tactIds, parsed.checkedFrom, parsed.checkedTo, parsed.tillDate);

    const advisors: AdvisorSummaryRow[] = pool.map((a) => {
      const tact = String(a.tactId).trim();
      const m = metricsByTact[tact] || { paymentsAvg: null, leadScoreAvg: null };
      return { tactId: a.tactId, name: a.name, guide: a.guide, leadScoreAvg: m.leadScoreAvg, paymentsAvg: m.paymentsAvg };
    });

    return { advisors, isAdmin: role.isAdmin, isGuide: role.isGuide, isMentor: role.isMentor, callerName: role.callerName };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err.message };
  }
}
