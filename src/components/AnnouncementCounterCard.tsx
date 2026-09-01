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
 * The "Announcement Counter" card this project had before the Home
 * Announcement carousel replaced it — restored by explicit request as the
 * narrow (1-of-3) partner card next to QA Performance (2-of-3) in the same
 * row, rather than the wide/horizontal card it used to be. Same three
 * stats, same icons/colors/click-to-browse behavior (see
 * AnnouncementStatModal.tsx, which this drives), same underlying counting
 * logic (see the `e4eb028` commit's LookupIntroPage.tsx for the version
 * this was extracted from) — just re-composed as a tall, narrow card with
 * the three stat blocks stacked vertically instead of in a horizontal row,
 * since a horizontal 3-up strip has nowhere near enough width in a 1-of-3
 * column.
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

  const cardClass = `relative rounded-2xl border px-4 sm:px-5 py-[clamp(10px,1.6vh,20px)] lg:h-full flex flex-col ${
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

  return (
    <div className={cardClass}>
      {/* No "View all" link here — it was competing with the title for
          this narrow card's width and forcing it to truncate. Announcements
          are still fully reachable via the "Announcements" tile in
          Workspace Tools above. */}
      <div className="flex items-center gap-2 select-none mb-[clamp(6px,1vh,14px)] lg:shrink-0 min-w-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
          <Megaphone className="w-4 h-4" />
        </div>
        <span className={`text-[13px] sm:text-[14px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
          Announcements
        </span>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        {/* Three stat blocks, stacked vertically (not the old horizontal
            3-up strip — this card is narrow, not wide). Sized to their own
            content now (`shrink-0`, was `flex-1` stretching to fill the
            card) — the space that freed up goes to the Last 30 Days
            breakdown below instead of sitting empty. */}
        <div className="flex flex-col gap-[clamp(6px,1vh,10px)] shrink-0">
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
                className="text-[26px] font-black font-mono leading-none"
                style={{ color: stat.value > 0 ? stat.color : theme === "dark" ? "#F8FAFC" : "#1E293B" }}
              >
                {stat.value}
              </span>
              <span className={`text-[11px] font-bold uppercase tracking-wide leading-tight ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                {stat.label}
                <br /> {stat.sub}
              </span>
            </button>
          ))}
        </div>

        {/* Last 30 Days breakdown — fills the space the stat tiles above
            used to stretch into. Total across every type (see the useMemo
            above), then a line each for the three real, selectable types —
            QA Announcement, Product Announcement, Insurance Operations
            (legacy/unreclassified General Announcement rows still count
            toward the total but have no line of their own; see migration
            0056). `justify-center` keeps the rows vertically centered in
            whatever leftover height this card ends up with instead of
            always pinning to the top. */}
        <div className={`mt-[clamp(6px,1vh,10px)] flex-1 min-h-0 flex flex-col justify-center gap-[clamp(6px,1vh,10px)] p-3 rounded-xl border ${
          theme === "dark" ? "border-white/[0.08] bg-white/[0.03]" : "border-stone-200 bg-stone-50/70"
        }`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-[10.5px] font-bold uppercase tracking-wide ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
              Last 30 Days
            </span>
            <span className={`text-xl font-black font-mono leading-none ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
              {last30Total}
            </span>
          </div>
          <div className="space-y-1.5">
            {([
              { label: "QA Announcement", value: last30Qa, color: theme === "dark" ? "#FB7185" : "#BE123C" },
              { label: "Product Announcement", value: last30Product, color: theme === "dark" ? "#A78BFA" : "#7C3AED" },
              { label: "Insurance Operations", value: last30Ops, color: theme === "dark" ? "#2DD4BF" : "#0F766E" },
            ] as const).map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                  <span className={`text-[11px] font-semibold truncate ${theme === "dark" ? "text-stone-300" : "text-stone-700"}`}>
                    {row.label}
                  </span>
                </span>
                <span className="text-[12px] font-black font-mono shrink-0" style={{ color: row.color }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnnouncementCounterCard;
