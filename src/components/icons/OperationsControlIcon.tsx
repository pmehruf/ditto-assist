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
 * Operations Control's sidebar group icon — a "network of nodes" glyph
 * (assets/.aistudio/network.png: solid black line-art on a transparent
 * background). Rendered as a CSS mask rather than a plain `<img>` so it
 * fills with `currentColor` exactly like every other lucide-react icon used
 * as a sidebar `GroupIcon` — active/inactive, light/dark, hover all just
 * work automatically via the same `color` the sidebar already sets on the
 * button, with no separate pre-recolored PNG variants to generate/maintain.
 *
 * The source artwork's line weight is noticeably thinner than
 * lucide-react's default `strokeWidth={2}` (measured ~4% of icon size vs
 * lucide's ~8.3%), which read as visibly thin next to the other sidebar
 * icons. `filter: blur() contrast()` is the standard CSS-only "poor man's
 * dilate": the blur spreads each edge's alpha outward a little, and the
 * steep contrast curve then snaps those spread edges back toward fully
 * opaque, netting a thicker silhouette with no separate re-exported PNG
 * asset needed. Tuned by rendering at the actual sidebar size (~22px) next
 * to the original — see conversation for the side-by-side comparison.
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
        WebkitMaskImage: "url(/assets/.aistudio/network.png)",
        maskImage: "url(/assets/.aistudio/network.png)",
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

export default OperationsControlIcon;
