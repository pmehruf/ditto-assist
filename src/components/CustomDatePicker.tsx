/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { CustomSelect, type CustomSelectOption } from "./CustomSelect";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface DateParts {
  y: number;
  m: number; // 0-11
  d: number;
}

/**
 * Parses the app's own plain "YYYY-MM-DD" date strings into {y, m, d} via a
 * direct regex/string split — never `new Date(isoString)` — for the exact
 * reason dateFormat.ts's isoDateToDMY does the same: a bare date-only string
 * fed through `new Date()` gets interpreted as UTC midnight and can render
 * as the PREVIOUS calendar day in a timezone behind UTC. Every date built or
 * compared in this component stays in plain (y, m, d) integer form; the only
 * place a real `Date` object is ever constructed is via the local
 * `new Date(y, m, d)` 3-arg form (never the 1-arg string-parsing form),
 * which is timezone-safe because it takes plain calendar components, not a
 * string to interpret.
 */
function parseISOParts(iso: string | null | undefined): DateParts | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function partsToISO(p: DateParts): string {
  return `${String(p.y).padStart(4, "0")}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function partsToDMY(p: DateParts): string {
  return `${String(p.d).padStart(2, "0")}-${String(p.m + 1).padStart(2, "0")}-${p.y}`;
}

function todayParts(): DateParts {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

/** -1 if a<b, 0 if equal, 1 if a>b — plain calendar-date comparison. */
function compareParts(a: DateParts, b: DateParts): number {
  if (a.y !== b.y) return a.y < b.y ? -1 : 1;
  if (a.m !== b.m) return a.m < b.m ? -1 : 1;
  if (a.d !== b.d) return a.d < b.d ? -1 : 1;
  return 0;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function clampToRange(p: DateParts, min: DateParts | null, max: DateParts | null): DateParts {
  if (min && compareParts(p, min) < 0) return min;
  if (max && compareParts(p, max) > 0) return max;
  return p;
}

/**
 * 2026-09: typing a date directly, digits only, no dashes needed (e.g.
 * "28112025" for 28-11-2025) -- the calendar-only interaction was the one
 * thing the old native <input type="date"> could still do that this
 * couldn't. `typedBuffer` (component state) holds only the raw digits typed
 * so far (0-8 chars); these two helpers format that buffer for display and
 * reject a digit that can already never lead to a valid day/month (e.g. a
 * day starting "4"-"9", or "32"-"99"; a month starting "2"-"9", or "13"-
 * "99") as it's typed, rather than only catching the mistake once all 8
 * digits are in. A day that's wrong for its specific month (e.g. 30 Feb)
 * can't be caught this way -- that's checked once the date is complete, in
 * the keydown handler below.
 */
function formatTypedDigits(digits: string): string {
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  let out = d;
  if (m) out += "-" + m;
  if (y) out += "-" + y;
  return out;
}

function isValidPartialDate(digits: string): boolean {
  if (digits.length >= 1 && digits[0] > "3") return false;
  if (digits.length >= 2) {
    const day = Number(digits.slice(0, 2));
    if (day < 1 || day > 31) return false;
  }
  if (digits.length >= 3 && digits[2] > "1") return false;
  if (digits.length >= 4) {
    const month = Number(digits.slice(2, 4));
    if (month < 1 || month > 12) return false;
  }
  return true;
}

interface CustomDatePickerProps {
  /** Plain "YYYY-MM-DD" (or "" for no value) — same shape a native
   * `<input type="date">` uses, so this drops into any existing
   * value/onChange pair unchanged. */
  value: string;
  onChange: (value: string) => void;
  /** Plain "YYYY-MM-DD", same as a native date input's min/max. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  theme: "light" | "dark";
  /** Overrides the trigger's classes entirely — use this to match an
   * existing field's exact background/border/sizing, same convention as
   * CustomSelect's `triggerClassName`. */
  triggerClassName?: string;
  id?: string;
  /** Optional trailing icon shown before the clear button, e.g. a Clock
   * icon a call site already used with the old native-input wrapper. */
  icon?: ReactNode;
  wrapperClassName?: string;
}

/**
 * App-wide replacement for a native `<input type="date">` — the browser's
 * own calendar popup can only be nudged towards a light/dark rendering via
 * the `color-scheme` CSS property (see index.css), it can never be styled
 * to match this app's actual navy/cyan palette, and different browsers
 * render that popup differently regardless. This renders a themed calendar
 * dropdown using the exact same floating-panel architecture as
 * CustomSelect.tsx (portal into document.body, position: fixed, coordinates
 * computed from the trigger's own bounding rect, opens upward when there
 * isn't room below, zoom-corrected) so date fields look and behave like
 * every other themed control in the app, identically across browsers.
 *
 * Always displays DD-MM-YYYY, the app's one established date convention
 * (see dateFormat.ts) — never the visitor's browser/OS locale format, which
 * was the same "looks different for different people" bug DateInputDMY.tsx
 * was originally built to fix for its own callers.
 */
export function CustomDatePicker({
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  title,
  placeholder = "DD-MM-YYYY",
  theme,
  triggerClassName,
  id,
  icon,
  wrapperClassName = "relative",
}: CustomDatePickerProps) {
  const dark = theme === "dark";
  const selected = useMemo(() => parseISOParts(value), [value]);
  const minParts = useMemo(() => parseISOParts(min), [min]);
  const maxParts = useMemo(() => parseISOParts(max), [max]);

  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [panelRect, setPanelRect] = useState<{ top: number; bottom: number; left: number } | null>(null);
  // Real available vertical space for the panel in whichever direction it
  // opened (set once the panel actually exists and can be measured -- see
  // the useLayoutEffect below). null until then, so the panel's natural
  // height is used for that very first frame.
  const [maxHeightPx, setMaxHeightPx] = useState<number | null>(null);
  // The month currently shown in the grid — independent of `selected` so
  // browsing to a different month doesn't commit anything until a day is
  // actually clicked/entered.
  const [viewYear, setViewYear] = useState(() => (selected ?? todayParts()).y);
  const [viewMonth, setViewMonth] = useState(() => (selected ?? todayParts()).m);
  // Keyboard-focused day, separate from the committed `selected` value —
  // arrow keys move this, Enter commits it. Reset to the selected day (or
  // today) every time the panel opens.
  const [focused, setFocused] = useState<DateParts>(() => clampToRange(selected ?? todayParts(), minParts, maxParts));
  // Raw digits typed so far toward a full DD-MM-YYYY entry (see
  // formatTypedDigits/isValidPartialDate above), "" when not mid-typing.
  const [typedBuffer, setTypedBuffer] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const PANEL_HEIGHT_ESTIMATE = 320;

  function openPanel() {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < PANEL_HEIGHT_ESTIMATE + 24 && spaceAbove > spaceBelow);
    // Same --app-zoom double-multiplication fix CustomSelect.tsx applies
    // to its own portaled panel — see that file's comment on why a fixed-
    // position descendant of a zoomed <html> needs this correction.
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")) || 1;
    const margin = 8;
    const panelWidth = 264;
    const clampedLeft = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - panelWidth - margin));
    setPanelRect({
      top: (rect.bottom + 6) / zoom,
      bottom: (window.innerHeight - rect.top + 6) / zoom,
      left: clampedLeft / zoom,
    });
    const base = clampToRange(selected ?? todayParts(), minParts, maxParts);
    setFocused(base);
    setViewYear(base.y);
    setViewMonth(base.m);
    setOpen(true);
  }

  const handleToggle = () => {
    if (disabled) return;
    if (!open) {
      openPanel();
    } else {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      // The month/year quick-jump dropdowns in the header are CustomSelect
      // instances, which portal their own floating option list straight into
      // document.body (see CustomSelect.tsx) -- so a click on one of those
      // options lands OUTSIDE both containerRef and panelRef above, and would
      // otherwise close this calendar out from under the nested select right
      // as it's being used. CustomSelect's floating panel always carries
      // role="listbox" (this component's own panel uses role="dialog", so
      // there's no collision) -- treat a click anywhere inside one of those
      // as still "inside" this picker.
      const insideNestedSelect = target instanceof Element && !!target.closest('[role="listbox"]');
      if (!insideTrigger && !insidePanel && !insideNestedSelect) setOpen(false);
    };
    const handleReposition = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      // Same reasoning as handlePointerDown above -- scrolling a long year
      // list (CustomSelect's own internal overflow-y-auto) fires a capturing
      // window scroll event that would otherwise be mistaken for the page
      // scrolling out from under this picker.
      if (target instanceof Element && target.closest('[role="listbox"]')) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open]);

  // 2026-09 viewport-boundary fix: openPanel() above picks an initial
  // open-up-or-down direction from a fixed height GUESS, made before the
  // panel exists in the DOM to measure. That guess going stale (it did,
  // after the month/year selects and Clear/Today footer were added) is
  // exactly how the panel ended up rendering taller than the room actually
  // available and running off the top of the screen. This re-checks with
  // the panel's REAL, on-screen height right after it mounts (and whenever
  // it reopens) and corrects course: flips direction if the guessed side
  // doesn't actually fit but the other one does, and -- if neither side has
  // room for the whole thing -- caps its height to whichever side has more
  // and lets that content scroll internally instead of overflowing the
  // viewport. Runs as a layout effect (before the browser paints) so a
  // wrong initial guess never flashes on screen first.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !containerRef.current) return;
    const panelHeight = panelRef.current.getBoundingClientRect().height;
    const triggerRect = containerRef.current.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")) || 1;
    const margin = 8;
    const spaceBelow = window.innerHeight - triggerRect.bottom - margin;
    const spaceAbove = triggerRect.top - margin;
    const fitsBelow = panelHeight <= spaceBelow;
    const fitsAbove = panelHeight <= spaceAbove;
    // Prefer whichever side actually fits the whole panel; if neither does,
    // fall back to whichever has more room (and cap+scroll it below) rather
    // than the emptier-but-still-too-small side happening to "win" a raw
    // space comparison the way the pre-render guess alone would.
    const goUpward = !fitsBelow && (fitsAbove || spaceAbove > spaceBelow);
    setOpenUpward((prev) => (prev === goUpward ? prev : goUpward));
    const available = (goUpward ? spaceAbove : spaceBelow) / zoom;
    const fits = goUpward ? fitsAbove : fitsBelow;
    setMaxHeightPx(fits ? null : Math.max(160, available));
  }, [open]);

  useEffect(() => {
    if (open) window.requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
    else {
      setTypedBuffer("");
      setMaxHeightPx(null);
    }
  }, [open]);

  useEffect(() => {
    setTypedBuffer("");
  }, [value]);

  function isDisabledDate(p: DateParts): boolean {
    if (minParts && compareParts(p, minParts) < 0) return true;
    if (maxParts && compareParts(p, maxParts) > 0) return true;
    return false;
  }

  function commit(p: DateParts) {
    if (isDisabledDate(p)) return;
    onChange(partsToISO(p));
    setOpen(false);
  }

  function moveFocused(deltaDays: number) {
    const d = new Date(focused.y, focused.m, focused.d + deltaDays);
    const next = clampToRange({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }, minParts, maxParts);
    setFocused(next);
    setViewYear(next.y);
    setViewMonth(next.m);
  }

  /**
   * Digit/Backspace/Escape handling shared by the trigger (before the panel
   * is open, so typing the first digit can open it) and the grid (after the
   * panel opens, focus moves there -- see the useEffect above -- so typing
   * must keep working once it does). Returns true when it consumed the key,
   * so callers skip their own handling for that keystroke (the grid's
   * arrow-key day navigation below, in particular).
   */
  function handleTypedKey(e: ReactKeyboardEvent): boolean {
    if (disabled) return false;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const next = typedBuffer + e.key;
      if (next.length > 8 || !isValidPartialDate(next)) return true;
      setTypedBuffer(next);
      if (!open) openPanel();
      if (next.length === 8) {
        const d = Number(next.slice(0, 2));
        const m = Number(next.slice(2, 4)) - 1;
        const y = Number(next.slice(4, 8));
        const parts: DateParts = { y, m, d };
        // isValidPartialDate already ruled out an impossible day/month
        // COMBINATION (e.g. day "32", month "13") as each digit was typed,
        // but not a day that's wrong for its specific month (30 Feb) --
        // daysInMonth catches that here, once the month is actually known.
        if (d <= daysInMonth(y, m) && !isDisabledDate(parts)) {
          setViewYear(y);
          setViewMonth(m);
          commit(parts);
        }
        setTypedBuffer("");
      }
      return true;
    }
    if (e.key === "Backspace" && typedBuffer) {
      e.preventDefault();
      setTypedBuffer(typedBuffer.slice(0, -1));
      return true;
    }
    if (e.key === "Escape" && typedBuffer) {
      // Mid-typing Escape cancels just the typed digits (falls through to
      // the grid's own Escape case -- close the whole calendar -- only once
      // there's nothing left to cancel).
      e.preventDefault();
      setTypedBuffer("");
      return true;
    }
    return false;
  }

  function handleTriggerKeyDown(e: ReactKeyboardEvent) {
    handleTypedKey(e);
  }

  function handleGridKeyDown(e: ReactKeyboardEvent) {
    if (handleTypedKey(e)) return;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        moveFocused(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocused(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocused(-7);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocused(7);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(focused);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  }

  // Build the 6x7 day grid for the currently viewed month, including the
  // trailing/leading days of the adjacent months needed to fill whole weeks.
  const cells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const total = daysInMonth(viewYear, viewMonth);
    const prevTotal = daysInMonth(viewYear, viewMonth === 0 ? 11 : viewMonth - 1);
    const out: { p: DateParts; inMonth: boolean }[] = [];
    for (let i = 0; i < firstWeekday; i++) {
      const dayNum = prevTotal - firstWeekday + 1 + i;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      out.push({ p: { y, m, d: dayNum }, inMonth: false });
    }
    for (let d = 1; d <= total; d++) out.push({ p: { y: viewYear, m: viewMonth, d }, inMonth: true });
    while (out.length % 7 !== 0 || out.length < 42) {
      const last = out[out.length - 1].p;
      const nextDate = new Date(last.y, last.m, last.d + 1);
      out.push({ p: { y: nextDate.getFullYear(), m: nextDate.getMonth(), d: nextDate.getDate() }, inMonth: false });
      if (out.length >= 42) break;
    }
    return out;
  }, [viewYear, viewMonth]);

  const today = useMemo(() => todayParts(), []);

  // Quick month/year jump (2026-09) -- the header used to be a plain label
  // with only the prev/next-month arrows next to it, so reaching a date far
  // from "now" meant clicking next/prev one month at a time, all the way
  // there. These reuse the app's existing CustomSelect dropdown (same
  // component every other themed select in the app uses) instead of a new
  // dropdown pattern, so they look and behave like part of this component.
  const monthOptions = useMemo<CustomSelectOption[]>(
    () => MONTH_LABELS.map((label, i) => ({ value: String(i), label })),
    []
  );

  const yearOptions = useMemo<CustomSelectOption[]>(() => {
    // Bounded by min/max when the caller set them (so a year outside the
    // allowed range can never be jumped to -- the day grid's own min/max
    // disabling only stops a specific DAY from being picked, not browsing
    // there in the first place). With no min/max, fall back to a generous
    // default range anchored on the real current year (not `viewYear`, so
    // the list doesn't shift under the user while they're browsing). Either
    // way, the currently viewed year is always included even if it happens
    // to fall outside that range (e.g. an existing stored value from before
    // a min/max was tightened).
    const lo = Math.min(minParts ? minParts.y : today.y - 100, viewYear);
    const hi = Math.max(maxParts ? maxParts.y : today.y + 50, viewYear);
    const out: CustomSelectOption[] = [];
    for (let y = lo; y <= hi; y++) out.push({ value: String(y), label: String(y) });
    return out;
  }, [minParts, maxParts, today.y, viewYear]);

  const monthYearTriggerClass = `w-full flex items-center justify-center pl-2 pr-5 py-1 rounded-md text-[12px] font-bold outline-none transition-colors cursor-pointer ${
    dark ? "text-white hover:bg-white/[0.08]" : "text-stone-900 hover:bg-stone-100"
  }`;

  const defaultTriggerClass = `w-full flex items-center justify-between gap-2 pl-3 pr-2.5 py-2 rounded-lg border outline-none font-bold text-input-value transition-colors font-sans relative ${
    disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
  } bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] hover:bg-[var(--surface-hover)] ${
    open ? "border-[var(--focus-ring)] ring-1 ring-[var(--focus-ring)]/30" : ""
  }`;

  return (
    <div ref={containerRef} className={wrapperClassName}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        title={title}
        onClick={handleToggle}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required}
        className={triggerClassName || defaultTriggerClass}
      >
        {/* Typing digits (see handleTypedKey) live-formats straight into
            DD-MM-YYYY here as they're entered -- no dashes to type, and
            nothing commits (onChange) until a complete, valid, in-range
            date is typed. Falls back to the selected value / placeholder
            exactly as before whenever there's nothing being typed. */}
        <span className={`truncate text-left ${!selected && !typedBuffer ? `font-medium ${dark ? "text-slate-400" : "text-stone-400"}` : ""}`}>
          {typedBuffer ? formatTypedDigits(typedBuffer) : selected ? partsToDMY(selected) : placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setTypedBuffer("");
                onChange("");
              }}
              className={`p-0.5 rounded ${dark ? "text-slate-500 hover:text-slate-200 hover:bg-white/10" : "text-stone-400 hover:text-stone-700 hover:bg-stone-100"}`}
              title="Clear date"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          {icon}
        </span>
      </button>

      {open && !disabled && panelRect &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Choose a date"
            // Same reasoning as CustomSelect.tsx's floating panel: fully
            // opaque background reusing the app's real navy --surface token
            // in dark theme (already a solid hex there, so it's safe for a
            // floating overlay — see CustomSelect's own comment), plain
            // white in light theme since --surface there is translucent.
            // overflow-y-auto (not overflow-hidden) still clips to the
            // rounded corners exactly the same when there's nothing to
            // scroll -- but on the rare screen too short for the whole
            // panel (see the useLayoutEffect above), it lets this content
            // scroll internally instead of running off the visible window.
            className={`fixed z-50 rounded-xl border shadow-lg overflow-y-auto flex flex-col w-[264px] ${
              dark ? "bg-[var(--surface)] border-white/[0.08] text-white" : "bg-[#ffffff] border-stone-200 text-stone-900"
            }`}
            style={{
              left: panelRect.left,
              ...(openUpward ? { bottom: panelRect.bottom } : { top: panelRect.top }),
              ...(maxHeightPx != null ? { maxHeight: `${maxHeightPx}px` } : {}),
            }}
          >
            <div className={`flex items-center justify-between px-2.5 py-1.5 border-b ${dark ? "border-white/[0.08]" : "border-stone-200"}`}>
              <button
                type="button"
                onClick={() => setViewMonth((m) => { if (m === 0) { setViewYear((y) => y - 1); return 11; } return m - 1; })}
                className={`p-1 rounded-md ${dark ? "hover:bg-white/[0.08] text-slate-300" : "hover:bg-stone-100 text-stone-600"}`}
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1 min-w-0">
                <div className="w-[94px] shrink-0">
                  <CustomSelect
                    value={String(viewMonth)}
                    onChange={(v) => setViewMonth(Number(v))}
                    options={monthOptions}
                    theme={theme}
                    triggerClassName={monthYearTriggerClass}
                    maxPanelHeightPx={200}
                    id={id ? `${id}-month` : undefined}
                  />
                </div>
                <div className="w-[64px] shrink-0">
                  <CustomSelect
                    value={String(viewYear)}
                    onChange={(v) => setViewYear(Number(v))}
                    options={yearOptions}
                    theme={theme}
                    triggerClassName={monthYearTriggerClass}
                    maxPanelHeightPx={200}
                    id={id ? `${id}-year` : undefined}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewMonth((m) => { if (m === 11) { setViewYear((y) => y + 1); return 0; } return m + 1; })}
                className={`p-1 rounded-md ${dark ? "hover:bg-white/[0.08] text-slate-300" : "hover:bg-stone-100 text-stone-600"}`}
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div
              ref={gridRef}
              tabIndex={0}
              onKeyDown={handleGridKeyDown}
              className="p-2 outline-none"
            >
              <div className="grid grid-cols-7 mb-0.5">
                {WEEKDAY_LABELS.map((w) => (
                  <div key={w} className={`text-center text-[10px] font-bold uppercase py-0.5 ${dark ? "text-slate-500" : "text-stone-400"}`}>
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map(({ p, inMonth }, i) => {
                  const isSelected = !!selected && compareParts(p, selected) === 0;
                  const isToday = compareParts(p, today) === 0;
                  const isFocused = compareParts(p, focused) === 0;
                  const dis = isDisabledDate(p);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={dis}
                      tabIndex={-1}
                      onClick={() => commit(p)}
                      onMouseEnter={() => setFocused(p)}
                      className={`aspect-square rounded-md text-input-value font-semibold flex items-center justify-center transition-colors ${
                        dis
                          ? `cursor-not-allowed ${dark ? "text-slate-700" : "text-stone-300"}`
                          : !inMonth
                            ? `${dark ? "text-slate-600" : "text-stone-300"} hover:bg-[var(--surface-hover)]`
                            : isSelected
                              ? "bg-[var(--accent-subtle-bg)] text-[var(--accent)] border border-[var(--accent)]"
                              : isFocused
                                ? `border ${dark ? "border-white/20" : "border-stone-300"} ${dark ? "text-white" : "text-stone-900"}`
                                : `${dark ? "text-slate-200" : "text-stone-700"} hover:bg-[var(--surface-hover)]`
                      } ${isToday && !isSelected ? "underline decoration-2 underline-offset-2" : ""}`}
                    >
                      {p.d}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2026-09: quick Clear/Today shortcuts, matching what the old
                native <input type="date"> popup offered (its own browser-
                drawn "Clear"/"Today" links) that got lost when this custom
                calendar replaced it. Today both jumps the view to the
                current month AND commits today's date (same as clicking
                today's cell) -- disabled rather than committing an
                out-of-range date if today falls outside min/max. Shown
                regardless of `required`: it's a convenience for correcting
                a mis-pick mid-edit, not a way around the field actually
                needing a value -- the form's own required-field validation
                still blocks submitting it empty. */}
            <div className={`flex items-center justify-between px-2.5 py-1.5 border-t text-[11px] font-bold ${dark ? "border-white/[0.08]" : "border-stone-200"}`}>
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className={`cursor-pointer hover:underline ${dark ? "text-slate-300 hover:text-white" : "text-stone-600 hover:text-stone-900"}`}
              >
                Clear
              </button>
              <button
                type="button"
                disabled={isDisabledDate(today)}
                onClick={() => {
                  setViewYear(today.y);
                  setViewMonth(today.m);
                  commit(today);
                }}
                className={`cursor-pointer hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:hover:no-underline ${
                  isDisabledDate(today)
                    ? dark ? "text-slate-700" : "text-stone-300"
                    : "text-[var(--accent)]"
                }`}
              >
                Today
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
