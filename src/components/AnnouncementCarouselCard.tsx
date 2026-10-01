/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MascotWithFallback } from "./mascots/MascotWithFallback";
import { QAAnnouncement } from "../types/announcements";
import { AnnouncementContent } from "./AnnouncementContent";
import { getDaysDiff, formatOrdinal, getCountdownBadgeConfig, getRatingBadgeConfig } from "../utils/announcementDisplay";

interface AnnouncementCarouselCardProps {
  theme: "light" | "dark";
  activeAnnouncements: QAAnnouncement[];
  noticeIndex: number;
  setNoticeIndex: (updater: number | ((prev: number) => number)) => void;
  slideDirection: "right-to-left" | "left-to-right";
  setSlideDirection: (value: "right-to-left" | "left-to-right") => void;
  /** "View All Announcements" link target — decoupled from a concrete TabId
      union so this component can be dropped onto any page regardless of
      that page's own local tab-id type. */
  onViewAll: () => void;
  /** Extra width/flex classes for the outer card — callers own layout sizing
      (e.g. a fixed sidebar width next to a form column, vs a standalone
      block on a dashboard). Defaults to the original Declarations-page
      sizing. */
  className?: string;
  /** Pixel height to match a sibling column exactly (desktop side-by-side
      layouts only) — pass null/undefined to fall back to a viewport-relative
      clamp() height instead, for standalone placements with no column to
      match. */
  heightPx?: number | null;
}

/**
 * Horizontal QA/General Announcement carousel card — originally lived on the
 * Declarations page next to the PED mapping form. Not currently rendered
 * anywhere: the Declarations page now shows a Declaration Guide section in
 * that area instead, and the Home dashboard has its own, smaller Home-native
 * carousel (HomeAnnouncementCard.tsx) rather than this component, which was
 * designed for a tall standalone sidebar column. Kept (not deleted) as a
 * reusable, still-functional component in case a future page wants this
 * exact large-card treatment; its formatting helpers (countdown/rating
 * badges, ordinal dates) now live in utils/announcementDisplay.ts, shared
 * with HomeAnnouncementCard so both stay in sync.
 */
export function AnnouncementCarouselCard({
  theme,
  activeAnnouncements,
  noticeIndex,
  setNoticeIndex,
  slideDirection,
  setSlideDirection,
  onViewAll,
  className = "w-full lg:w-96 xl:w-[28rem]",
  heightPx = null,
}: AnnouncementCarouselCardProps) {
  const sorted = [...activeAnnouncements];
  if (sorted.length === 0) return null;

  const index = noticeIndex % sorted.length;
  const item = sorted[index];

  const diffDays = getDaysDiff(item.effectiveDate);
  const countdownConfig = getCountdownBadgeConfig(diffDays, item.effectiveDate);
  const ratingConfig = getRatingBadgeConfig(item.rating, theme);

  const annType = item.type || "QA Announcement";

  const renderAnnouncementWithRatings = (text: string) => {
    return (
      <AnnouncementContent
        content={text}
        theme={theme}
        // Every announcement type's inner content card is light-colored in
        // both themes now (QA always was; General Announcement's dark-theme
        // card was just switched to match — see the background block
        // further down), so the rich content always needs light-contrast
        // (dark-text) rendering rather than following the app theme.
        forceLightContrast={true}
      />
    );
  };

  const typeConfig = (() => {
    if (annType === "General Announcement") {
      return {
        containerClass: "shadow-xs",
        containerBg:
          theme === "dark"
            ? "linear-gradient(135deg, rgba(13,148,136,0) 0%, rgba(13,148,136,0.34) 100%), #061a2b"
            : "linear-gradient(135deg, rgba(20,184,166,0.05) 0%, rgba(20,184,166,0.24) 100%), #F6F8FA",
        headerSubColor:
          theme === "dark"
            ? "text-emerald-400 font-extrabold"
            : "text-emerald-900 font-extrabold",
        titleColor:
          theme === "dark"
            ? "text-emerald-300 font-bold"
            : "text-emerald-700 font-bold",
      };
    } else {
      return {
        containerClass:
          theme === "dark"
            ? "shadow-xs"
            : "bg-gradient-to-br from-[#c7d2fe] to-[#a8b6f0] shadow-xs",
        containerBg:
          theme === "dark"
            ? "linear-gradient(135deg, rgba(190,18,60,0) 0%, rgba(220,38,38,0.38) 100%), #061a2b"
            : undefined,
        headerSubColor:
          theme === "dark"
            ? "text-rose-400 font-extrabold"
            : "text-rose-900 font-extrabold",
        titleColor:
          theme === "dark"
            ? "text-rose-300 font-bold"
            : "text-rose-700 font-bold",
      };
    }
  })();

  const containerStyle = typeConfig.containerClass;
  const containerBg = typeConfig.containerBg;

  const motionVariants = {
    enter: (dir: "right-to-left" | "left-to-right") => ({
      x: dir === "right-to-left" ? 180 : -180,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: "right-to-left" | "left-to-right") => ({
      x: dir === "right-to-left" ? -180 : 180,
      opacity: 0,
    }),
  };

  return (
    <div
      style={{
        height: heightPx ? `${heightPx}px` : "clamp(380px, 55vh, 650px)",
        maxHeight: heightPx ? `${heightPx}px` : "clamp(380px, 55vh, 650px)",
        paddingBottom: "8px",
        border: "none",
        ...(containerBg ? { background: containerBg } : {}),
      }}
      className={`p-6 sm:p-8 flex flex-col gap-4 select-none transition-all duration-300 flex-shrink-0 overflow-hidden relative rounded-2xl ${containerStyle} ${className}`}
    >
      {/* UPPER HEADER BAR (Row 1 of Layout) */}
      <div
        style={{
          paddingTop: "0px",
          marginTop: "0px",
          marginBottom: "0px",
        }}
        className="flex flex-row items-center justify-between gap-3 w-full"
      >
        <div className="text-left flex flex-col justify-center">
          <span
            style={{
              paddingLeft: "0px",
              paddingBottom: "1.5px",
              paddingTop: "1.5px",
              marginTop: "0px",
              marginBottom: "0px",
            }}
            className="inline-block text-[10px] leading-none font-black uppercase tracking-widest px-2.5 py-1 text-[#1A365D] dark:text-[#D7E5FF] w-fit"
          >
            Updates
          </span>
          <span
            className={`block text-[15px] leading-[18px] font-black mt-1 ${
              theme === "light" &&
              annType !== "General Announcement"
                ? "text-[#0f2942]"
                : "bg-clip-text text-transparent"
            }`}
            style={
              theme === "light" &&
              annType !== "General Announcement"
                ? undefined
                : { backgroundImage: "var(--gradient-heading)" }
            }
          >
            {annType === "General Announcement"
              ? "Common Announcements"
              : "QA Announcements"}
          </span>
        </div>

        {/* Badges on Top Right */}
        <div className="flex flex-wrap items-center gap-1.5 justify-end">
          {item.effectiveDate && (
            <span
              className={`text-[10px] px-2 py-1 tracking-wider whitespace-nowrap flex items-center justify-center font-extrabold h-6 rounded ${countdownConfig.classes}`}
            >
              {countdownConfig.text}
            </span>
          )}
          {item.rating !== undefined && item.rating !== 0 && (
            <span
              className={`text-[10px] px-2 py-1 tracking-wide rounded whitespace-nowrap flex items-center justify-center font-extrabold h-6 ${ratingConfig.classes}`}
            >
              {ratingConfig.text}
            </span>
          )}
        </div>
      </div>

      {/* HORIZONTAL SHARP DIVIDER */}
      <div className="border-t border-[#4E6981] dark:border-white/[0.08] w-full"></div>

      {/* BODY CONTENT (Row 2 of Layout) — secondary card */}
      <div
        style={{
          // Both announcement types now show a light inner content card
          // regardless of theme (dark theme keeps its dark OUTER card —
          // only this inner card goes light, matching QA's card, which has
          // always done this). See the text-color overrides below this
          // block for the corresponding readability fix.
          background:
            annType === "General Announcement"
              ? theme === "dark"
                ? "linear-gradient(135deg, #dbeafe, #bfdbfe)"
                : "#EDF6F3"
              : theme === "dark"
                ? "linear-gradient(135deg, #dbeafe, #bfdbfe)"
                : "#ffffff",
          paddingTop: "10px",
          paddingBottom: "8px",
          paddingLeft: "12px",
          paddingRight: "10px",
          marginTop: "0px",
          marginBottom: "0px",
          borderRadius: "16px",
          position: "relative",
          border:
            annType === "General Announcement"
              ? theme === "dark"
                ? "1px solid #93c5fd"
                : "1px solid #A9C9C2"
              : theme === "dark"
                ? "1px solid #93c5fd"
                : "1px solid #dbe0f5",
          flexGrow: 1,
          minHeight: "170px",
        }}
        className="flex flex-row items-start justify-between gap-3 md:gap-4 self-stretch w-full min-w-0"
      >
        {/* Left Text Block */}
        <div className="flex-grow flex-1 min-w-0 text-left flex flex-col justify-start h-full">
          {/* Announcement Title */}
          <span
            style={{
              fontFamily: "system-ui",
              // Always the light-card value now — this card's background is
              // light in both themes (see the background block above).
              color: annType === "General Announcement" ? "#134E4A" : "#0f2942",
              marginTop: "0px",
              marginBottom: "0px",
            }}
            className="text-xs md:text-[13px] font-bold tracking-tight uppercase mb-1.5 block"
          >
            {item.category || "General Announcement"}
          </span>

          {/* General Announcement meta: optional "From" team */}
          {annType === "General Announcement" && item.from && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
              <span
                className="text-[9px] font-semibold"
                style={{
                  // Always the light-card value — see the background block above.
                  color: "#0754B7",
                }}
              >
                From: {item.from}
              </span>
            </div>
          )}

          <div
            style={{
              overflowY: "auto",
              overflowX: "hidden",
              scrollbarWidth: "thin",
              // "on-dark" scrollbar styling no longer applies to General
              // Announcement — its inner card is light in both themes now.
              scrollbarColor: "#64748B transparent",
            }}
            className="announcement-scroll relative w-full flex-1 min-h-0 flex flex-col justify-start bg-transparent pr-1 overflow-x-hidden"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={item.id}
                custom={slideDirection}
                variants={motionVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  type: "spring",
                  stiffness: 220,
                  damping: 26,
                }}
                className="w-full text-left"
              >
                <div
                  className="text-[12.5px] font-medium leading-relaxed text-stone-850"
                  style={{
                    maxWidth: "100%",
                    fontFamily: "system-ui",
                    marginRight: "0px",
                    // Always the light-card value now — see the background block above.
                    color: annType === "General Announcement" ? "#1E293B" : "#0f2942",
                  }}
                >
                  {/* Desktop/MD Floated Spacer to push mascot to bottom right */}
                  <div
                    className="hidden md:block"
                    style={{
                      float: "right",
                      height: "84px",
                      width: "0px",
                    }}
                  />
                  {/* Floated Mascot Placeholder (Invisible Spacer) inside the text flow */}
                  <div
                    className="hidden md:block"
                    style={{
                      float: "right",
                      clear: "right",
                      width: "78px",
                      height: "91px",
                      marginLeft: "12px",
                      marginRight: "-7px",
                      marginTop: "6px",
                      marginBottom:
                        sorted.length > 1 ? "-11px" : "2px",
                    }}
                  />
                  {renderAnnouncementWithRatings(item.announcement)}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Posted Date — footer, pinned to the bottom-left of the secondary card */}
          {item.announcementDate && (
            <div className="shrink-0 mt-1 pt-1 border-t border-dashed border-stone-300/40 dark:border-white/10">
              <span
                className="text-[9.5px] font-semibold tracking-wide"
                style={{
                  // Always the light-card value — see the background block above.
                  color: "#57534e",
                }}
              >
                Posted {formatOrdinal(item.announcementDate)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Mascot — anchored to the primary card's bottom-right corner */}
      <div
        className="hidden md:flex items-end justify-center shrink-0 py-1 select-none absolute"
        style={{
          width: "130px",
          height: "140px",
          bottom: sorted.length > 1 ? "0px" : "4px",
          right: "2px",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            marginRight: "-20px",
            paddingLeft: "0px",
            width: "97px",
            height: "113px",
            marginLeft: "20px",
            marginTop: "0px",
            marginBottom: "2px",
          }}
          className="flex items-end justify-center relative pointer-events-auto"
        >
          <MascotWithFallback
            src="/assets/.aistudio/announcement-mascot.png"
            alt="Announcement Mascot"
            className="h-full w-auto object-contain transition-all duration-300 transform-gpu hover:scale-105 pointer-events-none select-none"
            type="notepad"
            style={{ maxHeight: "100%", maxWidth: "130px" }}
          />
        </div>
      </div>

      {/* View All — bottom-left corner of the primary card */}
      <button
        type="button"
        onClick={onViewAll}
        className={`absolute z-10 text-[10.5px] font-bold tracking-tight whitespace-nowrap cursor-pointer underline underline-offset-2 decoration-1 transition-colors ${
          theme === "dark"
            ? "text-stone-300 hover:text-stone-100 decoration-stone-300/50"
            : "text-stone-500 hover:text-stone-700 decoration-stone-400/50"
        }`}
        style={{
          bottom: sorted.length > 1 ? "14px" : "18px",
          left: "14px",
        }}
        title="Browse every posted announcement"
      >
        View All Announcements
      </button>

      {/* PAGE INDICATOR & ARROWS (Row 3 of Layout) */}
      {sorted.length >= 1 && (
        <div
          style={{
            paddingTop: "4px",
            paddingBottom: "2px",
            marginTop: "2px",
          }}
          className="flex flex-col items-center justify-center gap-2 border-t border-dashed border-[#4E6981] dark:border-white/[0.08] w-full shrink-0"
        >
          <div className="flex flex-wrap items-center justify-center gap-0.5 select-none max-w-full px-2">
            {sorted.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setSlideDirection(
                    idx > noticeIndex
                      ? "right-to-left"
                      : "left-to-right",
                  );
                  setNoticeIndex(idx);
                }}
                className="shrink-0 py-1 px-[2px] cursor-pointer group leading-none"
                title={`Go to page ${idx + 1}`}
              >
                <span
                  className={`block h-2.5 rounded-[3px] transition-all duration-300 ${
                    idx === noticeIndex
                      ? theme === "dark"
                        ? "w-2.5 bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]"
                        : "w-2.5 bg-blue-600 shadow-[0_0_5px_rgba(37,99,235,0.4)]"
                      : theme === "dark"
                        ? "w-[3px] bg-stone-600 group-hover:bg-stone-500"
                        : "w-[3px] bg-stone-400 group-hover:bg-stone-500"
                  }`}
                />
              </button>
            ))}
          </div>

          <div
            style={{
              height: "30px",
            }}
            className="flex items-center gap-2"
          >
            <button
              onClick={() => {
                setSlideDirection("left-to-right");
                setNoticeIndex(
                  (prev) =>
                    (prev - 1 + sorted.length) % sorted.length,
                );
              }}
              style={{
                width: "28px",
                height: "28px",
                backgroundColor:
                  theme === "dark"
                    ? "var(--surface-tint)"
                    : "var(--accent-subtle-bg)",
              }}
              className={`hover:scale-[1.03] active:scale-[0.97] rounded-lg transition-all cursor-pointer flex items-center justify-center border ${
                theme === "dark"
                  ? "border-white/[0.08]"
                  : "border-slate-200 shadow-xs"
              }`}
              title="Previous Announcement"
            >
              <ChevronLeft
                className="w-[18px] h-[18px]"
                style={{ color: "var(--accent)" }}
              />
            </button>
            <button
              onClick={() => {
                setSlideDirection("right-to-left");
                setNoticeIndex(
                  (prev) => (prev + 1) % sorted.length,
                );
              }}
              style={{
                width: "28px",
                height: "28px",
                backgroundColor:
                  theme === "dark"
                    ? "var(--surface-tint)"
                    : "var(--accent-subtle-bg)",
              }}
              className={`hover:scale-[1.03] active:scale-[0.97] rounded-lg transition-all cursor-pointer flex items-center justify-center border ${
                theme === "dark"
                  ? "border-white/[0.08]"
                  : "border-slate-200 shadow-xs"
              }`}
              title="Next Announcement"
            >
              <ChevronRight
                className="w-[18px] h-[18px]"
                style={{ color: "var(--accent)" }}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
