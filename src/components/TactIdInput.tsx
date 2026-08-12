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
  /** Styles the OUTER wrapper (border/bg/rounded/padding/sizing) to match a
   * call site's other inputs — e.g. a table row's compact w-full field
   * style. Do NOT put flex/width classes meant for a single "TACT"+digits
   * pair split across two elements: internally this is one bordered box
   * with "TACT" as a non-editable inline prefix, not two separate input
   * boxes, so a single className applied to the whole group always renders
   * correctly regardless of what the caller passes (previously this class
   * was applied identically to BOTH the fixed label and the real input,
   * which let a width utility like w-full make the label balloon and
   * squeeze the actual input down to nearly nothing — see git history for
   * the table edit-row bug this fixed). */
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

  const defaultWrapperClass = `px-3 py-3 rounded-2xl border text-xs font-bold ${
    dark ? "bg-[#102236] border-[#1e3e5c] text-white" : "bg-stone-50 border-stone-200 text-stone-900"
  }`;

  return (
    <div
      className={`flex items-center gap-1.5 transition-all focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/30 ${
        className ?? defaultWrapperClass
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span
        className={`shrink-0 select-none tracking-wider pr-1.5 border-r ${
          dark ? "text-slate-400 border-white/10" : "text-stone-500 border-stone-300"
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
        className={`min-w-0 flex-1 outline-none bg-transparent border-0 p-0 font-bold ${
          dark ? "text-white placeholder:text-slate-500" : "text-stone-900 placeholder:text-stone-400"
        }`}
      />
    </div>
  );
}
