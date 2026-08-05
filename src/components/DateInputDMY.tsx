/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";
import { isoDateToDMY } from "../utils/dateFormat";

/**
 * A `<input type="date">` whose VISIBLE text is always DD-MM-YYYY, no matter
 * what date format the visitor's browser/OS locale defaults to.
 *
 * Why this exists: a native date input's displayed text is controlled
 * entirely by the browser using the user's locale — it can't be overridden
 * via the `value` attribute (which the HTML spec requires to stay
 * "YYYY-MM-DD") or via CSS in a reliable, cross-browser way. Left alone, the
 * same app shows "07/29/2026" to a browser defaulting to en-US and
 * "29-07-2026" to one defaulting to en-GB — exactly the inconsistency
 * reported across the Announcement form, the Announcements archive's date
 * filter, Activity Log, and the QA Dashboard's date filters.
 *
 * The fix (first proven out ad-hoc in MyActivityPage.tsx's own date filter,
 * extracted here as the one shared implementation): render the REAL native
 * `<input type="date">` fully transparent and stretched over the control
 * (so typing, the calendar-picker button, keyboard nav, and min/max
 * validation all still work exactly as before), then paint a plain `<div>`
 * on top showing the value already reformatted to DD-MM-YYYY. The visible
 * div is `pointer-events-none` so every click/keystroke still reaches the
 * real input underneath.
 */
export function DateInputDMY({
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  title,
  placeholder = "dd-mm-yyyy",
  displayClassName,
  icon,
  wrapperClassName = "relative",
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  /** Full class list for the VISIBLE display box — callers keep their own
   * per-theme background/border/sizing exactly as before. */
  displayClassName: string;
  /** Optional trailing icon (a calendar/clock glyph, matching whatever the
   * call site used before this was extracted). */
  icon?: ReactNode;
  wrapperClassName?: string;
}) {
  return (
    <div className={wrapperClassName}>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        title={title}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            (e.currentTarget as HTMLInputElement).showPicker();
          } catch (_) {}
        }}
        className={`absolute inset-0 opacity-0 w-full h-full z-10 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      />
      <div className={displayClassName}>
        <span>{value ? isoDateToDMY(value) : placeholder}</span>
        {icon}
      </div>
    </div>
  );
}
