/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check } from "lucide-react";

export const ADVISOR_TAG_OPTIONS = ["Health", "Term"] as const;

interface AdvisorTagCheckboxesProps {
  value: string[];
  onChange: (tags: string[]) => void;
  theme: "light" | "dark";
  disabled?: boolean;
  /** "sm" fits inside a table cell (User Management's add/edit rows); "md"
   * is roomier, for the standalone first-time-setup "Skill Domain" section. */
  size?: "sm" | "md";
}

/**
 * Multi-select "which skill domain(s) does this person handle" control —
 * two independently toggleable chips (Health / Term), either or both may be
 * selected. Replaces the old single-value advisorRole dropdown ("Health
 * advisor"/"Term advisor"/"Both advisor"/"Manager" — see
 * drizzle/0026_advisor_tags.sql): a person can now hold either tag, both,
 * or neither (unassigned), reflected directly instead of via a special-cased
 * label.
 *
 * Shared between User Management's add/edit rows (ProfileAccessManagement.tsx)
 * and the first-time-setup form's "Skill Domain" section (App.tsx) so both
 * surfaces stay visually and behaviorally identical.
 */
export function AdvisorTagCheckboxes({ value, onChange, theme, disabled, size = "sm" }: AdvisorTagCheckboxesProps) {
  const dark = theme === "dark";
  const toggle = (tag: string) => {
    if (disabled) return;
    onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
  };

  const sizeClass = size === "md" ? "px-3.5 py-2 text-xs gap-1.5" : "px-2 py-1 text-[10.5px] gap-1";
  const iconSize = size === "md" ? "w-3.5 h-3.5" : "w-3 h-3";

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {ADVISOR_TAG_OPTIONS.map((tag) => {
        const active = value.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            onClick={() => toggle(tag)}
            aria-pressed={active}
            className={`flex items-center rounded-lg border font-bold uppercase tracking-wide transition-colors ${sizeClass} ${
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
            } ${
              active
                ? dark
                  ? "bg-sky-500/15 border-sky-500/40 text-sky-300"
                  : "bg-sky-50 border-sky-300 text-sky-700"
                : dark
                  ? "bg-[#060a12] border-stone-850 text-stone-400 hover:border-stone-700"
                  : "bg-white border-stone-200 text-stone-500 hover:border-stone-300"
            }`}
          >
            {active && <Check className={`${iconSize} shrink-0`} />}
            {tag}
          </button>
        );
      })}
    </div>
  );
}
