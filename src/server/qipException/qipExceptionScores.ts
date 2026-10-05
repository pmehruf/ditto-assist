// QIP Exception Request — autofill source. Read-only: returns one advisor's
// per-month Lead Score / Payments QA numbers from the SAME scoring the Team
// Tracker uses (qaDataEngine.getAdvisorsBatchMetrics, one call per month via
// teamTrackerService's own month/date-range helpers). No new calculation here.
//
// Access: the caller must be allowed to see this advisor under the Team
// Tracker's own Admin/Guide/Mentor scope (canAccessAdvisorForCoaching), so a
// Guide/Mentor can only pull their own team's numbers. Months are read one at
// a time on purpose — fanning out concurrent per-month reads is what pushed
// the Cloud Run instance past its memory limit on Team Tracker.

import { getAdvisorsBatchMetrics, parseDateFilters } from "../qaDashboard/qaDataEngine.js";
import { canAccessAdvisorForCoaching, enumerateMonths } from "../qaDashboard/teamTrackerService.js";

export interface QipMonthScores {
  monthKey: string;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  leadScoreBlunders: number;
  paymentsAvg: number | null;
  paymentsInstances: number;
  paymentsBlunders: number;
}

export type QipScoresResult = { months: QipMonthScores[] } | { error: "FORBIDDEN" | "BAD_REQUEST" | "SERVER_ERROR"; message: string };

const MAX_MONTHS = 24;

export async function getQipExceptionScores(email: string, tactId: string, fromYm: string, toYm: string): Promise<QipScoresResult> {
  try {
    const id = String(tactId || "").trim();
    if (!id || !/^\d{4}-\d{2}$/.test(fromYm) || !/^\d{4}-\d{2}$/.test(toYm)) {
      return { error: "BAD_REQUEST", message: "tactId, fromMonth and toMonth (yyyy-MM) are required." };
    }
    const access = await canAccessAdvisorForCoaching(email, id);
    if (!access.allowed) {
      return { error: "FORBIDDEN", message: "You do not have access to this advisor." };
    }
    const specs = enumerateMonths(fromYm, toYm);
    if (specs.length === 0 || specs.length > MAX_MONTHS) {
      return { error: "BAD_REQUEST", message: `Choose a range of 1 to ${MAX_MONTHS} months.` };
    }
    const months: QipMonthScores[] = [];
    for (const m of specs) {
      const parsed = parseDateFilters(m.filters);
      const byTact = await getAdvisorsBatchMetrics([id], parsed.checkedFrom, parsed.checkedTo, parsed.tillDate, m.filters);
      const mm = byTact[id];
      months.push({
        monthKey: m.key,
        leadScoreAvg: mm?.leadScoreAvg ?? null,
        leadScoreInstances: mm?.leadScoreInstances ?? 0,
        leadScoreBlunders: mm?.leadScoreBlunders ?? 0,
        paymentsAvg: mm?.paymentsAvg ?? null,
        paymentsInstances: mm?.paymentsInstances ?? 0,
        paymentsBlunders: mm?.paymentsBlunders ?? 0,
      });
    }
    return { months };
  } catch (err: any) {
    return { error: "SERVER_ERROR", message: err?.message || "Failed to load QA data." };
  }
}
