/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";

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
  /** Adds a search box pinned to the top of the floating panel that filters
   * the option list by label (case-insensitive substring), autofocused as
   * soon as the panel opens. Off by default — every existing call site is
   * unaffected — opt in for lists long enough that scrolling to find one
   * option is the actual complaint (e.g. picking one person out of a whole
   * department/org). Below ~15 options a search box is more chrome than
   * help, so most call sites should stay plain. */
  searchable?: boolean;
  /** Placeholder for the search box. Defaults to "Search…". */
  searchPlaceholder?: string;
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
  searchable,
  searchPlaceholder,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  // `width` is a FLOOR (min-width, below), not a fixed size — see the 2026-09
  // "don't truncate option text" fix below panelRect's usage for why.
  const [panelRect, setPanelRect] = useState<{ top: number; bottom: number; left: number; width: number; maxWidth: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionsListRef = useRef<HTMLDivElement>(null);
  const dark = theme === "dark";

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < maxPanelHeightPx + 24 && spaceAbove > spaceBelow);
      // getBoundingClientRect() reports true, on-screen pixel coordinates —
      // already scaled by the app-wide --app-zoom the large-monitor auto-
      // scale applies to <html> (see autoZoom.ts). But that same zoom is a
      // well-known trigger for a Chromium/Blink quirk: an element with
      // `zoom` set becomes a new containing block for `position: fixed`
      // descendants, same as `transform` would, instead of the true
      // viewport — so this portaled panel (a fixed-position descendant of
      // the zoomed <html>, via document.body) gets its top/left/width
      // RE-multiplied by zoom a second time when painted. Left uncorrected,
      // that renders the panel visibly offset from its trigger and wider
      // than intended on any screen where --app-zoom > 1 — exactly the
      // "detached, overflowing" symptom this fixes. Pre-dividing every
      // value by zoom here cancels the second multiplication out, so the
      // panel lands at its true, correct on-screen position either way.
      const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-zoom")) || 1;
      // Also keep the panel's left edge on-screen: a trigger near the
      // right edge of a wide table (e.g. DA Mapping Config's category
      // mapping grid) would otherwise still open flush with the trigger's
      // own left edge and run its full (untruncated by the panel's own
      // width) option labels off the right side of the viewport.
      const margin = 8;
      const clampedLeft = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - rect.width - margin));
      setPanelRect({
        top: (rect.bottom + 6) / zoom,
        bottom: (window.innerHeight - rect.top + 6) / zoom,
        left: clampedLeft / zoom,
        width: rect.width / zoom,
        // How far the panel is allowed to grow past the trigger's own width
        // before hitting the viewport edge — see the width/maxWidth pairing
        // on the panel's own style below.
        maxWidth: (window.innerWidth - clampedLeft - margin) / zoom,
      });
    }
    setOpen((v) => !v);
  };

  // Reset any leftover search text from the previous time this opened, and
  // autofocus the search box as soon as the portaled panel has painted (a
  // plain synchronous focus in handleToggle would run before the input
  // exists yet, since it's only rendered once `open` flips true).
  useEffect(() => {
    if (!open || !searchable) return;
    setSearchQuery("");
    const id = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open, searchable]);

  // Scroll the selected option into view (centered in the panel) as soon
  // as it opens -- rAF because the portal only paints once `open` flips
  // true, so the list/selected option don't exist in the DOM yet during
  // this same synchronous render. Uses getBoundingClientRect() rather than
  // offsetTop, since offsetTop is relative to the option's nearest
  // POSITIONED ancestor (which may not be this scroll container at all --
  // e.g. the portaled, `fixed` panelRef further up the tree), not
  // necessarily this list. Skipped for a searchable panel: the search box
  // is what the user's about to type into, so jumping the list on open
  // would just be a distracting, unrequested scroll.
  useEffect(() => {
    if (!open || searchable) return;
    const id = window.requestAnimationFrame(() => {
      const container = optionsListRef.current;
      const selectedEl = container?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!container || !selectedEl) return;
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selectedEl.getBoundingClientRect();
      const offsetWithinContainer = selectedRect.top - containerRect.top + container.scrollTop;
      container.scrollTop = offsetWithinContainer - container.clientHeight / 2 + selectedRect.height / 2;
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, searchable]);

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
  const filteredOptions =
    searchable && searchQuery.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      : options;

  // Cross-app UI consistency pass (2026-08): rebuilt to match Product
  // Assist's own dropdown trigger (its insurer selector on ProductAssistPage,
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
              // 2026-09 fix (recurring complaint across several admin
              // tables): this used to be a fixed `width: panelRect.width`,
              // i.e. exactly the trigger's own on-screen width. A trigger
              // sitting in a narrow, auto-sized table column (e.g. a
              // Department picker) could be 70-80px wide, and every option
              // label — even ones much longer than the current selection —
              // got force-fit into that same width and ellipsis-truncated
              // (opt.label's old `truncate` class below), so a long option
              // list could render as a column of indistinguishable "Adv…",
              // "Bus…", "Fou…" fragments. The trigger's width is now only a
              // FLOOR (minWidth) — the panel grows to fit its widest option
              // (`width: "max-content"`), capped so it never runs off the
              // right edge of the viewport (maxWidth, computed alongside
              // the left-clamping above). Options that are still too long
              // even for that capped width wrap onto a second line instead
              // of being cut off (see opt.label below) — full text is
              // always visible, never letters silently cut off.
              minWidth: panelRect.width,
              width: "max-content",
              maxWidth: panelRect.maxWidth,
              ...(openUpward ? { bottom: panelRect.bottom } : { top: panelRect.top }),
            }}
          >
            {searchable && (
              // Pinned above the scrollable option list (a sibling, not
              // inside the overflow-y-auto div below) so it stays visible
              // while a long, filtered list scrolls underneath it.
              <div className={`relative shrink-0 border-b ${dark ? "border-white/[0.08]" : "border-stone-200"}`}>
                <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${dark ? "text-stone-500" : "text-stone-400"}`} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder || "Search…"}
                  className={`w-full pl-8 pr-3 py-2 text-input-value font-sans font-medium outline-none bg-transparent ${
                    dark ? "text-white placeholder:text-stone-500" : "text-stone-900 placeholder:text-stone-400"
                  }`}
                />
              </div>
            )}
            <div ref={optionsListRef} className="overflow-y-auto" style={{ maxHeight: `${maxPanelHeightPx}px` }}>
              {filteredOptions.length === 0 ? (
                <div className={`px-4 py-3 text-input-value italic text-left select-none ${dark ? "text-stone-500" : "text-stone-400"}`}>
                  {searchable && searchQuery.trim() ? "No matches." : "No options available."}
                </div>
              ) : (
                filteredOptions.map((opt) => {
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
                      {/* Not `truncate` (ellipsis) — the panel now sizes
                          itself to fit this text (see the panel's own style
                          above); this only wraps the rare option that's
                          still too long even for the capped max width,
                          rather than ever silently hiding characters. */}
                      <span className="text-left break-words">{opt.label}</span>
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
