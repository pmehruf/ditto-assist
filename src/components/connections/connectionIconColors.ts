/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-connection icon tint helper — split out from ConnectionsTableUI.tsx
 * because that file's exports must stay component-only for Fast Refresh
 * (react-refresh/only-export-components), and this is a plain function.
 */
export type IconHue = "sky" | "violet" | "teal" | "amber" | "rose" | "indigo";

const ICON_HUES: Record<IconHue, { dark: string; light: string }> = {
  sky: { dark: "#38BDF8", light: "#0284C7" },
  violet: { dark: "#A78BFA", light: "#7C3AED" },
  teal: { dark: "#2DD4BF", light: "#0D9488" },
  amber: { dark: "#FBBF24", light: "#B45309" },
  rose: { dark: "#FB7185", light: "#E11D48" },
  indigo: { dark: "#818CF8", light: "#4F46E5" },
};

/** One color per connection (not per health state) so the six Connections
 * page rows are visually distinguishable at a glance — mirrors Team
 * Tracker's avatarColorFor pattern, just with a fixed hue per connection
 * identity instead of a hash, since there are only six and each should
 * stay recognizable across visits. */
export function iconColorFor(hue: IconHue, dark: boolean): { bg: string; fg: string } {
  const { dark: darkHex, light: lightHex } = ICON_HUES[hue];
  const fg = dark ? darkHex : lightHex;
  return { bg: `${fg}1A`, fg };
}
