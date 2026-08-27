/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface ScaleToFitProps {
  children: ReactNode;
  /** No-op passthrough (renders `children` directly, no measuring/transform)
   * when false — used to keep this effect scoped to desktop/large-monitor
   * viewports only. Below that, the existing responsive/stacked layout
   * already works correctly and untouched. */
  active: boolean;
  className?: string;
}

/**
 * "Poster" scaling for the Home dashboard's desktop composition — the whole
 * block (greeting + two-column grid) is authored at one fixed reference
 * width so every internal proportion (tile grid, QA Performance vs
 * Announcements) is deterministic, then uniformly scaled via a single CSS
 * `transform: scale()` (contain-fit, like `object-fit: contain` on an
 * image) to whatever space is actually available — larger monitor, larger
 * scale; smaller window, smaller scale. Because it's one uniform transform
 * applied to the whole composition, every relative position (including "QA
 * Performance's card bottom lines up with the Announcement card's bottom")
 * stays exactly true at every size — that alignment is guaranteed by the
 * fixed-width design itself (see LookupIntroPage.tsx's height-matching
 * effect), not by this component.
 *
 * How it works: `innerRef` renders `children` at a fixed width (set by the
 * caller via className, e.g. `w-[1536px]`) with no outer constraint, so its
 * rendered box is its true natural/unscaled size. A `ResizeObserver` on
 * that box reports this natural size — transforms never affect the box a
 * ResizeObserver reports (only paint), so this stays accurate regardless of
 * the scale currently applied, meaning there's no feedback loop between
 * "current scale" and "measured natural size." A second `ResizeObserver` on
 * `outerRef` (this component's own slot in the page) reports the actual
 * available space. `scale` is then the largest factor that fits the
 * natural box inside the available space on both axes at once (contain­
 * fit), floored so the composition never becomes illegibly small.
 */
export function ScaleToFit({ children, active, className = "" }: ScaleToFitProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [outerSize, setOuterSize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    if (!active) return;
    const outerEl = outerRef.current;
    const innerEl = innerRef.current;
    if (!outerEl || !innerEl) return;

    const readBox = (entry: ResizeObserverEntry) => {
      const box = entry.contentBoxSize?.[0];
      return box ? { w: box.inlineSize, h: box.blockSize } : { w: entry.contentRect.width, h: entry.contentRect.height };
    };

    const roOuter = new ResizeObserver((entries) => {
      if (entries[0]) setOuterSize(readBox(entries[0]));
    });
    const roInner = new ResizeObserver((entries) => {
      if (entries[0]) setNaturalSize(readBox(entries[0]));
    });
    roOuter.observe(outerEl);
    roInner.observe(innerEl);
    return () => {
      roOuter.disconnect();
      roInner.disconnect();
    };
  }, [active]);

  if (!active) {
    return <>{children}</>;
  }

  const canScale = naturalSize.w > 0 && naturalSize.h > 0 && outerSize.w > 0 && outerSize.h > 0;
  const rawScale = canScale ? Math.min(outerSize.w / naturalSize.w, outerSize.h / naturalSize.h) : 1;
  // Never scale up beyond a sane ceiling (an ultra-wide monitor shouldn't
  // balloon text past comfortable reading size). The legibility floor used
  // to be 0.6, but that turned into a real bug once the app-wide auto-zoom
  // feature shipped (autoZoom.ts): on a large/zoomed monitor the natural
  // (unscaled) composition height grew relative to the available box, so
  // the fit-to-space ratio needed to go below 0.6 — the floor forced a
  // bigger `scale` than actually fit, so `scaledHeight` (naturalH * scale)
  // exceeded the real available space and pushed the app's pinned footer
  // off-screen, requiring a scroll to see it (exactly the "never below a
  // legibility floor" comment's failure mode, just triggered by zoom
  // instead of a cramped window). Lowered so contain-fit's own guarantee —
  // this composition never exceeds its box — always wins over legibility;
  // 0.4 still keeps text readable at any monitor size this ships to.
  const scale = Math.min(Math.max(rawScale, 0.4), 1.6);
  const scaledHeight = naturalSize.h > 0 ? naturalSize.h * scale : undefined;

  return (
    <div ref={outerRef} className={`relative w-full flex justify-center overflow-hidden ${className}`} style={{ height: scaledHeight }}>
      <div
        ref={innerRef}
        style={{
          transform: canScale ? `scale(${scale})` : undefined,
          transformOrigin: "top center",
          // Only visible once measured/scaled — avoids a one-frame flash of
          // the unscaled, oversized natural-width composition.
          visibility: canScale ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default ScaleToFit;
