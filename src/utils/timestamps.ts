/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function parseGlobalLogTimestamp(ts: string): Date | null {
  if (!ts) return null;
  // Try standard ISO or direct parsing first
  const parsedDirect = Date.parse(ts);
  if (!isNaN(parsedDirect)) {
    return new Date(parsedDirect);
  }
  // Try custom formatting parser with commas (e.g. "11:45 PM, 06/06/2026")
  const parts = ts.split(",");
  const dateStr = parts[1] ? parts[1].trim() : parts[0].trim();
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }
  const dParts = dateStr.split(/[-/.]/);
  if (dParts.length === 3) {
    const first = parseInt(dParts[0]);
    const second = parseInt(dParts[1]);
    const third = parseInt(dParts[2]);
    if (third > 1000) {
      if (first > 12) {
        return new Date(third, second - 1, first);
      } else {
        return new Date(third, first - 1, second);
      }
    } else if (first > 1000) {
      return new Date(first, second - 1, third);
    }
  }
  return null;
}

export function formatDisplayTimestamp(ts: string): string {
  if (!ts) return "";
  const dateObj = parseGlobalLogTimestamp(ts);
  if (!dateObj) return ts;
  // DD-MM-YYYY built explicitly (not `toLocaleDateString()`, whose
  // no-locale-argument form renders MM/DD/YYYY on an en-US machine/browser)
  // so this always reads in the conventional Indian date order regardless
  // of the viewer's device locale.
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = dateObj.getFullYear();
  return `${dd}-${mm}-${yyyy} ` + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact "15 Jul 2026 · 05:30" form — same parsing as formatDisplayTimestamp
 * above, just a friendlier month-abbreviated rendering for space-constrained,
 * metadata-style surfaces (e.g. the profile card popover in App.tsx) where
 * the numeric DD-MM-YYYY form reads as denser/more form-like than wanted. */
export function formatCompactTimestamp(ts: string): string {
  if (!ts) return "";
  const dateObj = parseGlobalLogTimestamp(ts);
  if (!dateObj) return ts;
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mon = MONTH_ABBR[dateObj.getMonth()];
  const yyyy = dateObj.getFullYear();
  const time = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${dd} ${mon} ${yyyy} · ${time}`;
}
