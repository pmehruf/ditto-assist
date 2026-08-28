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
 * double-compensating).
 *
 * One thing it does NOT do automatically, though: `vh`/`vw` units (and
 * therefore Tailwind's `h-screen`) stay pinned to the real, physical
 * viewport size — CSS `zoom` inflates the rendered pixel size of
 * everything in its subtree, `vh` included, but it does not shrink the
 * *number* of vh units the viewport reports. So a `height: 100vh` box
 * still computes to "the full viewport height," and then that whole box
 * gets rendered `zoom`x bigger on screen — at zoom 1.35 a box sized to
 * exactly fill the screen at 1x now paints 35% taller than the screen,
 * pushing anything pinned below it (this app's footer bar) off-screen.
 * `--app-zoom` is set here specifically so `h-screen`/`max-h-screen`
 * usages in the app shell (App.tsx) can counteract this — sizing
 * themselves to `100vh / zoom` instead, so after the zoom scale-up they
 * land back on exactly the physical viewport height, the same as they
 * would with no zoom applied at all.
 *
 * GLOBAL_DENSITY_SCALE: a second, separate piece of feedback — even on
 * a laptop (below LAPTOP_REFERENCE_WIDTH, where the curve below used to
 * apply no zoom at all) the UI at a plain 100% render felt congested;
 * a side-by-side comparison against the exact same pages at 80–90%
 * native browser zoom read as noticeably more spacious with no layout
 * change otherwise. Rather than retune every component's padding/font
 * sizes individually, this multiplies the *whole* curve — laptop
 * baseline and large-monitor scale-up alike — down by a flat 0.85
 * (the middle of that 80–90% range), so "100%" now renders the way the
 * old ~85% did, at every screen size, while the large-monitor ramp
 * above still scales up relative to that new, smaller baseline.
 */

const LAPTOP_REFERENCE_WIDTH = 1536;
const MONITOR_REFERENCE_WIDTH = 2000;
const MONITOR_REFERENCE_ZOOM = 1.25;
const ZOOM_CAP = 1.35;
const GLOBAL_DENSITY_SCALE = 0.85;

const SLOPE = (MONITOR_REFERENCE_ZOOM - 1) / (MONITOR_REFERENCE_WIDTH - LAPTOP_REFERENCE_WIDTH);

function computeZoom(screenWidth: number): number {
  const raw = !screenWidth || screenWidth <= LAPTOP_REFERENCE_WIDTH
    ? 1
    : 1 + (screenWidth - LAPTOP_REFERENCE_WIDTH) * SLOPE;
  return Math.min(raw, ZOOM_CAP) * GLOBAL_DENSITY_SCALE;
}

function applyZoom(): void {
  const zoom = computeZoom(window.screen?.width || 0);
  // Round to 3 decimal places — plenty of precision for a smooth-
  // looking scale, avoids writing a needlessly long float to the DOM.
  const rounded = String(Math.round(zoom * 1000) / 1000);
  document.documentElement.style.setProperty("zoom", rounded);
  // See this file's doc comment: lets App.tsx's h-screen/max-h-screen
  // shell containers divide themselves back down to the real viewport
  // height, counteracting zoom's own inflation of a 100vh box.
  document.documentElement.style.setProperty("--app-zoom", rounded);
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
