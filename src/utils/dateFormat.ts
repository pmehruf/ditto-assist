/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared DD-MM-YYYY date formatting — the conventional Indian date order.
 * Before this existed, dates were shown two inconsistent (and both
 * "backwards" from an Indian reader's expectation) ways across the app:
 *   1. Raw stored "YYYY-MM-DD" strings (effectiveDate, announcementDate,
 *      validTillDate, createdAt-as-date) rendered directly in JSX.
 *   2. `date.toLocaleDateString()` with no locale argument, which renders
 *      MM/DD/YYYY on any machine/browser defaulting to en-US — silently
 *      locale-dependent, so it could vary by user's device.
 * Both are replaced with the explicit DD-MM-YYYY builders below.
 */

/**
 * Formats a Date (or anything `new Date()` can parse) as DD-MM-YYYY.
 * Returns "" for null/undefined/unparseable input (falling back to the
 * original string for a string input, so a genuinely odd value is never
 * silently swallowed).
 */
export function formatDateDMY(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return typeof input === "string" ? input : "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Converts the app's own plain "YYYY-MM-DD" stored date strings (announcement
 * dates, effective dates, valid-till dates, plain date-only fields) to
 * DD-MM-YYYY via a direct string rewrite rather than a `Date` round-trip —
 * so a bare date-only string (no time component) can never shift by a day
 * from local-timezone parsing. Falls back to `formatDateDMY` for anything
 * that isn't in that exact shape (e.g. a full ISO timestamp).
 */
export function isoDateToDMY(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return formatDateDMY(iso);
  const [, y, mo, d] = m;
  return `${d}-${mo}-${y}`;
}
