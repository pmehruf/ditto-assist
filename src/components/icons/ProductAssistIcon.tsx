/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Bot } from "lucide-react";

interface ProductAssistIconProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * "Product Assist" nav item icon — lucide's `Bot`, kept as the same concept/
 * glyph, just with a nudged `strokeWidth`. Measured against its actual
 * sidebar neighbors (Sparkles, FileSpreadsheet, ClipboardCheck — rendered
 * ink coverage ~0.30-0.32 of their bounding box at lucide's default
 * strokeWidth=2), Bot's own linework renders noticeably thinner at the same
 * strokeWidth (~0.25) purely because its shapes (a wide rounded rect body +
 * few short lines) leave more open space than its neighbors' denser
 * linework — not a concept mismatch, just a bit light next to them.
 * strokeWidth 2.4 (vs the lucide default of 2) brings its rendered ink
 * coverage back in line with its neighbors' (~0.30) without changing the
 * glyph itself or its rendered size.
 */
export const ProductAssistIcon: React.FC<ProductAssistIconProps> = ({ className, style }) => {
  return <Bot className={className} style={style} strokeWidth={2.4} />;
};

export default ProductAssistIcon;
