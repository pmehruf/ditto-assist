/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Uniformly scales a fixed-width "canonical" layout to fit whatever space
 * its parent gives it — laptop, monitor, TV, doesn't matter — so the
 * content NEVER needs to scroll and NEVER overflows, the same way an image
 * with `object-fit: contain` resizes to fill its frame without distorting.
 *
 * How it works: `children` render at a fixed `baseWidth` (so CSS Grid/Flex
 * columns compute real proportions instead of collapsing to their
 * min-content width) inside an absolutely-positioned, centered box. A
 * ResizeObserver on both the outer frame (available space) and the inner
 * box (content's natural, unscaled height — which varies with real data:
 * announcement counts, recent-search rows, etc.) recomputes
 * `scale = min(availableWidth / naturalWidth, availableHeight / naturalHeight)`
 * on every change and applies it via `transform: scale()`. Because CSS
 * transforms don't affect layout geometry (only paint), `offsetWidth` /
 * `offsetHeight` on the inner box keep reporting its true unscaled size
 * even while it's visibly scaled — that's what makes re-measuring safe to
 * do continuously without feedback loops.
 *
 * IMPORTANT: anything that must stay pinned to the real viewport (modals,
 * `position: fixed` overlays) must render OUTSIDE this component — a CSS
 * `transform` on an ancestor makes that ancestor the containing block for
 * `position: fixed` descendants, so a fixed-positioned modal rendered
 * *inside* `children` would get scaled and mispositioned along with
 * everything else instead of covering the real screen.
 */
export function ScaleToFit({
  children,
  baseWidth,
  className = "",
}: {
  children: ReactNode;
  /** The canonical design width (px) content is authored at before scaling. */
  baseWidth: number;
  className?: string;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const recompute = () => {
      const naturalW = inner.offsetWidth;
      const naturalH = inner.offsetHeight;
      const availW = outer.clientWidth;
      const availH = outer.clientHeight;
      if (naturalW === 0 || naturalH === 0 || availW === 0 || availH === 0) return;
      setScale(Math.min(availW / naturalW, availH / naturalH));
      setReady(true);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={`relative w-full h-full min-h-0 overflow-hidden ${className}`}>
      <div
        ref={innerRef}
        style={{
          width: baseWidth,
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          visibility: ready ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
