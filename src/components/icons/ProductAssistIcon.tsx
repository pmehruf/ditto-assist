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
  /** Color of the icon */
  color?: string;
}

// Traced from the approved artwork (a speech bubble with two sparkle
// accents) — outer/hole contour pairs extracted from the source PNG's alpha
// channel (OpenCV findContours + approxPolyDP), rendered with fill-rule
// evenodd so each shape's hollow stroke interior stays hollow. This
// replaces two earlier attempts that both fell short:
//  1. An <img> with a CSS invert(1) filter — can only ever show the PNG's
//     own baked-in pixels, so it was always a fixed grey/white, never any
//     sibling icon's `text-blue-300` etc.
//  2. A CSS mask (background-color: currentColor, masked by the PNG's own
//     alpha) — did follow currentColor, but the source artwork's ink is
//     only ~60% opaque on average at its native 945x945 size (soft,
//     painterly strokes), which is invisible at that size but becomes most
//     of what's left on screen once scaled down to a ~16-24px sidebar icon,
//     reading as washed-out no matter how the alpha was cleaned up.
// A real <svg> with fill="currentColor" is what every other icon here
// already is (DeclarationMapIcon, lucide's own icons) — it has no alpha
// channel to wash out and no raster/mask pipeline to fall out of sync with
// `text-*` classNames, so it's the only version of this icon guaranteed to
// exactly match its siblings' color at every size.
const PRODUCT_ASSIST_PATH =
  "M 570,387 L 559,395 L 528,458 L 518,467 L 458,495 L 451,503 L 450,513 L 453,520 L 459,525 L 506,546 L 525,557 L 535,572 L 559,622 L 568,629 L 577,630 L 584,627 L 589,622 L 618,563 L 633,550 L 691,523 L 696,517 L 697,505 L 690,495 L 628,466 L 619,457 L 588,393 L 583,389 Z " +
  "M 571,397 L 577,397 L 581,400 L 610,461 L 622,474 L 682,502 L 688,510 L 683,516 L 629,541 L 617,549 L 608,560 L 581,616 L 576,620 L 572,620 L 567,616 L 539,559 L 531,549 L 504,534 L 464,516 L 460,512 L 460,507 L 464,503 L 524,475 L 536,464 L 567,401 Z " +
  "M 69,337 L 58,383 L 60,654 L 98,721 L 166,748 L 166,926 L 177,939 L 197,935 L 414,756 L 804,755 L 860,732 L 903,676 L 911,381 L 880,306 L 853,284 L 806,268 L 544,268 L 528,283 L 541,308 L 803,309 L 858,342 L 873,381 L 873,642 L 863,671 L 839,699 L 798,716 L 403,717 L 205,879 L 203,719 L 132,697 L 97,645 L 96,382 L 108,347 L 136,320 L 240,308 L 253,282 L 237,268 L 142,273 L 99,297 Z " +
  "M 877,318 L 901,376 L 901,643 L 888,685 L 857,722 L 796,746 L 411,746 L 190,928 L 177,926 L 176,741 L 105,714 L 83,687 L 68,641 L 68,379 L 76,346 L 104,306 L 159,279 L 236,278 L 244,287 L 236,299 L 172,299 L 130,312 L 99,343 L 86,386 L 88,648 L 122,702 L 194,722 L 197,896 L 407,726 L 795,726 L 852,701 L 883,638 L 883,383 L 865,335 L 807,300 L 545,299 L 537,287 L 549,277 L 800,277 L 847,292 Z " +
  "M 350,11 L 343,14 L 335,23 L 285,129 L 272,140 L 183,186 L 176,196 L 175,204 L 184,219 L 276,267 L 287,278 L 336,382 L 345,391 L 361,393 L 368,390 L 377,380 L 426,276 L 438,266 L 528,219 L 535,211 L 537,201 L 533,190 L 526,184 L 441,141 L 425,127 L 377,23 L 366,12 Z " +
  "M 354,20 L 361,21 L 368,27 L 413,127 L 424,141 L 439,151 L 520,192 L 527,200 L 522,211 L 432,258 L 419,269 L 405,294 L 367,377 L 360,383 L 352,383 L 344,376 L 308,297 L 290,266 L 273,254 L 190,211 L 185,204 L 187,196 L 192,192 L 278,148 L 294,134 L 344,27 Z";

/**
 * Product Assist icon — the actual approved artwork, traced to SVG (see
 * PRODUCT_ASSIST_PATH above for why raster-based approaches didn't hold up).
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
      viewBox="0 0 945 945"
      className={className}
      fill={color}
      fillRule="evenodd"
      aria-label="Product Assist"
      role="img"
      {...rest}
    >
      <path d={PRODUCT_ASSIST_PATH} />
    </svg>
  );
};

export default ProductAssistIcon;
