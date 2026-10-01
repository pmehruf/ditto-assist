/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";
import { CustomDatePicker } from "./CustomDatePicker";

/**
 * A themed date field whose VISIBLE text is always DD-MM-YYYY, no matter
 * what date format the visitor's browser/OS locale defaults to, and whose
 * calendar popup matches the app's own theme instead of the browser's.
 *
 * History: this originally wrapped a real, fully transparent
 * `<input type="date">` stretched over a styled display `<div>` — the
 * native input's own text is locale-dependent and can't be restyled, so
 * only the popup's underlying value was used, with DD-MM-YYYY painted on
 * top. That fixed the text-format inconsistency but left the calendar
 * POPUP itself fully native — un-themeable beyond a `color-scheme:
 * dark`/`light` nudge (see index.css) and inconsistent across browsers.
 *
 * 2026-09 theme pass: rebuilt on CustomDatePicker (the date-field
 * counterpart to CustomSelect.tsx — same portal/positioning architecture,
 * same design tokens), which replaces the native input and its popup
 * entirely with a themed trigger + calendar dropdown. This component is now
 * a thin prop-forwarding wrapper kept only so its existing call sites
 * (Announcement form, Announcements archive, Activity Log, QA Dashboard,
 * Access Control Center's Directory, Porting Assist) don't need to change
 * anything — `displayClassName` still styles the visible control exactly as
 * before, `icon` still renders as a trailing glyph, `value`/`onChange` still
 * use the same plain "YYYY-MM-DD" string every caller already passes.
 */
export function DateInputDMY({
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  title,
  placeholder = "DD-MM-YYYY",
  displayClassName,
  icon,
  wrapperClassName = "relative",
  theme,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  /** Full class list for the VISIBLE control — callers keep their own
   * per-theme background/border/sizing exactly as before. */
  displayClassName: string;
  /** Optional trailing icon (a calendar/clock glyph, matching whatever the
   * call site used before this was extracted). */
  icon?: ReactNode;
  wrapperClassName?: string;
  /** Every existing call site already computes its own dark/light boolean
   * for `displayClassName` but never had to pass an explicit theme prop
   * (the underlying native input didn't need one) — accepted here as
   * optional (defaulting to dark-styled) so this is non-breaking, but every
   * call site should pass its real theme so the calendar POPUP (which does
   * need to know, unlike the old native input) matches the control around
   * it. Typed as a loose `string` (not CustomDatePicker's own strict
   * "light" | "dark") because a couple of call sites carry `theme` through
   * their own component tree as a plain `string` prop — normalized below
   * rather than tightening those unrelated prop types. */
  theme?: string;
}) {
  return (
    <CustomDatePicker
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      required={required}
      disabled={disabled}
      title={title}
      placeholder={placeholder}
      theme={theme === "light" ? "light" : "dark"}
      triggerClassName={displayClassName}
      icon={icon}
      wrapperClassName={wrapperClassName}
    />
  );
}
