/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from "react";
import { Megaphone, Sparkles, CheckCircle2, Zap } from "lucide-react";
import { QAAnnouncement } from "../types/announcements";

interface AnnouncementCounterCardProps {
  theme: "light" | "dark";
  /** The FULL (uncapped) announcement list — App.tsx's own `qaAnnouncements`
   * state — not the capped `activeAnnouncements` HomeAnnouncementCard uses,
   * so these counts stay accurate past 8 active announcements. */
  allAnnouncements: QAAnnouncement[];
  onOpenStat: (title: string, list: QAAnnouncement[]) => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * The "Announcement Counter" card — now a WIDE, horizontal card sitting
 * below QA Performance in the right (1fr) cell of the supporting row (see
 * LookupIntroPage.tsx), same width as QA Performance itself, mirroring how
 * QA Performance lays its own stats out horizontally rather than stacked.
 * (It used to be the narrow 260px-column card, with "Did you know!?" in
 * this slot instead — swapped by explicit request so the narrow column
 * holds a naturally-vertical, scrollable-content card instead of a card
 * whose content is inherently a short horizontal strip of numbers.)
 * Same three stats + click-to-browse behavior (see AnnouncementStatModal.tsx)
 * and the same Last 30 Days breakdown, just arranged as two horizontal rows
 * (a 3-up stat grid, then a single breakdown strip) instead of stacked
 * blocks — natural content height, no forced stretch either way.
 */
export function AnnouncementCounterCard({ theme, allAnnouncements, onOpenStat }: AnnouncementCounterCardProps) {
  const {
    newThisWeekList, wentLiveThisWeekList, liveTodayList,
    last30Total, last30Qa, last30Product, last30Ops,
  } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = fmtDateOnly(today);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    // Trailing 30-day window (today + 29 days back), same "inclusive of
    // today" convention as weekAgo above — used for the Last 30 Days
    // breakdown, keyed off posted (announcementDate) like "New This Week".
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 29);

    const newList: QAAnnouncement[] = [];
    const wentLiveList: QAAnnouncement[] = [];
    const liveTodayList: QAAnnouncement[] = [];
    let last30Total = 0;
    let last30Qa = 0;
    let last30Product = 0;
    let last30Ops = 0;
    for (const a of allAnnouncements) {
      const posted = parseDateOnly(a.announcementDate);
      if (posted && posted >= weekAgo && posted <= today) newList.push(a);
      const effective = parseDateOnly(a.effectiveDate);
      if (effective && effective >= weekAgo && effective <= today) wentLiveList.push(a);
      if (a.effectiveDate === todayStr) liveTodayList.push(a);

      if (posted && posted >= monthAgo && posted <= today) {
        // Total counts every type (QA, Product, Insurance Operations, and
        // any legacy/unreclassified General Announcement row) — the
        // per-type breakdown below only names the three real types (per
        // product decision), so a legacy row still counts toward the
        // total without its own line; that bucket shrinks to 0 as
        // migration 0056's reclassification (or manual re-save) catches
        // the rest.
        last30Total++;
        const type = a.type || "QA Announcement";
        if (type === "QA Announcement") last30Qa++;
        else if (type === "Product Announcement") last30Product++;
        else if (type === "Insurance Operations") last30Ops++;
      }
    }
    return {
      newThisWeekList: newList, wentLiveThisWeekList: wentLiveList, liveTodayList,
      last30Total, last30Qa, last30Product, last30Ops,
    };
  }, [allAnnouncements]);

  const cardClass = `relative rounded-2xl border px-4 sm:px-5 py-[clamp(10px,1.6vh,20px)] flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  const headerIconColor = theme === "dark" ? "#FB7185" : "#BE123C";
  const headerIconBg = theme === "dark" ? "#FB71851A" : "#BE123C1A";

  const statTiles = [
    {
      title: "New This Week",
      label: "New",
      sub: "This Week",
      value: newThisWeekList.length,
      list: newThisWeekList,
      icon: <Sparkles className="w-4 h-4" />,
      color: theme === "dark" ? "#60A5FA" : "#2563EB",
    },
    {
      title: "Went Live This Week",
      label: "Went Live",
      sub: "This Week",
      value: wentLiveThisWeekList.length,
      list: wentLiveThisWeekList,
      icon: <CheckCircle2 className="w-4 h-4" />,
      color: theme === "dark" ? "#34D399" : "#059669",
    },
    {
      title: "Live Today",
      label: "Live",
      sub: "Today",
      value: liveTodayList.length,
      list: liveTodayList,
      icon: <Zap className="w-4 h-4" />,
      color: theme === "dark" ? "#22D3EE" : "#0754B7",
    },
  ] as const;

  const breakdownRows = [
    { label: "QA Announcement", value: last30Qa, color: theme === "dark" ? "#FB7185" : "#BE123C" },
    { label: "Product Announcement", value: last30Product, color: theme === "dark" ? "#A78BFA" : "#7C3AED" },
    { label: "Insurance Operations", value: last30Ops, color: theme === "dark" ? "#2DD4BF" : "#0F766E" },
  ] as const;

  return (
    <div className={cardClass}>
      {/* No "View all" link here — Announcements are still fully reachable
          via the "Announcements" tile in Workspace Tools above. */}
      <div className="flex items-center gap-2 select-none mb-[clamp(8px,1.2vh,16px)] shrink-0 min-w-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
          <Megaphone className="w-4 h-4" />
        </div>
        <span className={`text-[13px] sm:text-[14px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
          Announcements
        </span>
      </div>

      {/* Three stat tiles side by side (was stacked, back when this card
          lived in the narrow 260px column) — a 3-up grid reads naturally
          now that the card has a whole row's width instead of a sliver of
          it. */}
      <div className="grid grid-cols-3 gap-[clamp(8px,1.2vh,12px)] shrink-0">
        {statTiles.map((stat) => (
          <button
            key={stat.title}
            type="button"
            onClick={() => onOpenStat(stat.title, [...stat.list])}
            title={`View ${stat.title.toLowerCase()}`}
            className={`relative w-full flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl border text-center cursor-pointer transition-all duration-200 hover:-translate-y-0.5 ${
              theme === "dark"
                ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.16]"
                : "border-stone-200 bg-stone-50/70 hover:bg-white hover:border-stone-300 hover:shadow-sm"
            }`}
          >
            {stat.label === "Live" && stat.value > 0 && (
              <span className="absolute top-2 right-2 flex w-1.5 h-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ backgroundColor: stat.color }} />
                <span className="relative inline-flex rounded-full w-1.5 h-1.5" style={{ backgroundColor: stat.color }} />
              </span>
            )}
            <span style={{ color: stat.color }}>{stat.icon}</span>
            <span
              className="text-[22px] font-black font-mono leading-none"
              style={{ color: stat.value > 0 ? stat.color : theme === "dark" ? "#F8FAFC" : "#1E293B" }}
            >
              {stat.value}
            </span>
            <span className={`text-[10.5px] font-bold uppercase tracking-wide leading-tight ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              {stat.label}
              <br /> {stat.sub}
            </span>
          </button>
        ))}
      </div>

      {/* Last 30 Days breakdown — a single horizontal strip (total on the
          left, a divider, then the three real types inline) instead of a
          stacked list, matching the card's new wide proportions. Total
          counts every type (see the useMemo above); legacy/unreclassified
          General Announcement rows count toward it without a line of their
          own (see migration 0056). */}
      <div className={`mt-[clamp(8px,1.2vh,12px)] shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2 p-3 rounded-xl border ${
        theme === "dark" ? "border-white/[0.08] bg-white/[0.03]" : "border-stone-200 bg-stone-50/70"
      }`}>
        <div className="flex items-baseline gap-2 shrink-0">
          <span className={`text-[10.5px] font-bold uppercase tracking-wide ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
            Last 30 Days
          </span>
          <span className={`text-xl font-black font-mono leading-none ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
            {last30Total}
          </span>
        </div>
        <div className={`hidden sm:block w-px h-6 shrink-0 ${theme === "dark" ? "bg-white/[0.1]" : "bg-stone-300"}`} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {breakdownRows.map((row) => (
            <div key={row.label} className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
              <span className={`text-[11px] font-semibold whitespace-nowrap ${theme === "dark" ? "text-stone-300" : "text-stone-700"}`}>
                {row.label}
              </span>
              <span className="text-[12px] font-black font-mono shrink-0" style={{ color: row.color }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AnnouncementCounterCard;
