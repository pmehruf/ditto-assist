/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface DaMappingConfigIconProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * "DA Mapping Config" nav item icon (assets/.aistudio/da-mapping-config.svg
 * — a solid-fill glyph on a transparent background, no stroke). Rendered as
 * a CSS mask, same technique as OperationsControlIcon.tsx, so it fills with
 * `currentColor` exactly like every other sidebar icon — active/inactive
 * and light/dark all just work via the `color` the sidebar already sets.
 * Used as `page.Icon` (see App.tsx's navPage("plan_scope", "DA Mapping
 * Config", DaMappingConfigIcon, ...)), so it accepts the same
 * className/style props every lucide-react icon used in that slot does.
 *
 * Same two rendering-treatment adjustments as OperationsControlIcon, for
 * the same reason (glyph/path data itself untouched):
 *  1. The source SVG's `viewBox` was tightened (assets/.aistudio/
 *     da-mapping-config.svg) to trim the empty side margins a naive
 *     `mask-size: contain` would otherwise preserve. This glyph is
 *     genuinely taller than it is wide (its trimmed artwork is ~365x512),
 *     so it will still render narrower than a perfectly square lucide icon
 *     even after this crop — that's the glyph's real shape, not leftover
 *     canvas whitespace.
 *  2. `filter: blur() contrast()` dilation — this glyph's linework measured
 *     visibly thinner (~0.13-0.16 ink coverage) than its lucide siblings
 *     (~0.25-0.32) even after the crop, so the same blur+contrast treatment
 *     used on OperationsControlIcon is applied here to bring its apparent
 *     line weight back in line with the rest of the sidebar.
 */
export const DaMappingConfigIcon: React.FC<DaMappingConfigIconProps> = ({ className, style }) => {
  return (
    <span
      aria-hidden="true"
      role="img"
      className={className}
      style={{
        display: "inline-block",
        backgroundColor: "currentColor",
        WebkitMaskImage: "url(/assets/.aistudio/da-mapping-config.svg)",
        maskImage: "url(/assets/.aistudio/da-mapping-config.svg)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        filter: "blur(0.5px) contrast(14)",
        ...style,
      }}
    />
  );
};

export default DaMappingConfigIcon;
