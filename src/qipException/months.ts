// Month helpers for the QIP Exception page (pure, so they are unit tested).

const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface MonthSlot {
  /** "yyyy-MM" — what the QA data lookup uses. */
  key: string;
  /** "January" — what the document's trend tables show (unchanged wording). */
  name: string;
}

/** `count` consecutive months starting at `from` ("yyyy-MM"), rolling over
 * the year: from 2026-11, count 3 -> November, December, January (2027). */
export function monthRange(from: string, count: number): MonthSlot[] {
  const m = /^(\d{4})-(\d{2})$/.exec(from || "");
  if (!m || !Number.isInteger(count) || count < 1) return [];
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) return [];
  const out: MonthSlot[] = [];
  for (let i = 0; i < count; i++) {
    const idx = month0 + i;
    const y = Number(m[1]) + Math.floor(idx / 12);
    const mi = idx % 12;
    out.push({ key: `${y}-${String(mi + 1).padStart(2, "0")}`, name: NAMES[mi] });
  }
  return out;
}

/** "July 2026" for a "yyyy-MM" key, "" if it is not one. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key || "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return "";
  return `${NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

/** A score from the QA data as the form's text value (at most 2 decimals, no
 * trailing zeros), or "" when there is no score. */
export function scoreText(avg: number | null | undefined): string {
  if (avg === null || avg === undefined || !Number.isFinite(avg)) return "";
  return String(Math.round(avg * 100) / 100);
}
