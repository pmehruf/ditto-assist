/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Shared presentational primitives for the Connections page's table-style
 * redesign (2026-09) — a summary stat bar plus two grouped "sections" (Data
 * Sources, Syncs & Exports), each a list of rows sharing one column layout
 * so everything lines up whether the row is built directly in
 * ConnectionsPage.tsx or rendered by a child component
 * (ConnectionRowCard.tsx, used by the Google Sheets read connections).
 *
 * Deliberately flexbox rows with a shared min-width per "column" rather than
 * a literal CSS Grid/`<table>` — a real grid can't span across the several
 * independent component files that render into it (each row's cells have
 * very different internal content: a resync button vs. a "queued" count vs.
 * a plain sync trigger), so consistent column widths are the only thing
 * actually shared. Wraps to a stacked layout below the `md` breakpoint,
 * since a fixed 5-6 column row has no honest way to fit a narrow viewport.
 *
 * 2026-09 follow-up redesign: every row is now a single self-contained,
 * click-to-expand unit (row summary + its own detail panel in ONE divide-y
 * child) instead of a plain summary row with an optional detail block
 * rendered as a separate sibling by the caller. Two things motivated this:
 * (1) users could previously only see Advisor Directory Sync's detail by
 * triggering a sync, and every other row had no detail view at all; (2) a
 * caller-rendered sibling detail block (the old Advisor Directory Sync
 * pattern) added an extra divide-y child only for that one row, which is
 * what made the first row of that table look misaligned with the rest —
 * every row is now guaranteed to be exactly one divide-y child, detail
 * panel included, so the rhythm is consistent top to bottom.
 */

// iconColorFor()/IconHue live in connectionIconColors.ts (a plain function,
// not a component) so this file's exports stay component-only for Fast
// Refresh — see that file's doc comment.

export type ConnectionHealth = "connected" | "not_connected" | "attention" | "ready" | "queued";

// "queued" (a normal, expected in-between state — rows waiting to export)
// is deliberately a different color from "attention" (something is actually
// broken) — they used to share the same amber, which is why a broken
// Product Assist Log Export ("Export failed: ...") and a healthy-but-queued
// one could look identical at a glance.
const PILL_STYLES: Record<ConnectionHealth, { label: string; dark: string; light: string }> = {
  connected: { label: "Connected", dark: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", light: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  ready: { label: "Ready", dark: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", light: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  queued: { label: "Queued", dark: "bg-sky-500/15 text-sky-300 border-sky-500/30", light: "bg-sky-50 text-sky-700 border-sky-200" },
  attention: { label: "Attention", dark: "bg-amber-500/15 text-amber-300 border-amber-500/30", light: "bg-amber-50 text-amber-700 border-amber-200" },
  not_connected: { label: "Not connected", dark: "bg-white/[0.06] text-stone-400 border-white/[0.10]", light: "bg-stone-100 text-stone-500 border-stone-200" },
};

export function ConnectionStatusPill({ dark, health, label }: { dark: boolean; health: ConnectionHealth; label?: string }) {
  const style = PILL_STYLES[health];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider whitespace-nowrap ${
        dark ? style.dark : style.light
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {label ?? style.label}
    </span>
  );
}

/** One of the top summary tiles (Total Connections / Connected / Needs
 * Attention / Last Checked). */
export function ConnectionsSummaryCard({
  dark,
  icon,
  iconColor,
  value,
  label,
}: {
  dark: boolean;
  icon: ReactNode;
  iconColor: { bg: string; fg: string };
  value: ReactNode;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${
        dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-white border-[#D2DFEC]"
      }`}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: iconColor.bg, color: iconColor.fg }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className={`text-lg font-black leading-none ${dark ? "text-white" : "text-stone-900"}`}>{value}</p>
        <p className={`text-[10.5px] font-bold mt-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>{label}</p>
      </div>
    </div>
  );
}

/** Wraps one grouped table (Data Sources / Syncs & Exports): a bordered
 * container with a small header (icon, title, one-line description) and
 * whatever rows are passed as children, hairline-divided. */
export function ConnectionsSection({
  dark,
  icon,
  title,
  description,
  children,
}: {
  dark: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[#D2DFEC]"}`}>
      <div className={`flex items-center gap-2.5 px-5 py-4 border-b ${dark ? "border-white/[0.08]" : "border-[#D2DFEC]"}`}>
        <div className={dark ? "text-stone-400" : "text-stone-500"}>{icon}</div>
        <div className="min-w-0">
          <h3 className={`text-[11px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>{title}</h3>
          <p className={`text-[10.5px] font-semibold mt-0.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>{description}</p>
        </div>
      </div>
      {/* Column header row — hidden below md, since rows themselves stack
          into labeled blocks at that width and repeating the labels there
          would be redundant. Grid columns must use the exact same template
          as ConnectionsRow below — see that component's comment on why
          "auto" for Actions was the cause of misaligned rows. */}
      <div
        className={`hidden md:grid grid-cols-[minmax(0,1fr)_1.4fr_1.3fr_1.4fr] gap-4 px-5 py-2 text-[9.5px] font-black uppercase tracking-wider ${
          dark ? "text-stone-500 border-b border-white/[0.06]" : "text-stone-400 border-b border-stone-100"
        }`}
      >
        <span>Connection</span>
        <span>Purpose</span>
        <span>Account / Details</span>
        <span className="text-right">Actions</span>
      </div>
      <div className={`divide-y ${dark ? "divide-white/[0.06]" : "divide-stone-100"}`}>{children}</div>
    </div>
  );
}

/** Shared row shell — a single self-contained, click-to-expand unit. Status
 * pill + colored icon in the first column, then whatever the caller passes
 * for the remaining three (purpose, account/details, actions), stacked
 * below `md`. Clicking anywhere in the row (other than the action buttons
 * themselves) toggles `expandedContent` open — same interaction as Team
 * Tracker's Guide/Mentor rows (whole-row click target, hover tint, trailing
 * chevron), adapted here to expand in place instead of navigating away,
 * since there's no separate detail page to send the user to. Used both
 * directly (Advisor Directory Sync, Product Assist Log Export rows in
 * ConnectionsPage.tsx) and inside ConnectionRowCard.tsx. */
export function ConnectionsRow({
  dark,
  health,
  icon,
  iconColor,
  name,
  subtitle,
  purpose,
  details,
  actions,
  healthLabel,
  expandedContent,
  expanded: controlledExpanded,
  onToggleExpanded,
}: {
  dark: boolean;
  health: ConnectionHealth;
  icon: ReactNode;
  /** Distinct per-connection tint for the leading icon circle — see
   * iconColorFor(). Falls back to the previous neutral gray circle when
   * omitted. */
  iconColor?: { bg: string; fg: string };
  name: string;
  subtitle?: string;
  purpose: ReactNode;
  details: ReactNode;
  actions: ReactNode;
  healthLabel?: string;
  /** Rendered inside the SAME divide-y child as the row summary, only when
   * expanded — never as a sibling block, so every row (including the
   * first) keeps identical spacing whether or not it's expanded. */
  expandedContent?: ReactNode;
  /** Pass to make expand/collapse controlled by the caller (Advisor
   * Directory Sync wants to auto-expand right after a sync completes);
   * omit to let the row manage its own open/closed state. */
  expanded?: boolean;
  onToggleExpanded?: (next: boolean) => void;
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : localExpanded;
  const hasExpandable = !!expandedContent;

  const toggle = () => {
    if (!hasExpandable) return;
    const next = !expanded;
    if (isControlled) onToggleExpanded?.(next);
    else setLocalExpanded(next);
  };

  return (
    <div>
      <div
        role={hasExpandable ? "button" : undefined}
        tabIndex={hasExpandable ? 0 : undefined}
        onClick={hasExpandable ? toggle : undefined}
        onKeyDown={
          hasExpandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
        aria-expanded={hasExpandable ? expanded : undefined}
        // The 4th (Actions) column used to be "auto" — sized to fit each
        // row's own button count/labels. Since every row is its own
        // independent CSS grid, "auto" made column 4's width DIFFER row to
        // row (QA Dashboard's 2 buttons vs. Playbook's 3, Advisor Directory
        // Sync's 1 vs. Product Assist Log Export's 3), which in turn shifted
        // how much space was left for columns 1-3 — that's what actually
        // caused the first-row-looks-misaligned symptom (any row with a
        // different button count from its neighbors misaligns, not
        // specifically row 1). Using a fixed ratio (1.4fr, matching the
        // Purpose column's weight) for every column, on every row, makes
        // all four column boundaries identical regardless of how many
        // action buttons a given row has — must stay in sync with
        // ConnectionsSection's header row template above.
        className={`grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_1.4fr_1.3fr_1.4fr] gap-2 md:gap-4 px-5 py-4 items-start md:items-center ${
          hasExpandable ? `cursor-pointer transition-colors ${dark ? "hover:bg-white/[0.04]" : "hover:bg-stone-50/80"}` : ""
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              iconColor ? "" : dark ? "bg-white/[0.06] text-stone-300" : "bg-stone-100 text-stone-600"
            }`}
            style={iconColor ? { backgroundColor: iconColor.bg, color: iconColor.fg } : undefined}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <p className={`text-[12.5px] font-black truncate ${dark ? "text-white" : "text-stone-900"}`}>{name}</p>
            {subtitle && <p className={`text-[10px] font-semibold truncate ${dark ? "text-stone-500" : "text-stone-400"}`}>{subtitle}</p>}
          </div>
        </div>
        <div className={`text-[11px] font-semibold leading-snug ${dark ? "text-stone-400" : "text-stone-500"}`}>{purpose}</div>
        <div className="min-w-0">
          <ConnectionStatusPill dark={dark} health={health} label={healthLabel} />
          <div className={`text-[10.5px] font-semibold mt-1.5 leading-snug ${dark ? "text-stone-400" : "text-stone-500"}`}>{details}</div>
        </div>
        <div className="flex md:justify-end items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
          {hasExpandable && (
            <ChevronRight
              className={`w-4 h-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""} ${dark ? "text-white/30" : "text-stone-350"}`}
            />
          )}
        </div>
      </div>
      {hasExpandable && expanded && (
        <div className={`px-5 pb-4 -mt-1 border-t ${dark ? "border-white/[0.05]" : "border-stone-100"} pt-3`}>{expandedContent}</div>
      )}
    </div>
  );
}
