/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Star, ArrowUpRight, TrendingUp, TrendingDown, Clock } from "lucide-react";

interface QaPerformancePeekProps {
  theme: "light" | "dark";
  userEmail: string;
  onOpenQaDashboard: () => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
/** Relative-time formatter for the "Last updated" label — same style as the
 * one Recent Searches uses elsewhere on the Workspace, so "3h ago" reads
 * consistently across the page. */
function formatRelativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Same three-param contract every other QA endpoint call in this app uses
 * (checkedFrom/checkedTo/tillDate). `monthsAgo` picks the calendar month —
 * 0 = the current month (fixed to its 1st/last day regardless of what day
 * it is today; it only rolls over when the month itself changes), 1 = the
 * previous month, for the trend comparison. tillDate is always 2 days
 * before the period's own start date, which — because month lengths vary —
 * always lands exactly on the second-last day of the PRIOR month (e.g.
 * period starting 1 Aug -> tillDate 30 Jul; period starting 1 Jul -> 29 Jun,
 * June's second-last day). Native Date arithmetic handles the month-length
 * differences automatically, so there's no special-casing per month here. */
function monthRange(monthsAgo: number): { checkedFrom: string; checkedTo: string; tillDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  // Day 0 of the following month = the last day of the target month.
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const till = new Date(start);
  till.setDate(till.getDate() - 2);
  return { checkedFrom: fmtDate(start), checkedTo: fmtDate(end), tillDate: fmtDate(till) };
}

function avgOf(a: number | null, b: number | null): number | null {
  const vals = [a, b].filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
}

/** Rating tier — deliberately no strong reds anywhere on the Workspace;
 * detailed red-flagging stays inside the full QA Dashboard.
 * All 5 tier colors were picked for the dark card and read too pale on the
 * light theme's white/60 card, so `theme` picks a darker equivalent for
 * the badge/number text in light mode only — `subtle` (the badge chip's
 * background tint) stays the same either way since a soft tint doesn't
 * have the same legibility problem a foreground color does. */
function tierFor(score: number | null, theme: "light" | "dark"): { label: string; color: string; subtle: string } {
  const dark = theme === "dark";
  if (score === null) return { label: "No Data", color: dark ? "#94A3B8" : "#475569", subtle: "rgba(148,163,184,0.12)" };
  if (score >= 4.5) return { label: "Outstanding", color: dark ? "#22D3EE" : "#0E7490", subtle: "rgba(34,211,238,0.12)" };
  if (score >= 4.0) return { label: "Excellent", color: dark ? "#3B82F6" : "#1D4ED8", subtle: "rgba(59,130,246,0.12)" };
  if (score >= 3.5) return { label: "Strong", color: dark ? "#D1A34A" : "#82652E", subtle: "rgba(209,163,74,0.14)" };
  if (score >= 3.0) return { label: "Improving", color: dark ? "#F0954D" : "#955C30", subtle: "rgba(240,149,77,0.14)" };
  return { label: "Needs Attention", color: dark ? "#EA8A5A" : "#915638", subtle: "rgba(234,138,90,0.14)" };
}

/** Fractional 5-star rating — a muted background row of 5 filled stars with
 * a full-color copy clipped to `score/5` width on top, so partial stars
 * (e.g. 4.3) render as an accurately partial star, not a rounded whole one.
 * Both rows are given the SAME explicit pixel width (`shrink-0` on the row
 * and every star) rather than letting the clipped copy's width come from
 * its `${pct}%` container — flexbox otherwise treats that percentage as a
 * target to shrink the 5 stars into (all 5 rendered smaller, not 4½ shown
 * full-size and the rest cut off), so the two rows drift out of alignment
 * and read as 6+ stars instead of a clean partial 5th star. */
function StarRating({ score, size = 15, color }: { score: number | null; size?: number; color: string }) {
  const pct = score === null ? 0 : Math.max(0, Math.min(1, score / 5)) * 100;
  const GAP = 1;
  const rowWidth = size * 5 + GAP * 4;
  const stars = (fill: string) => (
    <span className="flex shrink-0" style={{ gap: GAP, width: rowWidth }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} width={size} height={size} fill={fill} stroke="none" className="shrink-0" />
      ))}
    </span>
  );
  return (
    <span className="relative inline-flex shrink-0" style={{ lineHeight: 0, width: rowWidth }}>
      {stars("#CBD5E1")}
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {stars(color)}
      </span>
    </span>
  );
}

type WidgetState =
  | { kind: "loading" }
  | {
      kind: "own" | "team";
      scopeLabel: string;
      consolidated: number | null;
      lead: number | null;
      payments: number | null;
      leadCount: number;
      paymentsCount: number;
      prevConsolidated: number | null;
    }
  | { kind: "unavailable" };

interface AdvisorSummaryRow {
  tactId: string;
  name: string;
  leadScoreAvg: number | null;
  leadScoreInstances: number;
  paymentsAvg: number | null;
  paymentsInstances: number;
}

async function fetchTeamAggregate(
  qs: string
): Promise<{ scopeLabel: string; lead: number | null; payments: number | null; leadCount: number; paymentsCount: number } | "forbidden" | null> {
  const res = await fetch(`/api/qa-dashboard/summary?${qs}`);
  const body = await res.json();
  if (!res.ok) return null;
  if (body.error === "FORBIDDEN") return "forbidden";
  if (body.error) return null;
  const advisors: AdvisorSummaryRow[] = body.advisors || [];
  const withData = advisors.filter((a) => a.paymentsAvg !== null || a.leadScoreAvg !== null);
  const avg = (vals: number[]) => (vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null);
  // Evaluation counts are summed only over the advisors that actually fed
  // that metric's average (same filter as the average itself), so "N
  // evaluations" always matches the population the score above it
  // describes — not a total that includes advisors with no score.
  const leadContributors = withData.filter((a) => a.leadScoreAvg !== null);
  const paymentsContributors = withData.filter((a) => a.paymentsAvg !== null);
  return {
    scopeLabel: body.isAdmin ? "Company-Wide" : "Your Team",
    lead: avg(leadContributors.map((a) => a.leadScoreAvg).filter((v): v is number => v !== null)),
    payments: avg(paymentsContributors.map((a) => a.paymentsAvg).filter((v): v is number => v !== null)),
    leadCount: leadContributors.reduce((sum, a) => sum + (a.leadScoreInstances || 0), 0),
    paymentsCount: paymentsContributors.reduce((sum, a) => sum + (a.paymentsInstances || 0), 0),
  };
}

async function fetchOwnAggregate(
  qs: string
): Promise<{ lead: number | null; payments: number | null; leadCount: number; paymentsCount: number } | null> {
  const res = await fetch(`/api/qa-dashboard/dashboard?${qs}`);
  const body = await res.json();
  if (!res.ok || !body.metrics) return null;
  return {
    lead: body.metrics.leadScore?.average ?? null,
    payments: body.metrics.loPayments?.average ?? null,
    leadCount: body.metrics.leadScore?.numberOfLeads ?? 0,
    paymentsCount: body.metrics.loPayments?.instances ?? 0,
  };
}

/** Fallback for a caller with no QA Dashboard role AND no advisor record of
 * their own — hits the aggregate-only /company-summary route (see its doc
 * comment on the server) instead of leaving them with an empty widget. This
 * never grants access to the real QA Dashboard page itself: it's a
 * different, narrower endpoint that only ever returns 4 numbers. */
async function fetchCompanyWideAggregate(
  qs: string
): Promise<{ lead: number | null; payments: number | null; leadCount: number; paymentsCount: number } | null> {
  const res = await fetch(`/api/qa-dashboard/company-summary?${qs}`);
  const body = await res.json();
  if (!res.ok || body.error) return null;
  return {
    lead: body.lead ?? null,
    payments: body.payments ?? null,
    leadCount: body.leadCount ?? 0,
    paymentsCount: body.paymentsCount ?? 0,
  };
}

/**
 * "QA Performance Peek" — a premium, glanceable rating widget, deliberately
 * NOT a miniature QA Dashboard (no tables, no dense stats, no red). Role-
 * scoped the same way the full QA Dashboard is: an Advisor sees their own
 * Consolidated/Lead/Payments scores, a Guide/Mentor sees their team's, an
 * Admin sees the company-wide numbers — same summary/dashboard endpoints,
 * same FORBIDDEN-in-200-body role signal QaScoreWidget originally used,
 * just queried over the current calendar month (twice — this month and last
 * month) so a trend delta can be shown. A 4th case: someone with NO QA
 * Dashboard role and no advisor record of their own still sees the same
 * company-wide number an Admin would (via the separate, aggregate-only
 * /company-summary endpoint — see fetchCompanyWideAggregate) instead of an
 * empty widget, even though the real QA Dashboard page stays off-limits to
 * them; "glanceable for everyone" and "gated for the full dashboard" are
 * deliberately different bars here.
 * "Consolidated Score" = the average of Lead QA and Payments QA — there's
 * no other composite score defined anywhere in the QA data model, and
 * averaging the two is the simplest, most explainable definition of "one
 * hero number" for a widget that's explicitly not meant to be analyzed.
 */
export function QaPerformancePeek({ theme, userEmail, onOpenQaDashboard }: QaPerformancePeekProps) {
  const [state, setState] = useState<WidgetState>({ kind: "loading" });

  useEffect(() => {
    if (!userEmail) {
      setState({ kind: "unavailable" });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const thisMonth = monthRange(0);
        const lastMonth = monthRange(1);
        const qsThis = new URLSearchParams(thisMonth).toString();
        const qsLast = new URLSearchParams(lastMonth).toString();

        const teamThis = await fetchTeamAggregate(qsThis);
        if (cancelled) return;

        if (teamThis === "forbidden") {
          // Plain Advisor — own-record endpoint.
          const ownThis = await fetchOwnAggregate(qsThis);
          if (cancelled) return;
          if (ownThis) {
            const ownLast = await fetchOwnAggregate(qsLast);
            if (cancelled) return;
            setState({
              kind: "own",
              scopeLabel: "Your Score",
              consolidated: avgOf(ownThis.lead, ownThis.payments),
              lead: ownThis.lead,
              payments: ownThis.payments,
              leadCount: ownThis.leadCount,
              paymentsCount: ownThis.paymentsCount,
              prevConsolidated: ownLast ? avgOf(ownLast.lead, ownLast.payments) : null,
            });
            return;
          }

          // No QA Dashboard role (not Admin/Guide/Mentor) AND no advisor
          // record of their own — e.g. a General-tier user with no QA
          // identity at all. Rather than an empty "not tracked" widget,
          // show the same company-wide number an Admin sees (via the
          // aggregate-only endpoint above); this does NOT unlock the real
          // QA Dashboard page, which still requires an assigned role.
          const companyThis = await fetchCompanyWideAggregate(qsThis);
          if (cancelled) return;
          if (!companyThis) {
            setState({ kind: "unavailable" });
            return;
          }
          const companyLast = await fetchCompanyWideAggregate(qsLast);
          if (cancelled) return;
          setState({
            kind: "team",
            scopeLabel: "Company-Wide",
            consolidated: avgOf(companyThis.lead, companyThis.payments),
            lead: companyThis.lead,
            payments: companyThis.payments,
            leadCount: companyThis.leadCount,
            paymentsCount: companyThis.paymentsCount,
            prevConsolidated: companyLast ? avgOf(companyLast.lead, companyLast.payments) : null,
          });
          return;
        }

        if (teamThis === null) {
          setState({ kind: "unavailable" });
          return;
        }

        const teamLast = await fetchTeamAggregate(qsLast);
        if (cancelled) return;
        setState({
          kind: "team",
          scopeLabel: teamThis.scopeLabel,
          consolidated: avgOf(teamThis.lead, teamThis.payments),
          lead: teamThis.lead,
          payments: teamThis.payments,
          leadCount: teamThis.leadCount,
          paymentsCount: teamThis.paymentsCount,
          prevConsolidated: teamLast && teamLast !== "forbidden" ? avgOf(teamLast.lead, teamLast.payments) : null,
        });
      } catch (err) {
        console.error("Failed to load QA Performance Peek:", err);
        if (!cancelled) setState({ kind: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  // Separate, independent fetch — real trigger history for processRawDump
  // (Phase1_DataEngine.gs) via the Apps Script Executions API, not derived
  // from the scoring data above. `undefined` = still loading, `null` =
  // fetched but unavailable (e.g. the stored grant predates the
  // script.processes scope) — both render as no label, only a real
  // Date shows one, so a failed/unavailable lookup never claims a false
  // "just now".
  const [lastRunAt, setLastRunAt] = useState<Date | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/qa-dashboard/last-processed")
      .then((res) => (res.ok ? res.json() : { lastRunAt: null }))
      .then((body) => {
        if (cancelled) return;
        setLastRunAt(body.lastRunAt ? new Date(body.lastRunAt) : null);
      })
      .catch((err) => {
        console.error("Failed to load QA data's last-processed time:", err);
        if (!cancelled) setLastRunAt(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // This card is used exclusively by the Home dashboard (LookupIntroPage.tsx)
  // — vertical padding/margins below use clamp(floor, Xvh, ceiling) so this
  // supporting-tier card compresses on a short viewport instead of forcing
  // the page taller than it needs to be. Horizontal padding and all font
  // sizes are untouched.
  const cardClass = `relative rounded-2xl border px-5 py-[clamp(10px,1.6vh,20px)] flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  // Pale amber (#FBBF24) reads fine on the dark card but nearly disappears
  // against the light theme's white/60 card — use a deeper amber for the
  // icon in light mode only; dark mode, the star color, and the tier
  // colors are all untouched.
  const headerIconColor = theme === "dark" ? "#FBBF24" : "#B45309";
  const headerIconBg = theme === "dark" ? "#FBBF241A" : "#B453091A";

  if (state.kind === "loading") {
    return (
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-[clamp(6px,1vh,14px)]">
          <div className="flex items-center gap-2 select-none">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
              <Star className="w-4 h-4" />
            </div>
            <span className={`text-[12px] font-black uppercase tracking-wide ${theme === "dark" ? "text-white" : "text-stone-900"}`}>QA Performance</span>
          </div>
        </div>
        <div className="animate-pulse space-y-2">
          <div className={`h-7 w-32 rounded-lg ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
          <div className={`h-3.5 w-20 rounded ${theme === "dark" ? "bg-white/[0.04]" : "bg-stone-200/60"}`} />
        </div>
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className={cardClass}>
        <div className="flex items-center gap-2 select-none mb-[clamp(6px,1vh,14px)]">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
            <Star className="w-4 h-4" />
          </div>
          <span className={`text-[14px] font-black uppercase tracking-wide ${theme === "dark" ? "text-white" : "text-stone-900"}`}>QA Performance</span>
        </div>
        <div className={`flex-1 flex flex-col items-center justify-center text-center py-3 gap-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
          <Star className="w-5 h-5 opacity-50" />
          <span className="text-[13px] font-medium">QA scores aren't tracked for your account yet.</span>
        </div>
      </div>
    );
  }

  const tier = tierFor(state.consolidated, theme);
  const trend = state.consolidated !== null && state.prevConsolidated !== null ? Math.round((state.consolidated - state.prevConsolidated) * 100) / 100 : null;

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-[clamp(6px,1vh,14px)]">
        <div className="flex items-center gap-2 select-none min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
            <Star className="w-4 h-4" />
          </div>
          <span className={`text-[14px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
            QA Performance
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenQaDashboard}
          className={`flex items-center gap-0.5 text-[12px] font-bold uppercase tracking-wide cursor-pointer transition-colors shrink-0 ${
            theme === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
          }`}
        >
          View QA Dashboard
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {/* THREE-UP COHESIVE GROUPING — Consolidated Score, Lead QA, and
          Payments QA as three CENTERED zones distributed across the card's
          full width (roughly 40% / 30% / 30%, via flex-[1.4]/flex-1/flex-1
          on a flex-1 row so the split is always proportional to whatever
          width this card actually has, not a fixed px split). No vertical
          divider lines between zones — a hard rule reads as "three
          separate widgets"; a single shared `gap` on the row does the same
          separation job as plain whitespace instead, so the row reads as
          one unified KPI panel. Each zone centers its own content (label,
          stars-then-number stacked, and supporting line) rather than
          left-aligning it, so each zone's whitespace distributes evenly on
          both sides instead of pooling after the last one. Consolidated
          keeps the strongest hierarchy (bigger stars/number, plus the tier
          badge, trend and last-month line the other two don't get). */}
      <div className="flex items-stretch gap-6 sm:gap-8">
        <div className="min-w-0 flex-[1.4] flex flex-col items-center text-center justify-center">
          <div className={`text-[11.5px] font-bold uppercase tracking-wide mb-[clamp(3px,0.6vh,8px)] ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
            Consolidated Score
          </div>
          {/* Stars above the number (not side-by-side) — centers more
              cleanly as a block than a wide baseline-aligned row does. */}
          <div className="flex flex-col items-center gap-1 mb-[clamp(3px,0.6vh,8px)]">
            {/* Stars stay a fixed amber (same accent as this card's own
                header icon) rather than the tier color — with the score
                number and "Excellent" badge both already using tier.color
                right next to each other, tinting the stars the same made
                three same-colored elements in a row read as a mistake
                rather than a signal. Gold stars are also just the familiar
                rating convention on their own, independent of any tier. */}
            <StarRating score={state.consolidated} size={24} color="#FBBF24" />
            <span className={`text-[40px] leading-none font-black font-mono ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
              {state.consolidated !== null ? state.consolidated.toFixed(2) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-center gap-2 mb-[clamp(3px,0.6vh,8px)] flex-wrap">
            <span
              className="text-[12.5px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ color: tier.color, backgroundColor: tier.subtle }}
            >
              {tier.label}
            </span>
            {trend !== null && trend !== 0 && (
              <span className={`text-[12px] font-bold flex items-center gap-0.5 ${trend > 0 ? "text-emerald-500" : "text-orange-400"}`}>
                {trend > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {trend > 0 ? "+" : ""}
                {trend.toFixed(2)} this month
              </span>
            )}
          </div>
          {/* Always visible (not hover-only) — labelled plainly rather than
              "vs last month", since it sits directly under the Consolidated
              Score above, not the Lead QA figure beside it; this is the
              trend line's own previous-period baseline, not a per-metric
              number. Plain text, no chart — the arrow + delta above already
              carries the trend; a shape here would just repeat it. */}
          {state.prevConsolidated !== null && (
            <div className={`text-[12px] font-medium ${theme === "dark" ? "text-stone-500" : "text-stone-400"}`}>
              Last month: {state.prevConsolidated.toFixed(2)}
            </div>
          )}
        </div>

        {/* Lead QA / Payments QA — same label-over-value rhythm as
            Consolidated (stars above score, both centered), plus a
            workload line (evaluation count) that fills the space below
            the score instead of leaving it blank. Real numbers already
            returned by the same endpoints this card was already calling
            (leadScoreInstances/numberOfLeads and paymentsInstances) —
            nothing invented, nothing newly fetched. */}
        {([
          ["Lead QA", state.lead, state.leadCount],
          ["Payments QA", state.payments, state.paymentsCount],
        ] as const).map(([label, score, count]) => {
          const t = tierFor(score, theme);
          return (
            <div key={label} className="min-w-0 flex-1 flex flex-col items-center text-center justify-center">
              <div className={`text-[11.5px] font-bold uppercase tracking-wide mb-[clamp(3px,0.6vh,8px)] ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
                {label}
              </div>
              {/* Tier-colored here, neutral white on Consolidated above —
                  the reverse of "everything tier-colored" — so Consolidated
                  reads as the plain hero number and Lead/Payments carry the
                  tier signal beside it. */}
              <div className="flex flex-col items-center gap-1 mb-[clamp(2px,0.4vh,6px)]">
                <StarRating score={score} size={16} color="#FBBF24" />
                <span className="text-[22px] leading-none font-black font-mono" style={{ color: t.color }}>
                  {score !== null ? score.toFixed(2) : "—"}
                </span>
              </div>
              <div className={`text-[11.5px] font-medium ${theme === "dark" ? "text-stone-500" : "text-stone-400"}`}>
                {count > 0 ? `${count.toLocaleString("en-IN")} evaluation${count === 1 ? "" : "s"}` : "No evaluations yet"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Always visible — real last-processed time (processRawDump's actual
          trigger history via the Apps Script Executions API, see
          appsScriptClient.ts), not a guess and not hidden behind hover.
          Pinned bottom-right of the card. Omitted entirely (not shown as a
          placeholder) when that fetch comes back unavailable, rather than
          showing a made-up time. */}
      {lastRunAt && (
        <div
          className={`flex items-center justify-end gap-1 text-[11px] font-medium mt-auto pt-[clamp(3px,0.6vh,10px)] ${theme === "dark" ? "text-stone-500" : "text-stone-400"}`}
        >
          <Clock className="w-2.5 h-2.5 shrink-0" />
          Data last updated {formatRelativeTime(lastRunAt)}
        </div>
      )}
    </div>
  );
}
