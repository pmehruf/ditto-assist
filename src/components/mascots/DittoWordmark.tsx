/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

// Beautiful custom Ditto wordmark logo using uploaded ditto-logo.png asset
export function DittoWordmark({ className = "", isWhite = false, style, imgStyle }: { className?: string; isWhite?: boolean; style?: React.CSSProperties; imgStyle?: React.CSSProperties }) {
  return (
    <div className={`flex items-center select-none ${className}`} style={{ ...style, height: "26px" }}>
      <img
        src="/assets/.aistudio/ditto-logo.png"
        alt="Ditto Logo"
        referrerPolicy="no-referrer"
        className="h-full object-contain"
        style={{
          filter: isWhite ? "invert(1) hue-rotate(180deg)" : "none",
          maxHeight: "26px",
          ...imgStyle
        }}
      />
    </div>
  );
}
