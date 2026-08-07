/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Star, ArrowUpRight, Users } from "lucide-react";

interface QaScoreWidgetProps {
  theme: "light" | "dark";
  userEmail: string;
  onOpenQaDashboard: () => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Same "current calendar month" default QaDashboardPage.tsx uses, so
 * "this month" means the same thing here as it does on the full dashboard. */
function computeDefaultDates(): { checkedFrom: string; checkedTo: string; tillDate: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  return {
    checkedFrom: `${y}-${pad(m + 1)}-01`,
    checkedTo: fmtDate(new Date(y, m + 1, 0)),
    tillDate: fmtDate(new Date(y, m, -1)),
  };
}

function scoreColor(score: number | null): string {
  if (score === null) return "#94A3B8";
  if (score >= 90) return "#22C55E";
  if (score >= 75) return "#D1A34A";
  return "#DC2626";
}

interface AdvisorSummaryRow {
  tactId: string;
  name: string;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  paymentsAvg: number | null;
  paymentsInstances: number;
}

type WidgetState =
  | { kind: "loading" }
  | { kind: "own"; leadScore: number | null; leadInstances: number; paymentsScore: number | null; paymentsInstances: number }
  | { kind: "team"; scopeLabel: string; advisors: AdvisorSummaryRow[] }
  | { kind: "unavailable" };

/**
 * "QA Score — This Month" quick peek. Real, role-scoped data from the same
 * QA Dashboard backend QaDashboardPage.tsx uses (not placeholder content):
 *  - Plain Advisor → their own Lead Score / Payments QA average
 *    (/api/qa-dashboard/dashboard, own-record case).
 *  - Guide/Mentor → their team's averages + a short list
 *    (/api/qa-dashboard/summary, which already scopes the pool server-side
 *    via qaRoles.ts — Guide sees their team, Mentor sees their mentees).
 *  - Admin → the same /api/qa-dashboard/summary endpoint, unscoped (every
 *    advisor in the allowlist).
 * Role is determined by trying /summary first: it 200s with real data for
 * Admin/Guide/Mentor, and 200s with an {error:"FORBIDDEN"} body for a plain
 * Advisor (see getAdvisorsDashboardListFor in qaDashboardService.ts) — that
 * FORBIDDEN response is the signal to fall back to the own-record endpoint,
 * rather than duplicating qaRoles.ts's role resolution on the frontend.
 */
export function QaScoreWidget({ theme, userEmail, onOpenQaDashboard }: QaScoreWidgetProps) {
  const [state, setState] = useState<WidgetState>({ kind: "loading" });

  useEffect(() => {
    if (!userEmail) {
      setState({ kind: "unavailable" });
      return;
    }
    let cancelled = false;
    const { checkedFrom, checkedTo, tillDate } = computeDefaultDates();
    const qs = new URLSearchParams({ checkedFrom, checkedTo, tillDate }).toString();

    (async () => {
      try {
        const summaryRes = await fetch(`/api/qa-dashboard/summary?${qs}`);
        const summaryBody = await summaryRes.json();
        if (cancelled) return;

        if (summaryRes.ok && !summaryBody.error) {
          const advisors: AdvisorSummaryRow[] = summaryBody.advisors || [];
          const scopeLabel = summaryBody.isAdmin ? "All Advisors" : "Your Team";
          setState({ kind: "team", scopeLabel, advisors });
          return;
        }

        if (summaryBody.error === "FORBIDDEN") {
          // Plain Advisor — fall back to the own-record dashboard endpoint.
          const ownRes = await fetch(`/api/qa-dashboard/dashboard?${qs}`);
          const ownBody = await ownRes.json();
          if (cancelled) return;
          if (ownRes.ok && ownBody.metrics) {
            setState({
              kind: "own",
              leadScore: ownBody.metrics.leadScore?.average ?? null,
              leadInstances: ownBody.metrics.leadScore?.numberOfLeads ?? 0,
              paymentsScore: ownBody.metrics.loPayments?.average ?? null,
              paymentsInstances: ownBody.metrics.loPayments?.instances ?? 0,
            });
          } else {
            setState({ kind: "unavailable" });
          }
          return;
        }

        setState({ kind: "unavailable" });
      } catch (err) {
        console.error("Failed to load QA score widget:", err);
        if (!cancelled) setState({ kind: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  // No h-full here: this card is a standalone block in a vertical stack, not
  // a row sharing height with a sibling — h-full was stretching it to fill
  // whatever leftover vertical space existed on the page, leaving 100px+ of
  // dead white space below the advisor list. It should size to its content.
  const cardClass = `rounded-2xl border p-5 flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  const header = (subtitle: string) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2 select-none">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--accent-subtle-bg)", color: "var(--accent)" }}
        >
          <Star className="w-3.5 h-3.5" />
        </div>
        <div className="leading-tight">
          <div className={`text-[12.5px] font-black uppercase tracking-wide ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
            QA Score — This Month
          </div>
          <div className={`text-[10.5px] font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>{subtitle}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenQaDashboard}
        className={`flex items-center gap-0.5 text-[10.5px] font-bold uppercase tracking-wide cursor-pointer transition-colors shrink-0 ${
          theme === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
        }`}
      >
        Full Dashboard
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );

  // Not flex-1: on a wide card, two flex-1 blocks each claim ~50% of the row
  // width and left-align their (narrow, fixed-size) numbers inside that, so
  // the two scores end up stranded far apart with a big dead gap between
  // them. Sizing to content keeps the pair tight together regardless of how
  // wide the card is.
  const statBlock = (label: string, score: number | null, instances: number) => (
    <div className="min-w-[104px]">
      {/* 2 decimal places, not 1 — two independent metrics (Lead Score,
          Payments QA) can legitimately round to the same 1-decimal value
          by coincidence when averaged across 90+ instances, which reads as
          a bug even though the underlying numbers differ. */}
      <div className="text-2xl font-black font-mono leading-tight" style={{ color: scoreColor(score) }}>
        {score !== null ? score.toFixed(2) : "—"}
      </div>
      <div className={`text-[10px] font-semibold tracking-wide leading-tight mt-0.5 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
        {label} {instances > 0 ? `· ${instances}` : ""}
      </div>
    </div>
  );

  if (state.kind === "loading") {
    return (
      <div className={cardClass}>
        {header("Loading…")}
        <div className="flex gap-6 animate-pulse">
          <div className={`h-10 w-20 rounded-lg ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
          <div className={`h-10 w-20 rounded-lg ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
        </div>
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className={cardClass}>
        {header("Not tracked for your account")}
        <div className={`flex-1 flex flex-col items-center justify-center text-center py-2 gap-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
          <Star className="w-5 h-5 opacity-50" />
          <span className="text-[11.5px] font-medium">QA scores aren't tracked for your account yet.</span>
        </div>
      </div>
    );
  }

  if (state.kind === "own") {
    return (
      <div className={cardClass}>
        {header("Your Score")}
        <div className="flex gap-10">
          {statBlock("Lead Score", state.leadScore, state.leadInstances)}
          {statBlock("Payments QA", state.paymentsScore, state.paymentsInstances)}
        </div>
      </div>
    );
  }

  // Team view (Guide / Mentor / Admin)
  const withData = state.advisors.filter((a) => a.paymentsAvg !== null || a.leadScoreAvg !== null);
  // Round to 2 decimals (not 1) — averaging 90+ instances at 1-decimal
  // precision was exactly what made Lead Score and Payments QA collide on
  // an identical-looking value (4.4/4.4) despite being different numbers.
  const avg = (vals: number[]) => (vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null);
  const teamLead = avg(withData.map((a) => a.leadScoreAvg).filter((v): v is number => v !== null));
  const teamPayments = avg(withData.map((a) => a.paymentsAvg).filter((v): v is number => v !== null));
  // Surface who might need attention first — lowest Payments QA average,
  // advisors with no data yet pushed to the end rather than sorted as "0".
  const sorted = [...state.advisors].sort((a, b) => {
    if (a.paymentsAvg === null) return 1;
    if (b.paymentsAvg === null) return -1;
    return a.paymentsAvg - b.paymentsAvg;
  });
  const preview = sorted.slice(0, 8);

  return (
    <div className={cardClass}>
      {header(`${state.scopeLabel} · ${state.advisors.length} advisor${state.advisors.length === 1 ? "" : "s"}`)}
      <div className="flex gap-10 mb-4">
        {statBlock("Team Lead Score", teamLead, withData.length)}
        {statBlock("Team Payments QA", teamPayments, withData.length)}
      </div>
      {preview.length > 0 && (
        <div
          className="pt-3 border-t"
          style={{ borderColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(168,162,158,0.35)" }}
        >
          {/* One combined roster, sorted by lowest Payments QA — NOT split
              left/right by the two stat headers above (it used to sit
              directly under them with no label, which made it look like
              "Lead Score people" on the left vs "Payments QA people" on the
              right; both columns are really the same list, alternating via
              CSS grid auto-flow, and every row's number is always Payments
              QA). This label exists specifically to stop that misreading. */}
          <div className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
            Lowest Payments QA — Needs Attention
          </div>
          {/* 4 columns at xl+ (not just 2) — on a ~1500px-wide card, 2 fixed
              columns left acres of empty space next to each short name/score
              pair; 4 columns keeps the roster compact and tight instead of
              stretching it thin across the row. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6">
          {preview.map((a) => (
            <button
              type="button"
              key={a.tactId}
              onClick={onOpenQaDashboard}
              className={`flex items-center justify-between gap-3 py-2 text-left cursor-pointer transition-colors rounded-lg -mx-1 px-1 border-b border-dashed last:border-b-0 ${
                theme === "dark" ? "hover:bg-white/[0.03] border-white/[0.06]" : "hover:bg-stone-100/60 border-stone-300/50"
              }`}
              title="Open in QA Dashboard"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Users className={`w-3 h-3 shrink-0 ${theme === "dark" ? "text-stone-500" : "text-stone-400"}`} />
                <span className={`text-[12px] font-bold truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>{a.name}</span>
              </div>
              <span className="text-[11px] font-black font-mono shrink-0" style={{ color: scoreColor(a.paymentsAvg) }}>
                {a.paymentsAvg !== null ? a.paymentsAvg.toFixed(2) : "—"}
              </span>
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
