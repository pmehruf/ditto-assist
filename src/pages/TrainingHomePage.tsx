/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface TrainingHomePageProps {
  theme: "light" | "dark";
  /** First name only (already split off the full name by the caller) —
   * shown next to the greeting, same source LookupIntroPage's own tile
   * dashboard uses for its "Hi, {firstName}" copy. Undefined just drops the
   * name from the greeting instead of rendering "undefined". */
  firstName?: string;
}

function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

/**
 * Minimal Home dashboard for Advisory-department Trainee Advisors — 2026-09.
 * Replaces LookupIntroPage's full Workspace Tools tile grid (Declaration
 * Assist / Product Assist / Cover Projection Assist / etc.) with a plain
 * welcome screen for advisors still in training who have no tools to action
 * yet: the app logo + wordmark as one compact unit, a time-of-day greeting,
 * and a short encouragement line. See LookupIntroPage.tsx's early-return
 * branch (before any of its own hooks run) for how this gets selected, and
 * App.tsx's `showTrainingHome` derivation for the Department/Role match.
 *
 * Deliberately NO background/card of its own — this sits directly on
 * whatever App.tsx's shell already paints behind every tab (the background-
 * pattern SVG + GridTexture), exactly like the rest of the app.
 *
 * Sizing uses viewport-scaled clamp() (same technique the signed-out Login
 * hero uses for its headline) rather than fixed px/Tailwind breakpoints —
 * 2026-09, this page originally shipped compact/fixed-size and read as a
 * small huddle of text lost in the middle of a big empty page at normal
 * desktop zoom. clamp() lets the whole composition (logo, wordmark,
 * greeting, subtext, and the gaps between them) scale together with the
 * viewport instead of topping out at a laptop-sized cap, so it actually
 * fills the centered content area at 100% browser zoom on a real monitor
 * without needing separate "make it bigger" tuning per breakpoint.
 */
export function TrainingHomePage({ theme, firstName }: TrainingHomePageProps) {
  const dark = theme === "dark";
  const greeting = getTimeOfDayGreeting();
  const primaryText = dark ? "text-white" : "text-slate-900";
  const accentStyle = { color: "var(--accent)" };

  return (
    <div
      className="flex-1 w-full h-full flex items-center justify-center select-none"
      style={{ minHeight: "min(560px, 60vh)" }}
    >
      <div className="flex flex-col items-center text-center">
        {/* Logo + wordmark — one compact branded unit (small gap between
            them, not floating separately). */}
        <img
          src="/assets/favicon-180.png"
          alt="Ditto Assist"
          className="object-contain"
          style={{ width: "clamp(96px, 9vw, 168px)", height: "clamp(96px, 9vw, 168px)", marginBottom: "clamp(10px, 1.2vh, 20px)" }}
        />
        <div
          className={`font-bold ${primaryText}`}
          style={{ fontSize: "clamp(28px, 2.6vw, 44px)", marginBottom: "clamp(44px, 7vh, 84px)" }}
        >
          Ditto <span style={accentStyle}>Assist</span>
        </div>

        {/* Greeting + encouragement line — normal letter-spacing throughout
            (no tracking-wide/uppercase treatment). */}
        <h1
          className={`font-bold ${primaryText}`}
          style={{ fontSize: "clamp(36px, 4.4vw, 68px)", marginBottom: "clamp(12px, 1.8vh, 22px)", lineHeight: 1.15 }}
        >
          {greeting}
          {firstName ? ", " : "!"}
          {firstName && <span style={accentStyle}>{firstName}!</span>}
        </h1>
        <p
          className={`font-normal ${dark ? "text-slate-400" : "text-stone-500"}`}
          style={{ fontSize: "clamp(17px, 1.5vw, 26px)" }}
        >
          Every day is a chance to learn. Happy learning!
        </p>
      </div>
    </div>
  );
}
