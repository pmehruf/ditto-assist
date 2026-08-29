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

      {/* Plain flex-col (no justify-evenly): that approach left each
          divide-y border floating in blank space, disconnected from the
          item below it, instead of sitting flush against it — looked just
          as unfinished as the original top-stacked gap. Each of the 5 items
          below now carries its own flex-1 instead, so they stay adjacent
          (dividers touch normally) while collectively growing to absorb
          whatever extra height the stretched card has — every item's own
          justify-center then centers its text within its now-larger slot,
          so the card reads as evenly filled at any height.
          min-h-0 (paired with LookupPage.tsx's row now being lg:flex-1
          lg:min-h-0 too): without it, this flex-grow region couldn't
          shrink below the 5 items' natural/min-content height, so on a
          shorter viewport the list silently pushed the whole card (and the
          page around it) taller than the available space instead of
          scrolling within itself, which is what overflow-y-auto here is
          actually for. */}
      <div
        className={`divide-y flex-grow flex flex-col min-h-0 overflow-y-auto ${
          theme === "dark" ? "divide-white/[0.08]" : "divide-[#a1b7c3]"
        }`}
      >
        {/* CARD 1 */}
        <div className="flex-1 flex flex-col justify-center py-2 sm:py-2.5 px-4 lg:px-5 text-left overflow-hidden">
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
        <div className="flex-1 flex flex-col justify-center py-2 sm:py-2.5 px-4 lg:px-5 text-left overflow-hidden">
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
        <div className="flex-1 flex flex-col justify-center py-2 sm:py-2.5 px-4 lg:px-5 text-left overflow-hidden">
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
        <div className="flex-1 flex flex-col justify-center py-2 sm:py-2.5 px-4 lg:px-5 text-left overflow-hidden">
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
        <div className="flex-1 flex flex-col justify-center py-2 sm:py-2.5 px-4 lg:px-5 text-left overflow-hidden">
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
