import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle,
  Search,
  X,
  ClipboardList,
  Target,
  Info,
  ArrowRight,
  FileSpreadsheet,
  XCircle
} from "lucide-react";
import { matchSpecificIllness, MASTER_ILLNESSES, IllnessOverrideRecord } from "../specificIllnessEngine";

interface PlanScopeManagerProps {
  productionPlans: string[];
  theme: string;
}

export default function PlanScopeManager({
  productionPlans,
  theme
}: PlanScopeManagerProps) {
  // Specific Illness Ledger subtab state
  const [sandboxInput, setSandboxInput] = useState<string>("");
  const [selectedLedgerCategory, setSelectedLedgerCategory] = useState<string>("Gastroenterology");
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState<string>("");

  const getScheduleClause = (plan: string, parentIllness: string | null) => {
    if (!parentIllness) return "";

    // 1. Check local storage overrides first
    try {
      const raw = localStorage.getItem("ditto_plan_specific_illnesses");
      if (raw) {
        const overridesMap = JSON.parse(raw) as Record<string, IllnessOverrideRecord[]>;
        const planOverrides = overridesMap[plan];
        if (Array.isArray(planOverrides)) {
          const matchedOverride = planOverrides.find((item) =>
            item.illnessId?.toLowerCase() === parentIllness.toLowerCase() ||
            MASTER_ILLNESSES.find(mi => mi.parent_illness === parentIllness)?.id.toLowerCase() === item.illnessId?.toLowerCase()
          );
          if (matchedOverride && matchedOverride.scheduleText) {
            return matchedOverride.scheduleText;
          }
        }
      }
    } catch (_) {}

    // 2. Fall back to static master databases
    const matchedDef = MASTER_ILLNESSES.find(mi => mi.parent_illness === parentIllness);
    return matchedDef ? matchedDef.plan_schedules[plan] || "" : "";
  };

  const sandboxResults = matchSpecificIllness(sandboxInput);

  // Filter master illnesses list for table view
  const filteredIllnesses = MASTER_ILLNESSES.filter(item => {
    const matchesCategory = selectedLedgerCategory === "All" || item.category === selectedLedgerCategory;
    const matchesSearch = ledgerSearchQuery.trim() === "" ||
      item.parent_illness.toLowerCase().includes(ledgerSearchQuery.toLowerCase()) ||
      item.aliases.some(a => a.toLowerCase().includes(ledgerSearchQuery.toLowerCase())) ||
      item.procedures.some(p => p.toLowerCase().includes(ledgerSearchQuery.toLowerCase())) ||
      item.sub_conditions.some(s => s.toLowerCase().includes(ledgerSearchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div id="plan-scope-manager-root" className="space-y-6">
      {/* PAGE HEADER */}
      <div id="plan-scope-header" className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b ${
        theme === "dark" ? "border-stone-850" : "border-stone-200"
      }`}>
        <div>
          <h1 id="ledger-title-header" className={`text-xl md:text-2xl font-black tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-stone-900"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <ClipboardList className="w-5 h-5 text-blue-500 animate-pulse" />
            <span>Specific Illness Ledger</span>
          </h1>
          <p id="ledger-desc-text" className={`text-xs font-semibold mt-1.5 leading-relaxed ${
            theme === "dark" ? "text-stone-400" : "text-stone-605"
          }`}>
            Explore listed diseases, diagnostic aliases, surgical procedure mappings, and look up plan-specific waiting period clauses.
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key="specific_illness_ledger_tab"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="space-y-6 text-left"
        >
          {/* SANDBOX SECTION */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Matching Engine Inputs */}
            <div id="sandbox-inputs-card" className={`lg:col-span-12 xl:col-span-5 p-5 rounded-2xl border shadow-xl transition-all ${
              theme === "dark" ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200"
            }`}>
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-purple-400" />
                <span className={`text-xs font-bold uppercase tracking-wider ${
                  theme === "dark" ? "text-white" : "text-stone-900"
                }`}>Matching Ledger Sandbox</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={`block text-[10px] uppercase tracking-wider font-extrabold mb-1.5 ${
                    theme === "dark" ? "text-stone-400" : "text-stone-500"
                  }`}>
                    Adviser Declared PED (Pre-existing Condition)
                  </label>
                  <div className="relative">
                    <input
                      id="sandbox-ped-input-field"
                      type="text"
                      value={sandboxInput}
                      onChange={(e) => setSandboxInput(e.target.value)}
                      placeholder="e.g. piles, BPH, slipped disc, cholecystectomy, psoriasis..."
                      className={`w-full text-xs font-semibold px-3 py-2.5 rounded-lg border outline-none transition-all ${
                        theme === "dark"
                          ? "bg-[#171B22] border-[#252A34] text-white focus:ring-2 focus:ring-purple-450 focus:ring-purple-400"
                          : "bg-stone-50 border-stone-300 text-stone-900 focus:ring-2 focus:ring-purple-500"
                      }`}
                    />
                    {sandboxInput && (
                      <button
                        id="clear-sandbox-input-btn"
                        onClick={() => setSandboxInput("")}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md cursor-pointer ${
                          theme === "dark" ? "hover:bg-stone-800 text-stone-400" : "hover:bg-stone-200 text-stone-500"
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Presets Grid */}
                <div>
                  <label className={`block text-[10px] uppercase tracking-wider font-extrabold mb-1.5 ${
                    theme === "dark" ? "text-stone-400" : "text-stone-500"
                  }`}>
                    Popular Test Conditions
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: "Piles", val: "piles" },
                      { name: "BPH", val: "BPH" },
                      { name: "Slipped disc", val: "slipped disc" },
                      { name: "Cholecystectomy", val: "cholecystectomy" },
                      { name: "Psoriasis", val: "psoriasis" },
                      { name: "DNS", val: "DNS" },
                      { name: "Fibroids", val: "uterine fibroids" },
                      { name: "Lump in breast", val: "fibroadenoma breast" }
                    ].map((item) => (
                      <button
                        id={`popular-condition-btn-${item.val.replace(/\s+/g, "-")}`}
                        key={item.val}
                        onClick={() => setSandboxInput(item.val)}
                        className={`p-2 text-left text-[11px] font-semibold border transition-all hover:scale-[1.02] cursor-pointer rounded-lg ${
                          theme === "dark"
                            ? "bg-[#171B22]/50 border-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-300"
                            : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-800"
                        }`}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Display Core Compliance Rules */}
                <div className={`p-4 rounded-xl border border-dashed space-y-2 ${
                  theme === "dark"
                    ? "bg-stone-950/20 border-[#252A34]"
                    : "bg-purple-50/40 border-purple-200"
                }`}>
                  <div className={`flex items-center gap-1.5 mb-1 ${
                    theme === "dark" ? "text-stone-400" : "text-stone-600"
                  }`}>
                    <Info className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Compliance Rules Summary</span>
                  </div>
                  <ul className={`text-[10.5px] space-y-1 leading-relaxed list-disc list-inside ${
                    theme === "dark" ? "text-stone-400" : "text-stone-700"
                  }`}>
                    <li><strong className={theme === "dark" ? "text-stone-300" : "text-stone-800"}>Rule 1: Direct name match</strong> holds exact synonyms.</li>
                    <li><strong className={theme === "dark" ? "text-stone-300" : "text-stone-800"}>Rule 2: Procedures map</strong> surgical words to diagnosis.</li>
                    <li><strong className={theme === "dark" ? "text-stone-300" : "text-stone-800"}>Rule 3: Sub-conditions</strong> bind clinical subparts to parents.</li>
                    <li><strong className={theme === "dark" ? "text-stone-300" : "text-stone-800"}>Rule 4: Broad categories</strong> resolve umbrella classes.</li>
                    <li><strong className={theme === "dark" ? "text-stone-300" : "text-stone-800"}>Rule 5: Plan presence</strong> validates active specific schedules.</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Matching Engine JSON & Visual Outcomes */}
            <div id="sandbox-outcomes-card" className="lg:col-span-12 xl:col-span-7 space-y-6">
              {/* Visual Result panel */}
              <div className={`p-5 rounded-2xl border shadow-xl space-y-4 transition-all ${
                theme === "dark" ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200"
              }`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className={`text-xs font-bold uppercase tracking-wider ${
                      theme === "dark" ? "text-white" : "text-stone-900"
                    }`}>Live Sandbox Mapping Results</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                    sandboxResults[0].match_type === "no_match"
                      ? "bg-stone-500/10 text-stone-400 border-stone-500/15"
                      : (theme === "dark" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-blue-50 text-blue-700 border-blue-200")
                  }`}>
                    {sandboxResults[0].match_type === "no_match" ? "No Specific Wait Match" : "Specific wait mapped"}
                  </span>
                </div>

                {/* Display each result candidate */}
                <div className="space-y-4">
                  {sandboxResults.map((result, idx) => {
                    const isNoMatch = result.match_type === "no_match";
                    return (
                      <div key={idx} className={`p-4 rounded-xl border transition-all ${
                        isNoMatch
                          ? theme === "dark"
                            ? "bg-stone-900/15 border-stone-800"
                            : "bg-stone-50 border-stone-200"
                          : theme === "dark"
                          ? "bg-blue-950/20 border-blue-500/20"
                          : "bg-blue-50 border-blue-100"
                      } space-y-3`}>
                        {/* Match Type Badge & Title */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold select-all ${
                              theme === "dark" ? "text-purple-300" : "text-purple-700"
                            }`}>
                              "{result.declared_condition}"
                            </span>
                            {result.matched_listed_illness && (
                              <>
                                <ArrowRight className={`w-3 h-3 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`} />
                                <span className={`text-xs font-black underline ${
                                  theme === "dark" ? "text-white" : "text-stone-900"
                                }`}>
                                  {result.matched_listed_illness}
                                </span>
                              </>
                            )}
                          </div>
                           <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                            result.match_type === "direct" ? (theme === "dark" ? "bg-blue-500/10 text-blue-400 border-blue-500/10" : "bg-blue-50 text-blue-700 border-blue-200") :
                            result.match_type === "alias" ? (theme === "dark" ? "bg-purple-500/10 text-purple-400 border-purple-500/10" : "bg-purple-50 text-purple-700 border-purple-200") :
                            result.match_type === "procedure_mapped" ? (theme === "dark" ? "bg-[#1E4D7E] text-[#D7E5FF] border-[#2D67A4]" : "bg-[#EFF6FF] text-[#1A365D] border-blue-200") :
                            result.match_type === "sub_condition" ? (theme === "dark" ? "bg-blue-500/10 text-blue-400 border-blue-500/10" : "bg-blue-50 text-blue-700 border-blue-200") :
                            result.match_type === "broad_category" ? (theme === "dark" ? "bg-blue-500/10 text-blue-400 border-blue-500/10" : "bg-blue-50 text-blue-700 border-blue-200") :
                            (theme === "dark" ? "bg-stone-500/10 text-stone-400 border-stone-500/10" : "bg-stone-100 text-stone-605 border-stone-200")
                          }`}>
                            Match Type: {result.match_type.replace("_", " ")}
                          </span>
                        </div>

                        <p className={`text-[11px] font-semibold leading-relaxed font-sans ${
                          theme === "dark" ? "text-stone-300" : "text-stone-650"
                        }`}>
                          {result.notes}
                        </p>

                        {/* Plan applicability matrix */}
                        <div className="pt-2 border-t border-dashed border-stone-200/50 dark:border-stone-200/5 space-y-2">
                          <span className="block text-[9px] font-bold uppercase tracking-wider text-stone-500">
                            Plan Exclusion Check (Does 2-year Wait Exist?)
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {productionPlans.map(plan => {
                              const matchesPlan = result.plans_applicable.includes(plan);
                              const scheduleClause = getScheduleClause(plan, result.matched_listed_illness);

                              return (
                                <div key={plan} className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
                                  matchesPlan
                                    ? theme === "dark"
                                      ? "bg-red-500/5 border-red-500/20 text-red-300"
                                      : "bg-red-50 border-red-200 text-red-700"
                                    : theme === "dark"
                                    ? "bg-[#171B22] border-stone-800 text-stone-405 text-stone-400"
                                    : "bg-stone-50 border-stone-200 text-stone-600"
                                }`}>
                                  <div className="flex justify-between items-center gap-1">
                                    <span className={`text-[10.5px] font-extrabold ${
                                      theme === "dark" ? "text-white" : "text-stone-900"
                                    }`}>{plan}</span>
                                    <span className={`text-[10px] font-bold uppercase tracking-widest ${matchesPlan ? "text-red-600 dark:text-red-400 font-black" : "text-stone-500"}`}>
                                      {matchesPlan ? "⚠️ 2-Yr Wait Applies" : "✅ Standard Limits"}
                                    </span>
                                  </div>
                                  {matchesPlan && scheduleClause && (
                                    <div className={`mt-1 text-[9px] font-medium leading-relaxed italic opacity-85 border-t pt-1 select-all ${
                                      theme === "dark" ? "border-red-500/10 text-stone-400" : "border-red-100 text-stone-500"
                                    }`}>
                                      "{scheduleClause}"
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Copyable JSON view */}
                <div className="space-y-2 pt-2 border-t border-dashed border-stone-200/50 dark:border-stone-800">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">
                      Requested compliance output format (JSON API)
                    </span>
                    <button
                      id="copy-compliance-json-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(sandboxResults, null, 2));
                      }}
                      className="bg-blue-600 hover:bg-blue-700 hover:scale-[1.03] transition-all duration-200 text-white font-sans text-[10px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider cursor-pointer"
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre className={`p-3 rounded-lg overflow-x-auto font-mono text-[10px] select-all border ${
                    theme === "dark"
                      ? "bg-black/40 text-emerald-400 border-stone-800"
                      : "bg-stone-50 text-emerald-800 border-stone-200"
                  }`}>
                    {JSON.stringify(sandboxResults, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {/* MASTER EXCLUSION DATABASE CATALOG */}
          <div id="master-exclusion-database" className={`p-5 rounded-2xl border shadow-xl space-y-4 transition-all ${
            theme === "dark" ? "bg-[#091520]/80 border-white/[0.08]" : "bg-white border-stone-200"
          }`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className={`w-5 h-5 shrink-0 ${theme === "dark" ? "text-purple-400" : "text-purple-600"}`} />
                <div>
                  <h2 className={`text-xs font-black uppercase tracking-wider ${
                    theme === "dark" ? "text-purple-400" : "text-purple-700"
                  }`}>Master Specific Illness Database Catalog</h2>
                  <p className={`text-[10px] mt-0.5 font-semibold ${
                    theme === "dark" ? "text-stone-400" : "text-stone-600"
                  }`}>Explore listed diseases, aliases, and procedure mappings per Indian rules.</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto font-sans">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
                  <input
                    id="ledger-catalog-search"
                    type="text"
                    value={ledgerSearchQuery}
                    onChange={(e) => setLedgerSearchQuery(e.target.value)}
                    placeholder="Search database..."
                    className={`text-xs pl-8 pr-3 py-1.5 w-full sm:w-48 rounded-lg border outline-none font-semibold transition-all ${
                      theme === "dark"
                        ? "bg-[#171B22] border-[#252A34] text-white focus:border-purple-400"
                        : "bg-white border-stone-200 text-stone-900 focus:border-purple-500"
                    }`}
                  />
                  {ledgerSearchQuery && (
                    <button
                      id="clear-ledger-search-query"
                      onClick={() => setLedgerSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Dropdown Filter */}
                <select
                  id="ledger-category-dropdown"
                  value={selectedLedgerCategory}
                  onChange={(e) => setSelectedLedgerCategory(e.target.value)}
                  className={`text-xs font-bold p-1.5 rounded-lg border outline-none cursor-pointer font-sans transition-all ${
                    theme === "dark"
                      ? "bg-[#171B22] border-[#252A34] text-white focus:border-purple-400"
                      : "bg-white border-stone-200 text-stone-900 focus:border-purple-500"
                  }`}
                >
                  <option value="All">All Categories</option>
                  <option value="Gastroenterology">Gastroenterology</option>
                  <option value="Orthopaedic / Rheumatological">Orthopaedic / Rheumatological</option>
                  <option value="Eye">Eye</option>
                  <option value="ENT">ENT</option>
                  <option value="Gynaecology">Gynaecology</option>
                  <option value="Urogenital">Urogenital</option>
                  <option value="Skin">Skin</option>
                  <option value="General / Benign tumours">General / Benign tumours</option>
                </select>
              </div>
            </div>

            {/* CATALOG TILES / GRID VIEW */}
            {filteredIllnesses.length === 0 ? (
              <div className={`p-8 text-center border border-dashed rounded-xl ${
                theme === "dark" ? "border-stone-800 text-stone-400" : "border-stone-300 text-stone-500"
              }`}>
                <span className="text-xs font-bold">No specific illnesses found matching "{ledgerSearchQuery}" under {selectedLedgerCategory} Filter.</span>
              </div>
            ) : (
              <div className={`overflow-x-auto rounded-xl border transition-all ${
                theme === "dark" ? "border-white/[0.08]" : "border-stone-200"
              }`}>
                <table className="w-full text-left text-xs font-sans">
                  <thead className={`text-[10px] uppercase font-black tracking-widest select-none border-b ${
                    theme === "dark" ? "bg-[#171B22] text-stone-400 border-white/[0.08]" : "bg-stone-50 text-stone-600 border-stone-200"
                  }`}>
                    <tr>
                      <th className="p-3">Specific Illness (Parent)</th>
                      <th className="p-3">Diagnostic Aliases / Synonyms (Rule 1)</th>
                      <th className="p-3">Surgical Procedures (Rule 2)</th>
                      <th className="p-3">Sub-Conditions (Rule 3)</th>
                      <th className="p-3 text-center">Applicable Plans (Rule 5)</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y transition-all ${
                    theme === "dark" ? "divide-stone-800" : "divide-stone-100"
                  }`}>
                    {filteredIllnesses.map((item) => (
                      <tr key={item.id} className={`transition-all ${
                        theme === "dark" ? "hover:bg-white/[0.01]" : "hover:bg-stone-50/50"
                      }`}>
                        <td className="p-3 font-bold max-w-[170px]">
                          <span className={`block font-extrabold ${
                            theme === "dark" ? "text-white" : "text-stone-900"
                          }`}>{item.parent_illness}</span>
                          <span className={`text-[8.5px] uppercase font-black tracking-wider px-1.5 py-0.2 rounded mt-1 inline-block border ${
                            item.category === "Gastroenterology" ? (theme === "dark" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/10" : "bg-emerald-50 text-emerald-700 border-emerald-250 border-emerald-200") :
                            item.category === "Orthopaedic / Rheumatological" ? (theme === "dark" ? "bg-blue-500/10 text-blue-400 border-blue-500/10" : "bg-blue-50 text-blue-700 border-blue-200") :
                            item.category === "Eye" ? (theme === "dark" ? "bg-[#1E4D7E] text-[#D7E5FF] border-[#2D67A4]" : "bg-[#EFF6FF] text-[#1A365D] border-blue-200") :
                            item.category === "ENT" ? (theme === "dark" ? "bg-purple-500/10 text-purple-400 border-purple-500/10" : "bg-purple-50 text-purple-700 border-purple-200") :
                            item.category === "Gynaecology" ? (theme === "dark" ? "bg-pink-500/10 text-pink-400 border-pink-500/10" : "bg-pink-50 text-pink-700 border-pink-200") :
                            item.category === "Urogenital" ? (theme === "dark" ? "bg-sky-500/10 text-sky-400 border-sky-500/10" : "bg-sky-50 text-sky-700 border-sky-205 border-sky-200") :
                            item.category === "Skin" ? (theme === "dark" ? "bg-teal-500/10 text-teal-400 border-teal-500/10" : "bg-teal-50 text-teal-700 border-teal-200") :
                            (theme === "dark" ? "bg-stone-500/10 text-stone-400 border-stone-500/10" : "bg-stone-100 text-stone-605 border-stone-200")
                          }`}>
                            {item.category}
                          </span>
                        </td>
                        <td className="p-3 font-medium">
                          <div className="flex flex-wrap gap-1">
                            {item.aliases.map(a => (
                              <span key={a} className={`px-1.5 py-0.5 rounded text-[10px] border select-all font-semibold ${
                                theme === "dark"
                                  ? "bg-stone-900 border-stone-850 text-stone-300"
                                  : "bg-stone-50 border-stone-200 text-stone-700"
                              }`}>
                                {a}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {item.procedures.length > 0 ? (
                              item.procedures.map(p => (
                                <span key={p} className={`px-1.5 py-0.5 rounded text-[10px] border select-all font-mono font-bold ${
                                  theme === "dark"
                                    ? "bg-[#0E1F33] text-[#D7E5FF] border-[#2A3E5A]"
                                    : "bg-[#EFF6FF] text-[#1A365D] border-blue-200"
                                }`}>
                                  {p}
                                </span>
                              ))
                            ) : (
                              <span className="text-stone-500 italic text-[10px]">-</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {item.sub_conditions.length > 0 ? (
                              item.sub_conditions.map(s => (
                                <span key={s} className={`px-1.5 py-0.5 rounded text-[10px] border select-all font-mono font-bold ${
                                  theme === "dark"
                                    ? "bg-teal-500/10 text-teal-400 border-teal-500/10"
                                    : "bg-teal-50 border-teal-200 text-teal-700"
                                }`}>
                                  {s}
                                </span>
                              ))
                            ) : (
                              <span className="text-stone-500 italic text-[10px]">-</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex justify-center items-center gap-1.5 flex-wrap max-w-[200px] mx-auto">
                            {productionPlans.map(plan => {
                              const desc = getScheduleClause(plan, item.parent_illness);
                              const applies = !!desc;
                              return (
                                <span
                                  key={plan}
                                  title={`${plan}: ${applies ? `Excluded (2-Yr waiting: "${desc}")` : "Standard Wait"}`}
                                  className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold border ${
                                    applies
                                      ? theme === "dark"
                                        ? "bg-red-500/15 text-red-450 border-red-500/10"
                                        : "bg-red-50 text-red-600 border-red-250 border-red-200"
                                      : theme === "dark"
                                      ? "bg-stone-500/10 text-stone-500 border-stone-500/10 opacity-45"
                                      : "bg-stone-100 text-stone-400 border-stone-200 opacity-60"
                                  }`}
                                >
                                  {plan.split(" ").map(w => w[0]).join("")}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
