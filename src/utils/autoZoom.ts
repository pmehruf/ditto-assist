/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App-wide auto-scale for large/wide monitors.
 *
 * Browsers never expose the physical size of a display, only CSS
 * pixels — so the exact same layout that reads correctly on a 15"
 * laptop renders physically smaller on a 27"+ monitor at the same CSS
 * pixel width. There's no reliable way to detect physical screen size
 * (devicePixelRatio reflects the OS's chosen scaling factor, not
 * inches), so this uses the display's own CSS-pixel width
 * (`window.screen.width` — the monitor's resolution as the OS already
 * reports it after accounting for the user's display-scaling setting,
 * NOT the browser window's current size) as a practical proxy instead.
 * Imperfect — two different 27" monitors at different resolutions/OS
 * scaling settings won't get identical treatment — but it's exactly
 * what a person manually setting browser zoom to ~125% on a big
 * monitor is already doing, just automatic and monitor-driven rather
 * than window-size-driven.
 *
 * Deliberately keyed off `screen.width`, not `window.innerWidth`:
 * innerWidth reflects the CURRENTLY APPLIED zoom (same as real browser
 * zoom does), so computing this scale factor from innerWidth would
 * create a feedback loop — apply zoom, innerWidth shrinks, recompute a
 * smaller zoom from that, innerWidth grows back, reapply a larger
 * zoom... `screen.width` is a monitor property; it does not change
 * when this script sets `zoom`, so there is no loop.
 *
 * Calibrated against a real 15" laptop (~1536px effective width — see
 * LookupIntroPage.tsx's DESKTOP_CANVAS_WIDTH, the same reference width
 * the Home dashboard's own poster layout uses) vs. a real 27" monitor
 * (~2000px effective width) that needed ~125% browser zoom to visually
 * match it. Below the laptop width, zoom stays 1 (unchanged). Ramps
 * linearly from there, capped at 1.35 so an ultra-wide/4K monitor
 * doesn't run away to an absurd scale.
 *
 * `zoom` (not `transform: scale`) is used deliberately: it
 * participates in normal layout the same way native browser zoom does
 * (affects window.innerWidth, media queries, everything an app-side
 * responsive breakpoint might read — including Home's own ScaleToFit,
 * which works off ratios of measured sizes rather than absolute
 * thresholds, so it stays correct under this ambient zoom rather than
 * double-compensating), so nothing else in the app needs to
 * compensate for it the way a transform-based approach would require.
 */

const LAPTOP_REFERENCE_WIDTH = 1536;
const MONITOR_REFERENCE_WIDTH = 2000;
const MONITOR_REFERENCE_ZOOM = 1.25;
const ZOOM_CAP = 1.35;

const SLOPE = (MONITOR_REFERENCE_ZOOM - 1) / (MONITOR_REFERENCE_WIDTH - LAPTOP_REFERENCE_WIDTH);

function computeZoom(screenWidth: number): number {
  if (!screenWidth || screenWidth <= LAPTOP_REFERENCE_WIDTH) return 1;
  const raw = 1 + (screenWidth - LAPTOP_REFERENCE_WIDTH) * SLOPE;
  return Math.min(raw, ZOOM_CAP);
}

function applyZoom(): void {
  const zoom = computeZoom(window.screen?.width || 0);
  // Round to 3 decimal places — plenty of precision for a smooth-
  // looking scale, avoids writing a needlessly long float to the DOM.
  document.documentElement.style.setProperty("zoom", String(Math.round(zoom * 1000) / 1000));
}

let rafId: number | null = null;
function scheduleApplyZoom(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    applyZoom();
  });
}

let initialized = false;

/** Call once, at app startup (see main.tsx). Safe to call more than
 * once — later calls are no-ops. Re-checks on window resize (the
 * closest available signal for "the window moved to a different
 * monitor" — there's no direct browser event for that). */
export function initAutoZoom(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  applyZoom();
  window.addEventListener("resize", scheduleApplyZoom);
}
