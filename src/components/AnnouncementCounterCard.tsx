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
 * The "Announcement Counter" card — sits between QA Performance and the
 * Reference tile grid in the same column (see LookupIntroPage.tsx), at its
 * own natural (`shrink-0`) height, not stretched to fill anything. A single
 * compact row of 3 stat chips (was 3 stacked rows + a separate Last 30 Days
 * breakdown row in an earlier design) rather than something taller —
 * `h-full flex flex-col justify-center` centers that content within
 * whatever height the card ends up at. Padding/chip sizing were given more
 * room than the original compact cut (2026-09) once the Reference tile grid
 * next to it stopped being force-fit to an oversized fixed height (see that
 * grid's own comment in LookupIntroPage.tsx) — this card no longer needs to
 * stay as thin as possible just to avoid outgrowing that shorter neighbor.
 * Same click-to-browse behavior as before (see AnnouncementStatModal.tsx).
 */
export function AnnouncementCounterCard({ theme, allAnnouncements, onOpenStat }: AnnouncementCounterCardProps) {
  const { newThisWeekList, wentLiveThisWeekList, liveTodayList, last30Total } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = fmtDateOnly(today);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    // Trailing 30-day window (today + 29 days back), same "inclusive of
    // today" convention as weekAgo above — keyed off posted
    // (announcementDate) like "New This Week".
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 29);

    const newList: QAAnnouncement[] = [];
    const wentLiveList: QAAnnouncement[] = [];
    const liveTodayList: QAAnnouncement[] = [];
    let last30Total = 0;
    for (const a of allAnnouncements) {
      const posted = parseDateOnly(a.announcementDate);
      if (posted && posted >= weekAgo && posted <= today) newList.push(a);
      const effective = parseDateOnly(a.effectiveDate);
      if (effective && effective >= weekAgo && effective <= today) wentLiveList.push(a);
      if (a.effectiveDate === todayStr) liveTodayList.push(a);
      // Every type (QA, Product, Insurance Operations, and any
      // legacy/unreclassified General Announcement row) counts toward this
      // one total — the redesigned compact card no longer breaks it down
      // by type (see this component's doc comment on why).
      if (posted && posted >= monthAgo && posted <= today) last30Total++;
    }
    return { newThisWeekList: newList, wentLiveThisWeekList: wentLiveList, liveTodayList, last30Total };
  }, [allAnnouncements]);

  const cardClass = `relative rounded-2xl border px-4 sm:px-5 py-4 h-full flex flex-col justify-center gap-2.5 ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  const headerIconColor = theme === "dark" ? "#FB7185" : "#BE123C";
  const headerIconBg = theme === "dark" ? "#FB71851A" : "#BE123C1A";

  const statChips = [
    {
      title: "New This Week",
      label: "New",
      value: newThisWeekList.length,
      list: newThisWeekList,
      icon: <Sparkles className="w-3.5 h-3.5" />,
      color: theme === "dark" ? "#60A5FA" : "#2563EB",
    },
    {
      title: "Went Live This Week",
      label: "Went Live",
      value: wentLiveThisWeekList.length,
      list: wentLiveThisWeekList,
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      color: theme === "dark" ? "#34D399" : "#059669",
    },
    {
      title: "Live Today",
      label: "Live",
      value: liveTodayList.length,
      list: liveTodayList,
      icon: <Zap className="w-3.5 h-3.5" />,
      color: theme === "dark" ? "#22D3EE" : "#0754B7",
    },
  ] as const;

  return (
    <div className={cardClass}>
      {/* Header row — icon + label on the left, Last 30 Days total on the
          right (no "View all" link — Announcements are still fully
          reachable via the "Announcements" tile in Workspace Tools). The
          "Last 30d" figure here is a DIFFERENT window than the "This Week"
          chips below it — kept distinct (not folded into one number) since
          they answer different questions, but see the "This Week" label
          below for why that distinction needs to be visible, not just
          implied. */}
      <div className="flex items-center justify-between gap-2 select-none shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
            <Megaphone className="w-3 h-3" />
          </div>
          <span className={`text-[12px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
            Announcements
          </span>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
          Last 30d <span className={`font-mono font-black ${theme === "dark" ? "text-white" : "text-stone-900"}`}>{last30Total}</span>
        </span>
      </div>

      {/* "This Week" context label — the 3 chips below are New/Went Live
          (trailing 7 days) and Live (today, itself inside that same
          window), all a much shorter window than the "Last 30d" total in
          the header above. Without this label the two numbers sat side by
          side with no visible cue that they're answering different
          questions, reading as if the chips were just a breakdown of the
          Last 30d figure (they aren't — a 30-day total can't be reconciled
          against a 7-day one at a glance). */}
      <span className={`text-[9px] font-bold uppercase tracking-wider shrink-0 -mb-1 ${theme === "dark" ? "text-stone-500" : "text-stone-400"}`}>
        This Week
      </span>

      {/* One compact row of 3 stat chips — deliberately not stacked rows
          (see this component's doc comment) so the card's own natural
          height stays low regardless of how much space it's actually
          given. Wraps on a very narrow viewport rather than truncating. */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {statChips.map((stat) => (
          <button
            key={stat.title}
            type="button"
            onClick={() => onOpenStat(stat.title, [...stat.list])}
            title={`View ${stat.title.toLowerCase()}`}
            className={`relative flex-1 min-w-[100px] flex items-center gap-2 px-2.5 py-2.5 rounded-lg border text-left cursor-pointer transition-all duration-200 hover:-translate-y-0.5 ${
              theme === "dark"
                ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.16]"
                : "border-stone-200 bg-stone-50/70 hover:bg-white hover:border-stone-300 hover:shadow-sm"
            }`}
          >
            <span
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${stat.color}1A`, color: stat.color }}
            >
              {stat.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[10px] font-bold uppercase tracking-wide truncate leading-tight ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                {stat.label}
              </span>
              <span className="relative flex items-center gap-1">
                {stat.label === "Live" && stat.value > 0 && (
                  <span className="flex w-1.5 h-1.5">
                    <span className="absolute inline-flex h-1.5 w-1.5 rounded-full opacity-75 animate-ping" style={{ backgroundColor: stat.color }} />
                    <span className="relative inline-flex rounded-full w-1.5 h-1.5" style={{ backgroundColor: stat.color }} />
                  </span>
                )}
                <span
                  className="text-[15px] font-black font-mono leading-none"
                  style={{ color: stat.value > 0 ? stat.color : theme === "dark" ? "#F8FAFC" : "#1E293B" }}
                >
                  {stat.value}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default AnnouncementCounterCard;
