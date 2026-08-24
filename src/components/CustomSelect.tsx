/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  theme: "light" | "dark";
  /** Overrides the trigger button's classes entirely — use this to match
   * an existing select's exact sizing/spacing at a call site instead of
   * the default styling below. */
  triggerClassName?: string;
  disabled?: boolean;
  id?: string;
  /** Caps the floating panel's height before it scrolls. Defaults to the
   * same 240px used elsewhere so long option lists (e.g. plan pickers)
   * don't run off the bottom of the viewport. */
  maxPanelHeightPx?: number;
  /** Overrides the dropdown panel's surface classes. Added for the Smoke
   * Test page, which is deliberately off-theme (ember, not the app's
   * blue-grey) — without this the trigger was warm but the panel that
   * opened from it was still navy. Optional: every other call site keeps
   * the default styling. */
  panelClassName?: string;
  /** Overrides the selected-option highlight classes, for the same reason
   * as `panelClassName`. Should include background, text and border-left. */
  selectedOptionClassName?: string;
  /** Colour for the selected option's check icon. */
  checkColorClassName?: string;
}

/**
 * App-wide replacement for native <select>/<option> — browsers render the
 * expanded option list themselves with OS-native chrome that can't be
 * restyled, which is why every native select looked visually inconsistent
 * with the rest of the app (see the Lookup page's PED search dropdown,
 * which is hand-built and was the one dropdown that actually matched the
 * app's look). This renders the exact same floating-panel language
 * (rounded border, shadow, per-row hover highlight, left accent bar on the
 * active/selected row) as that PED dropdown, driven by a plain button +
 * absolutely-positioned panel instead of a native <select>.
 *
 * The floating panel is rendered through a portal into `document.body`
 * (position: fixed, coordinates computed from the trigger's own
 * bounding rect) rather than as a normal absolutely-positioned child of
 * the trigger. Every table in this app wraps its <table> in an
 * `overflow-x-auto` container for horizontal scrolling on narrow
 * viewports — per the CSS spec, setting overflow-x to anything but
 * `visible` forces overflow-y to compute as `auto` too, so that wrapper
 * silently clips any in-flow floating panel that would otherwise extend
 * below it (found via the PED Repository table: a Category dropdown
 * opened on the last visible row rendered with only its first option
 * visible, hard-cut at the table's border). Escaping to a portal makes
 * the panel immune to every ancestor's overflow/clipping, no matter how
 * short that ancestor's content currently is.
 *
 * Deliberately a single generic component reused everywhere a native
 * select previously stood — one visual language, one place to keep it
 * consistent, rather than each page re-implementing its own dropdown.
 */
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  theme,
  triggerClassName,
  disabled,
  id,
  maxPanelHeightPx = 240,
  panelClassName,
  selectedOptionClassName,
  checkColorClassName,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  // Whether the floating panel should render ABOVE the trigger instead of
  // below it. Decided once, right when the panel opens (see handleToggle),
  // based on actual viewport space — most triggers have room below and
  // keep the original downward-opening behavior, but a trigger pinned near
  // the bottom of the screen (e.g. the sidebar's "Preview As" picker) would
  // otherwise render its options panel partly off-screen/under the OS
  // taskbar.
  const [openUpward, setOpenUpward] = useState(false);
  // Viewport-relative coordinates for the portaled panel (position: fixed),
  // captured from the trigger's own bounding rect right when it opens.
  const [panelRect, setPanelRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dark = theme === "dark";

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < maxPanelHeightPx + 24 && spaceAbove > spaceBelow);
      setPanelRect({ top: rect.bottom, bottom: window.innerHeight - rect.top, left: rect.left, width: rect.width });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Closes on scroll (of the page, or any scrollable ancestor like a
    // table's overflow-x-auto wrapper) and resize, rather than trying to
    // keep the portaled panel's fixed-position coordinates in sync with a
    // moving trigger — simplest way to avoid the panel visually detaching
    // from its trigger.
    //
    // Scroll events don't bubble, so this capturing window listener is what
    // catches scroll on any ancestor in the first place — but that also
    // means it catches scroll events dispatched on the panel's OWN internal
    // options list (`.overflow-y-auto` below), which is a descendant of
    // `window` too. Without excluding that case, using a mouse wheel or
    // trackpad to scroll a long option list closes the dropdown on the very
    // first scroll tick instead of scrolling it — the panel's coordinates
    // aren't moving in that case (it's the list content scrolling inside a
    // fixed-position panel), so there's nothing to reposition for and
    // nothing to close for.
    const handleReposition = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  // Cross-app UI consistency pass (2026-08): rebuilt to match Product
  // Assist's own dropdown trigger (its insurer selector on QueryAssistPage,
  // which passes a custom triggerClassName rather than using this default)
  // — py-2/rounded-lg instead of py-3/rounded-xl (this default was
  // noticeably taller/larger-radius than every other control in the app,
  // the literal "oversized controls" complaint against Knowledge Base's
  // filter row, which never passes its own triggerClassName and so was
  // always rendering this default), and --input-bg/--input-border/
  // --input-text tokens instead of hardcoded hex — the same token pair a
  // text <input> already uses, so a select trigger and a text field read as
  // the same control family instead of two different ones. The open/
  // selected states below are on --accent/--focus-ring tokens instead of
  // Tailwind's generic `blue-*` swatch, which isn't tied to either theme's
  // palette and was the actual source of the "flat heavy blue" look.
  const defaultTriggerClass = `w-full flex items-center justify-between gap-2 pl-3 pr-8 py-2 rounded-lg border outline-none font-bold text-input-value transition-colors font-sans relative ${
    disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
  } bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--input-text)] hover:bg-[var(--surface-hover)] ${
    open ? "border-[var(--focus-ring)] ring-1 ring-[var(--focus-ring)]/30" : ""
  }`;

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerClassName || defaultTriggerClass}
      >
        <span
          className={`truncate text-left ${
            !selected ? `font-medium ${dark ? "text-slate-400" : "text-stone-400"}` : ""
          }`}
        >
          {selected ? selected.label : placeholder || "Select…"}
        </span>
      </button>
      <ChevronDown
        className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none shrink-0 transition-transform ${
          open ? "rotate-180" : ""
        } ${dark ? "text-slate-400" : "text-stone-400"}`}
      />

      {open && !disabled && panelRect &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            // Deliberately a plain opaque hex here, not the `bg-white`/
            // `bg-surface` classes cards use — those resolve to the app's
            // translucent card surface (Unified Surface Philosophy), which is
            // right for a stationary card sitting on the page background, but
            // wrong for a FLOATING panel: it sits on top of arbitrary other
            // content (whatever's behind the trigger), and a translucent
            // background lets that content bleed through and become
            // illegible. Every floating overlay (this panel, modals,
            // tooltips) needs to stay fully opaque regardless of the card
            // surface treatment.
            className={`fixed z-50 rounded-xl border shadow-lg overflow-hidden flex flex-col ${
              panelClassName ??
              (dark ? "bg-[#14181f] border-white/[0.08] text-white" : "bg-[#ffffff] border-stone-200 text-stone-900")
            }`}
            style={{
              left: panelRect.left,
              width: panelRect.width,
              ...(openUpward
                ? { bottom: panelRect.bottom + 6 }
                : { top: panelRect.top + 6 }),
            }}
          >
            <div className="overflow-y-auto" style={{ maxHeight: `${maxPanelHeightPx}px` }}>
              {options.length === 0 ? (
                <div className={`px-4 py-3 text-input-value italic text-left select-none ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  No options available.
                </div>
              ) : (
                options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onClick={() => {
                        if (opt.disabled) return;
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2 text-input-value flex items-center justify-between gap-2 transition-all font-sans font-medium border-l-2 ${
                        opt.disabled
                          ? "opacity-40 cursor-not-allowed border-transparent pl-[10px]"
                          : isSelected
                            ? // Default (no explicit override) is on the app's own
                              // --accent-subtle-bg/--accent tokens rather than
                              // Tailwind's generic `blue-*` swatch — that generic
                              // blue wasn't tied to either theme's palette (the
                              // "flat heavy blue" complaint) and wasn't AA-safe
                              // against a white light-theme panel by itself, which
                              // is why an earlier fix branched it by `dark`; the
                              // token pair already carries a correct value for
                              // each theme, so no branching is needed here anymore.
                              `${selectedOptionClassName ?? "bg-[var(--accent-subtle-bg)] text-[var(--accent)] border-[var(--accent)]"} pl-[10px]`
                            : dark
                              ? "hover:bg-white/[0.04] border-transparent pl-[10px]"
                              : "hover:bg-stone-100 border-transparent pl-[10px]"
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ${checkColorClassName ?? "text-[var(--accent)]"}`} />}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
