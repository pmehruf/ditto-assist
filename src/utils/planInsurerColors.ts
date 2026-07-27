/**
 * Shared per-plan insurer brand-color lookup, used anywhere the UI wants to
 * give a card/tag a quiet hint of "which insurer this plan belongs to"
 * (e.g. the PED result card's left border in DeclarationAssistantResults.tsx,
 * and the Lookup page's queue card border/tags/counter). Centralized here so
 * every surface stays in sync when a new plan/insurer is added — previously
 * this lived only in DeclarationAssistantResults.tsx and had to be
 * hand-copied anywhere else it was needed.
 *
 * Colors are deliberately muted (lower saturation, mid lightness) rather than
 * each insurer's raw marketing hex, because this app already uses color
 * semantically elsewhere (the match-tier badges: green/blue/amber for
 * Level 1/2/3, plus red app-wide for Flag/error) — a fully-saturated brand
 * color would visually compete with that instead of reading as a quiet hint:
 *   - Care Health's brand yellow (#fadf00) sits close to the Level 3
 *     "Fallback" amber (#FCD34D/#B45309) — muted into a duller olive so a
 *     Care Supreme card doesn't look pre-flagged as a fallback match.
 *   - Aditya Birla's brand red (#c91429/#b51023) and HDFC ERGO's brand red
 *     (#d82a1b) are both muted, and shifted to distinguishable hues (wine
 *     vs. terracotta) — both raw are close enough to each other, and to the
 *     app's Flag/error red, that they'd otherwise read as one interchangeable
 *     "something's off" color across 3 of our plans.
 *   - Niva Bupa's brand accent blue (#00b0f6) sits far too close to BOTH the
 *     Level 2 "Category Match" tier badge (#93C5FD/#1D4ED8, a periwinkle
 *     blue) and the app's own bright accent-blue chrome — muted AND
 *     hue-shifted toward teal (blue-green) instead of kept as a straight
 *     blue, so it reads as clearly its own color at a glance.
 */

// Flat neutral fallback for any plan without a known insurer mapping.
export const PED_BORDER_COLOR = { light: "#36454F", dark: "#C0C0C0" };

export const PLAN_INSURER_BORDER_COLOR: Record<string, { light: string; dark: string }> = {
  // HDFC ERGO — brand red #d82a1b, muted into a duller terracotta/rust.
  // Light value darkened/more saturated from the original #B5493B — a
  // mid-tone color has much less luminance contrast against a light
  // background than the same hue's pastel dark-theme counterpart has
  // against a dark background, so the left border read as barely-there
  // pale pink in light theme even though the equivalent dark-theme value
  // looked bold and clearly visible.
  "Optima Secure": { light: "#9B3223", dark: "#C97B6E" },
  // Care Health Insurance — brand yellow #fadf00, muted into a duller,
  // darker olive/mustard so it can't be mistaken for the amber tier badge.
  "Care Supreme": { light: "#8A7B1F", dark: "#B3A44A" },
  // Aditya Birla Health Insurance ("Activ" product family) — brand red
  // #c91429/#b51023, muted into a duller wine/maroon, kept distinct from
  // HDFC ERGO's warmer terracotta above.
  "Activ One Max": { light: "#9C3A52", dark: "#C97490" },
  "Activ Fit Preferred": { light: "#9C3A52", dark: "#C97490" },
  // Niva Bupa (Aspire, Reassure 2.0) — brand accent blue #00b0f6, muted and
  // shifted toward teal so it can't be mistaken for the Level 2 badge or the
  // app's own accent-blue chrome.
  "Aspire": { light: "#2E7A80", dark: "#7FC4C9" },
  "Reassure 2.0": { light: "#2E7A80", dark: "#7FC4C9" },
};

/** Resolves the light/dark border-color pair for a plan, falling back to the
 * flat neutral PED_BORDER_COLOR for any plan without a known insurer. */
export function getPlanInsurerColor(planName: string | undefined | null): { light: string; dark: string } {
  return (planName && PLAN_INSURER_BORDER_COLOR[planName]) || PED_BORDER_COLOR;
}

/** Converts a "#RRGGBB" hex string to an "rgba(r, g, b, alpha)" string, for
 * building subtle tinted fills/borders (e.g. queue tag chips) from the same
 * solid insurer hex used for borders/counters elsewhere. */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Readable text color to pair with a plan's SOLID insurer accent (e.g. the
 * queue counter badge). Dark-theme accent values in PLAN_INSURER_BORDER_COLOR
 * are deliberately the lighter/pastel member of each insurer's muted pair
 * (for visibility against a dark app background), so dark text reads best on
 * them; light-theme values are the deeper member, so white text reads best. */
export function getContrastTextForPlanColor(theme: "light" | "dark"): string {
  return theme === "dark" ? "#1A1206" : "#FFFFFF";
}
