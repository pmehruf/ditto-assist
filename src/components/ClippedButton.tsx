/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface ClippedButtonProps {
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  /**
   * "sm" — compact icon/table-row actions (Edit, Delete, Resolve, Ignore).
   * "md" — standard toolbar/header actions (Add Plan, Add User).
   * "lg" — full-width form actions (Save Changes, Add Announcement).
   */
  size?: "sm" | "md" | "lg";
  /** Background color of whatever sits behind this button (page/card bg) —
   * shows through the clipped corner notch, creating the cut-corner
   * illusion. Defaults to a sensible dark/light card color. */
  cornerBg?: string;
  /** Extra utility classes — background/text/border colors, layout, etc. */
  className?: string;
  style?: React.CSSProperties;
  /** Opt out of the grid-texture veneer (see BUTTON_GRID_TEXTURE below) for
   * the rare button where it reads as noise rather than texture. Applied by
   * default so every ClippedButton matches the Home page CTA. */
  noTexture?: boolean;
  /** Opt out of the default inner top-edge highlight (see INNER_HIGHLIGHT
   * below) for the rare button where it reads wrong — e.g. a fully
   * transparent button with no fill of its own to catch the sheen. */
  noHighlight?: boolean;
  /**
   * Draws a real border around the WHOLE clipped shape, including the
   * diagonal cut corner. A plain CSS `border` (via `className`/`style`)
   * only ever paints the original 4 rectangular edges — `clip-path` cuts a
   * new diagonal edge that a normal border never gets applied to, so any
   * bordered ClippedButton showed 3 bordered sides and one bare diagonal.
   * Pass the border color here instead to fix that: internally the button
   * itself becomes the border color, and an inset layer (sized `borderWidth`
   * smaller on every side) carries the actual fill, so the border reads as
   * one continuous ring around the whole cut shape.
   */
  borderColor?: string;
  /** Border color on hover — defaults to `borderColor` if omitted. */
  hoverBorderColor?: string;
  /** Ring thickness in px for the `borderColor` treatment. Default 1.5. */
  borderWidth?: number;
  /**
   * Utility classes for the inset fill layer when `borderColor` is used —
   * e.g. `bg-stone-800 hover:bg-sky-500/15` for a hover fill-tint that used
   * to live on the button itself. Ignored unless `borderColor` is set.
   */
  fillClassName?: string;
  /**
   * "action" fills the button with the app's shared primary/neutral-action
   * navy — the same `--action-navy`/`--on-action-navy`/`--action-navy-hover`
   * tokens `PrimaryCtaButton` uses for its default "accent" variant (see
   * that component). This is the ONE place that color lives: pass
   * `variant="action"` instead of a one-off `bg-blue-600`/hardcoded-hex
   * `style.background` on every "Add X" / "Save" / "Generate" / function-
   * performing button, and the whole app's secondary action buttons stay
   * in lock-step with the primary CTA's color, in both themes, for free.
   * (2026-09 design-system fix: several pages had drifted onto a hardcoded
   * `#1f2d3d` or the old `bg-blue-600` family, which happens to match the
   * token in light theme but NOT in dark theme, where `--action-navy`
   * resolves to a lighter `#355F87` for contrast against a near-black
   * page — see index.css's `.dark { --action-navy: ... }` comment.)
   * Omit this prop (the default) to keep passing your own background via
   * `className`/`style`, exactly as before — this is purely additive and
   * changes no existing call site that doesn't opt in.
   */
  variant?: "action";
  children: React.ReactNode;
}

/** The shared "action" variant's own color classes — kept as one constant
 * so `ClippedButton` and any future component/story reads a single
 * definition rather than a class string duplicated at each call site. */
const ACTION_VARIANT_CLASSNAME =
  "bg-[var(--action-navy)] text-[var(--on-action-navy)] hover:bg-[var(--action-navy-hover)]";

/**
 * Shared "grid texture" veneer style — mirrors the scanline pattern used by
 * `GridTexture.tsx` on page/card backgrounds (3px pitch, one dominant axis
 * rather than an even grid) so buttons read as the same faint surface
 * texture instead of a visible checkerboard. Unlike `GridTexture.tsx`, this
 * is a neutral dark-alpha version rather than a theme-aware one — it reads
 * correctly over any button background color without needing a `theme`
 * prop threaded through this component's 30+ call sites.
 */
const BUTTON_GRID_TEXTURE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.08) 50%), linear-gradient(90deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.025) 50%)",
  backgroundSize: "100% 3px, 3px 100%",
};

/** Subtle top-edge sheen, app-wide default for every ClippedButton — replaces
 * a visible contrasting border as the "this is a raised, pressable surface"
 * cue. `inset` box-shadows are clipped along with everything else by
 * `clip-path`, so this correctly follows the cut corner too, unlike a plain
 * CSS `border` (see the `borderColor` prop doc below for why that matters). */
const INNER_HIGHLIGHT = "inset 0 1px 0 rgba(255,255,255,0.09)";

/**
 * App-wide "clipped corner" button — the diagonal-cut-corner shape
 * (originated on the Home page's "LETS PUT THEM IN THEIR PLACE" CTA, later
 * on LookupPage's "Reset Fields") is the app's visual identity for any
 * button that performs a function (add/edit/delete/save/resolve/etc.).
 * This is the shared, reusable implementation — use it instead of
 * hand-rolling the clipPath + corner-chip markup per page.
 *
 * Note: `PrimaryCtaButton` remains for the ONE main per-page CTA (larger,
 * more decorated). This component is for every other function-performing
 * button — table row actions, secondary form actions, toolbar buttons.
 */
export function ClippedButton({
  onClick,
  type = "button",
  disabled = false,
  title,
  size = "sm",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  cornerBg,
  className = "",
  style,
  noTexture = false,
  noHighlight = false,
  borderColor,
  hoverBorderColor,
  borderWidth = 1.5,
  fillClassName,
  variant,
  children,
}: ClippedButtonProps) {
  const clipSize = size === "lg" ? 10 : size === "md" ? 8 : 6;
  const clipPath = (n: number) =>
    `polygon(100% 0, 100% calc(100% - ${n}px), calc(100% - ${n}px) 100%, 0 100%, 0 0)`;

  // When borderColor is set, the fill (style.background) moves off the
  // button itself and onto an inset layer — see the borderColor prop doc.
  // Only peel it out in that case; every other call site (the vast
  // majority, with no borderColor) must get `style` passed through
  // completely untouched, or its background would silently vanish since
  // nothing but the borderColor-only fill layer below would carry it.
  let fillBackground: React.CSSProperties["background"];
  let restStyle: React.CSSProperties = style || {};
  if (borderColor && style) {
    const { background, ...rest } = style;
    fillBackground = background;
    restStyle = rest;
  }

  // The inner highlight is a box-shadow, so it has to be merged with
  // whatever box-shadow a call site already passes (e.g. a drop shadow)
  // rather than overwriting it — box-shadow accepts a comma-separated
  // stack of shadows, inner and outer together.
  const { boxShadow: callerBoxShadow, ...styleWithoutShadow } = restStyle;
  restStyle = styleWithoutShadow;
  // "none" is a call site explicitly saying "no shadow" (common in a
  // dark/light ternary) — treat it the same as no shadow at all rather
  // than literally concatenating "none, inset ..." into an invalid,
  // browser-ignored box-shadow value.
  const hasCallerShadow = !!callerBoxShadow && callerBoxShadow !== "none";
  const mergedBoxShadow = noHighlight
    ? callerBoxShadow
    : hasCallerShadow
      ? `${callerBoxShadow}, ${INNER_HIGHLIGHT}`
      : INNER_HIGHLIGHT;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      // `isolate` gives this button its own stacking context so the
      // texture span's negative z-index below is scoped to just this
      // button (painted behind the label/icon, above the button's own
      // background) regardless of what stacking contexts exist further up
      // the tree — this is what lets the texture sit behind text without
      // wrapping `children` in an extra element (which would break the
      // flex/gap layouts every call site already relies on).
      className={`relative isolate overflow-hidden inline-flex items-center justify-center select-none transition-all active:scale-95 disabled:active:scale-100 ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${borderColor ? "clipped-btn-bordered" : ""} ${variant === "action" ? ACTION_VARIANT_CLASSNAME : ""} ${className}`}
      style={
        {
          // Only the bottom-right corner is clipped now — the top-right
          // corner used to get a matching "cut" via the decorative chip
          // overlay below, but that read as a second clip and was removed
          // per design feedback. `cornerBg` is kept in the prop signature
          // (call sites still pass it) even though it's now unused, so
          // existing callers don't need to be touched.
          clipPath: clipPath(clipSize),
          boxShadow: mergedBoxShadow,
          ...(borderColor
            ? {
                background: borderColor,
                "--clipped-border-hover-color": hoverBorderColor ?? borderColor,
              }
            : {}),
          ...restStyle,
        } as React.CSSProperties
      }
    >
      {borderColor && (
        <span
          aria-hidden="true"
          className={`absolute pointer-events-none ${fillClassName || ""}`}
          style={{
            top: borderWidth,
            left: borderWidth,
            right: borderWidth,
            bottom: borderWidth,
            background: fillBackground,
            clipPath: clipPath(Math.max(clipSize - borderWidth, 0)),
            zIndex: -2,
          }}
        />
      )}
      {!noTexture && (
        <span
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: -1, ...BUTTON_GRID_TEXTURE }}
        />
      )}
      {children}
    </button>
  );
}

export default ClippedButton;
