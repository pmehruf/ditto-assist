/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, AlertTriangle, X, Users, GraduationCap, Calendar, BarChart3, Tag, ListFilter, CheckCircle2, Download, ArrowLeft, ListChecks } from "lucide-react";
import { QaDashboardIcon } from "../components/icons";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";
import { DateInputDMY } from "../components/DateInputDMY";
import { downloadCSV } from "../utils/csvExport";

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

// QIP/PIP Candidates table: sticky header (px-3 py-1.5, text-xs → ~28px)
// plus 7 data rows (px-3 py-1.5, text-xs → ~28px each) plus a hairline
// border per row ≈ 8 * 28px + 8px borders = 232px. Past 7 rows the table
// scrolls internally inside this fixed height instead of growing the card.
const QIP_TABLE_MAX_HEIGHT_PX = 232;

// ── Session Feedback — full editable control (create/save sessions,
// history, actionable statuses) lives in Team Tracker's advisor-level
// Insights view now, not here (explicit request: the earlier relocation to
// this page was a mapping error). This page keeps only a read-only
// ActionableStatus type/status-badge for the lightweight self-view section
// below (see ReadOnlyFeedbackSummarySection), plus its own status-update
// call — a plain Advisor can act on their own actionables from here even
// though they can't reach Team Tracker to edit anything else. ──────────
type ActionableStatus = "Open" | "In Progress" | "Completed" | "Failed";
interface FeedbackSummaryActionable {
  id: number;
  description: string;
  dueDate: string | null;
  status: ActionableStatus;
}
interface FeedbackSummaryEntry {
  id: number;
  tactId: string;
  advisorName: string;
  authorName: string;
  meetingDate: string;
  discussionPoints: string | null;
  meetingNotes: string | null;
  createdAt: string;
  actionables: FeedbackSummaryActionable[];
}
async function fetchFeedbackSummary(tactId: string): Promise<FeedbackSummaryEntry[]> {
  return fetchJson<FeedbackSummaryEntry[]>(`/api/qa-dashboard/team-tracker/coaching/history?${qs({ tactId })}`);
}
/** The advisor's own status control on their read-only Feedback Summary —
 * the one field they CAN edit here (see requirement: "since the actionable
 * is given to the advisors, they should have the option to update the
 * actionable status on their end on the advisor dashboard"). */
async function patchActionableStatus(actionableId: number, status: ActionableStatus): Promise<void> {
  const res = await fetch(`/api/qa-dashboard/team-tracker/coaching/actionables/${actionableId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
}

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
/** monthIndex0 is 0-11 (January = 0) — same Start/End/Till formula
 * computeDefaultDates() always used for "the current month", generalized to
 * any (year, month) pair for the Control section's Month selector below. */
function monthDateFilters(year: number, monthIndex0: number): DateFilters {
  return {
    checkedFrom: `${year}-${pad(monthIndex0 + 1)}-01`,
    checkedTo: fmtDate(new Date(year, monthIndex0 + 1, 0)),
    tillDate: fmtDate(new Date(year, monthIndex0, -1)),
  };
}
function computeDefaultDates(): DateFilters {
  const d = new Date();
  return monthDateFilters(d.getFullYear(), d.getMonth());
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

// ── Month selector (Control section) — "yyyy-MM", or the literal "custom"
// for manual Start/End/Till editing exactly as before. Picking a month
// auto-fills the three date fields via monthDateFilters above; they stay
// disabled (view-only) until "Custom" is chosen, so the visible dates can
// never silently drift from the selected month. ───────────────────────────
function monthKeyOf(year: number, monthIndex0: number): string {
  return `${year}-${pad(monthIndex0 + 1)}`;
}
function parseMonthKey(key: string): { year: number; monthIndex0: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), monthIndex0: Number(m[2]) - 1 };
}
function currentMonthKey(): string {
  const d = new Date();
  return monthKeyOf(d.getFullYear(), d.getMonth());
}
// Last 24 months (newest first) plus "Custom" — 24 is comfortably past any
// range this dashboard's own date filters are meant to cover day-to-day,
// without the dropdown growing unbounded.
const MONTH_SELECT_COUNT = 24;
function recentMonthOptions(count: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  for (let i = 0; i < count; i++) {
    out.push({ value: monthKeyOf(y, m), label: new Date(y, m, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" }) });
    m--;
    if (m < 0) {
      m = 11;
      y--;
    }
  }
  return out;
}
const MONTH_SELECTION_STORAGE_KEY = "qa_dashboard_month_selection";
function loadStoredMonthSelection(): string {
  try {
    const raw = window.localStorage.getItem(MONTH_SELECTION_STORAGE_KEY);
    if (raw) return raw;
  } catch {
    /* ignore */
  }
  return currentMonthKey();
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

// Exports exactly the columns SheetTableView renders (not every raw column
// the sheet API returns) — the CSV matches what's on screen.
function pickVisibleColumns(table: SheetTable, columns: string[] | null): Record<string, unknown>[] {
  const visible = columns ? table.headers.filter((h) => columns.some((c) => norm(c) === norm(h))) : table.headers;
  return table.rows.map((row) => {
    const picked: Record<string, unknown> = {};
    for (const h of visible) picked[h] = row[h] ?? "";
    return picked;
  });
}

function ExportCsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <ClippedButton
      onClick={onClick}
      disabled={disabled}
      size="sm"
      title="Export this table as a CSV file"
      className="shrink-0 gap-1.5 pl-2 pr-2.5 py-1.5 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb] h-8"
    >
      <Download className="w-3.5 h-3.5 shrink-0" />
      <span>Export CSV</span>
    </ClippedButton>
  );
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
                  i === highlighted ? "bg-[var(--accent-subtle-bg)]" : ""
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
  // The card's headline metric (QA Score / Average Score) gets pulled out
  // of the compact stat-row list treatment entirely — previously it used
  // the exact same text-xs size as "Instances"/"Perfect" above it, just a
  // heavier weight, so the one number that actually matters on the card
  // didn't read as more important than its neighbors. A divider + real
  // vertical breathing room + an actual KPI-sized number fixes that.
  if (bold) {
    return (
      <div className="flex justify-between items-baseline gap-2 pt-1.5 mt-1 border-t border-stone-200/60 dark:border-white/[0.08]">
        <span className="text-xs font-bold uppercase tracking-wide text-content-muted">{label}</span>
        <span className={`text-2xl font-black leading-none tabular-nums ${isNa ? "text-content-faint" : ""} ${valueClassName}`}>
          {isNa ? "NA" : `${value}${suffix}`}
        </span>
      </div>
    );
  }
  return (
    <div className="flex justify-between text-xs py-1 border-b border-stone-200/60 dark:border-white/[0.06] last:border-b-0">
      <span className="text-content-muted">{label}</span>
      <span className={isNa ? "text-content-faint font-normal" : "font-semibold"}>
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
      className={`rounded-2xl border ${borderWidthClass} p-4 space-y-1.5 ${
        dark
          ? "bg-white/[0.03] shadow-soft transition-all duration-200 hover:shadow-card"
          : "bg-surface shadow-card hover:shadow-overlay transition-shadow duration-200"
      } ${neutralBorderClasses} ${borderColorClass}`}
    >
      <h2 className="text-sm font-bold uppercase tracking-wide text-content-muted">{title}</h2>
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

  // Outer div owns rounded-xl + overflow-hidden; the actual scrolling
  // happens on the plain inner div (max-h-[65vh] overflow-auto, no
  // rounding of its own) — see the roster table below for the full
  // explanation of why this split fixes the scrollbar/sticky-header
  // clipping the rounded corner.
  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
      <div className="overflow-auto max-h-[65vh]">
      <table className="w-full text-xs border-collapse min-w-[700px]">
        <thead>
          <tr>
            {visible.map((h) => (
              <th
                key={h}
                className={`sticky top-0 text-left px-3 py-2 font-bold whitespace-nowrap border-b ${
                  dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"
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
    </div>
  );
}

const ROSTER_HEADERS = ["Sl No", "Advisor", "Chat QA", "Instances", "Call QA", "Instances", "Lead Score", "Instances", "Payments QA", "Instances"] as const;
// Widths must sum to 100 — shared between the header table and the body
// table in AdvisorRosterTable below (two separate <table> elements) so
// their columns land in the same place. Approximate/hand-picked (Advisor
// gets the lion's share since names vary most; the four repeated
// "Instances" columns are kept equal and narrow).
const ROSTER_COL_WIDTHS = ["5%", "32%", "8%", "7%", "8%", "7%", "9%", "7%", "10%", "7%"];

function RosterColgroup() {
  return (
    <colgroup>
      {ROSTER_COL_WIDTHS.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

/**
 * Advisor roster table — a frozen-header table: the header and body are two
 * separate <table> elements (sharing one <colgroup> so their columns line
 * up via table-layout: fixed), with only the body table sitting inside the
 * scrolling div.
 *
 * The previous shape used one <table> with a `position: sticky` <thead>
 * inside the same overflow-auto div as the body. That keeps the header
 * visually pinned while scrolling, but the native scrollbar belongs to the
 * overflow-auto BOX, not to "the body specifically" — so it still ran the
 * box's full height, right alongside/through the header row too. That's
 * what "the scroller extends into the title area" describes, and no amount
 * of z-index or sticky positioning fixes it, because the header is still
 * physically inside the same scrolling element. Moving the header into its
 * own table, entirely outside the overflow-auto div that now wraps only the
 * body table, makes it structurally impossible instead of just visually
 * reduced — the scrollbar now belongs to a box that only ever contains body
 * rows.
 *
 * table-layout: fixed + a shared <colgroup> is required for this split:
 * two independent tables have no way to agree on column widths from
 * content alone (each fixed table lays out its own columns independently
 * of the other), so both must be told the same explicit widths.
 */
function AdvisorRosterTable({
  rows,
  dark,
  onExport,
  onAdvisorSelect,
}: {
  rows: AdvisorSummaryRow[];
  dark: boolean;
  onExport: () => void;
  onAdvisorSelect: (tactId: string) => void;
}) {
  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08]" : "border-[var(--border)]"}`}>
      <table className="w-full text-xs border-collapse table-fixed">
        <RosterColgroup />
        <thead>
          <tr>
            {ROSTER_HEADERS.map((h, i, arr) => {
              const isLast = i === arr.length - 1;
              return (
                <th
                  key={`${h}-${i}`}
                  className={`text-left py-2 font-bold whitespace-nowrap truncate border-b ${isLast ? "pl-3 pr-9 relative" : "px-3"} ${
                    dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"
                  }`}
                >
                  {h}
                  {/* Export icon lives directly in the header's own last
                      cell — the table's "title row" — instead of a bar of
                      its own above the table, so it adds no vertical space
                      at all. Absolutely positioned within this cell (which
                      reserves pr-9 of empty room for it) and vertically
                      centered on the cell's own height. */}
                  {isLast && (
                    <button
                      type="button"
                      onClick={onExport}
                      disabled={rows.length === 0}
                      title="Export this table as a CSV file"
                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md normal-case font-normal transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        dark ? "text-slate-300 hover:bg-white/[0.12]" : "text-stone-600 hover:bg-black/[0.08]"
                      }`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
      </table>
      {/* Caps at 65vh (was row-capped via a ResizeObserver on the header
          row measuring a fixed row count — e.g. 6 rows — regardless of
          viewport size; briefly removed entirely per an earlier request,
          but a fully unbounded table let ordinary page scrolling run on
          indefinitely through a long roster). 65vh lets the table grow
          with its own content up to roughly a full viewport's worth of
          rows — short lists size naturally, well under that cap — and once
          it hits the cap, this box's own overflow-y takes over: scrolling
          while the table already fills the visible viewport scrolls its
          rows instead of the page. */}
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full text-xs border-collapse table-fixed">
          <RosterColgroup />
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={ROSTER_HEADERS.length} className="px-3 py-6 text-center text-content-muted">
                  No advisors found.
                </td>
              </tr>
            ) : (
              rows.map((a, i) => (
                <tr key={a.tactId} className={`transition-colors ${dark ? "hover:bg-white/[0.03]" : "odd:bg-black/[0.015] hover:bg-stone-50"}`}>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{i + 1}</td>
                  <td className={`px-3 py-2 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                    <button
                      onClick={() => onAdvisorSelect(a.tactId)}
                      className={`w-full font-bold text-left cursor-pointer hover:underline ${dark ? "text-blue-300" : "text-blue-700"}`}
                      title="Open this advisor's dashboard"
                    >
                      {/* truncate (not wrap) now that the column has a
                          fixed width (table-layout: fixed) rather than
                          growing to fit content — title attr on the span
                          itself (separate from the button's own action
                          title above) surfaces the full name on hover. */}
                      <span className="block truncate" title={a.name || a.tactId}>
                        {a.name || a.tactId}
                      </span>
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
    </div>
  );
}

function ActionableStatusChip({ status, dark }: { status: ActionableStatus; dark: boolean }) {
  const cls =
    status === "Completed"
      ? dark
        ? "bg-emerald-500/20 text-emerald-300"
        : "bg-emerald-50 text-emerald-700"
      : status === "Failed"
        ? dark
          ? "bg-red-500/20 text-red-300"
          : "bg-red-50 text-red-700"
        : status === "In Progress"
          ? dark
            ? "bg-amber-500/20 text-amber-300"
            : "bg-amber-50 text-amber-700"
          : dark
            ? "bg-white/10 text-slate-300"
            : "bg-stone-100 text-stone-600";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase shrink-0 ${cls}`}>{status}</span>;
}

/** Feedback Summary's own status control (Task 3 item 16) — Open -> In
 * Progress -> Completed/Failed, editable inline. Optimistic update with
 * rollback on failure so the dropdown feels immediate. */
function ActionableStatusSelect({ actionableId, status, dark, onChanged }: { actionableId: number; status: ActionableStatus; dark: boolean; onChanged: (next: ActionableStatus) => void }) {
  const [saving, setSaving] = useState(false);
  const cls = `text-[10px] font-black uppercase rounded px-1 py-0.5 border cursor-pointer outline-none ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  } ${saving ? "opacity-50" : ""}`;
  return (
    <select
      value={status}
      disabled={saving}
      onChange={async (e) => {
        const next = e.target.value as ActionableStatus;
        const prev = status;
        onChanged(next);
        setSaving(true);
        try {
          await patchActionableStatus(actionableId, next);
        } catch {
          onChanged(prev); // roll back on failure
        } finally {
          setSaving(false);
        }
      }}
      className={cls}
    >
      <option value="Open">Open</option>
      <option value="In Progress">In Progress</option>
      <option value="Completed">Completed</option>
      <option value="Failed">Failed</option>
    </select>
  );
}

// ── Actionables duplicated from the Advisor Insight Page (Team Tracker) —
// per the explicit spec: "That actionable item alone should be duplicated
// and displayed... Only the assigned actionable should be surfaced on the
// Advisor's QA Dashboard. The complete feedback summary should remain
// available inside the Advisor Insight Page." So this reads the SAME
// coaching-history endpoint Team Tracker's own Feedback Summary uses, but
// flattens every session down to just its actionables — no meeting
// discussion/notes text here, only the items assigned to this advisor,
// each carrying a small "logged <date>" caption for context.
//
// Visible to anyone who can see this advisor's dashboard at all — the
// advisor's own self-view, or a Guide/Mentor/Admin browsing them (explicit
// request; see this component's call site). Editing is narrower though:
// `canEditStatus` (true only for the advisor's own self-view) gates the
// interactive status dropdown — a Guide/Mentor/Admin sees a plain
// read-only badge instead, and edits status from their own control back in
// Team Tracker. Status updates PATCH the same actionables/:id/status route
// Team Tracker's own status control uses (server-side, that route already
// allows either the advisor themselves or a Guide/Mentor/Admin with
// coaching access to this advisor — see coachingService.ts's authorize),
// so a change made from either place is the same DB row — nothing to
// "sync back". ──────────────────────────────────────────────────────────
interface FlattenedActionable extends FeedbackSummaryActionable {
  sessionId: number;
  meetingDate: string;
}
function ActionablesFromInsightSection({ dark, tactId, canEditStatus }: { dark: boolean; tactId: string; canEditStatus: boolean }) {
  const [actionables, setActionables] = useState<FlattenedActionable[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchFeedbackSummary(tactId)
      .then((entries) => {
        if (cancelled) return;
        const flat = entries.flatMap((s) => s.actionables.map((a) => ({ ...a, sessionId: s.id, meetingDate: s.meetingDate })));
        setActionables(flat);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load actionables.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tactId]);

  const setActionableStatus = (actionableId: number, next: ActionableStatus) => {
    setActionables((prev) => (prev ? prev.map((a) => (a.id === actionableId ? { ...a, status: next } : a)) : prev));
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${dark ? "border-white/[0.08] bg-white/[0.03]" : "border-[var(--border)] bg-white"}`}>
      <div className={`px-3 py-2.5 border-b ${dark ? "border-white/[0.08]" : "border-stone-150"}`}>
        <h4 className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-[#111827]"}`}>
          <ListChecks className="w-3.5 h-3.5" />
          Actionables
        </h4>
        <p className={`text-[10px] font-semibold mt-0.5 ${dark ? "text-slate-400" : "text-stone-500"}`}>
          {canEditStatus ? "Update the status as you complete each one." : "Status is updated by the advisor."}
        </p>
      </div>
      <div className="p-3">
        {loading ? (
          <p className="text-[13px] text-content-muted py-2">Loading…</p>
        ) : error ? (
          <p className="text-[13px] text-red-500 py-2">{error}</p>
        ) : !actionables || actionables.length === 0 ? (
          <p className="text-[13px] text-content-muted py-2">No actionables assigned yet.</p>
        ) : (
          <ul className="space-y-1.5 max-h-[50vh] overflow-auto">
            {actionables.map((a) => (
              <li key={a.id} className={`rounded-lg border p-2.5 text-[12px] flex items-center gap-2 flex-wrap ${dark ? "border-white/[0.06]" : "border-stone-100"}`}>
                <ActionableStatusChip status={a.status} dark={dark} />
                <span className="flex-1 min-w-[140px]">{a.description}</span>
                {a.dueDate && <span className="text-content-muted">(due {a.dueDate})</span>}
                <span className={`text-[10px] font-semibold ${dark ? "text-slate-500" : "text-stone-400"}`}>logged {a.meetingDate}</span>
                {canEditStatus && <ActionableStatusSelect actionableId={a.id} status={a.status} dark={dark} onChanged={(next) => setActionableStatus(a.id, next)} />}
              </li>
            ))}
          </ul>
        )}
      </div>
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

  // "yyyy-MM", or the literal "custom" — see monthKeyOf/parseMonthKey above.
  // When restoring a non-"custom" selection, `dates` is always freshly
  // recomputed from that month rather than trusted from its own stored
  // value, so the two can never disagree on load (e.g. after upgrading from
  // before this Month selector existed, when only DATES_STORAGE_KEY had
  // ever been written).
  const [monthSelection, setMonthSelection] = useState<string>(() => loadStoredMonthSelection());
  const [dates, setDates] = useState<DateFilters>(() => {
    const storedMonth = loadStoredMonthSelection();
    if (storedMonth !== "custom") {
      const parsed = parseMonthKey(storedMonth);
      if (parsed) return monthDateFilters(parsed.year, parsed.monthIndex0);
    }
    return loadStoredDates() || computeDefaultDates();
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(DATES_STORAGE_KEY, JSON.stringify(dates));
    } catch {
      /* ignore quota/serialization errors */
    }
  }, [dates]);
  useEffect(() => {
    try {
      window.localStorage.setItem(MONTH_SELECTION_STORAGE_KEY, monthSelection);
    } catch {
      /* ignore quota errors */
    }
  }, [monthSelection]);
  const monthOptions = useMemo(() => [...recentMonthOptions(MONTH_SELECT_COUNT), { value: "custom", label: "Custom" }], []);
  function handleMonthSelectionChange(value: string) {
    setMonthSelection(value);
    if (value !== "custom") {
      const parsed = parseMonthKey(value);
      if (parsed) setDates(monthDateFilters(parsed.year, parsed.monthIndex0));
    }
  }
  // Start/End/Till Date stay editable at all times now — the Month selector
  // is a convenience shortcut that fills them in, not a gate on them (it
  // used to disable these fields outright unless "Custom" was picked
  // explicitly, which made ad-hoc date ranges unreachable). Editing any
  // field directly flips the selector to "Custom" so it never shows a
  // month whose canonical range no longer matches what's actually loaded.
  function handleDateFieldChange(field: keyof DateFilters, value: string) {
    setDates((prev) => ({ ...prev, [field]: value }));
    setMonthSelection("custom");
  }

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

  // The advisor roster table below the Overall Score/QIP row used this
  // same row-cap-via-ResizeObserver pattern (a fixed 6 rows, internal
  // scroll) to keep the whole page inside one viewport, was briefly made
  // fully unbounded (no cap at all), and now caps via a plain max-h-[65vh]
  // instead — see the table's own render below for why that's a better
  // fit than either extreme: no ref/max-height state needs measuring here.

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

  // QIP/PIP table's scroll area is capped to a fixed height (~7 data rows
  // + the sticky header, see QIP_TABLE_MAX_HEIGHT_PX below) instead of
  // being measured against Overall Score's own height. A live
  // ResizeObserver-based match was tried first but flex's own
  // align-items: stretch kept winning in practice — once the QIP table
  // had enough rows to exceed Overall Score's natural height, the row
  // just grew to fit QIP instead of capping it. A flat pixel cap sidesteps
  // that fight entirely: the card simply never grows past ~7 rows tall,
  // and overflow-y-auto scrolls the rest.

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

  const exportFeedbackCsv = () => {
    if (!filteredFeedbackTable) return;
    downloadCSV(pickVisibleColumns(filteredFeedbackTable, FEEDBACK_COLUMNS), `qa-feedback-${dashboard?.advisor?.tactId || "advisor"}.csv`);
  };
  const exportReviewsCsv = () => {
    if (!filteredReviewTable) return;
    downloadCSV(pickVisibleColumns(filteredReviewTable, REVIEW_COLUMNS), `qa-reviews-${dashboard?.advisor?.tactId || "advisor"}.csv`);
  };
  const exportSummaryCsv = () => {
    downloadCSV(
      filteredSummary.map((a) => ({
        Advisor: a.name || a.tactId,
        "TACT ID": a.tactId,
        Guide: a.guide || "",
        Mentor: a.mentor || "",
        "Chat QA": a.chatAvg ?? "",
        "Chat Instances": a.chatInstances,
        "Call QA": a.callAvg ?? "",
        "Call Instances": a.callInstances,
        "Lead Score": a.leadScoreAvg ?? "",
        "Lead Score Instances": a.leadScoreInstances,
        "Payments QA": a.paymentsAvg ?? "",
        "Payments Instances": a.paymentsInstances,
      })),
      "qa-advisors-summary.csv"
    );
  };

  const dateFilterBar = (
    <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${dark ? "bg-white/[0.05] border-white/[0.10]" : "bg-surface-elevated border-[var(--border-strong)]"}`}>
      <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" /> Month
        </span>
        <CustomSelect value={monthSelection} onChange={handleMonthSelectionChange} theme={theme} triggerClassName={selectTriggerClass} options={monthOptions} />
      </label>
      {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
        <label key={field} className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
          </span>
          <DateInputDMY
            value={dates[field]}
            onChange={(v) => handleDateFieldChange(field, v)}
            displayClassName={`w-full ${qaDateInputClass}`}
          />
        </label>
      ))}
      {/* variant="action" (2026-09): shared --action-navy token instead of a
          hardcoded #1f2d3d, which stayed the light-theme color even in dark
          theme. hover:brightness-110 dropped — the variant's own
          hover:bg-[--action-navy-hover] already provides hover feedback. */}
      <ClippedButton onClick={handleRefresh} size="md" variant="action" className="h-8 gap-2 px-4 text-xs font-bold shrink-0">
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
        {error ? (
          <div
            className={`flex items-start gap-2 p-3 rounded-lg border text-xs font-semibold ${
              dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}
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
          <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Month
            </span>
            <CustomSelect value={monthSelection} onChange={handleMonthSelectionChange} theme={theme} triggerClassName={selectTriggerClass} options={monthOptions} />
          </label>
          {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
            <label key={field} className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
              </span>
              <DateInputDMY
                value={dates[field]}
                onChange={(v) => handleDateFieldChange(field, v)}
                displayClassName={`w-full ${qaDateInputClass}`}
              />
            </label>
          ))}
          {/* variant="action" (2026-09): shared --action-navy token instead
              of a hardcoded #1f2d3d (see the Refresh button above). */}
          <ClippedButton onClick={() => loadAdvisorsSummary(dates)} size="md" variant="action" className="h-8 gap-2 px-4 text-xs font-bold shrink-0">
            <RefreshCw className="w-3.5 h-3.5" />
            {summaryLoading ? "Loading…" : "Load Dashboard"}
          </ClippedButton>
        </div>

        {summaryError && <p className="text-xs text-red-500">{summaryError}</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}

        {advisorsSummary !== null && (
          /* Both columns use a proportional basis (40/60) so together they
             always span the row's full width. QIP/PIP's own table caps at
             a fixed height (QIP_TABLE_MAX_HEIGHT_PX, ~7 rows) and scrolls
             internally past that — see the table wrapper below — so it no
             longer relies on flex's align-items: stretch, which could only
             ever equalize both sides to whichever's natural content was
             TALLEST rather than cap one to the other. */
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Overall Score — a 2x2 pairing (not a single tall stack): the
                two money-metric cards (Payments/Lead Score) form one
                column, the two conversation-quality cards (Chat/Call, no
                score highlighting) form the other.
                lg: (not xl:, which this row used before): xl's 1280px
                viewport-width threshold routinely failed on real laptop
                screens once the sidebar and content padding ate into that
                budget, silently falling back to the stacked layout even
                though there was room — this row shares the page with
                nothing else, so it only needs lg's 1024px to pair up
                safely. Matches the breakpoint LookupPage.tsx's own
                Input/Instruction-Manual row uses for the same reason. */}
            <div className="lg:basis-2/5 lg:grow lg:shrink min-w-0 space-y-3">
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

            {/* QIP/PIP Candidates — the rest of the row (60% basis). The
                card itself is naturally sized (title banner + table), not
                height-matched to Overall Score — instead the table's own
                scroll area below is capped at QIP_TABLE_MAX_HEIGHT_PX
                (~7 rows), so the card stops growing past that and any
                further candidates scroll internally instead. */}
            <div
              // 2026-09: light theme had a hover elevation change here
              // (hover:shadow-overlay) and dark theme had none -- added the
              // same transition to dark's own shadow-sm baseline so the
              // panel gets equivalent hover feedback in both themes.
              className={`lg:basis-3/5 lg:grow lg:shrink min-w-0 rounded-2xl overflow-hidden border flex flex-col transition-shadow duration-200 ${
                dark
                  ? "border-[rgba(184,106,28,0.35)] bg-white/[0.02] shadow-sm hover:shadow-card"
                  : "border-[rgba(176,106,36,0.28)] bg-white shadow-card hover:shadow-overlay"
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
              <div className={`px-4 py-2 flex items-center justify-center gap-2 shrink-0 border-b ${
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
                  // Fixed max-height (~7 rows, QIP_TABLE_MAX_HEIGHT_PX) so
                  // the card stops growing once the candidate list gets
                  // long — overflow-y only kicks in past that point. With
                  // a short list the table is naturally shorter than the
                  // cap, so this never visibly scrolls either way.
                  <div className="overflow-y-auto" style={{ maxHeight: QIP_TABLE_MAX_HEIGHT_PX }}>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr>
                          {["Advisor", "Payment QA", "Instances", "LeadScore", "Instances"].map((h, i) => (
                            <th
                              key={`${h}-${i}`}
                              className={`sticky top-0 text-left px-3 py-1.5 font-bold whitespace-nowrap border-b ${
                                dark ? "bg-[#0d1c3f] border-white/[0.16] text-slate-300" : "bg-[#f5f5f4] border-stone-200 text-stone-700"
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
                            <td className={`px-3 py-1.5 border-b font-semibold ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>{a.name || a.tactId}</td>
                            <td className={`px-3 py-1.5 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                              <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.paymentsAvg, dark)}`}>{a.paymentsAvg ?? "NA"}</div>
                            </td>
                            <td className={`px-3 py-1.5 border-b ${dark ? "border-white/[0.05] text-slate-400" : "border-stone-100 text-stone-500"}`}>{a.paymentsInstances}</td>
                            <td className={`px-3 py-1.5 border-b ${dark ? "border-white/[0.05]" : "border-stone-100"}`}>
                              <div className={`inline-block pl-2.5 ${scoreFlagClasses(a.leadScoreAvg, dark)}`}>{a.leadScoreAvg ?? "NA"}</div>
                            </td>
                            <td className={`px-3 py-1.5 border-b ${dark ? "border-white/[0.05] text-slate-400" : "border-stone-100 text-stone-500"}`}>{a.leadScoreInstances}</td>
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
          <AdvisorRosterTable rows={filteredSummary} dark={dark} onExport={exportSummaryCsv} onAdvisorSelect={handleAdvisorChange} />
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
          {/* Local back-to-list button — restored now that the global
              header (which used to close this drilldown via its own back
              arrow) is gone. Only shown when there's actually a list to go
              back to (Admin/Guide/Mentor viewing an advisor); a plain
              Advisor viewing their own dashboard has no list. */}
          {canBrowseOthers && (
            <button
              onClick={handleBackToList}
              className={`mt-1 p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer ${
                dark ? "hover:bg-white/10 text-slate-300" : "hover:bg-stone-100 text-stone-600"
              }`}
              title="Back to advisor list"
              aria-label="Back to advisor list"
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
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Month
              </span>
              <CustomSelect value={monthSelection} onChange={handleMonthSelectionChange} theme={theme} triggerClassName={selectTriggerClass} options={monthOptions} />
            </label>
            {(["checkedFrom", "checkedTo", "tillDate"] as const).map((field) => (
              <label key={field} className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {field === "checkedFrom" ? "Start Date" : field === "checkedTo" ? "End Date" : "Till Date"}
                </span>
                <DateInputDMY
                  value={dates[field]}
                  onChange={(v) => handleDateFieldChange(field, v)}
                  displayClassName={`w-full ${qaDateInputClass}`}
                />
              </label>
            ))}
            {/* variant="action" (2026-09): shared --action-navy token
                instead of a hardcoded #1f2d3d (see the Refresh button above). */}
            <ClippedButton onClick={handleRefresh} size="md" variant="action" className="h-8 gap-2 px-4 text-xs font-bold shrink-0">
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

      {/* The "Historical Trend" chart that used to render here for
          Guide/Mentor/Admin (browsing someone else's Advisor's QA
          Dashboard) was removed by explicit request — this page's
          scorecards above are the source of truth for that scope, and
          Team Tracker's Advisor Performance Page is the dedicated place
          for a trend view. The duplicated Actionables list below the score
          cards (see ActionablesFromInsightSection) is visible to anyone who
          can see this advisor's dashboard at all — a plain Advisor's own
          self-view, or a Guide/Mentor/Admin browsing them (explicit
          request — it used to be self-view only, since a plain Advisor
          can't reach Team Tracker's own copy, but a Guide/Mentor/Admin
          should be able to see it right here too rather than only in Team
          Tracker). Only the advisor themselves can change a status though
          (canEditStatus={!canBrowseOthers}) — a Guide/Mentor/Admin sees a
          read-only badge here; they still have their own editable control
          back in Team Tracker's Advisor Insight Page. */}
      {activeTab === "score" && advisor && (
        <div className="space-y-3.5">
          <ActionablesFromInsightSection dark={dark} tactId={advisor.tactId} canEditStatus={!canBrowseOthers} />
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
            <ExportCsvButton onClick={exportFeedbackCsv} disabled={!filteredFeedbackTable || filteredFeedbackTable.rows.length === 0} />
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
            <ExportCsvButton onClick={exportReviewsCsv} disabled={!filteredReviewTable || filteredReviewTable.rows.length === 0} />
          </div>
          <SheetTableView table={filteredReviewTable ?? null} loading={!!tabLoading.reviews} error={tabError.reviews || ""} columns={REVIEW_COLUMNS} theme={theme} />
        </>
      )}

      {/* The floating Session Feedback workspace (create/save sessions) now
          lives in Team Tracker's advisor-level Insights view — see this
          page's header comment. Nothing renders here for it. */}
    </div>
  );
}

export default QaDashboardPage;
