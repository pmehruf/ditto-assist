/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface PrimaryCtaButtonProps {
  theme: "light" | "dark" | string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  id?: string;
  /**
   * "accent" (default) matches the Home page's cyan/blue CTA.
   * "danger" keeps the same clipped-corner shape and typography but in red —
   * for the rare page whose single primary action is itself a warning/report
   * action (e.g. "Submit Report" in the Flag dialog).
   */
  variant?: "accent" | "danger";
  /** Extra classes for layout — margins, width, self-alignment, etc. */
  className?: string;
  /** Extra inline style overrides (e.g. custom margins), merged after the base style. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Shared "primary action" CTA button — the clipped-corner, uppercase mono
 * button style originated on the Declaration Assistant Home page ("LETS PUT
 * THEM IN THEIR PLACE"). Extracted here so every page's single main action
 * button (Find a Match, Submit Report, Sign in, Add, etc.) shares the same
 * visual identity, matching the Home page.
 *
 * Only the ONE primary action per page should use this — secondary/utility
 * buttons (Cancel, Reset, filters, Ignore, etc.) keep their own styling.
 *
 * @example
 * <PrimaryCtaButton theme={theme} onClick={handleSubmit} className="self-start">
 *   Find a Match
 * </PrimaryCtaButton>
 */
export function PrimaryCtaButton({
  theme,
  onClick,
  type = "button",
  disabled = false,
  title,
  id,
  variant = "accent",
  className = "",
  style,
  children,
}: PrimaryCtaButtonProps) {
  const dark = theme === "dark";
  const isDanger = variant === "danger";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      id={id}
      // `isolate` scopes the texture span's negative z-index to this button
      // alone (see ClippedButton.tsx's BUTTON_GRID_TEXTURE for the same
      // pattern) — texture paints behind the label, above the button's own
      // background, without needing to wrap `children`.
      className={`px-6 border-[1.5px] text-xs font-mono uppercase font-bold tracking-[0.2em] transition-all select-none relative isolate overflow-hidden ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${
        isDanger
          ? "bg-red-600 border-red-600 text-white hover:bg-red-700 hover:border-red-700 hover:shadow-[0_0_40px_rgba(220,38,38,0.15)]"
          : dark
            ? "bg-[#00afce] text-[#0a0a0c] border-[#00afce] hover:bg-[#009cb8] hover:border-[#009cb8] hover:shadow-[0_0_40px_rgba(0,175,206,0.15)]"
            : "hover:bg-[#06469c] hover:border-[#06469c]"
      } ${className}`}
      style={{
        clipPath: "polygon(100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 0)",
        paddingTop: "clamp(8px, 1.2vh, 12px)",
        paddingBottom: "clamp(8px, 1.2vh, 12px)",
        backgroundColor: !isDanger && !dark ? "var(--accent-solid)" : undefined,
        color: !isDanger && !dark ? "var(--on-accent)" : undefined,
        borderColor: !isDanger && !dark ? "var(--accent-solid)" : undefined,
        ...style,
      }}
    >
      {/* Grid texture veneer — matches the Home page CTA's original look,
          now applied to every ClippedButton too (see ClippedButton.tsx) so
          the whole app's buttons share one consistent surface. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: -1,
          backgroundImage:
            "linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.08) 50%), linear-gradient(90deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.025) 50%)",
          backgroundSize: "100% 3px, 3px 100%",
        }}
      />
      {children}
    </button>
  );
}

export default PrimaryCtaButton;
