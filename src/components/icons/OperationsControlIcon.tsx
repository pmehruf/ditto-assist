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
 * operations-control.svg — a solid-fill glyph on a transparent background,
 * no stroke). Rendered as a CSS mask rather than a plain `<img>` so it
 * fills with `currentColor` exactly like every other lucide-react icon used
 * as a sidebar `GroupIcon` — active/inactive, light/dark all just work
 * automatically via the same `color` the sidebar already sets on the
 * button, with no separate pre-recolored variant to generate/maintain.
 *
 * Two adjustments vs. a bare mask of the raw asset, both purely rendering
 * treatment — the glyph/path data itself is untouched:
 *  1. The source SVG's `viewBox` was tightened (assets/.aistudio/
 *     operations-control.svg) to trim the ~30-40% of empty canvas margin
 *     around the artwork that a naive `mask-size: contain` would otherwise
 *     preserve, so the visible glyph — not the padded canvas — fills the
 *     icon slot the same way a lucide icon's glyph fills its 24x24 viewBox.
 *  2. `filter: blur() contrast()` — the same "poor man's dilate" this icon
 *     used previously (when it masked a thinner-lined PNG): even after the
 *     crop, this glyph's linework measured visibly thinner (~0.11-0.16 ink
 *     coverage of its bounding box) than its lucide siblings (~0.25-0.32),
 *     so the blur spreads each edge's alpha outward a little and the steep
 *     contrast curve snaps those spread edges back toward fully opaque,
 *     netting a bolder silhouette that reads at roughly the same visual
 *     weight as the surrounding icons with no separate re-exported asset.
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
        filter: "blur(0.5px) contrast(14)",
        ...style,
      }}
    />
  );
};

export default OperationsControlIcon;
