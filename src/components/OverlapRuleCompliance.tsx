import { Info } from "lucide-react";

interface OverlapRuleComplianceProps {
  theme: "light" | "dark";
}

export default function OverlapRuleCompliance({ theme }: OverlapRuleComplianceProps) {
  return (
    <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs leading-normal font-semibold ${
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
  );
}
