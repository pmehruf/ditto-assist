/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Helpers for Team Tracker's Session Feedback / Feedback Summary.
 *
 * "Session Notes" is a single field in the UI. It is stored in the existing
 * `meeting_notes` column; older sessions may also carry a separate
 * `discussion_points` value from before the two fields were merged. Nothing
 * is rewritten in the database — both values are combined only for display
 * (and when an old entry is next edited and saved).
 */

/** Combine a session's legacy Discussion Points and Meeting Notes into one
 * Session Notes text, discussion first, separated by a blank line. Line
 * breaks inside each value are kept exactly as typed; empty/whitespace-only
 * parts are skipped. */
export function combineSessionNotes(discussionPoints: string | null | undefined, meetingNotes: string | null | undefined): string {
  return [discussionPoints, meetingNotes]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join("\n\n");
}

/** Normalise a stored meeting date to "yyyy-MM-dd" without going through
 * `new Date()` (which misreads day-month-year text and shifts by timezone).
 * Accepts "yyyy-MM-dd" (optionally followed by a time part) and
 * "dd-MM-yyyy" / "dd/MM/yyyy". Returns null for anything else, including
 * impossible dates such as 31-02-2026. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    match = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
    if (!match) return null;
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  }
  if (m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > daysInMonth) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface FeedbackFilter {
  /** "yyyy-MM-dd" or "" for no lower bound. */
  from: string;
  /** "yyyy-MM-dd" or "" for no upper bound. */
  to: string;
  /** Feedback owner's name, or "" for everyone. */
  owner: string;
}

export const EMPTY_FEEDBACK_FILTER: FeedbackFilter = { from: "", to: "", owner: "" };

export function isFeedbackFilterActive(f: FeedbackFilter): boolean {
  return f.from !== "" || f.to !== "" || f.owner !== "";
}

/** Apply the date range (inclusive, compared as ISO strings) and owner
 * filters. An entry whose date can't be read is excluded only while a date
 * bound is set. */
export function filterFeedbackEntries<T extends { meetingDate: string; authorName: string }>(entries: T[], f: FeedbackFilter): T[] {
  const from = toIsoDate(f.from);
  const to = toIsoDate(f.to);
  return entries.filter((e) => {
    if (f.owner && e.authorName !== f.owner) return false;
    if (from || to) {
      const iso = toIsoDate(e.meetingDate);
      if (!iso) return false;
      if (from && iso < from) return false;
      if (to && iso > to) return false;
    }
    return true;
  });
}

/** Distinct feedback owners, alphabetical. */
export function feedbackOwners(entries: { authorName: string }[]): string[] {
  return [...new Set(entries.map((e) => e.authorName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function feedbackCountLabel(n: number): string {
  return `${n} ${n === 1 ? "feedback" : "feedbacks"}`;
}
