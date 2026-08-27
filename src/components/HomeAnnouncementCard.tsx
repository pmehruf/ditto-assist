/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Megaphone, ArrowUpRight } from "lucide-react";
import { QAAnnouncement } from "../types/announcements";
import { AnnouncementContent } from "./AnnouncementContent";
import {
  getDaysDiff,
  formatOrdinal,
  getCountdownBadgeConfig,
  getRatingBadgeConfig,
} from "../utils/announcementDisplay";

interface HomeAnnouncementCardProps {
  theme: "light" | "dark";
  activeAnnouncements: QAAnnouncement[];
  noticeIndex: number;
  setNoticeIndex: (updater: number | ((prev: number) => number)) => void;
  slideDirection: "right-to-left" | "left-to-right";
  setSlideDirection: (value: "right-to-left" | "left-to-right") => void;
  onViewAll: () => void;
}

/**
 * Home dashboard's own announcement carousel — the Quick Peek section's
 * primary announcement surface (replacing the old title-only "Latest
 * Updates" list). Consumes the exact same shared state App.tsx already
 * drives the Declaration Assist carousel with (activeAnnouncements,
 * noticeIndex/setNoticeIndex, slideDirection/setSlideDirection) and reuses
 * AnnouncementContent (the one sanitized-HTML renderer every announcement
 * surface in the app shares) plus the countdown/rating badge helpers
 * extracted to utils/announcementDisplay.ts — no second data source, no
 * second rotation timer (App.tsx's existing effect already advances
 * noticeIndex on a dynamic ~5s+ interval regardless of which page reads it).
 *
 * Deliberately its own, compact, Home-native visual treatment — NOT a copy
 * of AnnouncementCarouselCard.tsx (that component's gradient background,
 * mascot artwork, and ~400-650px height belong to the Declaration Assist
 * page and stay there conceptually, just no longer rendered on that page —
 * see LookupPage.tsx, which now shows InstructionManualPanel in that slot
 * instead). This card matches the same bordered/rounded-2xl card language
 * every other Home Quick Peek tile uses (see QaPerformancePeek.tsx's
 * `cardClass`).
 */
export function HomeAnnouncementCard({
  theme,
  activeAnnouncements,
  noticeIndex,
  setNoticeIndex,
  slideDirection,
  setSlideDirection,
  onViewAll,
}: HomeAnnouncementCardProps) {
  const cardClass = `rounded-2xl border px-4 sm:px-5 py-[clamp(10px,1.6vh,20px)] flex flex-col ${
    theme === "dark" ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/60 border-stone-300"
  }`;

  const headerIconColor = theme === "dark" ? "#FB7185" : "#BE123C";
  const headerIconBg = theme === "dark" ? "#FB71851A" : "#BE123C1A";

  if (activeAnnouncements.length === 0) {
    return (
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-[clamp(6px,1vh,14px)] gap-2">
          <div className="flex items-center gap-2 select-none min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
              <Megaphone className="w-4 h-4" />
            </div>
            <span className={`text-[13px] sm:text-[14px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
              Announcements
            </span>
          </div>
        </div>
        <div className={`flex-1 flex flex-col items-center justify-center text-center py-3 gap-1.5 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
          <Megaphone className="w-5 h-5 opacity-50" />
          <span className="text-[13px] font-medium">No active announcements right now.</span>
        </div>
      </div>
    );
  }

  const sorted = activeAnnouncements;
  const index = noticeIndex % sorted.length;
  const item = sorted[index];
  const isGeneral = (item.type || "QA Announcement") === "General Announcement";

  const diffDays = item.effectiveDate ? getDaysDiff(item.effectiveDate) : null;
  const countdownConfig = diffDays !== null && item.effectiveDate ? getCountdownBadgeConfig(diffDays, item.effectiveDate) : null;
  const ratingConfig = item.rating !== undefined && item.rating !== 0 ? getRatingBadgeConfig(item.rating, theme) : null;

  const motionVariants = {
    enter: (dir: "right-to-left" | "left-to-right") => ({ x: dir === "right-to-left" ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: "right-to-left" | "left-to-right") => ({ x: dir === "right-to-left" ? -40 : 40, opacity: 0 }),
  };

  const goTo = (idx: number) => {
    setSlideDirection(idx > noticeIndex ? "right-to-left" : "left-to-right");
    setNoticeIndex(idx);
  };

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-[clamp(6px,1vh,14px)] gap-2">
        <div className="flex items-center gap-2 select-none min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: headerIconBg, color: headerIconColor }}>
            <Megaphone className="w-4 h-4" />
          </div>
          <span className={`text-[13px] sm:text-[14px] font-black uppercase tracking-wide truncate ${theme === "dark" ? "text-white" : "text-stone-900"}`}>
            Announcements
          </span>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className={`flex items-center gap-0.5 text-[12px] font-bold uppercase tracking-wide cursor-pointer transition-colors shrink-0 ${
            theme === "dark" ? "text-stone-400 hover:text-white" : "text-stone-500 hover:text-stone-800"
          }`}
        >
          View all
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {/* Category + badges row */}
      <div className="flex items-center justify-between gap-2 mb-[clamp(4px,0.8vh,8px)] flex-wrap">
        <span className={`text-[11px] font-bold uppercase tracking-wide truncate ${isGeneral ? (theme === "dark" ? "text-emerald-400" : "text-emerald-700") : (theme === "dark" ? "text-rose-400" : "text-rose-700")}`}>
          {item.category || (isGeneral ? "General Announcement" : "QA Announcement")}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {countdownConfig && (
            <span className={`text-[9.5px] px-1.5 py-0.5 tracking-wide whitespace-nowrap rounded font-extrabold ${countdownConfig.classes}`}>
              {countdownConfig.text}
            </span>
          )}
          {ratingConfig && (
            <span className={`text-[9.5px] px-1.5 py-0.5 tracking-wide whitespace-nowrap rounded font-extrabold ${ratingConfig.classes}`}>
              {ratingConfig.text}
            </span>
          )}
        </div>
      </div>

      {/* Content — fills whatever vertical room the card actually has
          (`flex-1 min-h-0`, the correct way to bound a scrollable region
          inside a flex column: a flex item WITH min-height:0 gets a real,
          definite height from the flex algorithm, unlike a plain block
          child of a min/max-height-only parent — see this component's own
          earlier bug where that gave the browser nothing to size against
          and content silently got clipped instead of scrolling) and only
          scrolls internally once an announcement is too long even for the
          card's now much larger (full page height) content area. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto pr-1"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: theme === "dark" ? "#475569 transparent" : "#94A3B8 transparent",
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={item.id}
            custom={slideDirection}
            variants={motionVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          >
            <AnnouncementContent content={item.announcement} theme={theme} />
          </motion.div>
        </AnimatePresence>
      </div>

      {item.announcementDate && (
        <div className={`text-[10px] font-semibold mt-[clamp(3px,0.6vh,6px)] ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>
          Posted {formatOrdinal(item.announcementDate)}
          {isGeneral && item.from ? ` · From: ${item.from}` : ""}
        </div>
      )}

      {/* Position + navigation — omitted entirely for a single-item feed,
          same convention AnnouncementCarouselCard uses. */}
      {sorted.length > 1 && (
        <div className="flex items-center justify-between gap-2 mt-[clamp(4px,0.8vh,10px)] pt-[clamp(4px,0.8vh,8px)] border-t border-dashed" style={{ borderColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(168,162,158,0.35)" }}>
          <div className="flex flex-wrap items-center gap-1 select-none">
            {sorted.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => goTo(idx)}
                className="shrink-0 py-1 px-[1.5px] cursor-pointer group leading-none"
                title={`Go to announcement ${idx + 1}`}
              >
                <span
                  className={`block h-[5px] rounded-full transition-all duration-300 ${
                    idx === noticeIndex
                      ? theme === "dark"
                        ? "w-4 bg-cyan-400"
                        : "w-4 bg-blue-600"
                      : theme === "dark"
                        ? "w-[5px] bg-stone-600 group-hover:bg-stone-500"
                        : "w-[5px] bg-stone-400 group-hover:bg-stone-500"
                  }`}
                />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => goTo((noticeIndex - 1 + sorted.length) % sorted.length)}
              style={{ backgroundColor: theme === "dark" ? "var(--surface-tint)" : "var(--accent-subtle-bg)" }}
              className={`w-6 h-6 rounded-md transition-all cursor-pointer flex items-center justify-center border hover:scale-[1.05] active:scale-[0.95] ${
                theme === "dark" ? "border-white/[0.08]" : "border-slate-200"
              }`}
              title="Previous announcement"
            >
              <ChevronLeft className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
            </button>
            <button
              type="button"
              onClick={() => goTo((noticeIndex + 1) % sorted.length)}
              style={{ backgroundColor: theme === "dark" ? "var(--surface-tint)" : "var(--accent-subtle-bg)" }}
              className={`w-6 h-6 rounded-md transition-all cursor-pointer flex items-center justify-center border hover:scale-[1.05] active:scale-[0.95] ${
                theme === "dark" ? "border-white/[0.08]" : "border-slate-200"
              }`}
              title="Next announcement"
            >
              <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
