/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface InstructionManualPanelProps {
  theme: "light" | "dark";
  /** Extra width/flex classes for the outer card — default matches the slot
      this now occupies on the Declarations page (previously the Announcement
      card's width). */
  className?: string;
}

/**
 * "Instruction Manual" spec-card panel — extracted from LookupIntroPage.tsx
 * (the Home page's old right-hand column) and given its own bordered card
 * treatment so it reads correctly as a standalone panel on the Declarations
 * page, in the slot the Announcement card used to occupy.
 */
export function InstructionManualPanel({
  theme,
  className = "w-full lg:w-96 xl:w-[28rem] flex-shrink-0",
}: InstructionManualPanelProps) {
  return (
    <div
      className={`rounded-2xl border overflow-hidden flex flex-col min-h-0 text-left ${className} ${
        theme === "dark"
          ? "bg-white/[0.02] border-white/[0.08]"
          : "bg-stone-50/60 border-stone-300"
      }`}
    >
      <div
        className={`py-3 px-4 lg:px-5 border-b flex flex-col gap-0.5 shrink-0 ${
          theme === "dark" ? "border-white/[0.08]" : "border-[#6a787f]"
        }`}
      >
        <div className="flex items-center gap-2 select-none">
          <div
            className="w-8 h-0.5 flex-shrink-0"
            style={{ backgroundColor: "var(--accent)" }}
          />
          <span
            style={{ color: "var(--accent)" }}
            className="font-mono uppercase tracking-[0.2em] text-[10px] font-bold"
          >
            Mapping Engine
          </span>
        </div>
        <span
          className={`text-[15px] font-black uppercase tracking-wider font-sans ${
            theme === "dark" ? "text-white" : "text-stone-900"
          }`}
        >
          Instruction Manual
        </span>
      </div>

      {/* Plain flex-col (no justify-evenly, no per-item flex-1): items pack
          at their own natural/compact height, immediately adjacent to one
          another, so divide-y borders sit flush against real content on
          both sides instead of floating in stretched blank space. An
          earlier version gave each item its own flex-1 (+ justify-center)
          specifically to absorb extra height when the card was stretched
          taller than the list needed — but that meant every item's own
          padding grew along with the card, reading as wasted whitespace
          once LookupPage.tsx's row started sizing itself to Input section's
          full natural height (lg:min-h-fit) rather than a squeezed-down
          "available space" allotment. Any leftover height the stretched
          card now has simply shows up as blank space after item 5, not
          inflated gaps inside each item.
          min-h-0 (paired with LookupPage.tsx's row min-h-fit): lets this
          region still shrink below the 5 items' natural height on a
          shorter viewport, scrolling within itself via overflow-y-auto
          rather than pushing the whole card (and the page around it)
          taller than the available space. */}
      <div
        className={`divide-y flex-grow flex flex-col min-h-0 overflow-y-auto ${
          theme === "dark" ? "divide-white/[0.08]" : "divide-[#a1b7c3]"
        }`}
      >
        {/* CARD 1 */}
        <div className="shrink-0 flex flex-col justify-center py-2.5 sm:py-3 px-4 lg:px-5 text-left overflow-hidden">
          <span
            className={`block font-mono text-[9px] mb-0.5 ${
              theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
            }`}
          >
            0x01
          </span>
          <h4
            className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            Multi-condition lookup
          </h4>
          <p
            className={`text-[12px] leading-snug font-sans ${
              theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
            }`}
          >
            Enter{" "}
            <strong
              className={theme === "dark" ? "text-white font-bold" : "text-stone-900 font-bold"}
            >
              all pre-existing diseases (PEDs)
            </strong>{" "}
            together before running the engine.
          </p>
        </div>

        {/* CARD 2 */}
        <div className="shrink-0 flex flex-col justify-center py-2.5 sm:py-3 px-4 lg:px-5 text-left overflow-hidden">
          <span
            className={`block font-mono text-[9px] mb-0.5 ${
              theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
            }`}
          >
            0x02
          </span>
          <h4
            className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            Input accuracy
          </h4>
          <p
            className={`text-[12px] leading-snug font-sans ${
              theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
            }`}
          >
            Use dropdown suggestions when available to reduce spelling errors. If not listed, enter it manually and proceed.
          </p>
        </div>

        {/* CARD 3 */}
        <div className="shrink-0 flex flex-col justify-center py-2.5 sm:py-3 px-4 lg:px-5 text-left overflow-hidden">
          <span
            className={`block font-mono text-[9px] mb-0.5 ${
              theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
            }`}
          >
            0x03
          </span>
          <h4
            className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            Diagnoses only
          </h4>
          <p
            className={`text-[12px] leading-snug font-sans mb-0.5 ${
              theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
            }`}
          >
            Run the engine for medical conditions (diagnosis), not the treatments.
          </p>
          <div className="flex flex-col gap-0.5 text-[11px] leading-none mt-1">
            <div>
              <strong className={theme === "dark" ? "text-emerald-400 font-bold" : "text-emerald-600 font-semibold"}>
                Correct:
              </strong>{" "}
              Hypothyroidism
            </div>
            <div>
              <strong className={theme === "dark" ? "text-rose-400 font-bold" : "text-rose-600 font-semibold"}>
                Incorrect:
              </strong>{" "}
              Thyroid surgery
            </div>
          </div>
        </div>

        {/* CARD 4 */}
        <div className="shrink-0 flex flex-col justify-center py-2.5 sm:py-3 px-4 lg:px-5 text-left overflow-hidden">
          <span
            className={`block font-mono text-[9px] mb-0.5 ${
              theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
            }`}
          >
            0x04
          </span>
          <h4
            className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            Output verification
          </h4>
          <p
            className={`text-[12px] leading-snug font-sans ${
              theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
            }`}
          >
            After lookup, verify each mapped question against actual payment journey questions to ensure accuracy.
          </p>
        </div>

        {/* CARD 5 */}
        <div className="shrink-0 flex flex-col justify-center py-2.5 sm:py-3 px-4 lg:px-5 text-left overflow-hidden">
          <span
            className={`block font-mono text-[9px] mb-0.5 ${
              theme === "dark" ? "text-[#00D3F3]" : "text-[#0754b7] font-bold"
            }`}
          >
            0x05
          </span>
          <h4
            className={`uppercase font-bold text-[13px] tracking-wide mb-0.5 font-sans ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            Flag mismatch
          </h4>
          <p
            className={`text-[12px] leading-snug font-sans ${
              theme === "dark" ? "text-white/50" : "text-stone-700 font-semibold"
            }`}
          >
            If you find an incorrect mapped question or error, use the{" "}
            <strong className={theme === "dark" ? "text-white font-bold" : "text-stone-900 font-bold"}>
              Flag
            </strong>{" "}
            option to report it immediately.
          </p>
        </div>
      </div>
    </div>
  );
}
