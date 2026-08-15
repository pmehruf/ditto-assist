import React from "react";

interface QaDashboardIconProps extends Omit<React.SVGProps<SVGSVGElement>, "color"> {
  /** Width of the icon */
  width?: number | string;
  /** Height of the icon */
  height?: number | string;
  /** CSS class name for styling */
  className?: string;
  /** Stroke color of the icon */
  color?: string;
}

/** Five-pointed star outline, centered at (cx, cy), alternating outer/inner radius. */
function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

// Five star centers arranged in a ring (one star pointing straight up), mirroring
// the reference artwork — a "5 stars in a circle" QA-rating motif.
//
// RING_RADIUS/STAR_OUTER were previously 26/13 with strokeWidth 7: at that
// ratio, adjacent stars' bounding circles nearly touch (gap of only ~4.5
// units against a stroke that extends ~3.5 units past each path), so the
// thick outlines bridged the gaps and fused into one closed flower/gear
// shape instead of 5 legible individual stars — defeating the "5-star
// rating" motif entirely. Pushing the ring out and slimming both the stars
// and the stroke (verified at the actual sidebar render size, ~22px, via a
// live side-by-side in Chrome) keeps a clear gap between every star while
// each one stays large enough to still read as a star, not a dot.
const RING_RADIUS = 32;
const STAR_OUTER = 12;
const STAR_INNER = 4.8;
const STAR_CENTERS = Array.from({ length: 5 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
  return { x: 50 + RING_RADIUS * Math.cos(angle), y: 50 + RING_RADIUS * Math.sin(angle) };
});

/**
 * QA Dashboard Icon — five outlined stars arranged in a ring (QA scoring
 * motif). Drawn as a lucide-style stroke icon (currentColor stroke, no
 * fill, round joins/caps) so it's a drop-in replacement anywhere a
 * lucide-react icon is used — same className/style/width/height props work,
 * matching the convention set by DeclarationMapIcon.
 *
 * @example
 * ```tsx
 * <QaDashboardIcon className="w-4.5 h-4.5 shrink-0 text-cyan-400" />
 * ```
 */
export const QaDashboardIcon: React.FC<QaDashboardIconProps> = ({
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
      viewBox="0 0 100 100"
      fill="none"
      stroke={color}
      strokeWidth={5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="QA Dashboard"
      role="img"
      {...rest}
    >
      {STAR_CENTERS.map((c, i) => (
        <polygon key={i} points={starPoints(c.x, c.y, STAR_OUTER, STAR_INNER)} />
      ))}
    </svg>
  );
};

export default QaDashboardIcon;
