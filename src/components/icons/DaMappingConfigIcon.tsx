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
 * — a solid black glyph on a transparent background, no stroke). Rendered
 * as a CSS mask, same technique as OperationsControlIcon.tsx, so it fills
 * with `currentColor` exactly like every other sidebar icon — active/
 * inactive and light/dark all just work via the `color` the sidebar already
 * sets, with no separate pre-recolored asset needed. Used as `page.Icon`
 * (see App.tsx's navPage("plan_scope", "DA Mapping Config",
 * DaMappingConfigIcon, ...)), so it accepts the same className/style props
 * every lucide-react icon used in that slot does.
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
        ...style,
      }}
    />
  );
};

export default DaMappingConfigIcon;
