/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { QAAnnouncement } from "../types/announcements";

/**
 * Severity (the "Rating" field, QA Announcements only) color scale — 1 (red)
 * through 4 (green), matching the 4-point scale QAAnnouncementForm's Rating
 * select offers (0 means "unselected/no rating" and never reaches a badge —
 * every call site guards on `rating > 0` first).
 *
 * Shared by the Announcement Manager's table and the advisor-facing
 * Announcements archive so both use the exact same scale.
 */
export function ratingColorClasses(rating: number, dark: boolean): string {
  switch (rating) {
    case 1:
      return dark ? "bg-red-500/10 text-red-500 border-red-500/25" : "bg-red-50 text-red-700 border-red-200";
    case 2:
      return dark ? "bg-orange-500/10 text-orange-500 border-orange-500/25" : "bg-orange-50 text-orange-700 border-orange-200";
    case 3:
      return dark ? "bg-amber-500/10 text-amber-500 border-amber-500/25" : "bg-amber-50 text-amber-700 border-amber-200";
    default:
      // 4 and any higher/unexpected value fall back to the "best" end of the scale.
      return dark ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25" : "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
}

/** "Team" — QA Announcements are simply labeled by their type. Legacy
 * (unreclassified) General Announcement rows show whatever team the author
 * entered (Product, Medical, etc. — QAAnnouncementForm's old "From" field,
 * mapped to `item.from`); Product Announcement / Insurance Operations rows
 * no longer collect a "From" value — the type itself is now the label. */
export function teamLabel(item: QAAnnouncement): string {
  if (item.type === "General Announcement") return item.from || "—";
  return item.type || "QA Announcement";
}

/**
 * Below: shared presentational helpers for rendering a single announcement's
 * "chrome" (countdown badge, rating badge, ordinal date) — extracted from
 * AnnouncementCarouselCard.tsx so the Home dashboard's own announcement card
 * (HomeAnnouncementCard.tsx) can reuse the exact same formatting/labeling
 * logic instead of re-deriving it. Pure functions only, no rendering — each
 * caller still owns its own visual treatment (colors, layout).
 */

export function getDaysDiff(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateStr);
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function formatOrdinal(dStr: string): string {
  const d = new Date(dStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const day = d.getDate();
  const month = months[d.getMonth()];
  let suffix = "th";
  if (day === 1 || day === 21 || day === 31) suffix = "st";
  else if (day === 2 || day === 22) suffix = "nd";
  else if (day === 3 || day === 23) suffix = "rd";
  return `${day}${suffix} ${month}`;
}

const countdownClasses = "bg-[#de7c50] text-black border border-[#c26a3d] font-extrabold";

export function getCountdownBadgeConfig(diff: number, effectiveDate: string): { text: string; classes: string } {
  if (diff === 0) return { text: "Effective today", classes: countdownClasses };
  if (diff === 1) return { text: "Live in 1 day", classes: countdownClasses };
  if (diff === 2) return { text: "Live in 2 days", classes: countdownClasses };
  if (diff === 3) return { text: "Live in 3 days", classes: countdownClasses };
  if (diff > 3 && diff <= 7) return { text: `Live in ${diff} days`, classes: countdownClasses };
  if (diff < 0) {
    const absDiff = Math.abs(diff);
    const dayLabel = absDiff === 1 ? "day" : "days";
    return { text: `Active since ${absDiff} ${dayLabel}`, classes: countdownClasses };
  }
  return { text: `Active from ${formatOrdinal(effectiveDate)}`, classes: countdownClasses };
}

export function getRatingBadgeConfig(rating: number | undefined, theme: "light" | "dark"): { text: string; classes: string } {
  if (rating === undefined || rating === 0) {
    return {
      text: "No Rating",
      classes:
        theme === "dark"
          ? "bg-stone-500/10 text-stone-400 border border-stone-500/15 font-extrabold"
          : "bg-stone-55 text-stone-600 border border-stone-205 font-extrabold",
    };
  }
  if (rating === 1) return { text: "Rating 1", classes: "bg-[#c1665c] text-black border border-[#a84f46] font-extrabold" };
  if (rating === 2) return { text: "Rating 2", classes: "bg-[#de7c50] text-black border border-[#c26a3d] font-extrabold" };
  if (rating === 3) return { text: "Rating 3", classes: "bg-[#d1a34a] text-black border border-[#b3872f] font-extrabold" };
  if (rating === 4) return { text: "Rating 4", classes: "bg-[#94b06c] text-black border border-[#7a9552] font-extrabold" };
  if (rating === -1) {
    return {
      text: "Highlight",
      classes:
        theme === "dark"
          ? "bg-purple-500/10 text-purple-400 border border-purple-500/20 font-extrabold"
          : "bg-purple-55 text-purple-700 border border-purple-200 font-extrabold",
    };
  }
  return { text: `Rating ${rating}`, classes: "bg-[#6fa08c] text-black border border-[#57806e] font-extrabold" };
}

export function announcementTypeLabel(item: QAAnnouncement): string {
  return (item.type || "QA Announcement") === "General Announcement" ? "Common Announcements" : "QA Announcements";
}
