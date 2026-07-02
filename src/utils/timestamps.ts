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
  return dateObj.toLocaleDateString() + " " + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
