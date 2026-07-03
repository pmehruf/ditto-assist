/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import { MascotWithFallback } from "../components/mascots/MascotWithFallback";

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
    <>
    <div
      style={{ marginTop: "2px", marginBottom: "10px" }}
      className={`relative overflow-hidden w-full rounded-2xl border font-sans flex-grow flex flex-col justify-center h-auto lg:h-[calc(100vh-140px)] lg:max-h-[720px] lg:min-h-[500px] ${
        theme === "dark" ? "border-white/[0.08] bg-transparent text-[#FFFFFF]" : "border-[#a1b7c3] bg-transparent text-stone-900"
      }`}
    >
      {/* Optimized grid / texture overlay based on theme to prevent moire and maintain premium feel */}
      {theme === "dark" ? (
        <div
          className="absolute inset-0 pointer-events-none z-20 opacity-80"
          style={{
            backgroundImage: `linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.15) 50%), linear-gradient(90deg, rgba(255,0,0,0.03), rgba(0,255,0,0.01), rgba(0,0,255,0.03))`,
            backgroundSize: "100% 3px, 3px 100%"
          }}
        />
      ) : (
        <div
          className="absolute inset-0 pointer-events-none z-20 opacity-50"
          style={{
            backgroundImage: `linear-gradient(rgba(70,115,169,0) 50%, rgba(70,115,169,0.14) 50%), linear-gradient(90deg, rgba(70,115,169,0.07), rgba(255,255,255,0), rgba(70,115,169,0.07))`,
            backgroundSize: "100% 3px, 3px 100%"
          }}
        />
      )}

      {/* Workspace grid: 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-10 w-full relative z-10 h-full">

        {/* LEFT HERO PANEL (lg:col-span-7) */}
        <div className={`col-span-1 lg:col-span-7 p-4 sm:p-5 md:p-6 lg:p-6 xl:p-8 flex flex-col justify-center relative border-b lg:border-b-0 lg:border-r bg-radial-[circle_at_10%_20%] bg-radial-from-[rgba(0,211,243,0.03)] bg-radial-to-transparent text-left ${
          theme === "dark" ? "border-white/[0.08]" : "border-[#a1b7c3]"
        }`}>

          <div
            style={{
              paddingTop: "0px",
              marginRight: "0px",
              marginLeft: "0px"
            }}
            className="flex flex-col justify-center h-full w-full relative z-10 py-1"
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
              style={{ width: "740px", maxWidth: "100%", fontSize: "clamp(32px, 5.5vw, 60.888px)", lineHeight: "1.1" }}
              className={`font-sans font-bold uppercase tracking-tight mb-3 select-none ${
                theme === "dark" ? "text-white" : "text-stone-900"
              }`}
            >
              Know <b className={`font-bold ${theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7]"}`}>What</b> To Declare.<br />
              Know <b className={`font-bold ${theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7]"}`}>Where</b> To Declare.
            </h1>

            <p
              style={{ fontSize: "clamp(12px, 1.8vh, 14px)", lineHeight: "1.5" }}
              className={`max-w-[600px] mb-3 font-sans ${
                theme === "dark" ? "text-white/60" : "text-stone-600 font-medium"
              }`}
            >
              Accurate disclosure is not just about what you declare. It is also about where you declare it. Your Declaration Assistant helps you identify the most appropriate place to disclose a medical condition by considering both medical context and policy logic.
            </p>

            <div
              style={{ padding: "clamp(8px, 1.5vh, 12px)" }}
              className={`border-l-2 mb-3 max-w-[550px] ${
                theme === "dark" ? "border-[#ff9f43] bg-[#ff9f43]/5" : "border-amber-500 bg-amber-500/[0.04]"
              }`}
            >
              <p
                style={{ fontSize: "clamp(10px, 1.5vh, 12px)" }}
                className={`font-mono uppercase tracking-wide leading-relaxed ${
                  theme === "dark" ? "text-[#ff9f43]" : "text-amber-800 font-semibold"
                }`}
              >
                SYSTEM WARNING❗: Results may not be accurate in every case. This tool supports your judgement, it doesn't replace it. Verify before disclosing.
              </p>
            </div>

            <button
              onClick={() => setShowIntro(false)}
              className={`px-6 border-[1.5px] text-xs font-mono uppercase font-bold tracking-[0.2em] transition-all cursor-pointer select-none self-start relative overflow-hidden ${
                theme === "dark"
                  ? "bg-[#00afce] text-[#0a0a0c] border-[#00afce] hover:bg-[#009cb8] hover:border-[#009cb8] hover:shadow-[0_0_40px_rgba(0,175,206,0.15)]"
                  : "hover:bg-[#06469c] hover:border-[#06469c]"
              }`}
              style={{
                clipPath: "polygon(100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 0)",
                marginTop: "clamp(6px, 1.5vh, 14px)",
                paddingTop: "clamp(8px, 1.2vh, 12px)",
                paddingBottom: "clamp(8px, 1.2vh, 12px)",
                backgroundColor: theme !== "dark" ? "var(--accent-solid)" : undefined,
                color: theme !== "dark" ? "var(--on-accent)" : undefined,
                borderColor: theme !== "dark" ? "var(--accent-solid)" : undefined
              }}
            >
              LETS PUT THEM IN THEIR PLACE
              <span className="absolute top-0 right-0 w-2.5 h-2.5 transform rotate-45 translate-x-1 -translate-y-1" style={{ backgroundColor: theme !== "dark" ? "#021426" : "#0a0a0c" }}></span>
            </button>
          </div>

          {/* Absolute positioned floating mascot, vertically center aligned with body text */}
          <div
            className="absolute pointer-events-none z-0 hidden xl:block"
            style={{ right: '50px', top: '50%', transform: 'translateY(-50%)', width: '220px', height: '240px' }}
          >
            <motion.div
              animate={{ y: [0, -10, 0], scale: [1, 1.03, 1] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="w-full h-full flex items-center justify-end select-none"
            >
              <MascotWithFallback
                src="/assets/.aistudio/mapping-mascot.png"
                alt="Mapping Mascot"
                className="object-contain max-h-[240px] max-w-[220px]"
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

          {/* SPEC CARDS */}
          <div className={`divide-y flex-grow flex flex-col justify-between overflow-hidden ${
            theme === "dark" ? "divide-white/[0.08]" : "divide-[#a1b7c3]"
          }`}>

            {/* CARD 1 */}
            <div
              className="flex-1 flex flex-col justify-center py-1 sm:py-1.5 lg:py-1 xl:py-2 px-4 lg:px-5 text-left overflow-hidden"
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
              className="flex-1 flex flex-col justify-center py-1 sm:py-1.5 lg:py-1 xl:py-2 px-4 lg:px-5 text-left overflow-hidden"
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
              className="flex-1 flex flex-col justify-center py-1 sm:py-1.5 lg:py-1 xl:py-2 px-4 lg:px-5 text-left overflow-hidden"
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
              className="flex-1 flex flex-col justify-center py-1 sm:py-1.5 lg:py-1 xl:py-2 px-4 lg:px-5 text-left overflow-hidden"
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
              className="flex-1 flex flex-col justify-center py-1 sm:py-1.5 lg:py-1 xl:py-2 px-4 lg:px-5 text-left overflow-hidden"
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

    {/* Compact elegant Launcher Info Bar */}
    <div
      style={{ marginTop: "clamp(6px, 1.5vh, 12px)", marginBottom: "0px", borderColor: !isDark ? "#707a80" : undefined }}
      className={`pt-2.5 border-t flex justify-between items-center text-[10px] font-mono tracking-widest uppercase select-none shrink-0 w-full ${
        theme === "dark"
          ? "border-[#252A34]/40 text-slate-400"
          : "font-extrabold text-stone-600"
      }`}
    >
      <div className="flex items-center select-none">
        <span>YOUR PAYMENT ASSISTANT</span>
      </div>
      <span style={{ color: !isDark ? "#57534d" : "#90a1b9", fontWeight: !isDark ? "bold" : "normal", fontSize: "10px" }} className="font-normal">©BLISS GUIDES.DITTO</span>
    </div>
    </>
  );
}
