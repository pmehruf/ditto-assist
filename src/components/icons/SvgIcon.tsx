import React from "react";

interface SvgIconProps {
  /** Path to the SVG file (relative to public folder) */
  src: string;
  /** Width of the icon */
  width?: number | string;
  /** Height of the icon */
  height?: number | string;
  /** CSS class name for styling */
  className?: string;
  /** Alt text for accessibility */
  alt?: string;
  /** Color of the icon (applies to SVG with fill) */
  color?: string;
}

/**
 * Generic reusable SVG icon component
 * 
 * @example
 * ```tsx
 * <SvgIcon src="/icons/my-icon.svg" width={24} height={24} />
 * ```
 */
export const SvgIcon: React.FC<SvgIconProps> = ({
  src,
  width = 24,
  height = 24,
  className = "",
  alt = "Icon",
  color,
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 512 512"
      className={className}
      style={color ? { fill: color } : undefined}
      aria-label={alt}
      role="img"
    >
      <use href={`${src}#icon`} />
    </svg>
  );
};

/**
 * Alternative approach using img tag for better control
 */
export const SvgIconImage: React.FC<SvgIconProps> = ({
  src,
  width = 24,
  height = 24,
  className = "",
  alt = "Icon",
  color,
}) => {
  return (
    <img
      src={src}
      width={width}
      height={height}
      alt={alt}
      className={className}
      style={color ? { filter: `drop-shadow(0 0 0 ${color})` } : undefined}
    />
  );
};

/**
 * Inline SVG icon component for custom SVG content
 */
interface InlineSvgIconProps {
  /** SVG path data or content */
  children?: React.ReactNode;
  /** Width of the icon */
  width?: number | string;
  /** Height of the icon */
  height?: number | string;
  /** CSS class name for styling */
  className?: string;
  /** Color of the icon */
  color?: string;
  /** Alt text for accessibility */
  alt?: string;
}

export const InlineSvgIcon: React.FC<InlineSvgIconProps> = ({
  children,
  width = 24,
  height = 24,
  className = "",
  color = "#000000",
  alt = "Icon",
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 512 512"
      className={className}
      fill={color}
      aria-label={alt}
      role="img"
    >
      {children}
    </svg>
  );
};

export default SvgIcon;
