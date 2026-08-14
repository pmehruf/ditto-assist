/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

type ProductAssistIconProps = React.SVGProps<SVGSVGElement>;

/**
 * Product Assist icon — a speech bubble with a sparkle accent.
 *
 * Rendered as a stroke-based line icon using the exact same SVG root
 * conventions as every lucide-react icon in this sidebar (viewBox 0 0 24 24,
 * fill="none", stroke="currentColor", strokeWidth 2, round caps/joins) so it
 * is guaranteed to match its siblings' color and visual weight exactly —
 * confirmed by inspecting a live lucide <Sparkles> icon's rendered SVG
 * attributes and mirroring them here.
 *
 * This replaces three earlier attempts that all preserved the original
 * painterly PNG artwork's exact shape and kept coming back "still not
 * fixed":
 *  1. <img> + CSS invert(1) filter — could only ever render white/grey,
 *     never a real color match.
 *  2. CSS mask-image + background-color: currentColor — did follow
 *     currentColor, but the source art's ink was only ~60% opaque on
 *     average, reading as washed out once scaled down to icon size.
 *  3. A real inline <svg><path fill="currentColor"> traced from the
 *     artwork's alpha-channel contours — color was verified byte-for-byte
 *     identical to sibling icons via computed styles, but the traced
 *     shape's "ink" was a razor-thin sliver of fill (tracing a thin
 *     painted stroke as solid fill), so almost no pixels were actually
 *     painted at 15-24px — it read as faint/dark not because the hue was
 *     wrong, but because there was barely any icon there.
 * The fix here abandons literal artwork tracing and instead redraws the
 * same bubble+sparkle motif using normal icon strokes at native weight,
 * the same way every other icon in this sidebar already works.
 *
 * @example
 * ```tsx
 * <ProductAssistIcon className="w-4 h-4 shrink-0 text-blue-300" />
 * ```
 */
export const ProductAssistIcon: React.FC<ProductAssistIconProps> = ({
  className = "",
  ...rest
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Product Assist"
      role="img"
      {...rest}
    >
      {/* Speech bubble body + tail */}
      <path d="M3 9.5A2.5 2.5 0 0 1 5.5 7h6A2.5 2.5 0 0 1 14 9.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3 2.5v-2.5A2.5 2.5 0 0 1 3 13.5Z" />
      {/* Sparkle accent — solid fill (not stroked) so it stays crisp at tiny sizes */}
      <path
        fill="currentColor"
        stroke="none"
        d="M20 1.8 L21.1 3.9 L23.2 5 L21.1 6.1 L20 8.2 L18.9 6.1 L16.8 5 L18.9 3.9 Z"
      />
    </svg>
  );
};

export default ProductAssistIcon;
