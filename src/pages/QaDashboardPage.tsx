/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, ArrowLeft, AlertTriangle, X, Users, GraduationCap, Calendar, BarChart3, Tag, ListFilter, CheckCircle2 } from "lucide-react";
import { QaDashboardIcon } from "../components/icons";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";
import { DateInputDMY } from "../components/DateInputDMY";

/**
 * QA Dashboard — native React port of the standalone Apps Script "Advisor
 * QA Dashboard" (Index.html's vanilla-JS state/render app). Same data,
 * same role model (Admin/Guide/Mentor/Advisor), same tabs (Score / QA
 * Feedback / Reviews) — now backed by src/server/qaDashboard/* reading the
 * same Google Sheet read-only over the app's existing Google login instead
 * of a separate Apps Script deployment. See the QA Dashboard integration
 * memory for why this native port was chosen over iframing the original.
 */

// ── Types (mirror src/server/qaDashboard/*.ts response shapes) ────────────
interface Advisor {
  tactId: string;
  name: string;
  guide: string | null;
  mentor: string | null;
}
interface BucketMetrics {
  instances: number;
  perfect: number;
  perfectPct: number | null;
  average: number | null;
}
interface AdvisorMetrics {
  tactId: string;
  loChats: BucketMetrics;
  loCalls: BucketMetrics;
  loPayments: BucketMetrics;
  leadScore: { totalScore: number; numberOfLeads: number; average: number | null };
}
interface DashboardData {
  advisor: Advisor | null;
  metrics: AdvisorMetrics | null;
  isAdmin: boolean;
  isGuide: boolean;
  isMentor: boolean;
  callerName?: string;
  error?: string;
  message?: string;
}
interface SheetTable {
  headers: string[];
  rows: Record<string, unknown>[];
  error?: string;
  message?: string;
}
interface AdvisorSummaryRow {
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
interface DateFilters {
  checkedFrom: string;
  checkedTo: string;
  tillDate: string;
}

const FEEDBACK_COLUMNS = [
  "Checked Date", "Mistake Date", "Domain", "Chat ID",
  "Red Flags", "Orange Flags", "Green Flags", "Score", "Dispute Window\n(Days)",
];
const REVIEW_COLUMNS = [
  "TACT ID", "Advisor", "Chat ID", "Domain", "Type", "Score", "Raised", "Resolved",
  "Comment", "QA Response", "Status",
];

const SCORE_DANGER = 3.5;
const SCORE_WARN = 3.75;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// QIP/PIP Candidates empty-state copy — different flavor depending on how
// far into the month we are, since "nobody qualifies yet" reads very
// differently on day 2 (too early to know) vs. day 20 (a genuinely clean
// month so far).
function qipEmptyStateLines(): [string, string] {
  const dayOfMonth = new Date().getDate();
  if (dayOfMonth <= 14) {
    return ["Good news: There are no potential QIP/PIP candidates. 🥳", "Bad news: It's still early. 👾"];
  }
  return ["You can chill... there are no potential QIP/PIP candidates. 🥳", "Yet. 👾"];
}

// Transparent cell + colored text + 4px left accent border, instead of a
// solid fill — lets the row's own hover tint (see the <tr> below) show
// through consistently on score cells the same way it does on every other
// cell, rather than a flat color block masking it. Good scores get no
// treatment at all — only the two tiers actually worth flagging (danger,
// warning) get the accent.
function scoreFlagClasses(value: number | null | undefined, dark: boolean): string {
  if (value === null || value === undefined) return "border-l-4 border-l-transparent";
  if (value < SCORE_DANGER) return dark ? "border-l-4 border-l-red-500 text-red-300 font-bold" : "border-l-4 border-l-red-500 text-red-700 font-bold";
  if (value < SCORE_WARN) return dark ? "border-l-4 border-l-amber-500 text-amber-300 font-bold" : "border-l-4 border-l-amber-500 text-amber-700 font-bold";
  return "border-l-4 border-l-transparent";
}

// Border color only — no text color. Feedback text here is long-form
// paragraphs, not short labels, so tinting the font made whole blocks of
// prose hard to read. Applied to a content-sized wrapper (not the <td>
// itself — see SheetTableView below) so the accent bar hugs just the text,
// instead of stretching down the full row height and reading as one
// continuous line down the column when neighboring cells are taller.
function cellFlagBorderClass(header: string, value: unknown): string {
  const lo = header.toLowerCase();
  const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
  if (!hasValue || !lo.includes("flag")) return "border-l-4 border-l-transparent";
  if (lo.includes("red flag")) return "border-l-4 border-l-red-500";
  if (lo.includes("orange flag")) return "border-l-4 border-l-amber-500";
  if (lo.includes("green flag")) return "border-l-4 border-l-emerald-500";
  return "border-l-4 border-l-transparent";
}

// ── Default date filters — Start/End = current calendar month, Till Date =
// start of current month minus 2 days. Restored from localStorage after
// the first visit (see loadStoredDates), matching the original tool. ──────
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function computeDefaultDates(): DateFilters {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  return {
    checkedFrom: `${y}-${pad(m + 1)}-01`,
    checkedTo: fmtDate(new Date(y, m + 1, 0)),
    tillDate: fmtDate(new Date(y, m, -1)),
  };
}
const DATES_STORAGE_KEY = "qa_dashboard_date_filters";
function loadStoredDates(): DateFilters | null {
  try {
    const raw = window.localStorage.getItem(DATES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.checkedFrom && parsed.checkedTo && parsed.tillDate) return parsed;
  } catch {
    /* corrupt/unreadable storage — ignore */
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  }
  return body as T;
}

function qs(params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") p.set(k, v);
  }
  return p.toString();
}

// ── Small reusable advisor combobox (name/TACT ID search) ─────────────────
function AdvisorCombobox({
  advisors,
  value,
  onChange,
  theme,
  placeholder = "Type a name or TACT ID…",
  // Outer wrapper width — a caller-supplied width class so this reads as a
  // normal, proportionally-sized filter field wherever it's dropped in,
  // instead of always claiming its own internal max-width regardless of
  // the space the caller actually gave it (the previous hardcoded
  // max-w-[280px] made this control disproportionately wide next to the
  // Guide dropdown next to it). Defaults to the old cap for any future
  // call site that doesn't specify one.
  className = "w-full max-w-[280px]",
}: {
  advisors: Advisor[];
  value: string;
  onChange: (tactId: string) => void;
  theme: "light" | "dark";
  placeholder?: string;
  className?: string;
}) {
  const dark = theme === "dark";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value ? advisors.find((a) => a.tactId === value) : undefined;
  const selectedLabel = selected ? (selected.name && selected.name !== selected.tactId ? `${selected.name} (${selected.tactId})` : selected.tactId) : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return advisors.filter((a) => a.name?.toLowerCase().includes(q) || a.tactId?.toLowerCase().includes(q));
  }, [advisors, query]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function select(tactId: string) {
    onChange(tactId);
    setOpen(false);
    setQuery("");
    setHighlighted(-1);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        type="text"
        value={open ? query : selectedLabel}
        placeholder={open ? placeholder : selectedLabel || placeholder}
        // Native tooltip for the truncated value below — the only way to
        // see a long advisor name in full once the field is sized down to
        // match its neighbors instead of stretching to fit the text.
        title={!open && selectedLabel ? selectedLabel : undefined}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filtered.length) setHighlighted((i) => (i + 1) % filtered.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filtered.length) setHighlighted((i) => (i - 1 + filtered.length) % filtered.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (highlighted >= 0 && highlighted < filtered.length) select(filtered[highlighted].tactId);
            else if (filtered.length === 1) select(filtered[0].tactId);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        // px-2.5/py-1.5 matches selectTriggerClass/qaDateInputClass exactly
        // (was py-2 — a taller pill than every other filter field it sits
        // beside). `truncate` lets a long "Name (TACT ID)" value ellipsize
        // instead of forcing the field wider than its neighbors.
        className={`w-full px-2.5 py-1.5 rounded-lg border outline-none text-xs font-semibold truncate ${
          dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
        }`}
      />
      {open && (
        <ul
          className={`absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border shadow-lg py-1 ${
            dark ? "bg-[#0d1c3f] border-white/10" : "bg-white border-stone-200"
          }`}
        >
          {filtered.length === 0 ? (
            <li className={`px-3 py-2 text-xs ${dark ? "text-slate-400" : "text-stone-500"}`}>
              {query ? `No match for "${query}"` : "Type to search…"}
            </li>
          ) : (
            filtered.map((a, i) => (
              <li
                key={a.tactId}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(a.tactId);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`px-3 py-2 text-xs flex justify-between gap-2 cursor-pointer ${
                  i === highlighted
                    ? dark ? "bg-blue-600/20" : "bg-blue-50"
                    : ""
                } ${a.tactId === value ? "font-bold" : ""}`}
              >
                <span>{a.name || a.tactId}</span>
                {a.name && a.name !== a.tactId && (
                  <span className={dark ? "text-slate-400" : "text-stone-400"}>{a.tactId}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
  suffix = "",
  bold = false,
  valueClassName = "",
}: {
  label: string;
  value: number | null;
  suffix?: string;
  bold?: boolean;
  /** Extra classes for the value only — used to color just the QA Score
      figure on a danger card, instead of tinting the whole row/card. */
  valueClassName?: string;
}) {
  const isNa = value === null || value === undefined;
  return (
    <div className="flex justify-between text-xs py-1 border-b border-stone-200/60 dark:border-white/[0.06] last:border-b-0">
      <span className={`text-content-muted ${bold ? "font-bold" : ""}`}>{label}</span>
      <span className={`${isNa ? "text-content-faint font-normal" : "font-semibold"} ${bold ? "font-black" : ""} ${valueClassName}`}>
        {isNa ? "NA" : `${value}${suffix}`}
      </span>
    </div>
  );
}

// Same principle as the table cells above: transparent card (no solid
// danger fill), a 4px left accent border instead of recoloring the whole
// card border, and color reserved for the one number that matters (QA
// Score) rather than the title too.
// Same always-on left-accent identity as the landing page's QuickScoreCard
// (Payments/money metrics get the red family, Chat/Call get the amber
// family), swapping to an actual red/amber threshold color once the score
// crosses into danger/warn — mirrors QuickScoreCard's borderColorClass logic
// exactly so this advisor-level card and the landing summary card read as
// the same design system. Only Payments passes `highlight` (it's one of the
// two QIP/PIP-eligible metrics); Chats/Calls never get the danger/warn swap,
// same as landing's Chat QA/Call QA cards (allowScoreHighlight={false}).
function BucketCard({ title, bucket, highlight, theme }: { title: string; bucket: BucketMetrics; highlight?: boolean; theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const isDanger = !!highlight && bucket.average !== null && bucket.average < SCORE_DANGER;
  const isWarn = !!highlight && !isDanger && bucket.average !== null && bucket.average < SCORE_WARN;
  const borderColorClass = isDanger
    ? dark ? "border-l-red-500" : "border-l-red-500/85"
    : isWarn
      ? dark ? "border-l-amber-500" : "border-l-amber-500/85"
      : highlight
        ? dark ? "border-l-[#b23a2f]" : "border-l-[#b23a2f]/85"
        : dark ? "border-l-[#c9a227]" : "border-l-[#c9a227]/85";
  // Neutral (non-accent) sides spelled out per-side rather than a blanket
  // `border-{color}` utility — see QuickScoreCard's own neutralBorderClasses
  // comment for why: an all-sides utility and a directional border-l utility
  // resolve in Tailwind's compiled-output order, not class-list order, so
  // the accent side can silently lose to the neutral one unless the neutral
  // utility never touches that side to begin with.
  const neutralBorderClasses = dark
    ? "border-t-white/[0.09] border-r-white/[0.09] border-b-white/[0.09] hover:border-t-white/[0.14] hover:border-r-white/[0.14] hover:border-b-white/[0.14]"
    : "border-t-[var(--border)] border-r-[var(--border)] border-b-[var(--border)]";
  return (
    <div
      className={`rounded-2xl border border-l-4 p-4 space-y-1 ${
        dark
          ? "bg-white/[0.03] shadow-soft transition-all duration-200 hover:shadow-card"
          : "bg-surface shadow-card hover:shadow-overlay transition-shadow duration-200"
      } ${neutralBorderClasses} ${borderColorClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-content-muted">{title}</h2>
        {highlight && (
          <span
            className={`shrink-0 inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
              isDanger ? "bg-red-600 text-white" : "bg-amber-500 text-white"
            }`}
          >
            {isDanger ? "Below threshold" : "KPI"}
          </span>
        )}
      </div>
      <StatRow label="Instances" value={bucket.instances} />
      <StatRow label="Perfect" value={bucket.perfect} />
      <StatRow label="% Perfect" value={bucket.perfectPct} suffix={bucket.perfectPct === null ? "" : "%"} />
      <StatRow
        label="QA Score"
        value={bucket.average}
        bold
        valueClassName={isDanger ? (dark ? "text-red-300" : "text-red-700") : isWarn ? (dark ? "text-amber-300" : "text-amber-700") : ""}
      />
    </div>
  );
}

// Lead Score is the other QIP/PIP-eligible metric alongside Payments, so it
// gets the same always-on red-family accent as Payments on the landing page
// (see BucketCard's comment above for the full rationale/mechanics).
function LeadScoreCard({ lead, theme }: { lead: AdvisorMetrics["leadScore"]; theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const isDanger = lead.average !== null && lead.average < SCORE_DANGER;
  const isWarn = !isDanger && lead.average !== null && lead.average < SCORE_WARN;
  const borderColorClass = isDanger
    ? dark ? "border-l-red-500" : "border-l-red-500/85"
    : isWarn
      ? dark ? "border-l-amber-500" : "border-l-amber-500/85"
      : dark ? "border-l-[#b23a2f]" : "border-l-[#b23a2f]/85";
  const neutralBorderClasses = dark
    ? "border-t-white/[0.09] border-r-white/[0.09] border-b-white/[0.09] hover:border-t-white/[0.14] hover:border-r-white/[0.14] hover:border-b-white/[0.14]"
    : "border-t-[var(--border)] border-r-[var(--border)] border-b-[var(--border)]";
  return (
    <div
      className={`rounded-2xl border border-l-4 p-4 space-y-1 ${
        dark
          ? "bg-white/[0.03] shadow-soft transition-all duration-200 hover:shadow-card"
          : "bg-surface shadow-card hover:shadow-overlay transition-shadow duration-200"
      } ${neutralBorderClasses} ${borderColorClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-content-muted">Lead Score</h2>
        <span className={`shrink-0 inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${isDanger ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
          {isDanger ? "Below threshold" : "KPI"}
        </span>
      </div>
      <StatRow label="Total Score" value={lead.totalScore} />
      <StatRow label="Number of Leads" value={lead.numberOfLeads} />
      <StatRow
        label="QA Score"
        value={lead.average}
        bold
        valueClassName={isDanger ? (dark ? "text-red-300" : "text-red-700") : isWarn ? (dark ? "text-amber-300" : "text-amber-700") : ""}
      />
    </div>
  );
}

// Landing-page "Overall Score" KPI card — same visual language as the
// advisor-level BucketCard/LeadScoreCard (transparent card, 4px left accent),
// but summarizing the currently-scoped LIST of advisors (avg of averages +
// total instances) rather than one advisor's buckets, since AdvisorSummaryRow
// doesn't carry perfect/perfectPct.
//
// Every card gets a distinct, always-on colored left border as its base
// identity (accentClass, a full "border-{l|r}-..." class supplied by the
// caller) — Payments QA and Lead Score additionally swap that for red/amber
// when the score crosses a threshold (their "special" highlight, since those
// two are what QIP/PIP eligibility is based on). Chat/Call never get the
// danger/warning treatment — allowScoreHighlight stays false for them,
// matching the main advisors table's rule. borderSide lets the two pairs
// (Payments+Lead Score vs Chat+Call) carry their accent on opposite edges,
// per the paired-column layout below.
function QuickScoreCard({
  title,
  average,
  instances,
  theme,
  accentClass,
  borderSide = "left",
  allowScoreHighlight = true,
}: {
  title: string;
  average: number | null;
  instances: number;
  theme: "light" | "dark";
  accentClass: string;
  borderSide?: "left" | "right";
  allowScoreHighlight?: boolean;
}) {
  const dark = theme === "dark";
  const isDanger = allowScoreHighlight && average !== null && average < SCORE_DANGER;
  const isWarn = allowScoreHighlight && !isDanger && average !== null && average < SCORE_WARN;
  const prefix = borderSide === "left" ? "border-l" : "border-r";
  const borderWidthClass = borderSide === "left" ? "border-l-4" : "border-r-4";
  // Light-only opacity softening (final polish pass) — the accent strip
  // stays fully opaque in dark theme (untouched), but light theme dials it
  // to 85% so the strip reads as a clear color cue without competing with
  // the card's own new elevation/shadow for attention.
  //
  // Every branch below is a COMPLETE literal string, not built by
  // concatenating pieces at runtime (`${prefix}-red-500${suffix}` etc.) —
  // Tailwind's build-time scanner greps the raw source text for candidate
  // class names and only generates CSS for strings that appear verbatim
  // somewhere in the file. A runtime-assembled string never appears as
  // contiguous text in the source, so no CSS gets generated for it and the
  // class silently does nothing (this is exactly what happened on the
  // first pass here — the border fell back to no color at all instead of a
  // softened one). Writing out every combination by hand is the fix.
  const ACCENT_LIGHT: Record<string, string> = {
    "border-l-[#b23a2f]": "border-l-[#b23a2f]/85",
    "border-l-[#c9a227]": "border-l-[#c9a227]/85",
    "border-r-[#b23a2f]": "border-r-[#b23a2f]/85",
    "border-r-[#c9a227]": "border-r-[#c9a227]/85",
  };
  const borderColorClass = isDanger
    ? borderSide === "left"
      ? dark ? "border-l-red-500" : "border-l-red-500/85"
      : dark ? "border-r-red-500" : "border-r-red-500/85"
    : isWarn
      ? borderSide === "left"
        ? dark ? "border-l-amber-500" : "border-l-amber-500/85"
        : dark ? "border-r-amber-500" : "border-r-amber-500/85"
      : dark
        ? accentClass
        : (ACCENT_LIGHT[accentClass] ?? accentClass);
  // Neutral border color for the 3 sides that AREN'T carrying the thick
  // accent color — deliberately spelled out per-side (border-t-/-r-/-b-/-l-)
  // rather than the blanket `border-{color}` shorthand. Tailwind's compiled
  // stylesheet orders a plain `border-white/[0.08]` (all 4 sides) and a
  // directional `border-l-[#b23a2f]` independently of where they appear in
  // this file, so which one wins the accent side is order-dependent — it
  // happened to resolve correctly in light theme and wrong in dark theme.
  // Never touching the accent side with the all-sides utility removes the
  // ambiguity entirely instead of relying on output order.
  const neutralBorderClasses =
    borderSide === "left"
      ? dark
        ? "border-t-white/[0.09] border-r-white/[0.09] border-b-white/[0.09] hover:border-t-white/[0.14] hover:border-r-white/[0.14] hover:border-b-white/[0.14]"
        : "border-t-[var(--border)] border-r-[var(--border)] border-b-[var(--border)]"
      : dark
        ? "border-t-white/[0.09] border-l-white/[0.09] border-b-white/[0.09] hover:border-t-white/[0.14] hover:border-l-white/[0.14] hover:border-b-white/[0.14]"
        : "border-t-[var(--border)] border-l-[var(--border)] border-b-[var(--border)]";
  // Cards read as "raised" (--surface, solid white) against the filter bar
  // and page background's grayer tones, with an extremely soft layered
  // shadow (--shadow-card, defined in index.css) standing in for the
  // elevation dark theme already gets "for free" from its translucent
  // white-overlay backgrounds. Dark theme is untouched — it keeps its
  // existing flat bg-white/[0.03], no shadow class. On hover, light theme
  // steps up one shadow tier (--shadow-overlay, the same token overlays/
  // modals use) for a very slight, smoothly-transitioned lift.
  return (
    <div
      className={`rounded-2xl border ${borderWidthClass} p-7 space-y-2.5 ${
        dark
          ? "bg-white/[0.03] shadow-soft transition-all duration-200 hover:shadow-card"
          : "bg-surface shadow-card hover:shadow-overlay transition-shadow duration-200"
      } ${neutralBorderClasses} ${borderColorClass}`}
    >
      <h2 className="text-lg font-bold uppercase tracking-wide text-content-muted">{title}</h2>
      <StatRow label="Instances" value={instances} />
      <StatRow
        label="Average Score"
        value={average}
        bold
        valueClassName={isDanger ? (dark ? "text-red-300" : "text-red-700") : isWarn ? (dark ? "text-amber-300" : "text-amber-700") : ""}
      />
    </div>
  );
}

function SheetTableView({
  table,
  loading,
  error,
  columns,
  theme,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string;
  columns: string[] | null;
  theme: "light" | "dark";
}) {
  const dark = theme === "dark";
  if (loading) return <p className="text-xs text-content-muted py-6">Loading…</p>;
  if (error) return <p className="text-xs text-red-500 py-6">{error}</p>;
  if (!table || table.rows.length === 0) return <p className="text-xs text-content-muted py-6">No records found.</p>;

  const visible = columns ? table.headers.filter((h) => columns.some((c) => norm(c) === norm(h))) : table.headers;

  return (
    <div className={`overflow-auto max-h-[65vh] rounded-xl border ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
      <table className="w-full text-xs border-collapse min-w-[700px]">
        <thead>
          <tr>
            {visible.map((h) => (
              <th
                key={h}
                className={`sticky top-0 text-left px-3 py-2 font-bold whitespace-nowrap border-b ${
                  dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-stone-100 border-stone-200 text-stone-700"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
              {visible.map((h) => {
                const isFlagCol = h.toLowerCase().includes("flag");
                const text = row[h] != null ? String(row[h]) : "";
                return (
                  <td
                    key={h}
                    className={`px-3 py-2 border-b align-top ${dark ? "border-white/[0.05]" : "border-stone-100"}`}
                  >
                    {isFlagCol ? <div className={`pl-2.5 ${cellFlagBorderClass(h, row[h])}`}>{text}</div> : text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface QaDashboardPageProps {
  theme: "light" | "dark";
}

export function QaDashboardPage({ theme }: QaDashboardPageProps) {
  const dark = theme === "dark";
  // Matches the px-2.5/py-1.5/text-xs sizing of the plain <input> filters
  // beside it — CustomSelect's own default trigger uses much larger py-3
  // padding, which otherwise makes the Guide/Type/Status dropdowns visibly
  // taller than the Search/Date fields in the same filter row.
  const selectTriggerClass = `w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none text-xs font-semibold cursor-pointer relative ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;
  // Shared by every DateInputDMY on this page (Score tab's date bar, plus
  // Feedback/Reviews' own date-range filters below).
  const qaDateInputClass = `px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;
  const qaSearchInputClass = `pl-7 pr-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none min-w-[160px] ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  }`;

  const [dates, setDates] = useState<DateFilters>(() => loadStoredDates() || computeDefaultDates());
  useEffect(() => {
    try {
      window.localStorage.setItem(DATES_STORAGE_KEY, JSON.stringify(dates));
    } catch {
      /* ignore quota/serialization errors */
    }
  }, [dates]);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [advisorList, setAdvisorList] = useState<Advisor[] | null>(null);
  const [selectedTactId, setSelectedTactId] = useState<string | null>(null);
  const [guideFilter, setGuideFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"score" | "feedback" | "reviews">("score");
  const [tabData, setTabData] = useState<Record<string, SheetTable | undefined>>({});
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [tabError, setTabError] = useState<Record<string, string>>({});

  const [advisorsSummary, setAdvisorsSummary] = useState<AdvisorSummaryRow[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryGuideFilter, setSummaryGuideFilter] = useState("");
  const [summaryMentorFilter, setSummaryMentorFilter] = useState("");
  const [summarySearch, setSummarySearch] = useState("");

  // QA Feedback tab's own filters — independent of the Score tab's date
  // range (see the "Advisor Level view" rebalance: the shared date bar only
  // ever drove score calculations, so Feedback/Reviews now get their own).
  const [feedbackDateFrom, setFeedbackDateFrom] = useState("");
  const [feedbackDateTo, setFeedbackDateTo] = useState("");
  const [feedbackDomain, setFeedbackDomain] = useState("");
  const [feedbackSearch, setFeedbackSearch] = useState("");

  const [reviewDateFrom, setReviewDateFrom] = useState("");
  const [reviewDateTo, setReviewDateTo] = useState("");
  const [reviewDomainFilter, setReviewDomainFilter] = useState("");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewTypeFilter, setReviewTypeFilter] = useState("");
  const [reviewStatusFilter, setReviewStatusFilter] = useState("");

  // QIP table row cap state — see the effect right after qipCandidates is
  // defined below (kept apart from it to avoid a temporal-dead-zone
  // reference: this state is used inside the JSX above where qipCandidates
  // is computed, but the measuring effect itself needs qipCandidates to
  // already exist as a dependency).
  const qipHeaderRowRef = useRef<HTMLTableRowElement>(null);
  const [qipNineRowMaxHeight, setQipNineRowMaxHeight] = useState<number | null>(null);

  const loadDashboard = useCallback(async (dateFilters: DateFilters, requestedTactId: string | null, hasList: boolean) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<DashboardData>(
        `/api/qa-dashboard/dashboard?${qs({ ...dateFilters, tactId: requestedTactId })}`
      );
      setDashboard(data);
      setSelectedTactId(data.advisor ? data.advisor.tactId : null);
      if ((data.isAdmin || data.isGuide || data.isMentor) && !hasList) {
        try {
          const list = await fetchJson<{ advisors: Advisor[] }>(`/api/qa-dashboard/advisors`);
          setAdvisorList(list.advisors);
        } catch (e) {
          console.warn("Advisor list failed:", e);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdvisorsSummary = useCallback(async (dateFilters: DateFilters) => {
    setSummaryLoading(true);
    setSummaryError("");
    try {
      // Spread into a fresh object literal: `qs` takes a Record<string, ...>
      // index-signature type, which a named interface like DateFilters
      // isn't directly assignable to.
      const data = await fetchJson<{ advisors: AdvisorSummaryRow[] }>(`/api/qa-dashboard/summary?${qs({ ...dateFilters })}`);
      setAdvisorsSummary(data.advisors || []);
    } catch (err: any) {
      setSummaryError(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Feedback and Reviews each carry their own independent date range now
  // (see the state block above) — this takes an explicit params object
  // instead of reading the shared dashboard `dates`, which only ever drives
  // the Score tab's metrics.
  const loadTab = useCallback(async (tabId: "feedback" | "reviews", tactId: string, params: { checkedFrom?: string; checkedTo?: string }) => {
    setTabLoading((prev) => ({ ...prev, [tabId]: true }));
    setTabError((prev) => ({ ...prev, [tabId]: "" }));
    try {
      const url = `/api/qa-dashboard/${tabId}?${qs({ tactId, checkedFrom: params.checkedFrom, checkedTo: params.checkedTo })}`;
      const data = await fetchJson<SheetTable>(url);
      setTabData((prev) => ({ ...prev, [tabId]: data }));
    } catch (err: any) {
      setTabError((prev) => ({ ...prev, [tabId]: err.message }));
    } finally {
      setTabLoading((prev) => ({ ...prev, [tabId]: false }));
    }
  }, []);

  // Initial load on mount.
  useEffect(() => {
    loadDashboard(dates, null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load the landing summary once we know the caller is Admin/Guide/Mentor.
  useEffect(() => {
    if (dashboard && !dashboard.advisor && (dashboard.isAdmin || dashboard.isGuide || dashboard.isMentor) && advisorsSummary === null && !summaryLoading) {
      loadAdvisorsSummary(dates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard, advisorsSummary, summaryLoading]);

  // The "Load Dashboard" button (dateFilterBar) only ever renders on the
  // Score tab now — Feedback/Reviews reload themselves via their own date
  // filters below — so this only needs to refresh the score metrics.
  function handleRefresh() {
    loadDashboard(dates, selectedTactId, !!advisorList);
  }

  function handleAdvisorChange(tactId: string) {
    setSelectedTactId(tactId);
    setActiveTab("score");
    setTabData({});
    setTabLoading({});
    setTabError({});
    loadDashboard(dates, tactId, !!advisorList);
  }

  function handleBackToList() {
    setDashboard((prev) => (prev ? { ...prev, advisor: null, metrics: null } : prev));
    setSelectedTactId(null);
    setActiveTab("score");
    setTabData({});
    setTabLoading({});
    setTabError({});
  }

  function handleTabClick(tabId: "score" | "feedback" | "reviews") {
    setActiveTab(tabId);
    if (tabId !== "score" && !tabData[tabId] && !tabLoading[tabId] && dashboard?.advisor) {
      const params = tabId === "feedback" ? { checkedFrom: feedbackDateFrom, checkedTo: feedbackDateTo } : { checkedFrom: reviewDateFrom, checkedTo: reviewDateTo };
      loadTab(tabId, dashboard.advisor.tactId, params);
    }
  }

  // Re-fetch Feedback/Reviews when their OWN date range changes (only once
  // that tab has actually been visited — this effect is a no-op on mount
  // since activeTab starts as "score").
  useEffect(() => {
    if (activeTab === "feedback" && dashboard?.advisor) {
      loadTab("feedback", dashboard.advisor.tactId, { checkedFrom: feedbackDateFrom, checkedTo: feedbackDateTo });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackDateFrom, feedbackDateTo]);

  useEffect(() => {
    if (activeTab === "reviews" && dashboard?.advisor) {
      loadTab("reviews", dashboard.advisor.tactId, { checkedFrom: reviewDateFrom, checkedTo: reviewDateTo });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewDateFrom, reviewDateTo]);

  const guideNames = useMemo(
    () => Array.from(new Set((advisorList || []).map((a) => a.guide).filter(Boolean))).sort() as string[],
    [advisorList]
  );
  const pickerAdvisors = useMemo(
    () => (advisorList ? (guideFilter ? advisorList.filter((a) => a.guide === guideFilter) : advisorList) : []),
    [advisorList, guideFilter]
  );

  const summaryGuideNames = useMemo(
    () => Array.from(new Set((advisorsSummary || []).map((a) => a.guide).filter(Boolean))).sort() as string[],
    [advisorsSummary]
  );
  const summaryMentorNames = useMemo(
    () => Array.from(new Set((advisorsSummary || []).map((a) => a.mentor).filter(Boolean))).sort() as string[],
    [advisorsSummary]
  );
  const canFilterByMentor = !!(dashboard?.isAdmin || dashboard?.isGuide);
  // Guide + Mentor filters only (no search) — this is the "list of advisors
  // visible under this access level" that the Overall Score cards summarize;
  // the free-text search box narrows the TABLE but shouldn't make the KPI
  // cards above it flicker while someone's mid-search.
  const guideMentorFilteredSummary = useMemo(() => {
    if (!advisorsSummary) return [];
    return advisorsSummary
      .filter((a) => !(dashboard?.isAdmin && summaryGuideFilter) || a.guide === summaryGuideFilter)
      .filter((a) => !(canFilterByMentor && summaryMentorFilter) || a.mentor === summaryMentorFilter);
  }, [advisorsSummary, summaryGuideFilter, summaryMentorFilter, dashboard?.isAdmin, canFilterByMentor]);
  const filteredSummary = useMemo(() => {
    const q = summarySearch.trim().toLowerCase();
    return guideMentorFilteredSummary.filter((a) => !q || a.name?.toLowerCase().includes(q) || a.tactId?.toLowerCase().includes(q));
  }, [guideMentorFilteredSummary, summarySearch]);

  // Potential QIP/PIP Candidates — mirrors the source spreadsheet's formula:
  // unique advisors where (Payments avg < 3.5 with >= 5 instances) OR
  // (Lead Score avg < 3.5 with >= 15 instances). Sourced from filteredSummary
  // so it stays as dynamic as the advisors list and the Overall Score cards —
  // narrows with Guide/Mentor/search exactly like everything else on this page.
  const qipCandidates = useMemo(() => {
    return filteredSummary.filter(
      (a) =>
        (a.paymentsAvg !== null && a.paymentsAvg < SCORE_DANGER && a.paymentsInstances >= 5) ||
        (a.leadScoreAvg !== null && a.leadScoreAvg < SCORE_DANGER && a.leadScoreInstances >= 15)
    );
  }, [filteredSummary]);

  // QIP table row cap — dropped the earlier approach of matching this
  // card's height to the (unrelated) Overall Score column; that required
  // measuring one element to size a different one, which turned out
  // fragile in practice. This is simpler and self-contained: measure this
  // table's own header row height (all rows share the same
  // px-3/py-2/text-xs padding and line-height, so one row's height stands
  // in for any row), then cap the scroll area at 9 rows worth (header + 8
  // data rows) via max-height. Fewer than 9 rows sizes naturally; more
  // than 9 scrolls internally instead of growing the card.
  useEffect(() => {
    const el = qipHeaderRowRef.current;
    if (!el) return;
    const update = () => setQipNineRowMaxHeight(el.getBoundingClientRect().height * 9);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [qipCandidates.length]);

  function avgOf(values: number[]): number | null {
    return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;
  }
  const quickScoreStats = useMemo(() => {
    const list = guideMentorFilteredSummary;
    const leadVals = list.filter((a): a is AdvisorSummaryRow & { leadScoreAvg: number } => a.leadScoreAvg !== null).map((a) => a.leadScoreAvg);
    const payVals = list.filter((a): a is AdvisorSummaryRow & { paymentsAvg: number } => a.paymentsAvg !== null).map((a) => a.paymentsAvg);
    const chatVals = list.filter((a): a is AdvisorSummaryRow & { chatAvg: number } => a.chatAvg !== null).map((a) => a.chatAvg);
    const callVals = list.filter((a): a is AdvisorSummaryRow & { callAvg: number } => a.callAvg !== null).map((a) => a.callAvg);
    return {
      leadAvg: avgOf(leadVals),
      leadInstancesTotal: list.reduce((sum, a) => sum + (a.leadScoreInstances || 0), 0),
      payAvg: avgOf(payVals),
      payInstancesTotal: list.reduce((sum, a) => sum + (a.paymentsInstances || 0), 0),
      chatAvg: avgOf(chatVals),
      chatInstancesTotal: list.reduce((sum, a) => sum + (a.chatInstances || 0), 0),
      callAvg: avgOf(callVals),
      callInstancesTotal: list.reduce((sum, a) => sum + (a.callInstances || 0), 0),
    };
  }, [guideMentorFilteredSummary]);

  const reviewRows = tabData.reviews?.rows;
  const reviewTypeOptions = useMemo(
    () => Array.from(new Set((reviewRows || []).map((r) => String(r["Type"] ?? "")).filter(Boolean))),
    [reviewRows]
  );
  const reviewStatusOptions = useMemo(
    () => Array.from(new Set((reviewRows || []).map((r) => String(r["Status"] ?? "")).filter(Boolean))),
    [reviewRows]
  );
  const reviewDomainOptions = useMemo(
    () => Array.from(new Set((reviewRows || []).map((r) => String(r["Domain"] ?? "")).filter(Boolean))),
    [reviewRows]
  );
  const filteredReviewTable = useMemo(() => {
    if (!tabData.reviews) return tabData.reviews;
    const q = reviewSearch.trim().toLowerCase();
    const rows = tabData.reviews.rows.filter(
      (r) =>
        (!reviewTypeFilter || r["Type"] === reviewTypeFilter) &&
        (!reviewStatusFilter || r["Status"] === reviewStatusFilter) &&
        (!reviewDomainFilter || r["Domain"] === reviewDomainFilter) &&
        (!q || String(r["Chat ID"] ?? "").toLowerCase().includes(q))
    );
    return { ...tabData.reviews, rows };
  }, [tabData.reviews, reviewTypeFilter, reviewStatusFilter, reviewDomainFilter, reviewSearch]);

  const feedbackDomainOptions = useMemo(
    () => Array.from(new Set((tabData.feedback?.rows || []).map((r) => String(r["Domain"] ?? "")).filter(Boolean))),
    [tabData.feedback]
  );
  const filteredFeedbackTable = useMemo(() => {
    if (!tabData.feedback) return tabData.feedback;
    const q = feedbackSearch.trim().toLowerCase();
    const rows = tabData.feedback.rows.filter(
      (r) => (!feedbackDomain || r["Domain"] === feedbackDomain) && (!q || String(r["Chat ID"] ?? "").toLowerCase().includes(q))
    );
    return { ...tabData.feedback, rows };
  }, [tabData.feedback, feedbackDomain, feedbackSearch]);

  const dateFilterBar = (
    <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
      {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
        <label key={field} className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
          </span>
          <DateInputDMY
            value={dates[field]}
            onChange={(v) => setDates((prev) => ({ ...prev, [field]: v }))}
            displayClassName={`w-full ${qaDateInputClass}`}
          />
        </label>
      ))}
      <ClippedButton onClick={handleRefresh} size="md" className="h-8 gap-2 px-4 text-xs font-bold text-white hover:brightness-110 shrink-0" style={{ background: "#1f2d3d" }}>
        <RefreshCw className="w-3 h-3" />
        {loading ? "Loading…" : "Load Dashboard"}
      </ClippedButton>
    </div>
  );

  if (!dashboard) {
    return (
      <div className="space-y-4">
        <h1 className="text-page-title flex items-center gap-2">
          <QaDashboardIcon className="w-5 h-5" />
          QA Dashboard
        </h1>
        {loading ? <p className="text-xs text-content-muted">Loading your metrics…</p> : null}
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>
    );
  }

  // ── Landing page (Admin/Guide/Mentor roster) ─────────────────────────────
  if (!dashboard.advisor) {
    const roleLabel = dashboard.isAdmin ? "Admin view" : dashboard.isGuide ? "Guide view" : dashboard.isMentor ? "Mentor view" : "";
    return (
      <div className="space-y-5 pb-6">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <QaDashboardIcon className="w-5 h-5" />
            <span>Hey {dashboard.callerName || "there"}, welcome to the QA Dashboard</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">{roleLabel}</p>
        </div>

        <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
          {/* flex-1 on every field (instead of fixed min-widths only) so the
              row stretches to fill the card's full width evenly, rather than
              bunching left and leaving a slab of dead space on wide screens.
              Each label is a small icon + text — plain text labels sitting
              directly on this card's rounded corners read as slightly
              off-kilter; the icon gives the eye a fixed anchor point. */}
          <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
            <span className="flex items-center gap-1"><Search className="w-3 h-3" /> Search Advisor</span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
              <input
                type="text"
                value={summarySearch}
                onChange={(e) => setSummarySearch(e.target.value)}
                placeholder="Name or TACT ID…"
                className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
                  dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                }`}
              />
            </div>
          </label>
          {dashboard.isAdmin && summaryGuideNames.length > 0 && (
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Guide</span>
              <CustomSelect
                value={summaryGuideFilter}
                onChange={setSummaryGuideFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All guides" }, ...summaryGuideNames.map((g) => ({ value: g, label: g }))]}
              />
            </label>
          )}
          {canFilterByMentor && summaryMentorNames.length > 0 && (
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><GraduationCap className="w-3 h-3" /> Mentor</span>
              <CustomSelect
                value={summaryMentorFilter}
                onChange={setSummaryMentorFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All mentors" }, ...summaryMentorNames.map((m) => ({ value: m, label: m }))]}
              />
            </label>
          )}
          {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
            <label key={field} className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
              </span>
              <DateInputDMY value={dates[field]} onChange={(v) => setDates((prev) => ({ ...prev, [field]: v }))} displayClassName={`w-full ${qaDateInputClass}`} />
            </label>
          ))}
          <ClippedButton onClick={() => loadAdvisorsSummary(dates)} size="md" className="h-8 gap-2 px-4 text-xs font-bold text-white shrink-0 hover:brightness-110" style={{ background: "#1f2d3d" }}>
            <RefreshCw className="w-3.5 h-3.5" />
            {summaryLoading ? "Loading…" : "Load Dashboard"}
          </ClippedButton>
        </div>

        {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}

        {advisorsSummary !== null && (
          /* Both columns use a proportional basis (40/60) so together they
             always span the row's full width. Their heights are no longer
             tied to each other — Overall Score sizes to its own 2x2 card
             grid, and the QIP card below caps its own table to 9 rows (see
             qipNineRowMaxHeight) — so there's nothing left to keep in sync
             between two unrelated elements. */
          <div className="flex flex-col xl:flex-row gap-4">
            {/* Overall Score — a 2x2 pairing (not a single tall stack): the
                two money-metric cards (Payments/Lead Score) form one
                column, the two conversation-quality cards (Chat/Call, no
                score highlighting) form the other. */}
            <div className="xl:basis-2/5 xl:grow xl:shrink min-w-0 space-y-3">
              <h2 className="text-xs font-black uppercase tracking-wider text-content flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />
                Overall Score — {guideMentorFilteredSummary.length} advisor{guideMentorFilteredSummary.length === 1 ? "" : "s"}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-3">
                  <QuickScoreCard title="Payments QA" average={quickScoreStats.payAvg} instances={quickScoreStats.payInstancesTotal} theme={theme} accentClass="border-l-[#b23a2f]" />
                  <QuickScoreCard title="Lead Score" average={quickScoreStats.leadAvg} instances={quickScoreStats.leadInstancesTotal} theme={theme} accentClass="border-l-[#b23a2f]" />
                </div>
                <div className="space-y-3">
                  <QuickScoreCard title="Chat QA" average={quickScoreStats.chatAvg} instances={quickScoreStats.chatInstancesTotal} theme={theme} accentClass="border-l-[#c9a227]" allowScoreHighlight={false} />
                  <QuickScoreCard title="Call QA" average={quickScoreStats.callAvg} instances={quickScoreStats.callInstancesTotal} theme={theme} accentClass="border-l-[#c9a227]" allowScoreHighlight={false} />
                </div>
              </div>
            </div>

            {/* QIP/PIP Candidates — the rest of the row (60% basis). Its own
                height is capped to 9 rows (see qipNineRowMaxHeight below);
                it does not try to match the Overall Score column anymore. */}
            <div
              className={`xl:basis-3/5 xl:grow xl:shrink min-w-0 rounded-2xl overflow-hidden border flex flex-col ${
                dark
                  ? "border-[rgba(184,106,28,0.35)] bg-white/[0.02] shadow-sm"
                  : "border-[rgba(176,106,36,0.28)] bg-white shadow-card hover:shadow-overlay transition-shadow duration-200"
              }`}
            >
              {/* Not an <h1-h6> on purpose: index.css's light-theme rule
                  `html:not(.dark) h1, h2, ... { color: var(--text-heading) }`
                  (added for cross-theme text-visibility, see the
                  SMOKE TEST EXCEPTION comment right below it for the same
                  issue previously) outranks a plain Tailwind text-color class
                  by specificity and forces headings to a dark navy — fine on
                  a light card, but unreadable on this banner's own colored
                  background. Using a span sidesteps that global rule
                  entirely instead of fighting it. */}
              {/* Header bg/border are split per-theme here (dark keeps the
                  exact #B86A1C / rgba(184,106,28,0.35) it's always had —
                  untouched); light gets a ~8% desaturated "#B06A24" burnt
                  amber and a softer-opacity border, per the final light-theme
                  polish pass — calmer without losing the amber identity. */}
              <div className={`px-4 py-2.5 flex items-center justify-center gap-2 shrink-0 border-b ${
                dark ? "bg-[#B86A1C] border-[#B86A1C]" : "bg-[#B06A24] border-[#B06A24]"
              }`}>
                <AlertTriangle className="w-4 h-4 shrink-0 text-[#FFF3D6]" />
                <span className="text-sm font-black tracking-wide text-[#FFF3D6]">
                  Potential QIP/PIP Candidates{qipCandidates.length > 0 ? ` (${qipCandidates.length})` : ""}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                {qipCandidates.length === 0 ? (
                  <div className="text-xs text-content-muted py-6 text-center space-y-1">
                    {qipEmptyStateLines().map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                ) : (
                  // max-height caps the visible area to 9 rows worth
                  // (qipNineRowMaxHeight = header-row height x 9, measured
                  // off qipHeaderRowRef below); overflow-y scrolls the rest
                  // internally instead of growing the card. With 9 or fewer
                  // candidates this never kicks in — the box just sizes to
                  // its natural (shorter) content.
                  <div className="overflow-y-auto" style={qipNineRowMaxHeight ? { maxHeight: qipNineRowMaxHeight } : undefined}>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr ref={qipHeaderRowRef}>
                          {["Advisor", "Payment QA", "Instances", "LeadScore", "Instances"].map((h, i) => (
                            <th
                              key={`${h}-${i}`}
                              className={`sticky top-0 text-left px-3 py-2 font-bold whitespace-nowrap border-b ${
                                dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-stone-100 border-stone-200 text-stone-700"
                              }`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {qipCandidates.map((a) => (
                          <tr key={a.tactId} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
                            <td className={`px-3 py-2 border-b font-semibold ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.name || a.tactId}</td>
                            <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                              <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.paymentsAvg, dark)}`}>{a.paymentsAvg ?? "NA"}</div>
                            </td>
                            <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05] text-slate-400" : "border-stone-100 text-stone-500"}`}>{a.paymentsInstances}</td>
                            <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                              <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.leadScoreAvg, dark)}`}>{a.leadScoreAvg ?? "NA"}</div>
                            </td>
                            <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05] text-slate-400" : "border-stone-100 text-stone-500"}`}>{a.leadScoreInstances}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {advisorsSummary === null ? (
          <p className="text-xs text-content-muted py-6">Loading advisors…</p>
        ) : (
          <div className={`overflow-auto rounded-xl border ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {["Sl No", "Advisor", "Chat QA", "Instances", "Call QA", "Instances", "Lead Score", "Instances", "Payments QA", "Instances"].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      className={`sticky top-0 text-left px-3 py-2 font-bold whitespace-nowrap border-b ${
                        dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-stone-100 border-stone-200 text-stone-700"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSummary.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-content-muted">
                      No advisors found.
                    </td>
                  </tr>
                ) : (
                  filteredSummary.map((a, i) => (
                    <tr key={a.tactId} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{i + 1}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                        <button
                          onClick={() => handleAdvisorChange(a.tactId)}
                          className={`font-bold text-left cursor-pointer hover:underline ${dark ? "text-blue-300" : "text-blue-700"}`}
                          title="Open this advisor's dashboard"
                        >
                          {a.name || a.tactId}
                        </button>
                      </td>
                      {/* Chat/Call QA — plain text, deliberately no scoreFlagClasses:
                          the red/amber highlighting is reserved for Payments and
                          Lead Score, the two metrics QIP/PIP eligibility is based on. */}
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.chatAvg ?? "NA"}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.chatInstances}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.callAvg ?? "NA"}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.callInstances}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                        <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.leadScoreAvg, dark)}`}>{a.leadScoreAvg ?? "NA"}</div>
                      </td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.leadScoreInstances}</td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                        <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.paymentsAvg, dark)}`}>{a.paymentsAvg ?? "NA"}</div>
                      </td>
                      <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.paymentsInstances}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Individual advisor dashboard ─────────────────────────────────────────
  const { advisor, metrics, isAdmin, isGuide, isMentor } = dashboard;
  const canBrowseOthers = isAdmin || isGuide || isMentor;

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-start gap-3">
          {canBrowseOthers && (
            <button
              onClick={handleBackToList}
              title="Back to advisor list"
              className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer ${
                dark ? "bg-white/[0.03] border-white/10 text-blue-300" : "bg-white border-stone-250 text-blue-700"
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
              <QaDashboardIcon className="w-5 h-5" />
              <span>{advisor?.name || advisor?.tactId}&#8217;s QA Dashboard</span>
            </h1>
            <p className="text-xs mt-1 font-semibold text-content-muted">
              TACT ID: {advisor?.tactId}
              {advisor?.guide ? ` · Guide: ${advisor.guide}` : ""}
              {isAdmin ? " · Admin view" : isGuide ? " · Guide view" : isMentor ? " · Mentor view" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Advisor/guide picker + the Score tab's date bar get a full panel —
          real estate they earn since they drive the Score tab's numbers.
          On Feedback/Reviews neither one calculates anything anymore (each
          tab now has its own date filter below), so they collapse to a
          single compact strip — just enough to still switch advisors —
          leaving the table the space it needs. */}
      {activeTab === "score" ? (
        canBrowseOthers && advisorList ? (
          // Single cohesive control panel — same landing-page treatment as
          // the roster filter bar (rounded card, icon-labeled flex-1 fields,
          // trailing action button) instead of two stacked, disconnected
          // panels (guide/advisor picker above, dates below).
          <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
            {isAdmin && guideNames.length > 0 && (
              <label className="flex-[1_1_0%] min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Guide</span>
                <CustomSelect
                  value={guideFilter}
                  onChange={setGuideFilter}
                  theme={theme}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "All guides" }, ...guideNames.map((g) => ({ value: g, label: g }))]}
                />
              </label>
            )}
            {/* Grow factor 1.35 (not flex-1's equal 1) keeps this at a fixed
                ~1.2–1.5x ratio to Guide's width regardless of viewport width
                — plain equal flex-1 on both let this balloon to match
                whatever leftover row space existed, which is how it ended up
                reading as the dominant control instead of "just another
                filter". max-w keeps it from over-growing on very wide
                screens; AdvisorCombobox's own `truncate` handles long names. */}
            <label className="flex-[1.35_1_0%] min-w-[180px] max-w-[320px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Search className="w-3 h-3" /> Viewing advisor</span>
              <AdvisorCombobox advisors={pickerAdvisors} value={selectedTactId || ""} onChange={handleAdvisorChange} theme={theme} className="w-full" />
            </label>
            {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
              <label key={field} className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
                </span>
                <DateInputDMY value={dates[field]} onChange={(v) => setDates((prev) => ({ ...prev, [field]: v }))} displayClassName={`w-full ${qaDateInputClass}`} />
              </label>
            ))}
            <ClippedButton onClick={handleRefresh} size="md" className="h-8 gap-2 px-4 text-xs font-bold text-white hover:brightness-110 shrink-0" style={{ background: "#1f2d3d" }}>
              <RefreshCw className="w-3 h-3" />
              {loading ? "Loading…" : "Load Dashboard"}
            </ClippedButton>
          </div>
        ) : (
          dateFilterBar
        )
      ) : (
        canBrowseOthers &&
        advisorList && (
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && guideNames.length > 0 && (
              // CustomSelect's own outer wrapper hardcodes w-full (it fills
              // whatever box you put it in) — triggerClassName only affects
              // the trigger button inside that box, not the box itself. Left
              // unconstrained in a plain flex row, that w-full div claimed
              // the entire row on its own line, which is what pushed the
              // advisor field down onto a second line below it. Wrapping it
              // in a fixed-width box here (same ~150px used in the main
              // Score-tab panel) is what actually bounds it.
              <div className="w-[150px] shrink-0">
                <CustomSelect
                  value={guideFilter}
                  onChange={setGuideFilter}
                  theme={theme}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "All guides" }, ...guideNames.map((g) => ({ value: g, label: g }))]}
                />
              </div>
            )}
            <AdvisorCombobox advisors={pickerAdvisors} value={selectedTactId || ""} onChange={handleAdvisorChange} theme={theme} className="w-[200px]" />
          </div>
        )
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {(["score", "feedback", "reviews"] as const).map((tabId) => (
          <button
            key={tabId}
            onClick={() => handleTabClick(tabId)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg -mb-0.5 border-b-[3px] cursor-pointer transition-colors ${
              activeTab === tabId
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-content-muted hover:text-content"
            }`}
          >
            {tabId === "score" ? "Score Dashboard" : tabId === "feedback" ? "QA Feedback" : "Reviews"}
            {tabId !== "score" && tabLoading[tabId] ? " ⟳" : ""}
          </button>
        ))}
      </nav>

      {activeTab === "score" && metrics && (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 ${loading ? "opacity-40 pointer-events-none" : ""}`}>
          <BucketCard title="Chats" bucket={metrics.loChats} theme={theme} />
          <BucketCard title="Calls" bucket={metrics.loCalls} theme={theme} />
          <BucketCard title="Payments" bucket={metrics.loPayments} highlight theme={theme} />
          <LeadScoreCard lead={metrics.leadScore} theme={theme} />
        </div>
      )}

      {activeTab === "feedback" && (
        <>
          <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
            <label className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> From</span>
              <DateInputDMY value={feedbackDateFrom} onChange={setFeedbackDateFrom} max={feedbackDateTo || undefined} displayClassName={`w-full ${qaDateInputClass}`} />
            </label>
            <label className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> To</span>
              <DateInputDMY value={feedbackDateTo} onChange={setFeedbackDateTo} min={feedbackDateFrom || undefined} displayClassName={`w-full ${qaDateInputClass}`} />
            </label>
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> Domain</span>
              <CustomSelect
                value={feedbackDomain}
                onChange={setFeedbackDomain}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All" }, ...feedbackDomainOptions.map((d) => ({ value: d, label: d }))]}
              />
            </label>
            <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Search className="w-3 h-3" /> Chat ID</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
                <input
                  type="text"
                  value={feedbackSearch}
                  onChange={(e) => setFeedbackSearch(e.target.value)}
                  placeholder="Search Chat ID…"
                  className={`w-full ${qaSearchInputClass}`}
                />
              </div>
            </label>
            {(feedbackDateFrom || feedbackDateTo || feedbackDomain || feedbackSearch) && (
              <ClippedButton
                onClick={() => {
                  setFeedbackDateFrom("");
                  setFeedbackDateTo("");
                  setFeedbackDomain("");
                  setFeedbackSearch("");
                }}
                size="md"
                className="h-8 gap-1.5 px-3 text-[11px] font-bold shrink-0"
                style={{ background: dark ? "#1c2632" : "#e5e9ee", color: dark ? "#cbd5e1" : "#334155" }}
              >
                <X className="w-3 h-3" />
                Clear
              </ClippedButton>
            )}
          </div>
          <SheetTableView table={filteredFeedbackTable ?? null} loading={!!tabLoading.feedback} error={tabError.feedback || ""} columns={FEEDBACK_COLUMNS} theme={theme} />
        </>
      )}

      {activeTab === "reviews" && (
        <>
          <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
            <label className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> From</span>
              <DateInputDMY value={reviewDateFrom} onChange={setReviewDateFrom} max={reviewDateTo || undefined} displayClassName={`w-full ${qaDateInputClass}`} />
            </label>
            <label className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> To</span>
              <DateInputDMY value={reviewDateTo} onChange={setReviewDateTo} min={reviewDateFrom || undefined} displayClassName={`w-full ${qaDateInputClass}`} />
            </label>
            <label className="flex-1 min-w-[140px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> Domain</span>
              <CustomSelect
                value={reviewDomainFilter}
                onChange={setReviewDomainFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All" }, ...reviewDomainOptions.map((d) => ({ value: d, label: d }))]}
              />
            </label>
            <label className="flex-1 min-w-[120px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><ListFilter className="w-3 h-3" /> Type</span>
              <CustomSelect
                value={reviewTypeFilter}
                onChange={setReviewTypeFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All" }, ...reviewTypeOptions.map((t) => ({ value: t, label: t }))]}
              />
            </label>
            <label className="flex-1 min-w-[120px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Status</span>
              <CustomSelect
                value={reviewStatusFilter}
                onChange={setReviewStatusFilter}
                theme={theme}
                triggerClassName={selectTriggerClass}
                options={[{ value: "", label: "All" }, ...reviewStatusOptions.map((s) => ({ value: s, label: s }))]}
              />
            </label>
            <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Search className="w-3 h-3" /> Chat ID</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
                <input
                  type="text"
                  value={reviewSearch}
                  onChange={(e) => setReviewSearch(e.target.value)}
                  placeholder="Search Chat ID…"
                  className={`w-full ${qaSearchInputClass}`}
                />
              </div>
            </label>
          </div>
          <SheetTableView table={filteredReviewTable ?? null} loading={!!tabLoading.reviews} error={tabError.reviews || ""} columns={REVIEW_COLUMNS} theme={theme} />
        </>
      )}
    </div>
  );
}

export default QaDashboardPage;
