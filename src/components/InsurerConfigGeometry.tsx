/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Coverage Projection Assist — insurer tab row + configuration panel
 * geometry (2026-09, v7).
 *
 * Earlier passes gave only the ACTIVE tab a special connected shape and
 * left every other tab as a plain rounded-rectangle button — which read
 * as "one merged tab plus a row of separate buttons" rather than one
 * consistent tab strip. v7 draws every tab, active or not, from the same
 * slanted "file tab" trapezoid (rounded top corners, both sides sloped
 * inward as they descend) via ONE shared SVG overlay; the buttons
 * themselves become fully transparent hit-targets used only for layout,
 * click handling, and the tab/tabpanel accessibility wiring.
 *
 * The active tab's own path is the one exception: it never draws its
 * bottom edge (the seam with the panel), and the panel's own outline
 * never draws the matching span of its top edge — both numbers come from
 * the SAME live measurement (`useInsurerRowGeometry`, via
 * getBoundingClientRect), so they can never disagree with each other.
 */

/** Every tab's fixed rendered height, in px — a shared design constant,
 *  not per-insurer, applied identically regardless of which tab is
 *  active or how wide its label/logo make it. */
export const TAB_HEIGHT = 70;
/** Every tab's fixed rendered width, in px — a shared design constant
 *  applied identically to all four tabs (2026-09 light/dark parity pass):
 *  previously each tab's width came from its own content (padding + logo
 *  + label), so "HDFC Ergo" and "Care Health" rendered as visibly
 *  different-sized tabs. Sized to comfortably fit the longest label
 *  ("Care Health") with TAB_PADDING_X/TAB_CONTENT_GAP room to spare. */
export const TAB_WIDTH = 210;
/** Horizontal padding inside each tab, in px, both sides. */
export const TAB_PADDING_X = 22;
/** Gap between a tab's logo and its label, in px. */
export const TAB_CONTENT_GAP = 12;
/** Each tab's logo box, in px (square; the logo image itself is scaled to
 *  fit via object-fit: contain so non-square logos never distort). */
export const TAB_LOGO_SIZE = 30;
/** Configuration panel's own corner radius, in px. */
export const PANEL_RADIUS = 16;
/** How far each tab's sides slope inward from top to bottom, in px. */
export const TAB_SLOPE = 16;
export const STROKE_WIDTH = 1;
/** Tab's own top-corner radius — deliberately smaller than the panel's,
 *  matching the reference's tighter "file tab" corner. */
const TAB_CORNER_RADIUS = 10;

export type TabRect = { x: number; width: number };

export type InsurerRowGeometry = {
  /** The shared coordinate-space width: the shell's own rendered width,
   *  which both the panel and every tab's x/width are relative to (the
   *  shell's left edge == the panel's left edge == x = 0). */
  width: number;
  /** Configuration panel's own rendered height. */
  panelHeight: number;
  /** Every tab's {x, width}, in the shell's own coordinate space, same
   *  order as INSURER_TABS. */
  tabs: TabRect[];
};

/**
 * Measures the tab row and the configuration panel live: every tab's own
 * rendered {x, width} (found via the row's `[role="tab"]` children, so
 * this doesn't care how many tabs there are or which one is active), and
 * the panel's own rendered {width, height} — all relative to `shellRef`,
 * the common wrapper both sit inside. No fixed pixel offsets and no
 * equal-tab-width assumption: a tab's width comes from its own rendered
 * box, whatever its label or logo make that box.
 *
 * Re-measures on ResizeObserver (window resize, a tab's own width
 * changing, the panel's content changing its height) and again whenever
 * `activeKey` changes, since swapping which tab is "active" can restyle
 * a tab's own width (e.g. bold text) without firing a resize on its own.
 */
export function useInsurerRowGeometry(
  shellRef: RefObject<HTMLElement>,
  rowRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  activeKey: string,
): InsurerRowGeometry | null {
  const [geometry, setGeometry] = useState<InsurerRowGeometry | null>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const row = rowRef.current;
    const panel = panelRef.current;
    if (!shell || !row || !panel) return;

    const measure = () => {
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (shellRect.width === 0 || panelRect.width === 0) return;
      const tabEls = Array.from(row.querySelectorAll<HTMLElement>('[role="tab"]'));
      if (tabEls.length === 0) return;
      const tabs = tabEls.map((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - shellRect.left, width: r.width };
      });
      setGeometry({ width: shellRect.width, panelHeight: panelRect.height, tabs });
    };

    // Measure immediately -- covers the case where the active tab changed
    // without changing anyone's size, which ResizeObserver alone would
    // never fire for.
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(shell);
    ro.observe(row);
    ro.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  return geometry;
}

/**
 * One tab's outline: rounded top corners, both sides sloped inward by
 * `TAB_SLOPE` as they descend to `height` — the same "file tab"
 * silhouette every insurer tab shares, active or not.
 *
 * The active tab's own bottom edge (the seam with the panel) is
 * deliberately never drawn: there is no line back to the start point and
 * no closing `Z`, so a *stroke* along this path stops short of it. Fill
 * is unaffected — per the SVG spec, an open subpath used for filling is
 * closed with an implicit straight line for that fill only, never for
 * its stroke — so the exact same path reads as a solid tab shape all the
 * way down to `height`, but with a stroke that stops at both bottom
 * corners and never draws that bottom line. Inactive tabs close with an
 * explicit `Z`, giving them a complete outline including the bottom.
 */
export function getTabPath(x: number, width: number, height: number, active: boolean): string {
  const slope = TAB_SLOPE;
  const r = TAB_CORNER_RADIUS;
  const left = x;
  const right = x + width;

  const base = [
    `M ${left} ${height}`,
    `L ${left + slope} ${r}`,
    `Q ${left + slope} 0 ${left + slope + r} 0`,
    `L ${right - slope - r} 0`,
    `Q ${right - slope} 0 ${right - slope} ${r}`,
    `L ${right} ${height}`,
  ];

  return (active ? base : [...base, "Z"]).join(" ");
}

/**
 * The configuration panel's own outline, in the panel's own local
 * coordinate space (0,0 at its own top-left corner) — the caller
 * translates it into the shared SVG by `(0, TAB_HEIGHT)`, since the panel
 * sits directly below the tab row with no gap.
 *
 * `activeX`/`activeWidth` are the SAME measured numbers `getTabPath` uses
 * for that same tab, so the panel's top-edge gap always lines up exactly
 * with where the active tab's own shape sits — never a separate
 * hand-tuned offset that could drift out of sync.
 *
 * This is built as several disjoint SVG subpaths (left+bottom+right as
 * one continuous run, the top-left corner, the two top-edge segments
 * either side of the gap, and the top-right corner, each its own `M`)
 * rather than one path closed with a trailing `Z`. A single `Z` here
 * would close back to whichever `M` started the CURRENT subpath, not the
 * very first one — since the top edge is deliberately split in two by
 * the gap, that closing line would cut a stray diagonal straight across
 * the panel's interior instead of just finishing the outline. Multiple
 * open subpaths sidestep that entirely: each one strokes only the visible
 * segment it was given, with no implicit closing line anywhere.
 *
 * When the active tab sits flush against the panel's own left or right
 * edge (HDFC Ergo at the start of the row, Niva Bupa at the end), that
 * corner's own arc is left out of the path entirely, not drawn and then
 * run over by the gap — leaving it in would show a curved sliver of that
 * corner poking out from under the tab's own (also square-cornered, at
 * that extreme) edge.
 */
export function getPanelPath(width: number, height: number, activeX: number, activeWidth: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const activeRight = activeX + activeWidth;

  const dropLeftCorner = activeX <= r;
  const dropRightCorner = activeRight >= width - r;

  const gapStart = dropLeftCorner ? 0 : Math.min(Math.max(activeX, r), width - r);
  const gapEnd = dropRightCorner ? width : Math.max(gapStart, Math.min(activeRight, width - r));

  const parts: string[] = [];

  // Left side, bottom-left corner, bottom edge, bottom-right corner,
  // right side -- one continuous subpath, running from just below the
  // top-left corner (or straight from y=0 if that corner is dropped)
  // down and all the way around to just below the top-right corner (or
  // straight to y=0 if that corner is dropped).
  parts.push(
    `M 0 ${dropLeftCorner ? 0 : r}` +
      ` V ${height - r} Q 0 ${height} ${r} ${height}` +
      ` H ${width - r} Q ${width} ${height} ${width} ${height - r}` +
      ` V ${dropRightCorner ? 0 : r}`,
  );

  // Top-left corner arc, only when the gap doesn't reach it.
  if (!dropLeftCorner) {
    parts.push(`M 0 ${r} Q 0 0 ${r} 0`);
  }
  // Top edge, left segment: from the (real or dropped) top-left corner to
  // where the active tab's gap begins.
  parts.push(`M ${dropLeftCorner ? 0 : r} 0 H ${gapStart}`);

  // Top edge, right segment: from where the gap ends to the (real or
  // dropped) top-right corner.
  parts.push(`M ${gapEnd} 0 H ${dropRightCorner ? width : width - r}`);
  // Top-right corner arc, only when the gap doesn't reach it.
  if (!dropRightCorner) {
    parts.push(`M ${width - r} 0 Q ${width} 0 ${width} ${r}`);
  }

  return parts.join(" ");
}
