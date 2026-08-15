/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert, User, ClipboardCheck, Check, Lock } from "lucide-react";
import { PrimaryCtaButton } from "./PrimaryCtaButton";

const FIRST_COUNTDOWN_START = 10;
const REMINDER_COUNTDOWN_START = 5;
const TICK_MS = 1000;
/** Must match the CSS `transition-opacity` duration below (ms). */
const EXIT_TRANSITION_MS = 450;
/** SVG viewBox is 200x200 — the countdown ring's radius. */
const RING_RADIUS = 92;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type ProductAssistWarningVariant = "first" | "reminder";

interface ProductAssistDailyWarningProps {
  theme: "light" | "dark";
  /** "first" — the full 10-second warning + acknowledgement + Proceed flow,
   *  shown exactly once ever per advisor. "reminder" — the lightweight
   *  5-second auto-advancing recap shown once per calendar day after that. */
  variant: ProductAssistWarningVariant;
  /** "first": called once the advisor has ticked the box and clicked
   *  Proceed (after the exit transition finishes). "reminder": called
   *  automatically once the 5-second countdown + exit transition finish. */
  onComplete: () => void;
}

/**
 * Full-screen, full-viewport LANDSCAPE Product Assist AI-awareness gate —
 * mascot / countdown / copy occupying real horizontal space (not a small
 * centered card), placed directly on the app's own light/dark background
 * tokens with a soft blurred glow (no card border) lifting the content off
 * the decorative watermark/dot-grid behind it. See App.tsx's
 * `productAssistGateState` for how the two variants below are chosen and
 * how completion is persisted server-side (ProductAssistAcksRepository)
 * rather than only in browser localStorage.
 *
 * Both variants share one countdown/acknowledgement state machine:
 *  - "first" ticks 10 → 0 and then HOLDS at "00" — no auto-advance. The
 *    acknowledgement checkbox stays locked/disabled until the countdown
 *    reaches 0, and Proceed stays disabled until the box is also checked.
 *    There is no bypass: both controls use the real `disabled` attribute,
 *    not a styling trick, so neither is clickable/keyboard-activatable
 *    early.
 *  - "reminder" ticks 5 → 1 and then automatically fades out and calls
 *    `onComplete`, same behavior as the original single-warning version.
 *
 * Sizing uses CSS `min(Xvw, Yvh, Zpx)` throughout rather than fixed
 * breakpoints, so the composition scales smoothly with BOTH viewport width
 * and height — capped by height on a short laptop screen, capped by width
 * on a huge monitor, capped by the px ceiling so it never grows absurdly
 * large either. The pulse/glow on the digits, the ring's fill, and the
 * fade in/out all use ordinary CSS animations/transitions, so the app's
 * existing global `prefers-reduced-motion` rule (index.css) automatically
 * reduces this screen to simple, near-instant swaps without any
 * special-casing here, while the countdown's own JS timing is untouched by
 * that rule.
 */
export function ProductAssistDailyWarning({ theme, variant, onComplete }: ProductAssistDailyWarningProps) {
  const isDark = theme === "dark";
  const isFirst = variant === "first";
  const countdownStart = isFirst ? FIRST_COUNTDOWN_START : REMINDER_COUNTDOWN_START;

  const [secondsLeft, setSecondsLeft] = useState(countdownStart);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (secondsLeft > 0) {
      const tick = setTimeout(() => setSecondsLeft((s) => s - 1), TICK_MS);
      return () => clearTimeout(tick);
    }
    // secondsLeft reached 0.
    if (isFirst) return; // Holds at "00" — waits for checkbox + Proceed, no auto-advance.
    setIsExiting(true);
    const handoff = setTimeout(() => onCompleteRef.current(), EXIT_TRANSITION_MS);
    return () => clearTimeout(handoff);
  }, [secondsLeft, isFirst]);

  const countdownDone = secondsLeft <= 0;
  const canProceed = isFirst && countdownDone && acknowledged;
  const handleProceed = () => {
    if (!canProceed) return;
    setIsExiting(true);
    setTimeout(() => onCompleteRef.current(), EXIT_TRANSITION_MS);
  };

  // "first" counts all the way down to and displays "00"; "reminder" never
  // shows "00" — it holds "01" for its final second, then transitions away.
  const displaySeconds = isFirst ? secondsLeft : Math.max(secondsLeft, 1);
  const progress = (countdownStart - secondsLeft) / countdownStart;
  const dotAngleRad = ((-90 + progress * 360) * Math.PI) / 180;
  const dotX = 100 + RING_RADIUS * Math.cos(dotAngleRad);
  const dotY = 100 + RING_RADIUS * Math.sin(dotAngleRad);
  const accent = isDark ? "#ef4444" : "#dc2626";

  // Size tokens — "first" is a major, ~70-80%-of-viewport full-scale
  // composition (mascot ~25-30% of it, per spec); "reminder" reuses the
  // same mascot/ring/typography treatment at a deliberately much smaller,
  // lighter scale.
  const s = isFirst
    ? {
        contentWidth: "min(80vw, 1680px)",
        rowGap: "min(4.2vw, 5vh, 64px)",
        mascotWidth: "min(26vw, 44vh, 400px)",
        ringSize: "min(19vw, 32vh, 250px)",
        digitFont: "min(8vw, 14vh, 120px)",
        eyebrowFont: "min(1.3vw, 2.2vh, 16px)",
        headlineFont: "min(3.2vw, 5.6vh, 46px)",
        bodyFont: "min(1.25vw, 2.2vh, 17px)",
      }
    : {
        contentWidth: "min(56vw, 920px)",
        rowGap: "min(3vw, 3.4vh, 36px)",
        mascotWidth: "min(10vw, 16vh, 130px)",
        ringSize: "min(9vw, 15vh, 108px)",
        digitFont: "min(3.6vw, 6.5vh, 46px)",
        eyebrowFont: "min(1vw, 1.7vh, 13px)",
        headlineFont: "min(1.9vw, 3.2vh, 24px)",
        bodyFont: "min(1vw, 1.8vh, 14px)",
      };

  const ring = (
    <div
      className="relative flex flex-shrink-0 items-center justify-center"
      style={{ width: s.ringSize, height: s.ringSize }}
    >
      <svg viewBox="0 0 200 200" style={{ width: "100%", height: "100%" }}>
        <circle
          cx="100"
          cy="100"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          className={isDark ? "stroke-white/10" : "stroke-slate-300/70"}
        />
        <circle
          cx="100"
          cy="100"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          stroke={accent}
          transform="rotate(-90 100 100)"
          style={{
            strokeDasharray: RING_CIRCUMFERENCE,
            strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress),
            transition: "stroke-dashoffset 0.6s ease-out",
            filter: `drop-shadow(0 0 6px ${accent}88)`,
          }}
        />
        <circle cx="100" cy="8" r="4" fill={accent} style={{ filter: `drop-shadow(0 0 4px ${accent})` }} />
        <circle
          cx={dotX}
          cy={dotY}
          r="4"
          fill={accent}
          style={{ transition: "cx 0.6s ease-out, cy 0.6s ease-out", filter: `drop-shadow(0 0 4px ${accent})` }}
        />
      </svg>
      <span
        key={secondsLeft}
        className={`pa-warning-countdown absolute font-mono font-black leading-none ${isDark ? "text-red-500" : "text-red-600"}`}
        style={{ fontSize: s.digitFont, textShadow: `0 0 24px ${accent}73` }}
      >
        {String(displaySeconds).padStart(2, "0")}
      </span>
    </div>
  );

  const mascot = (
    <img
      src="/assets/.aistudio/product-assist-mascot.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className="h-auto flex-shrink-0 select-none"
      style={{ width: s.mascotWidth }}
    />
  );

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden px-[3vw] py-[3vh] ${
        isDark ? "bg-[#001322] text-[#F5F7FA]" : "bg-[#F1F6FB] text-stone-900"
      }`}
      role="alert"
    >
      {/* Decorative background flourishes — static, low-opacity; echoes the
          app's own blob/dotted-grid motifs used on the login screen. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-24 -left-16 select-none font-black leading-none ${
          isDark ? "text-white/[0.035]" : "text-slate-900/[0.045]"
        }`}
        style={{ fontSize: "clamp(180px, 30vw, 460px)" }}
      >
        {countdownStart}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-6 top-6 grid grid-cols-6 gap-2 opacity-40 sm:right-10 sm:top-10"
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} className={`h-1 w-1 rounded-full ${isDark ? "bg-blue-400/40" : "bg-blue-900/20"}`} />
        ))}
      </div>
      {/* Soft blurred glow behind the content cluster — lifts it off the
          decorative watermark/dot-grid without a hard-edged card boundary. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className={`rounded-full blur-3xl ${isDark ? "bg-[#04162c]/70" : "bg-white/70"}`}
          style={{
            width: isFirst ? "94%" : "70%",
            height: isFirst ? "70%" : "56%",
            maxWidth: isFirst ? "1500px" : "1000px",
          }}
        />
      </div>

      <div
        className="relative flex max-h-full flex-col items-center overflow-y-auto transition-opacity ease-out"
        style={{
          width: s.contentWidth,
          gap: "min(3vh, 28px)",
          transitionDuration: `${EXIT_TRANSITION_MS}ms`,
          opacity: isExiting ? 0 : 1,
        }}
      >
        {/* Header eyebrow */}
        {isFirst ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertTriangle
              className={isDark ? "text-red-500" : "text-red-600"}
              strokeWidth={2.25}
              style={{ width: "min(1.8vw,3vh,22px)", height: "min(1.8vw,3vh,22px)" }}
            />
            <div className="flex w-full items-center gap-4">
              <span className={`h-px flex-1 ${isDark ? "bg-red-500/25" : "bg-red-500/30"}`} />
              <span className="whitespace-nowrap font-bold uppercase tracking-[0.4em]" style={{ fontSize: s.eyebrowFont }}>
                PRODUCT ASSIST
              </span>
              <span className={`h-px flex-1 ${isDark ? "bg-red-500/25" : "bg-red-500/30"}`} />
            </div>
          </div>
        ) : (
          <span className="font-bold uppercase tracking-[0.35em]" style={{ fontSize: s.eyebrowFont }}>
            PRODUCT ASSIST
          </span>
        )}

        {isFirst ? (
          <div
            className="flex w-full flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-between"
            style={{ gap: s.rowGap }}
          >
            {mascot}
            {ring}

            <div className="flex flex-1 flex-col items-center gap-4 text-center lg:items-start lg:text-left">
              <h1 className="font-black uppercase leading-tight tracking-tight" style={{ fontSize: s.headlineFont }}>
                AI CAN <span className={isDark ? "text-red-500" : "text-red-600"}>MAKE MISTAKES.</span>
              </h1>
              <p className={`max-w-xl ${isDark ? "text-slate-300" : "text-stone-600"}`} style={{ fontSize: s.bodyFont }}>
                For the sake of our jobs, let's hope it never becomes perfect. ☠️
              </p>

              <div
                className={`relative mt-1 inline-flex items-center gap-2 rounded-md border px-4 py-2 ${
                  isDark ? "border-red-500/60 text-red-500" : "border-red-600/60 text-red-600"
                }`}
              >
                <ShieldAlert className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} />
                <span className="font-extrabold uppercase tracking-[0.15em]" style={{ fontSize: s.eyebrowFont }}>
                  GUIDE, NOT JUDGMENT
                </span>
                <span aria-hidden="true" className="pa-warning-hazard-strip absolute -bottom-1 -right-1 h-2.5 w-8 rounded-sm" />
              </div>

              <div className={`mt-2 flex w-full max-w-xl flex-col divide-y text-left ${isDark ? "divide-white/10" : "divide-slate-200"}`}>
                <div className="flex items-start gap-3 py-3 first:pt-0">
                  <User className={`mt-0.5 h-4 w-4 flex-shrink-0 ${isDark ? "text-blue-400" : "text-blue-600"}`} strokeWidth={2} />
                  <p className={isDark ? "text-slate-200" : "text-stone-700"} style={{ fontSize: s.bodyFont }}>
                    Use it as a guide, not a replacement for your judgement.
                  </p>
                </div>
                <div className="flex items-start gap-3 py-3 last:pb-0">
                  <ClipboardCheck className={`mt-0.5 h-4 w-4 flex-shrink-0 ${isDark ? "text-blue-400" : "text-blue-600"}`} strokeWidth={2} />
                  <p className={isDark ? "text-slate-200" : "text-stone-700"} style={{ fontSize: s.bodyFont }}>
                    Always verify the references before relying on or communicating an answer.
                  </p>
                </div>
              </div>

              <p className={`max-w-xl italic ${isDark ? "text-slate-500" : "text-stone-500"}`} style={{ fontSize: s.bodyFont }}>
                <span aria-hidden="true" className={`mr-1 not-italic ${isDark ? "text-blue-400/70" : "text-blue-500/70"}`}>
                  "
                </span>
                Because 'the AI said so' isn't a policy clause.
                <span aria-hidden="true" className={`ml-1 not-italic ${isDark ? "text-blue-400/70" : "text-blue-500/70"}`}>
                  "
                </span>
              </p>

              {/* Acknowledgement — locked until the countdown reaches "00";
                  real `disabled` attributes below, not a styling trick. */}
              <button
                type="button"
                role="checkbox"
                aria-checked={acknowledged}
                disabled={!countdownDone}
                onClick={() => countdownDone && setAcknowledged((a) => !a)}
                className={`group mt-2 flex items-start gap-3 text-left ${countdownDone ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                    acknowledged
                      ? isDark
                        ? "border-red-500 bg-red-500"
                        : "border-red-600 bg-red-600"
                      : isDark
                        ? "border-white/30 group-hover:border-white/50"
                        : "border-stone-400 group-hover:border-stone-500"
                  }`}
                >
                  {acknowledged ? (
                    <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                  ) : !countdownDone ? (
                    <Lock className={`h-3 w-3 ${isDark ? "text-white/30" : "text-stone-400"}`} />
                  ) : null}
                </span>
                <span className={isDark ? "text-slate-200" : "text-stone-700"} style={{ fontSize: s.bodyFont }}>
                  I acknowledge that "because AI said so" is not a policy clause.💁‍♂️
                </span>
              </button>

              <PrimaryCtaButton theme={theme} variant="danger" disabled={!canProceed} onClick={handleProceed} className="mt-1">
                PROCEED TO PRODUCT ASSIST →
              </PrimaryCtaButton>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-6 text-center">
            <div className="flex items-center" style={{ gap: s.rowGap }}>
              {mascot}
              {ring}
            </div>
            <h1 className="font-black uppercase leading-tight tracking-tight" style={{ fontSize: s.headlineFont }}>
              AI CAN <span className={isDark ? "text-red-500" : "text-red-600"}>MAKE MISTAKES.</span>
            </h1>
            <p className={isDark ? "text-slate-300" : "text-stone-600"} style={{ fontSize: s.bodyFont }}>
              Use it as a guide. Verify before you rely on it.
            </p>
            <p className={`italic ${isDark ? "text-slate-500" : "text-stone-500"}`} style={{ fontSize: s.bodyFont }}>
              "Because 'the AI said so' isn't a policy clause." 💁‍♂️
            </p>
            <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.2em]" style={{ fontSize: s.eyebrowFont }}>
              <span aria-hidden="true" className="pa-warning-status-dot leading-none">
                ⏳
              </span>
              Opening Product Assist...
            </div>
          </div>
        )}
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {isFirst
          ? countdownDone
            ? "You may now acknowledge and proceed to Product Assist."
            : `Warning countdown: ${secondsLeft} seconds remaining.`
          : secondsLeft > 0
            ? `Opening Product Assist in ${secondsLeft} seconds.`
            : "Opening Product Assist."}
      </span>
    </div>
  );
}
