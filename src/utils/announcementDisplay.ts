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

/** "Team" — QA Announcements are simply labeled by their type; General
 * Announcements show whatever team the author entered (Product, Medical,
 * etc. — QAAnnouncementForm's "From" field, mapped to `item.from`). */
export function teamLabel(item: QAAnnouncement): string {
  if (item.type === "General Announcement") return item.from || "—";
  return "QA Announcement";
}
