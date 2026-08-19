/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface OperationsControlIconProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Operations Control's sidebar group icon (assets/.aistudio/
 * operations-control.svg — a solid black glyph on a transparent
 * background, no stroke). Rendered as a CSS mask rather than a plain
 * `<img>` so it fills with `currentColor` exactly like every other
 * lucide-react icon used as a sidebar `GroupIcon` — active/inactive,
 * light/dark all just work automatically via the same `color` the sidebar
 * already sets on the button, with no separate pre-recolored variant to
 * generate/maintain.
 *
 * (Previously masked assets/.aistudio/network.png, a thin-lined PNG that
 * needed a `blur()+contrast()` dilation hack to read at sidebar size — this
 * SVG is a solid filled glyph, so that hack is gone.)
 */
export const OperationsControlIcon: React.FC<OperationsControlIconProps> = ({ className, style }) => {
  return (
    <span
      aria-hidden="true"
      role="img"
      className={className}
      style={{
        display: "inline-block",
        backgroundColor: "currentColor",
        WebkitMaskImage: "url(/assets/.aistudio/operations-control.svg)",
        maskImage: "url(/assets/.aistudio/operations-control.svg)",
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

export default OperationsControlIcon;
