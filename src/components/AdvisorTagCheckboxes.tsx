/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check } from "lucide-react";

export const ADVISOR_TAG_OPTIONS = ["Health", "Term"] as const;
// Client-only sentinel — never a real `tags` value sent to/stored by the
// server (that column only ever accepts "Health"/"Term", empty array = no
// product affiliation, unchanged). Callers that opt into `notApplicable`
// (currently just the first-time-setup form, App.tsx — 2026-09, at the
// user's explicit request: "Product Tag should not be optional... Add a
// clear 'Not Applicable' option") must strip this out and send `[]` in its
// place before the value ever reaches a fetch() body; its only job here is
// letting the UI tell "explicitly chose N/A" apart from "hasn't chosen
// anything yet", which an empty array alone can't distinguish.
export const NOT_APPLICABLE_TAG = "Not Applicable";

interface AdvisorTagCheckboxesProps {
  value: string[];
  onChange: (tags: string[]) => void;
  theme: "light" | "dark";
  disabled?: boolean;
  /** "sm" fits inside a table cell (User Management's add/edit rows); "md"
   * is roomier, for the standalone first-time-setup "Skill Domain" section. */
  size?: "sm" | "md";
  /** Adds a third, mutually-exclusive "Not Applicable" chip alongside
   * Health/Term — off by default, so every existing call site (Directory's
   * add/edit rows, bulk-edit panel) keeps its original two-chip Health/Term
   * multi-select untouched. Selecting "Not Applicable" clears and disables
   * Health/Term; selecting either Health or Term clears "Not Applicable" —
   * see toggle() below. */
  notApplicable?: boolean;
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
export function AdvisorTagCheckboxes({ value, onChange, theme, disabled, size = "sm", notApplicable = false }: AdvisorTagCheckboxesProps) {
  const dark = theme === "dark";
  const naSelected = value.includes(NOT_APPLICABLE_TAG);

  const toggle = (tag: string) => {
    if (disabled) return;
    if (tag === NOT_APPLICABLE_TAG) {
      // Exclusive — selecting it clears Health/Term entirely; toggling it
      // back off just clears the whole selection (same "nothing chosen"
      // state as before this option existed).
      onChange(naSelected ? [] : [NOT_APPLICABLE_TAG]);
      return;
    }
    // Picking a real product tag always wins over a prior "Not Applicable"
    // — drop the sentinel the moment Health/Term is touched, then toggle
    // the real tag normally.
    const withoutNA = value.filter((t) => t !== NOT_APPLICABLE_TAG);
    onChange(withoutNA.includes(tag) ? withoutNA.filter((t) => t !== tag) : [...withoutNA, tag]);
  };

  const sizeClass = size === "md" ? "px-3.5 py-2 text-xs gap-1.5" : "px-2 py-1 text-[10.5px] gap-1";
  const iconSize = size === "md" ? "w-3.5 h-3.5" : "w-3 h-3";

  const chipClass = (active: boolean, chipDisabled: boolean) =>
    `flex items-center rounded-lg border font-bold uppercase tracking-wide transition-colors ${sizeClass} ${
      chipDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
    } ${
      active
        ? dark
          ? "bg-sky-500/15 border-sky-500/40 text-sky-300"
          : "bg-sky-50 border-sky-300 text-sky-700"
        : dark
          ? "bg-[#060a12] border-stone-850 text-stone-400 hover:border-stone-700"
          : "bg-white border-stone-200 text-stone-500 hover:border-stone-300"
    }`;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {ADVISOR_TAG_OPTIONS.map((tag) => {
        const active = value.includes(tag);
        // Health/Term go inert the instant "Not Applicable" is selected —
        // "If Not Applicable is selected: Health and Term product tags
        // should become disabled."
        const chipDisabled = !!disabled || naSelected;
        return (
          <button
            key={tag}
            type="button"
            disabled={chipDisabled}
            onClick={() => toggle(tag)}
            aria-pressed={active}
            className={chipClass(active, chipDisabled)}
          >
            {active && <Check className={`${iconSize} shrink-0`} />}
            {tag}
          </button>
        );
      })}
      {notApplicable && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => toggle(NOT_APPLICABLE_TAG)}
          aria-pressed={naSelected}
          className={chipClass(naSelected, !!disabled)}
        >
          {naSelected && <Check className={`${iconSize} shrink-0`} />}
          {NOT_APPLICABLE_TAG}
        </button>
      )}
    </div>
  );
}
