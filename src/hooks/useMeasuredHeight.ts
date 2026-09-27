/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Live-measures an element's content-box height via ResizeObserver, so a
 * sibling elsewhere on the page can be set to that exact pixel height (see
 * LookupIntroPage.tsx: the "Updates - Live feed" card matches the left
 * column's total height, and the "Did you know!?" card matches the QA
 * Performance + Announcement Counter + reference-tiles cell's height) — the
 * two edges land on
 * the same line by construction (the browser's own layout is the source of
 * truth), not hand-computed guesswork, and it stays correct as content
 * changes (a Quick Guide panel opening, an Insight's length changing, etc.).
 *
 * `active` gates the whole thing — pass `false` below the breakpoint where
 * the two elements no longer sit side by side, and the returned height
 * resets to `null` (the caller should treat that as "no inline height,
 * render at natural content height instead").
 */
export function useMeasuredHeight(active: boolean): [RefObject<HTMLDivElement>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [heightPx, setHeightPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setHeightPx(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      const raw = box ? box.blockSize : entry.contentRect.height;
      // Rounded — ResizeObserver reports fractional (sub-pixel) heights,
      // and setting a fractional `height` style on the target element can
      // round differently than the source did, showing up as a visible
      // ~1px seam between the two elements' bottom edges at some zoom
      // levels even though they're "the same" height by construction.
      setHeightPx(Math.round(raw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  return [ref, heightPx];
}

export default useMeasuredHeight;
