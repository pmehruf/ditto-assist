/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { tactIdDigits } from "../utils/tactId";

interface TactIdInputProps {
  /** Full canonical value, e.g. "TACT1500", or "" if unset. */
  value: string;
  /** Called with the full canonical value ("TACT" + digits), or "" if the
   * digit field is cleared. */
  onChange: (value: string) => void;
  theme: "light" | "dark";
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Overrides both segments' classes entirely — use to match an existing
   * field's exact sizing at a call site instead of the default styling. */
  className?: string;
}

/**
 * TACT ID entry — a fixed, non-editable "TACT" prefix beside a digits-only
 * input, instead of a free-text field. Structurally prevents every
 * malformed variant that used to reach the directory ("tact1500",
 * "Tact-1500", "TACT-1500", ...) since there's no way to type anything but
 * digits into the editable half; the composed value is always exactly
 * "TACT" + digits (see normalizeTactId in utils/tactId.ts, which the server
 * also applies independently as a second line of defense for any writes
 * that don't go through this component).
 */
export function TactIdInput({ value, onChange, theme, required, disabled, placeholder = "e.g. 1500", className }: TactIdInputProps) {
  const dark = theme === "dark";
  const digits = tactIdDigits(value);

  const segmentClass =
    className ??
    `px-3 py-3 rounded-2xl border text-xs font-bold ${
      dark
        ? "bg-[#102236] border-[#1e3e5c] text-white placeholder:text-slate-500"
        : "bg-stone-50 border-stone-200 text-stone-900 placeholder:text-stone-400"
    }`;

  return (
    <div className="flex items-center gap-2">
      <span
        className={`shrink-0 select-none tracking-wider ${segmentClass} ${
          dark ? "text-slate-400" : "text-stone-500"
        }`}
      >
        TACT
      </span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={digits}
        onChange={(e) => {
          const nextDigits = tactIdDigits(e.target.value);
          onChange(nextDigits ? `TACT${nextDigits}` : "");
        }}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`w-full outline-none transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 ${segmentClass}`}
      />
    </div>
  );
}
