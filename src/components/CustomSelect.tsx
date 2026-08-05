/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const dark = theme === "dark";

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < maxPanelHeightPx + 24 && spaceAbove > spaceBelow);
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const defaultTriggerClass = `w-full flex items-center justify-between gap-2 pl-3 pr-8 py-3 rounded-xl border outline-none font-bold text-input-value transition-all font-sans shadow-sm relative ${
    disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
  } ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
  } ${open ? (dark ? "border-blue-500 ring-1 ring-blue-500/30" : "border-blue-400 ring-1 ring-blue-400/30") : ""}`;

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

      {open && !disabled && (
        <div
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
          className={`absolute left-0 right-0 z-50 rounded-xl border shadow-lg overflow-hidden flex flex-col ${
            openUpward ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${
            panelClassName ??
            (dark ? "bg-[#14181f] border-white/[0.08] text-white" : "bg-[#ffffff] border-stone-200 text-stone-900")
          }`}
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
                          ? `${selectedOptionClassName ?? "bg-blue-600/20 text-blue-300 border-blue-500"} pl-[10px]`
                          : dark
                            ? "hover:bg-white/[0.04] border-transparent pl-[10px]"
                            : "hover:bg-stone-100 border-transparent pl-[10px]"
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ${checkColorClassName ?? "text-blue-400"}`} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
