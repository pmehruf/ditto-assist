import {
  Info,
  Sparkles,
  Heart,
  Activity,
  FileText,
  Shield
} from "lucide-react";

interface OverlapRuleComplianceProps {
  theme: "light" | "dark";
}

export default function OverlapRuleCompliance({ theme }: OverlapRuleComplianceProps) {
  return (
    <div className={`p-6 rounded-2xl border transition-all duration-300 ${
      theme === "dark" 
        ? "bg-gradient-to-r from-teal-950/10 via-[#10141b] to-stone-900/10 border-[#252A34]" 
        : "bg-gradient-to-r from-teal-50/20 via-white to-stone-50/20 border-stone-200 shadow-sm"
    }`}>
      {/* CARD HEADER */}
      <div className="flex items-start gap-4 pb-5 border-b border-stone-200 dark:border-stone-800">
        <div className={`p-3 rounded-xl ${
          theme === "dark" ? "bg-teal-500/10 text-teal-400" : "bg-teal-50 text-teal-700"
        } shrink-0`}>
          <Shield className="w-6 h-6" />
        </div>
        <div>
          <h2 className={`text-base md:text-lg font-black tracking-tight ${
            theme === "dark" ? "text-white" : "text-stone-900"
          }`}>
            Disclosure Guidelines - Overlapping Questions
          </h2>
          <p className={`text-xs mt-1 font-medium ${
            theme === "dark" ? "text-stone-400" : "text-stone-500"
          }`}>
            Important instructions for declaring medical conditions, surgical histories, and active medications.
          </p>
        </div>
      </div>

      {/* DETAILED CONTENT BLOCKS */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* RULE 1: Illness & Active Medications */}
        <div className={`p-5 rounded-xl border ${
          theme === "dark" ? "bg-stone-950/30 border-stone-800/60" : "bg-stone-50/50 border-stone-250"
        } space-y-3`}>
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded bg-[#14B8A6]/10 text-[#14B8A6]">
              <Heart className="w-4 h-4" />
            </div>
            <h3 className={`text-xs font-black uppercase tracking-wider ${
              theme === "dark" ? "text-stone-100" : "text-stone-950"
            }`}>
              Illness &amp; Medication Overlap
            </h3>
          </div>
          <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-300" : "text-stone-900"}`}>
            When a customer declares an active pre-existing disease (PED) like Diabetes, Blood Pressure, or Thyroid:
          </p>
          <ul className="space-y-2 text-[11px] font-semibold leading-relaxed">
            <li className="flex gap-2">
              <span className="text-[#14B8A6] select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                Declare <strong>"Yes" first</strong> under the specific main path question (e.g., Hypertension under the Blood Pressure question).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#14B8A6] select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                Under active therapies, always record medication details using generic names or generic condition descriptions (e.g. <em>"Medication for Diabetes going on"</em>) rather than strict retail brand logos.
              </span>
            </li>
          </ul>
        </div>

        {/* RULE 2: Illness & Surgery History */}
        <div className={`p-5 rounded-xl border ${
          theme === "dark" ? "bg-stone-950/30 border-stone-800/60" : "bg-stone-50/50 border-stone-250"
        } space-y-3`}>
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded bg-blue-500/10 text-blue-400">
              <Activity className="w-4 h-4" />
            </div>
            <h3 className={`text-xs font-black uppercase tracking-wider ${
              theme === "dark" ? "text-stone-100" : "text-stone-950"
            }`}>
              Illness &amp; Surgery Overlap
            </h3>
          </div>
          <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-300" : "text-stone-900"}`}>
            If a surgical procedure was performed historically or actively to resolve or manage a declared PED:
          </p>
          <ul className="space-y-2 text-[11px] font-semibold leading-relaxed">
            <li className="flex gap-2">
              <span className="text-blue-400 select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                It is mandatory to select <strong>"Yes" to BOTH</strong> the primary disease question and the Surgery question in the user portal.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-400 select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                In the specific details / Catch-all Others box, record the connection clearly (e.g. <em>"Surgery for Tonsilitis done"</em> or <em>"Hernioplasty done for Hernia"</em>).
              </span>
            </li>
          </ul>
        </div>

        {/* RULE 3: Illness & Generic Hospitalisations */}
        <div className={`p-5 rounded-xl border ${
          theme === "dark" ? "bg-stone-950/30 border-stone-800/60" : "bg-stone-50/50 border-stone-250"
        } space-y-3`}>
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded bg-amber-500/10 text-amber-500 dark:text-amber-400">
              <FileText className="w-4 h-4" />
            </div>
            <h3 className={`text-xs font-black uppercase tracking-wider ${
              theme === "dark" ? "text-stone-100" : "text-stone-950"
            }`}>
              Hospitalisation Overlap rules
            </h3>
          </div>
          <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-300" : "text-stone-900"}`}>
            When hospitalization occurs due to acute episodes or maintenance of a chronic declared condition:
          </p>
          <ul className="space-y-2 text-[11px] font-semibold leading-relaxed">
            <li className="flex gap-2">
              <span className="text-amber-500 dark:text-amber-400 select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                Declare <strong>"Yes" to the specific medical category</strong> (e.g., Stomach/Gastro), and <strong>"Yes" under Hospitalisation History</strong>.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-500 dark:text-amber-400 select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                Explicitly label the diagnosis (e.g. <em>"Hospitalisation for kidney stones"</em>) in the notes logs to ensure a smoother, faster approval routing and avoid follow-up queries.
              </span>
            </li>
          </ul>
        </div>

        {/* RULE 4: Diagnostic & Special Medical Tests */}
        <div className={`p-5 rounded-xl border ${
          theme === "dark" ? "bg-stone-950/30 border-stone-800/60" : "bg-stone-50/50 border-stone-250"
        } space-y-3`}>
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded bg-purple-500/10 text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <h3 className={`text-xs font-black uppercase tracking-wider ${
              theme === "dark" ? "text-stone-100" : "text-stone-950"
            }`}>
              Medical Diagnostics Checklist
            </h3>
          </div>
          <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-300" : "text-stone-900"}`}>
            If specific medical tests were done, they must be meticulously logged using literal labels:
          </p>
          <ul className="space-y-2 text-[11px] font-semibold leading-relaxed">
            <li className="flex gap-2">
              <span className="text-purple-400 select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                Use standard text like <strong>"Medical test(s) was/were done"</strong>.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-purple-400 select-none shrink-0">•</span>
              <span className={theme === "dark" ? "text-stone-300" : "text-slate-700"}>
                It is <strong>mandatory to specify the exact test name</strong> if they were: <em>Angiography, TRT (Treadmill Test) / Stress Test, ECG (Echocardiogram), MRI (Magnetic Resonance Imaging), Endoscopy, Colonoscopy, or USG (Ultrasound Sonography)</em>.
              </span>
            </li>
          </ul>
        </div>

      </div>

      {/* FAILSAFE BAR */}
      <div className={`mt-6 p-4 rounded-xl border flex items-start gap-3 text-xs leading-normal font-semibold ${
        theme === "dark" ? "bg-teal-950/20 border-teal-850/40 text-stone-300" : "bg-teal-50/30 border-teal-150 text-stone-750"
      }`}>
        <div className={`p-1 rounded ${
          theme === "dark" ? "bg-teal-500/10 text-teal-400" : "bg-teal-50 text-teal-600"
        } shrink-0`}>
          <Info className="w-4 h-4" />
        </div>
        <div>
          <span className="font-extrabold uppercase text-[10.5px] block mb-0.5 tracking-wider">The General Overlap Rule</span>
          If a condition fits two or more specific questions in the main customer journey, follow the rules detailed above. This ensures consistent premium assessment and eliminates duplicate flags during automated safety checks.
        </div>
      </div>
    </div>
  );
}
