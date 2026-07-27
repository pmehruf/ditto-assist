/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { MascotWithFallback } from "../components/mascots/MascotWithFallback";
import { GridTexture } from "../components/GridTexture";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";

interface LookupIntroPageProps {
  theme: "light" | "dark";
  isDark: boolean;
  setShowIntro: (value: boolean) => void;
}

/**
 * "Declaration Assistant" lookup tab — intro/splash screen content.
 * Extracted verbatim from App.tsx (Phase 1.3). The `activeTab === "lookup"
 * && showIntro` condition and wrapping `<motion.div key="intro">`
 * deliberately stay in App.tsx (see ResourcesPage.tsx for why — moving them
 * here would break the AnimatePresence exit animation).
 */
export function LookupIntroPage({ theme, isDark, setShowIntro }: LookupIntroPageProps) {
  return (
    <div
      style={{ marginTop: "2px", marginBottom: "4px" }}
      className={`relative overflow-hidden w-full rounded-2xl border font-sans flex-grow flex flex-col justify-center h-auto lg:h-[calc(100vh-175px)] lg:max-h-[680px] lg:min-h-[480px] ${
        theme === "dark" ? "border-white/[0.08] bg-transparent text-[#FFFFFF]" : "border-[#a1b7c3] bg-transparent text-stone-900"
      }`}
    >
      {/* Optimized grid / texture overlay based on theme to prevent moire and maintain premium feel */}
      <GridTexture theme={theme} />

      {/* Workspace grid: 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-10 w-full relative z-10 h-full">

        {/* LEFT HERO PANEL (lg:col-span-7) */}
        <div className={`col-span-1 lg:col-span-7 p-4 sm:p-5 md:p-6 lg:p-6 xl:p-8 flex flex-col justify-center relative border-b lg:border-b-0 lg:border-r bg-radial-[circle_at_10%_20%] bg-radial-from-[rgba(0,211,243,0.03)] bg-radial-to-transparent text-left ${
          theme === "dark" ? "border-white/[0.08]" : "border-[#a1b7c3]"
        }`}>

          {/* flex-wrap (not a breakpoint) decides whether the mascot sits
              beside the text or drops below it — that reflow now tracks the
              row's actual rendered width continuously, so it responds
              correctly to browser zoom too, instead of the mascot just
              vanishing at a fixed viewport-width cutoff (which is what
              "hidden xl:flex" caused — zooming in shrinks the effective CSS
              viewport, so it could drop below the xl breakpoint and hide the
              mascot entirely even on a huge window). */}
          <div className="flex flex-row flex-wrap items-center h-full w-full relative z-10 py-1 gap-4">
            {/* Text content — flex-1 with a real min-width (not min-w-0) so
                it stops shrinking at a readable size and hands off to wrap
                instead of squeezing itself unreadably thin to keep the
                mascot on the same line. */}
            <div
              style={{ paddingTop: "0px", marginRight: "0px", marginLeft: "0px" }}
              className="flex flex-col justify-center flex-1 min-w-[240px]"
            >
              <div className="flex items-center gap-2 select-none mb-2">
                <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: "var(--accent)" }} />
                <span
                  style={{ fontSize: "11px" }}
                  className={`font-mono tracking-[0.4em] uppercase ${
                    theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
                  }`}
                >
                  ADVISORY PROTOCOL
                </span>
              </div>

              <h1
                style={{ fontSize: "clamp(24px, 5vw, 60px)", lineHeight: "1.15" }}
                className={`font-sans font-bold uppercase tracking-tight mb-3 select-none max-w-full ${
                  theme === "dark" ? "text-white" : "text-stone-900"
                }`}
              >
                {/* Each line forced onto a single row (no internal wrap) so the
                    heading always renders as exactly 2 lines — matching the
                    80%-zoom appearance — instead of the browser's page-zoom
                    shrinking the effective container width faster than this
                    capped font-size shrinks, which used to wrap each line a
                    second time into 4 lines total at 100% zoom. */}
                <span className="block whitespace-nowrap">
                  Know <b className={`font-bold ${theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7]"}`}>What</b> To Declare.
                </span>
                <span className="block whitespace-nowrap">
                  Know <b className={`font-bold ${theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7]"}`}>Where</b> To Declare.
                </span>
              </h1>

              <p
                style={{ fontSize: "clamp(12px, 1.8vh, 14px)", lineHeight: "1.5" }}
                className={`max-w-[37.5rem] mb-3 font-sans ${
                  theme === "dark" ? "text-white/60" : "text-stone-600 font-medium"
                }`}
              >
                Accurate disclosure is not just about what you declare. It is also about where you declare it. Your Declaration Assistant helps you identify the most appropriate place to disclose a medical condition by considering both medical context and policy logic.
              </p>

              {/* Advisory Note — was a thin amber left-border strip with a
                  single inline "SYSTEM WARNING❗:" sentence; now a full
                  rounded card with its own icon+title header row and a
                  diagonal navy→red gradient background (dark) / soft
                  indigo→rose gradient (light), mirroring the same blue-to-red
                  diagonal wash already used for the QA Announcement card in
                  LookupPage.tsx so warning-style cards read consistently
                  across the app. Title/icon keep the same amber accent
                  color the old inline warning text used. */}
              <div
                style={{
                  padding: "clamp(10px, 1.8vh, 14px)",
                  ...(theme === "dark"
                    ? { background: "linear-gradient(135deg, #0f1f3d 0%, #14243f 45%, #7f1d1d 100%)" }
                    : {}),
                }}
                className={`rounded-2xl mb-3 max-w-[34.375rem] shadow-xs ${
                  theme === "light" ? "bg-gradient-to-br from-indigo-100 via-rose-100 to-red-200" : ""
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${theme === "dark" ? "text-[#ff9f43]" : "text-amber-700"}`} />
                  <span
                    style={{ fontSize: "clamp(10px, 1.5vh, 12px)" }}
                    className={`font-mono uppercase tracking-wide font-black ${
                      theme === "dark" ? "text-[#ff9f43]" : "text-amber-700"
                    }`}
                  >
                    Advisory Note
                  </span>
                </div>
                <p
                  style={{ fontSize: "clamp(10px, 1.5vh, 12px)" }}
                  className={`leading-relaxed font-medium ${
                    theme === "dark" ? "text-white/85" : "text-stone-800"
                  }`}
                >
                  Results may not be accurate in every case. This tool supports your judgement, it doesn't replace it. Always verify before disclosing, and reach out to your mentor when you need clarity.
                </p>
              </div>

              <PrimaryCtaButton
                theme={theme}
                onClick={() => setShowIntro(false)}
                className="self-start"
                style={{ marginTop: "clamp(6px, 1.5vh, 14px)" }}
              >
                LETS PUT THEM IN THEIR PLACE
              </PrimaryCtaButton>
            </div>

            {/* Mascot — a normal flex sibling (its own reserved column) instead
                of an absolutely-positioned overlay, so it can never share
                space with the text above regardless of window size or zoom.
                Always rendered (no breakpoint hide) — flex-wrap above moves
                it below the text on narrow rows instead of it disappearing
                outright. Sized with clamp() (viewport-relative) rather than
                a fixed px box, so it scales proportionally instead of
                staying pinned at one physical size while everything around
                it changes. */}
            <motion.div
              animate={{ y: [0, -10, 0], scale: [1, 1.03, 1] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="flex items-center justify-center shrink-0 mx-auto pointer-events-none select-none"
              style={{ width: "clamp(120px, 14vw, 220px)", height: "clamp(130px, 15vw, 240px)" }}
            >
              <MascotWithFallback
                src="/assets/.aistudio/mapping-mascot.png"
                alt="Mapping Mascot"
                className="object-contain w-full h-full"
                type="magnifier"
              />
            </motion.div>
          </div>
        </div>

        {/* RIGHT SPECS/MANUAL PANEL (lg:col-span-3) */}
        <div className={`col-span-1 lg:col-span-3 flex flex-col h-full text-left overflow-hidden ${
          theme === "dark" ? "bg-white/[0.01]" : "bg-stone-50/40"
        }`}>
          <div className={`py-3 px-4 lg:px-5 border-b flex flex-col gap-0.5 shrink-0 ${
            theme === "dark" ? "border-white/[0.08]" : "border-[#6a787f]"
          }`}>
            <div className="flex items-center gap-2 select-none">
              <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: "var(--accent)" }} />
              <span
                style={{ color: "var(--accent)" }}
                className="font-mono uppercase tracking-[0.2em] text-[10px] font-bold"
              >
                Mapping Engine
              </span>
            </div>
            <span className={`text-[15px] font-black uppercase tracking-wider font-sans ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}>
              Instruction Manual
            </span>
          </div>

          {/* SPEC CARDS — hugged as a compact group directly under the header,
              rather than each card stretching (flex-1) to fill an equal,
              oversized slice of the full panel height (old approach spread
              the 5 cards out with large empty gaps at taller viewport/zoom
              combinations) or being centered as a group (left a large gap
              between the header and card 1). justify-start keeps card 1
              flush against the header. */}
          <div className={`divide-y flex-grow flex flex-col justify-start overflow-hidden ${
            theme === "dark" ? "divide-white/[0.08]" : "divide-[#a1b7c3]"
          }`}>

            {/* CARD 1 */}
            <div
              className="flex flex-col justify-center py-1.5 sm:py-2 lg:py-2 xl:py-2.5 px-4 lg:px-5 text-left overflow-hidden"
            >
              <span className={`block font-mono text-[9px] mb-0.5 ${
                theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
              }`}>0x01</span>
              <h4 className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
                theme === "dark" ? "text-white" : "text-stone-900"
              }`}>Multi-condition lookup</h4>
              <p className={`text-[12px] leading-snug font-sans ${
                theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
              }`}>
                Enter <strong className={theme === "dark" ? "text-white font-bold" : "text-stone-900 font-bold"}>all pre-existing diseases (PEDs)</strong> together before running the engine.
              </p>
            </div>

            {/* CARD 2 */}
            <div
              className="flex flex-col justify-center py-1.5 sm:py-2 lg:py-2 xl:py-2.5 px-4 lg:px-5 text-left overflow-hidden"
            >
              <span className={`block font-mono text-[9px] mb-0.5 ${
                theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
              }`}>0x02</span>
              <h4 className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
                theme === "dark" ? "text-white" : "text-stone-900"
              }`}>Input accuracy</h4>
              <p className={`text-[12px] leading-snug font-sans ${
                theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
              }`}>
                Use dropdown suggestions when available to reduce spelling errors. If not listed, enter it manually and proceed.
              </p>
            </div>

            {/* CARD 3 */}
            <div
              className="flex flex-col justify-center py-1.5 sm:py-2 lg:py-2 xl:py-2.5 px-4 lg:px-5 text-left overflow-hidden"
            >
              <span className={`block font-mono text-[9px] mb-0.5 ${
                theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
              }`}>0x03</span>
              <h4 className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
                theme === "dark" ? "text-white" : "text-stone-900"
              }`}>Diagnoses only</h4>
              <p className={`text-[12px] leading-snug font-sans mb-0.5 ${
                theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
              }`}>
                Run the engine for medical conditions (diagnosis), not the treatments.
              </p>
              <div className="flex flex-col gap-0.5 text-[11px] leading-none mt-1">
                <div><strong className={theme === "dark" ? "text-emerald-400 font-bold" : "text-emerald-600 font-semibold"}>Correct:</strong> Hypothyroidism</div>
                <div><strong className={theme === "dark" ? "text-rose-400 font-bold" : "text-rose-600 font-semibold"}>Incorrect:</strong> Thyroid surgery</div>
              </div>
            </div>

            {/* CARD 4 */}
            <div
              className="flex flex-col justify-center py-1.5 sm:py-2 lg:py-2 xl:py-2.5 px-4 lg:px-5 text-left overflow-hidden"
            >
              <span className={`block font-mono text-[9px] mb-0.5 ${
                theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
              }`}>0x04</span>
              <h4 className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
                theme === "dark" ? "text-white" : "text-stone-900"
              }`}>Output verification</h4>
              <p className={`text-[12px] leading-snug font-sans ${
                theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
              }`}>
                After lookup, verify each mapped question against actual payment journey questions to ensure accuracy.
              </p>
            </div>

            {/* CARD 5 */}
            <div
              className="flex flex-col justify-center py-1.5 sm:py-2 lg:py-2 xl:py-2.5 px-4 lg:px-5 text-left overflow-hidden"
            >
              <span className={`block font-mono text-[9px] mb-0.5 ${
                theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
              }`}>0x05</span>
              <h4 className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
                theme === "dark" ? "text-white" : "text-stone-900"
              }`}>Flag mismatch</h4>
              <p className={`text-[12px] leading-snug font-sans ${
                theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
              }`}>
                If you find an incorrect mapped question or error, use the <strong className={theme === "dark" ? "text-white font-bold" : "text-stone-900 font-bold"}>Flag</strong> option to report it immediately.
              </p>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
