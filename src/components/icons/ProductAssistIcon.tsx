/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface ProductAssistIconProps extends Omit<React.SVGProps<SVGSVGElement>, "color"> {
  /** Width of the icon */
  width?: number | string;
  /** Height of the icon */
  height?: number | string;
  /** CSS class name for styling */
  className?: string;
  /** Stroke color of the icon */
  color?: string;
}

/**
 * Product Assist icon — a headset (advisor support) paired with a small
 * speech bubble (conversation), drawn as one lucide-style stroke icon so it
 * drops in anywhere a lucide-react icon is used today (same
 * width/height/className/color props, 24x24 viewBox matching lucide's own
 * coordinate space — see QaDashboardIcon.tsx / DeclarationMapIcon.tsx for
 * the same convention).
 *
 * Deliberately NOT a chat-bubble-only or robot/bot glyph — the combined
 * silhouette reads as "an assistant you can ask for help" rather than a
 * generic AI chatbot, per the product's intent for this tool.
 *
 * @example
 * ```tsx
 * <ProductAssistIcon className="w-4 h-4 shrink-0 text-blue-300" />
 * ```
 */
export const ProductAssistIcon: React.FC<ProductAssistIconProps> = ({
  width = 24,
  height = 24,
  className = "",
  color = "currentColor",
  ...rest
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Product Assist"
      role="img"
      {...rest}
    >
      {/* Headset — band + two ear cups */}
      <path d="M3 12a6 6 0 0 1 12 0" />
      <rect x="2" y="11" width="3.4" height="6.5" rx="1.6" />
      <rect x="11.6" y="11" width="3.4" height="6.5" rx="1.6" />
      {/* Speech bubble — the conversation the headset represents */}
      <rect x="13.5" y="2" width="9" height="7" rx="2.2" />
      <path d="M16 9 L14.3 11.8 L18 9.6 Z" fill={color} stroke="none" />
    </svg>
  );
};

export default ProductAssistIcon;
