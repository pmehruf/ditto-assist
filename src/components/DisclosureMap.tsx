import { useState } from "react";
import {
  Layers,
  ChevronDown,
  Compass,
  AlertTriangle,
  Lightbulb,
  ArrowRight
} from "lucide-react";

interface DisclosureMapProps {
  theme: "light" | "dark";
}

export default function DisclosureMap({ theme }: DisclosureMapProps) {
  // All 4 branches start collapsed.
  const [expandedBranches, setExpandedBranches] = useState<number[]>([]);

  const toggleBranch = (id: number) => {
    if (expandedBranches.includes(id)) {
      setExpandedBranches(expandedBranches.filter(x => x !== id));
    } else {
      setExpandedBranches([...expandedBranches, id]);
    }
  };

  return (
    <div className="space-y-6 select-none font-sans">

      {/* DECISION SWITCH (Compact Horizontal Reminder) */}
      <div className={`p-5 rounded-2xl border backdrop-blur-md relative overflow-hidden space-y-4 ${
        theme === "dark"
          ? "border-[#2a9bff]/40 bg-gradient-to-b from-[#152d49]/60 to-[#0e1f33]/50 shadow-[0_8px_24px_rgba(0,0,0,0.26),0_0_18px_rgba(42,155,255,0.1)]"
          : "border-sky-200 bg-gradient-to-b from-sky-50 to-white shadow-xs"
      }`}>
        <div className="flex gap-3 items-center">
          <div className={`w-9 h-9 rounded-xl display grid place-items-center text-lg shrink-0 border ${
            theme === "dark" ? "bg-white/5 border-white/10" : "bg-sky-100 border-sky-200"
          }`}>
            🔀
          </div>
          <div>
            <h2 className={`text-base font-bold ${theme === "dark" ? "text-[#eaf3ff]" : "text-stone-900"}`}>
              Others Section — The Decision Switch
            </h2>
            <p className={`text-xs m-0 ${theme === "dark" ? "text-zinc-400" : "text-stone-605"}`}>
              The Others section determines whether a case enters Manual Underwriting or proceeds through Automated Processing.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {/* Row 1 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-lg border ${
              theme === "dark" ? "bg-[#ff5a6e]/10 border-[#ff5a6e]/45 text-[#ffb3bd]" : "bg-rose-50 border-rose-200 text-rose-700"
            }`}>
              🔴 PED Present
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-stone-400" />
            <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-lg border ${
              theme === "dark" ? "bg-white/5 border-white/10 text-stone-200" : "bg-stone-50 border-stone-200 text-stone-700"
            }`}>
              Fill “Others”
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-stone-400" />
            <span className={`inline-flex items-center text-xs font-extrabold px-2.5 py-1 rounded-lg border ${
              theme === "dark" ? "bg-[#ff5a6e]/7 border-[#ff5a6e]/42 text-[#ff9aa8]" : "bg-rose-100/60 border-rose-300 text-rose-800"
            }`}>
              Manual Underwriting
            </span>
          </div>

          {/* Row 2 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-lg border ${
              theme === "dark" ? "bg-[#2ed573]/10 border-[#2ed573]/45 text-[#9bf0bf]" : "bg-emerald-50 border-emerald-200 text-emerald-700"
            }`}>
              🟢 No PED
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-stone-400" />
            <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-lg border ${
              theme === "dark" ? "bg-white/5 border-white/10 text-stone-200" : "bg-stone-50 border-stone-200 text-stone-700"
            }`}>
              Leave “Others” Blank
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-stone-400" />
            <span className={`inline-flex items-center text-xs font-extrabold px-2.5 py-1 rounded-lg border ${
              theme === "dark" ? "bg-[#2ed573]/7 border-[#2ed573]/42 text-[#7fe6a8]" : "bg-emerald-100/60 border-emerald-300 text-emerald-850"
            }`}>
              Automated Processing
            </span>
          </div>
        </div>

        <div className={`h-px ${theme === "dark" ? "bg-white/10" : "bg-stone-200"}`} />
        <div className={`text-xs font-bold ${theme === "dark" ? "text-[#bfe0ff]" : "text-stone-700"}`}>
          📘 Now let’s learn how to do it properly.
        </div>
      </div>

      {/* DECLARATION GUIDE: OVERLAPPING QUESTIONS Block (Interactive branches, covers full width — sits above the Ladder/Decision Sequence grid) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <Layers className="w-4 h-4 text-[#117FDA]" />
          <h3 className={`text-xs font-black uppercase tracking-widest ${
            theme === "dark" ? "text-stone-200" : "text-stone-850"
          }`}>
            Declaration Guide: Overlapping Questions
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* BRANCH 1: PED x Surgery */}
          <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
            theme === "dark" ? "bg-[#0e2236]" : "bg-white shadow-xs"
          } ${
            expandedBranches.includes(1)
              ? "border-[#ff9f43]/50 ring-1 ring-[#ff9f43]/20"
              : theme === "dark" ? "border-white/10" : "border-stone-250"
          }`}>
            <button
              onClick={() => toggleBranch(1)}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                theme === "dark"
                  ? "bg-white/5 text-[#ff9f43] border-[#ff9f43]/30"
                  : "bg-[#FEF3C7] text-[#D97706] border-[#ff9f43]/55"
              }`}>
                🔪
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-[#B4C2D6]" : "text-stone-500"}`}>
                  Branch 1
                </div>
                <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED × Surgery
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                expandedBranches.includes(1) ? "transform rotate-180 text-[#ff9f43]" : ""
              }`} />
            </button>

            {expandedBranches.includes(1) && (
              <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                <div className="mt-4 pl-3.5 border-l-2 border-[#ff9f43] space-y-5">

                  {/* Sub-Case A */}
                  <div className="space-y-2">
                    <strong className={`text-xs block ${theme === "dark" ? "text-white" : ""}`}>
                      Cured / one-time (Cataract, Kidney stones) — the surgery is the key declaration.
                    </strong>
                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${theme === "dark" ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-600"}`}>
                        <li>Surgeries Q or Organ / System Q <span className="font-extrabold" style={{ color: "var(--teal)" }}>(PED Q is optional)</span></li>
                      </ol>
                    </div>
                    <span className={`inline-block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                      theme === "dark" ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                    }`}>
                      <span className="text-[#3b9eff] font-bold">Care:</span> Surgery Q = Yes + surgery name in <strong>Others</strong>
                    </span>
                  </div>

                  {/* Sub-Case B */}
                  <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-4 space-y-2">
                    <strong className={`text-xs block ${theme === "dark" ? "text-white" : ""}`}>
                      Linked to active PED (heart condition + Angioplasty) — PED is extremely important here; its declaration is <span className="text-red-500">mandatory</span> in the PED / Organ / System specific question, along with the surgery.
                    </strong>

                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${theme === "dark" ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-600"}`}>
                        <li>Declaration of the PED in PED / Organ / System (by priority order) is <span className="text-red-500 font-black">mandatory</span></li>
                        <li>
                          Surgery declared in:
                          <ul className="list-disc pl-4 mt-1 space-y-0.5">
                            <li>Same Q as the PED declaration</li>
                            <li>Generic umbrella Surgeries Q</li>
                            <li>Others Section</li>
                          </ul>
                        </li>
                      </ol>
                    </div>

                    <span className={`block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                      theme === "dark" ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                    }`}>
                      <span className="text-[#3b9eff] font-bold">Care:</span> PED/Organ Q = Yes → Surgery Q = Yes → Others = PED name <span className="text-red-500 font-extrabold">(mandatory)</span> + surgery name <span className="font-bold" style={{ color: "var(--teal)" }}>(optional)</span>
                    </span>
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* BRANCH 2: PED x Hospitalization */}
          <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
            theme === "dark" ? "bg-[#0e2236]" : "bg-white shadow-xs"
          } ${
            expandedBranches.includes(2)
              ? "border-[#2ed573]/50 ring-1 ring-[#2ed573]/20"
              : theme === "dark" ? "border-white/10" : "border-stone-250"
          }`}>
            <button
              onClick={() => toggleBranch(2)}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                theme === "dark"
                  ? "bg-white/5 text-[#2ed573] border-[#2ed573]/30"
                  : "bg-[#E1F7E8] text-[#0F766E] border-[#2ed573]/55"
              }`}>
                🛏️
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-[#B4C2D6]" : "text-stone-500"}`}>
                  Branch 2
                </div>
                <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED × Hospitalization
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                expandedBranches.includes(2) ? "transform rotate-180 text-[#2ed573]" : ""
              }`} />
            </button>

            {expandedBranches.includes(2) && (
              <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                <div className="mt-4 pl-3.5 border-l-2 border-[#2ed573] space-y-5">

                  {/* Sub-case A */}
                  <div className="space-y-2">
                    <strong className={`text-xs block ${theme === "dark" ? "text-white" : ""}`}>
                      Non-active PED — one-time & not organ-related (Dengue, COVID, Viral fever).
                    </strong>
                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${theme === "dark" ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-600"}`}>
                        <li>Hospitalization Q only</li>
                      </ol>
                    </div>
                    <span className={`inline-block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                      theme === "dark" ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                    }`}>
                      <span className="text-[#3b9eff] font-bold">Care:</span> Hospitalization Q = Yes + details in <strong>Others</strong>
                    </span>
                  </div>

                  {/* Sub-case B */}
                  <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-4 space-y-2">
                    <strong className={`text-xs block ${theme === "dark" ? "text-white" : ""}`}>
                      Active-PED-linked hospitalization (hospitalized for Diabetes).
                    </strong>

                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${theme === "dark" ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-600"}`}>
                        <li>Declaration of the PED in PED / Organ / System (by priority order) is <span className="text-red-500 font-extrabold">mandatory</span></li>
                        <li>
                          Hospitalization declared in:
                          <ul className="list-disc pl-4 mt-1 space-y-0.5">
                            <li>Same Q as the PED declaration</li>
                            <li>Generic umbrella Hospitalization Q</li>
                            <li>Others Section</li>
                          </ul>
                        </li>
                      </ol>
                    </div>

                    <span className={`block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                      theme === "dark" ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                    }`}>
                      <span className="text-[#3b9eff] font-bold">Care:</span> PED/Organ Q = Yes → Hospitalization Q = Yes → Others = PED name <span className="text-red-500 font-extrabold">(mandatory)</span> + details <span className="font-bold" style={{ color: "var(--teal)" }}>(optional)</span>
                    </span>
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* BRANCH 3: PED x Medication */}
          <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
            theme === "dark" ? "bg-[#0e2236]" : "bg-white shadow-xs"
          } ${
            expandedBranches.includes(3)
              ? "border-[#3b9eff]/50 ring-1 ring-[#3b9eff]/20"
              : theme === "dark" ? "border-white/10" : "border-stone-250"
          }`}>
            <button
              onClick={() => toggleBranch(3)}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                theme === "dark"
                  ? "bg-white/5 text-[#3b9eff] border-[#3b9eff]/30"
                  : "bg-[#E1EAF7] text-[#1D63ED] border-[#3b9eff]/55"
              }`}>
                💊
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-[#B4C2D6]" : "text-stone-500"}`}>
                  Branch 3
                </div>
                <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED × Medication
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                expandedBranches.includes(3) ? "transform rotate-180 text-[#3b9eff]" : ""
              }`} />
            </button>

            {expandedBranches.includes(3) && (
              <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                <div className="mt-4 pl-3.5 border-l-2 border-[#3b9eff] space-y-4">
                  <div className="space-y-1.5">
                    <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-300" : "text-stone-750"}`}>
                      <strong>Declare both the PED and the medication.</strong> Use the general format — “Medications of [condition] going on” — the drug name is not required.
                    </p>

                    <div className="mt-3 space-y-2">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${theme === "dark" ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-600"}`}>
                        <li>PED Q + Meds in the <strong>same</strong> question</li>
                        <li>PED Q + Meds in the generic umbrella Meds Q</li>
                        <li>PED Q + Meds in the Others section</li>
                      </ol>
                    </div>

                    <div className="mt-3">
                      <span className={`inline-block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                        theme === "dark" ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                      }`}>
                        <span className="text-[#3b9eff] font-bold">Care:</span> PED Q = Yes + medication in <strong>Others</strong>
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-3.5">
                    <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-400" : "text-stone-700"}`}>
                      A <strong>missing-medication flag</strong> is raised for <strong>Diabetes · Cholesterol · Hypertension · Thyroid</strong> if the PED is declared but no medication is.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* BRANCH 4: PED/No-PED × Investigative Tests */}
          <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
            theme === "dark" ? "bg-[#0e2236]" : "bg-white shadow-xs"
          } ${
            expandedBranches.includes(4)
              ? "border-[#b07cff]/50 ring-1 ring-[#b07cff]/20"
              : theme === "dark" ? "border-white/10" : "border-stone-250"
          }`}>
            <button
              onClick={() => toggleBranch(4)}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                theme === "dark"
                  ? "bg-white/5 text-[#b07cff] border-[#b07cff]/30"
                  : "bg-[#EBE1F7] text-[#7C3AED] border-[#b07cff]/55"
              }`}>
                🔬
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[10px] font-bold uppercase tracking-wider ${theme === "dark" ? "text-[#B4C2D6]" : "text-stone-500"}`}>
                  Branch 4
                </div>
                <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED/No-PED × Investigative Tests
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                expandedBranches.includes(4) ? "transform rotate-180 text-[#b07cff]" : ""
              }`} />
            </button>

            {expandedBranches.includes(4) && (
              <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                <div className="mt-4 pl-3.5 border-l-2 border-[#b07cff] space-y-4">

                  {/* Safety Flag / Alert Row */}
                  <div className={`p-3 rounded-xl border font-semibold ${
                    theme === "dark" ? "bg-[#ff5a6e]/10 border-[#ff5a6e]/50 text-[#ffd9df]" : "bg-red-50 border-red-200 text-red-800"
                  }`}>
                    <div className="text-xs">
                      <span className="text-red-700 font-bold dark:text-[#ff8a9a]">⚠ Mandatory declaration:</span> Disclose <strong>with or without a diagnosis</strong> (exception applicable), <strong>with or without findings</strong>, and <strong>with or without reports</strong>.
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-300" : "text-stone-750"}`}>
                      <strong>Exception:</strong> if a test was done <strong>only</strong> to diagnose an already-declared PED (e.g. an <strong>ECG</strong> that revealed a declared heart condition), you need <strong>not</strong> name it.
                    </p>

                    <div className="mt-3 space-y-2">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${theme === "dark" ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-600"}`}>
                        <li>Umbrella Question — Investigative Tests</li>
                        <li>Others Section</li>
                      </ol>
                    </div>

                    <div className="mt-3 space-y-4">
                      <div className={`p-3 rounded-xl border ${
                        theme === "dark" ? "bg-stone-950/20 border-white/5" : "bg-white border-stone-200 shadow-xs"
                      }`}>
                        <strong className={`text-xs block font-bold mb-1 ${theme === "dark" ? "text-white" : ""}`}>
                          7 critical tests — name exactly:
                        </strong>
                        <p className="font-mono text-xs font-extrabold leading-relaxed" style={{ color: theme === "dark" ? "var(--accent)" : "#6366f1" }}>
                          Angiography · TRT (Treadmill Test) / Stress Test · ECG · MRI · Endoscopy · Colonoscopy · USG
                        </p>
                      </div>

                      <div className={`p-3 rounded-xl border ${
                        theme === "dark" ? "bg-stone-950/20 border-white/5" : "bg-white border-stone-200 shadow-xs"
                      }`}>
                        <strong className={`text-xs block font-bold mb-1 ${theme === "dark" ? "text-white" : ""}`}>
                          Any other test:
                        </strong>
                        <p className={`text-xs m-0 ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-600"}`}>
                          → use the generic phrase <strong>“Medical tests were done.”</strong>
                        </p>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* MAIN LAYOUT GRID: Priority Ladder + Critical Rules (left) and Decision Sequence (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

        {/* LEFT COLUMN (Priority Ladder & Critical Rules, stacked) */}
        <div className="col-span-1 lg:col-span-4 space-y-6">

          {/* PRIORITY LADDER (SPINE) */}
          <aside className={`p-5 rounded-2xl border space-y-4 transition-all ${
            theme === "dark" 
              ? "bg-[#0e2236] border-white/10" 
              : "bg-[#EBF1F7] border-stone-250 shadow-xs"
          }`}>
            <h3 className={`text-xs font-black uppercase tracking-widest text-center border-b pb-2 ${
              theme === "dark" ? "text-[#90a6c4] border-white/5" : "text-stone-700 border-stone-250"
            }`}>
              The Priority Ladder
            </h3>
            
            <div className="space-y-3.5 relative">
              {/* Rung P0 */}
              <div className="flex gap-3 items-start relative group">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-[#06101d] bg-gradient-to-br from-[#5db4ff] to-[#2a8fef] shrink-0 shadow-sm">
                  P0
                </div>
                <div className="space-y-0.5">
                  <div className={`text-xs font-extrabold ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>Direct Match</div>
                  <div className={`text-[11px] leading-relaxed ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-600"}`}>Question names the exact PED — Diabetes, Hypertension</div>
                </div>
                <div className="absolute left-[18px] top-9 w-[2px] h-3.5 bg-white/15 dark:bg-white/10" />
              </div>

              {/* Rung P1 */}
              <div className="flex gap-3 items-start relative group">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-[#06101d] bg-gradient-to-br from-[#ff9f43] to-[#ff7a59] shrink-0 shadow-sm">
                  P1
                </div>
                <div className="space-y-0.5">
                  <div className={`text-xs font-extrabold ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>Category Match</div>
                  <div className={`text-[11px] leading-relaxed ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-600"}`}>Organ / system question — Thyroid → endocrine / parathyroid glands Q</div>
                </div>
                <div className="absolute left-[18px] top-9 w-[2px] h-3.5 bg-white/15 dark:bg-white/10" />
              </div>

              {/* Rung P2 */}
              <div className="flex gap-3 items-start relative group">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-[#06101d] bg-gradient-to-br from-[#2ed573] to-[#17b894] shrink-0 shadow-sm">
                  P2
                </div>
                <div className="space-y-0.5">
                  <div className={`text-xs font-extrabold ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>Umbrella Match</div>
                  <div className={`text-[11px] leading-relaxed ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-600"}`}>Event catch-all — Surgery → Surgeries Q; Hospitalization → Hospitalization Q; Medication → Meds Q</div>
                </div>
                <div className="absolute left-[18px] top-9 w-[2px] h-3.5 bg-white/15 dark:bg-white/10" />
              </div>

              {/* Rung P3 */}
              <div className="flex gap-3 items-start relative group">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-[#06101d] bg-gradient-to-br from-[#ff7088] to-[#ff4f6b] shrink-0 shadow-sm">
                  P3
                </div>
                <div className="space-y-0.5">
                  <div className={`text-xs font-extrabold ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>Others</div>
                  <div className={`text-[11px] leading-relaxed ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-600"}`}>Last-resort placement, most important section — the manual-review trigger</div>
                </div>
              </div>
            </div>

            <div className={`pt-3 border-t text-[11px] leading-normal font-semibold ${
              theme === "dark" ? "border-white/5 text-[#6b82a3]" : "border-stone-250 text-stone-605"
            }`}>
              <strong className={`${theme === "dark" ? "text-[#b07cff]" : "text-[#7C3AED]"}`}>Always</strong> climb to the best match — then <strong className={`${theme === "dark" ? "text-[#b07cff]" : "text-[#7C3AED]"}`}>always</strong> also feed P3. Disclosing in P0–P2 without feeding Others risks Automated Issuance.
            </div>
          </aside>

          {/* THE CRITICAL RULES (Strict Adherence Mandates - Left side, under Priority Ladder) */}
          <div className={`p-5 rounded-2xl border transition-all relative overflow-hidden space-y-4 ${
            theme === "dark"
              ? "bg-gradient-to-b from-[#2a171d] to-[#161214] border-red-500/55 text-stone-200 shadow-[inset_0_0_25px_rgba(255,90,110,0.1)]"
              : "bg-[#FFF5F6] border-red-300 text-rose-950 shadow-sm"
          }`}>
            <div className="absolute right-0 top-0 w-32 h-32 bg-red-500/5 dark:bg-red-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex items-center gap-2.5 border-b pb-3.5 border-stone-200/50 dark:border-white/5">
              <div className="p-2 rounded-xl bg-red-500/15 text-red-500 shrink-0">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className={`text-sm md:text-base font-black ${theme === "dark" ? "text-red-400" : "text-red-800"}`}>
                   ⛔ Critical Rules
                </h3>
              </div>
            </div>
            
            <div className="space-y-3">
              {/* Item 1 */}
              <div className={`p-4 rounded-xl border flex gap-3 items-start ${
                theme === "dark" ? "bg-stone-950/20 border-white/5" : "bg-white border-red-100 shadow-xs"
              }`}>
                <div className="w-6 h-6 rounded-lg bg-red-500/10 text-red-500 font-mono text-xs font-black flex items-center justify-center shrink-0">
                  1
                </div>
                <div className="space-y-0.5">
                  <strong className={`text-xs block font-bold ${theme === "dark" ? "text-stone-100" : "text-stone-900"}`}>
                    Never Leave Blank Rule
                  </strong>
                  <p className={`text-[11px] leading-relaxed font-semibold m-0 ${theme === "dark" ? "text-stone-400" : "text-stone-605"}`}>
                    The “Others” section must never be left blank if a PED exists, a diagnostic test was performed, or a hospitalization had happened to disclose.
                  </p>
                </div>
              </div>

              {/* Item 2 */}
              <div className={`p-4 rounded-xl border flex gap-3 items-start ${
                theme === "dark" ? "bg-stone-950/20 border-white/5" : "bg-white border-red-100 shadow-xs"
              }`}>
                <div className="w-6 h-6 rounded-lg bg-red-500/10 text-red-500 font-mono text-xs font-black flex items-center justify-center shrink-0">
                  2
                </div>
                <div className="space-y-0.5">
                  <strong className={`text-xs block font-bold ${theme === "dark" ? "text-stone-100" : "text-stone-900"}`}>
                    Report Availability
                  </strong>
                  <p className={`text-[11px] leading-relaxed font-semibold m-0 ${theme === "dark" ? "text-stone-400" : "text-stone-605"}`}>
                    Never mention in the declarations that the “reports are unavailable”.
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN (Decision Sequence) */}
        <div className="col-span-1 lg:col-span-8">

          {/* DECISION SEQUENCE (Moved directly to the right of Priority Ladder) */}
          <div className={`p-5 rounded-2xl border space-y-4 m-0 transition-all h-full flex flex-col ${
            theme === "dark" ? "bg-[#0e2236] border-white/10" : "bg-white border-stone-250 shadow-xs"
          }`}>
            <div className="flex items-center gap-2 border-b pb-3 border-stone-200/50 dark:border-white/5">
              <Compass className="w-4.5 h-4.5 text-teal-400" />
              <h3 className={`text-sm font-black uppercase tracking-wider ${
                theme === "dark" ? "text-[#bfe0ff]" : "text-stone-900"
              }`}>
                Decision Sequence
              </h3>
            </div>

            {/* Plan-specific extras */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`p-4 rounded-xl border ${
                theme === "dark" ? "bg-stone-950/25 border-white/5" : "bg-[#F1F6FB] border-[#3b9eff]/20"
              }`}>
                <div className="flex items-center gap-1.5 font-black text-[11px] mb-1 uppercase tracking-wide" style={{ color: theme === "dark" ? "var(--accent)" : "#3b82f6" }}>
                  🛡️ Care plans
                </div>
                <p className={`text-[11.5px] leading-relaxed m-0 font-medium ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-650"}`}>
                  PED questions have no surgery/hospitalization sub-question — so mark the umbrella Q = Yes <strong>and</strong> write the name into Others, per profile separately.
                </p>
              </div>

              <div className={`p-4 rounded-xl border ${
                theme === "dark" ? "bg-stone-950/25 border-white/5" : "bg-[#FFFDF3] border-amber-300/60"
              }`}>
                <div className="flex items-center gap-1.5 font-black text-[11px] mb-1 uppercase tracking-wide text-amber-600 dark:text-[#ff9f43]">
                  ❤️ HDFC plans
                </div>
                <p className={`text-[11.5px] leading-relaxed m-0 font-medium ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-650"}`}>
                  Lifestyle habits should be asked and declared under the Others section, if any.
                </p>
              </div>
            </div>

            {/* Core sequence steps */}
            <div className="space-y-4">
              <ol className="space-y-1">
                {[
                  { text: <span><strong>Healthy?</strong> : No - PEDs / reports / medications / medical tests → Leave <strong>Others</strong> blank.</span> },
                  { text: <span><strong>Each PED</strong> finds its highest home: P0 (exact) → P1 (category) → P2 (umbrella). If a condition fits a P0/P1 question in the payment journey and a P2 umbrella question, follow the Declaration Guide on Overlap Questions.</span> },
                  { text: <span><strong>Events:</strong> surgery / hospitalization / medication → select the respective P2 umbrella Q without fail if applicable.</span> },
                  { text: <span>
                      <strong>Tests — with or without diagnosis, findings or reports:</strong>
                      <span className="block mt-1 pl-2 border-l border-white/10 dark:border-white/10 space-y-1 text-[11px]">
                        <span>• <strong>one of the 7</strong> → name it: <span className={theme === "dark" ? "text-[#90a6c4]" : "text-stone-605"}>Angiography · TRT (Treadmill Test) / Stress Test · ECG · MRI · Endoscopy · Colonoscopy · USG</span></span>
                        <span>• <strong>Any other</strong> → “Medical tests were done.” <span className={theme === "dark" ? "text-zinc-500" : "text-stone-500"}> (Not mandatory if there is a diagnosis which is declared in the application. E.g. ECG, and we have declared the angioplasty for which the ECG was taken.)</span></span>
                      </span>
                    </span>
                  },
                  { text: <span><strong>Plan extras:</strong> Care → name surgery/hosp per profile in Others; HDFC → add lifestyle habits.</span> },
                  { text: <span><strong>Feed Others (P3):</strong> un-housed PED names + required keywords. Nothing specific left? → “Medical details available.” Never blank on a risk; never say reports are unavailable.</span> }
                ].map((step, idx) => (
                  <li key={idx} className={`relative pl-8 py-2 text-xs font-semibold leading-relaxed border-b ${
                    theme === "dark" ? "border-white/5" : "border-stone-150"
                  } last:border-b-0`}>
                    <span className={`absolute left-0 top-2.5 w-5 h-5 rounded flex items-center justify-center font-mono text-[10px] font-black shrink-0 ${
                      theme === "dark" ? "bg-white/5 border border-white/10 text-cyan-400" : "bg-[#DDE5F0] border border-stone-250 text-stone-850"
                    }`}>
                      {idx + 1}
                    </span>
                    <span className={theme === "dark" ? "text-stone-300" : "text-stone-750"}>
                      {step.text}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Warnings flags */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-dashed border-stone-200/50 dark:border-white/5 mt-auto">
              <div className="border-l-3 border-[#e0b94a] bg-[#FEF3C7]/15 dark:bg-[#e0b94a]/5 p-3 rounded-r-xl">
                <div className="font-extrabold text-[10px] text-[#e0b94a] uppercase tracking-wider mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> ⚑ Care-only vs all-plans
                </div>
                <p className={`text-[10px] leading-relaxed m-0 ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-550"}`}>
                  Surgery/hospitalization naming-in-Others is treated as Care-specific (Care PED questions lack a surgery/hosp sub-question). Confirm against the actual Care question bank.
                </p>
              </div>

              <div className="border-l-3 border-[#e0b94a] bg-[#FEF3C7]/15 dark:bg-[#e0b94a]/5 p-3 rounded-r-xl">
                <div className="font-extrabold text-[10px] text-[#e0b94a] uppercase tracking-wider mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> ⚑ Organ-question buckets
                </div>
                <p className={`text-[10px] leading-relaxed m-0 ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-550"}`}>
                  Organ / system PED questions vary by plan. Confirm which organ-question bucket each plan uses before locking any alias table.
                </p>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* UNDER ALL THIS: THE 3 KEYWORDS "DO NOT MIX UP" CARD BLOCK (Spans full width) */}
      <div className={`p-5 rounded-2xl border space-y-4 ${
        theme === "dark" ? "bg-[#0e2236] border-white/10" : "bg-white border-stone-250 shadow-xs"
      }`}>
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-500 dark:text-[#e0b94a]" />
          <h3 className={`text-xs font-black uppercase tracking-widest ${
            theme === "dark" ? "text-[#bfe0ff]" : "text-[#1A365D]"
          }`}>
            The 3 keywords — do not mix up
          </h3>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Chip 1 */}
          <div className={`p-4 rounded-xl border flex flex-col justify-between gap-2.5 ${
            theme === "dark" ? "bg-white/5 border-indigo-500/35" : "bg-[#F1F6FB] border-[#3b9eff]/20"
          }`}>
            <div>
              <span className={`font-mono text-[12.5px] font-black tracking-wide block ${theme === "dark" ? "text-[#7fc0ff]" : "text-[#1D63ED]"}`}>
                “Medical details available”
              </span>
              <p className={`text-[11px] leading-relaxed font-semibold mt-2 ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-605"}`}>
                History exists but there are <em>no reports</em> — or everything’s declared and nothing else remains. Generic manual-review trigger.
              </p>
            </div>
          </div>

          {/* Chip 2 */}
          <div className={`p-4 rounded-xl border flex flex-col justify-between gap-2.5 ${
            theme === "dark" ? "bg-white/5 border-emerald-500/35" : "bg-[#EBF7EF] border-emerald-300/30"
          }`}>
            <div>
              <span className={`font-mono text-[12.5px] font-black tracking-wide block ${theme === "dark" ? "text-[#69e29b]" : "text-[#0F766E]"}`}>
                “Medical tests were done”
              </span>
              <p className={`text-[11px] leading-relaxed font-semibold mt-2 ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-605"}`}>
                A generic term to be used when an investigative test was performed and is <strong>not one of the 7</strong> listed tests.
              </p>
            </div>
          </div>

          {/* Chip 3 */}
          <div className={`p-4 rounded-xl border flex flex-col justify-between gap-2.5 ${
            theme === "dark" ? "bg-white/5 border-purple-500/35" : "bg-[#F5EEFF] border-purple-300/30"
          }`}>
            <div>
              <span className={`font-mono text-[12.5px] font-black tracking-wide block ${theme === "dark" ? "text-[#c6a4ff]" : "text-[#7C3AED]"}`}>
                “Actual test name”
              </span>
              <p className={`text-[11px] leading-relaxed font-semibold mt-2 ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-605"}`}>
                One of the <strong>7 critical</strong> tests was done — name it: Angiography, TRT (Treadmill Test) / Stress Test, ECG, MRI, Endoscopy, Colonoscopy, USG.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <p className={`text-[10px] font-bold text-center leading-relaxed font-mono ${
        theme === "dark" ? "text-[#6b82a3]" : "text-stone-600"
      }`}>
        Reading order: Engine → Branches → Ladder → Decision Sequence → Critical Rules → Keywords.
      </p>

    </div>
  );
}

