/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface ProductAssistIconProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "color"> {
  /** Width of the icon */
  width?: number | string;
  /** Height of the icon */
  height?: number | string;
  /** CSS class name for styling */
  className?: string;
  /** Accepted for API compatibility with the lucide-style icon components
   * this replaced (className/style/width/height are the ones that matter
   * for a raster image) — unused, since a PNG's own colors can't be
   * recolored via a stroke/fill prop the way an inline SVG's can. */
  color?: string;
}

/**
 * Product Assist icon — the actual approved artwork
 * (assets/.aistudio/Product Assist.png: a speech bubble with sparkle
 * accents), used verbatim per explicit product decision rather than a
 * redrawn/substituted icon. The source PNG is a black stroke on a
 * transparent background; every place this component is used today sits on
 * dark sidebar/header chrome, so it's rendered inverted to white via CSS
 * filter — this only changes how the existing pixels are displayed, not
 * the artwork itself.
 *
 * @example
 * ```tsx
 * <ProductAssistIcon className="w-4 h-4 shrink-0" />
 * ```
 */
export const ProductAssistIcon: React.FC<ProductAssistIconProps> = ({
  width = 24,
  height = 24,
  className = "",
  style,
  ...rest
}) => {
  return (
    <img
      src="/assets/.aistudio/Product%20Assist.png"
      alt="Product Assist"
      width={width}
      height={height}
      className={className}
      style={{ filter: "invert(1)", objectFit: "contain", ...style }}
      {...rest}
    />
  );
};

export default ProductAssistIcon;
