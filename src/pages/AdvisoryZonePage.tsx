/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { PlanConfig } from "../types";
import { CustomSelect } from "../components/CustomSelect";

interface AdvisoryZonePageProps {
  theme: "light" | "dark";
  productionPlans: string[];
  planConfigs: Record<string, PlanConfig>;
  specificIllnessesDict: Record<string, Array<{ category?: string; illness: string }>>;
}

/**
 * Advisory Zone — read-only plan reference for advisors.
 *
 * ACCESS: Advisory Zone pages are visible to EVERY tier, including General
 * advisors (contrast with Admin Zone pages — Plan Management, PED
 * Repository, Announcement Manager, etc. — which are Admin/Developer only).
 * This page is deliberately read-only: it renders the same live plan data
 * the matching engine uses, but exposes no add/edit/delete affordance, so
 * an advisor can look something up without any risk of changing config.
 *
 * Two sections per plan, toggled:
 *   • Payment Journey Questions — the plan's declaration questionnaire,
 *     with umbrella and catch-all questions labelled.
 *   • Specific Illness List — the plan's 2-year specific-exclusion
 *     schedule, grouped by category.
 *
 * Both are searchable. Data comes straight from the same props the Lookup
 * page uses (planConfigs / specificIllnessesDict), so this view always
 * reflects live plan edits without a second source of truth.
 */
export function AdvisoryZonePage({
  theme,
  productionPlans,
  planConfigs,
  specificIllnessesDict,
}: AdvisoryZonePageProps) {
  const dark = theme === "dark";
  const [selectedPlan, setSelectedPlan] = useState<string>(productionPlans[0] || "");
  const [section, setSection] = useState<"questions" | "illnesses">("questions");
  const [query, setQuery] = useState("");

  const config = planConfigs[selectedPlan];

  /**
   * Ordered question list: Specific → Umbrella → Others.
   *
   * `umbrellaQuestions` is a SEPARATE array on PlanConfig, not a subset of
   * `questions` — so iterating `questions` alone (as this did originally)
   * silently omitted every umbrella question. They're concatenated here and
   * de-duplicated by text, in case a plan lists one in both arrays.
   */
  const questions = useMemo(() => {
    if (!config) return [];
    const q = query.trim().toLowerCase();
    const umbrella = config.umbrellaQuestions || [];
    const umbrellaSet = new Set(umbrella);

    const specific = config.questions.filter((t) => t !== config.anyOther && !umbrellaSet.has(t));

    const ordered: Array<{ text: string; kind: "specific" | "umbrella" | "other" }> = [
      ...specific.map((text) => ({ text, kind: "specific" as const })),
      ...umbrella.map((text) => ({ text, kind: "umbrella" as const })),
      ...(config.anyOther ? [{ text: config.anyOther, kind: "other" as const }] : []),
    ];

    const seen = new Set<string>();
    return ordered
      .filter((item) => {
        if (seen.has(item.text)) return false;
        seen.add(item.text);
        return true;
      })
      .filter((item) => !q || item.text.toLowerCase().includes(q));
  }, [config, query]);

  const totalQuestions = useMemo(() => {
    if (!config) return 0;
    const umbrellaSet = new Set(config.umbrellaQuestions || []);
    const specific = config.questions.filter((t) => t !== config.anyOther && !umbrellaSet.has(t));
    return specific.length + umbrellaSet.size + (config.anyOther ? 1 : 0);
  }, [config]);

  const illnessGroups = useMemo(() => {
    const list = specificIllnessesDict[selectedPlan] || [];
    const q = query.trim().toLowerCase();
    const filtered = list.filter(
      (i) => !q || i.illness.toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q)
    );
    const groups: Record<string, string[]> = {};
    filtered.forEach((i) => {
      const cat = i.category || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(i.illness);
    });
    return groups;
  }, [specificIllnessesDict, selectedPlan, query]);

  // Derived here rather than inline in JSX: Object.values/Object.entries on a
  // Record widen to `unknown` under this tsconfig's lib, so we go through the
  // key list and index back into the record, which stays properly typed.
  const illnessCategories: string[] = Object.keys(illnessGroups);
  const shownIllnessCount = illnessCategories.reduce((n, cat) => n + illnessGroups[cat].length, 0);

  const totalIllnesses = (specificIllnessesDict[selectedPlan] || []).length;

  const cardClass = `rounded-2xl border ${
    dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)]"
  }`;

  return (
    <div className="space-y-5 text-left lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800 lg:shrink-0">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            dark ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Plan Reference</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Read-only reference for every plan's payment journey questions and specific illness list. Available to all advisors.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className={`p-4 lg:shrink-0 ${cardClass}`}>
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="lg:w-72">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3" /> Health Insurance Plan
              </span>
            </label>
            <CustomSelect
              theme={theme}
              value={selectedPlan}
              onChange={setSelectedPlan}
              placeholder="Select Plan"
              options={productionPlans.map((p) => ({ value: p, label: p }))}
              triggerClassName={`w-full flex items-center justify-between gap-2 pl-2.5 pr-8 py-1.5 rounded-lg border outline-none font-semibold text-xs cursor-pointer shadow-sm relative ${
                dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
              }`}
            />
          </div>

          <div className="flex-1 min-w-0">
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Search {section === "questions" ? "questions" : "illnesses"}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={section === "questions" ? "e.g. diabetes, surgery, medication..." : "e.g. cataract, hernia, piles..."}
                className={`w-full py-1.5 pl-9 pr-3 rounded-lg border outline-none text-xs font-semibold placeholder:font-normal ${
                  dark
                    ? "bg-[#102236] border-[#1e3e5c] text-white placeholder-stone-500"
                    : "bg-white border-stone-250 text-stone-850 placeholder-stone-400"
                }`}
              />
            </div>
          </div>

          {/* Sub-tab toggle — same role="tablist" pill pattern used on the
              Activity Log page's User Activity / Modification History switch
              and Plan Management's sub-tabs, for visual consistency across
              sub-tabbed pages. Right-aligned, at the end of the toolbar row. */}
          <div role="tablist" aria-label="Plan reference view" className={`flex p-1 rounded-xl border shrink-0 select-none ${
            dark ? "bg-stone-900/40 border-stone-800" : "bg-stone-100 border-stone-250"
          }`}>
            <button
              role="tab" aria-selected={section === "questions"} onClick={() => setSection("questions")}
              className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                section === "questions"
                  ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] shadow-md font-extrabold"
                  : dark
                    ? "text-stone-400 hover:text-stone-200"
                    : "text-stone-600 hover:text-stone-900 font-bold"
              }`}
            >
              Payment Journey Questions
            </button>
            <button
              role="tab" aria-selected={section === "illnesses"} onClick={() => setSection("illnesses")}
              className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                section === "illnesses"
                  ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] shadow-md font-extrabold"
                  : dark
                    ? "text-stone-400 hover:text-stone-200"
                    : "text-stone-600 hover:text-stone-900 font-bold"
              }`}
            >
              Specific Illness List
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`p-5 flex flex-col lg:flex-1 lg:min-h-0 overflow-hidden ${cardClass}`}>
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800 shrink-0">
          <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
            {section === "questions" ? "Payment Journey Questions" : "Specific Illness List"}
          </h3>
          <span className={`text-[10px] font-mono ${dark ? "text-stone-400" : "text-stone-500"}`}>
            {section === "questions"
              ? `${questions.length} of ${totalQuestions} questions`
              : `${shownIllnessCount} of ${totalIllnesses} illnesses`}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {!config ? (
            <p className="text-xs italic text-stone-500 py-10 text-center">Select a plan to view its details.</p>
          ) : section === "questions" ? (
            questions.length === 0 ? (
              <p className="text-xs italic text-stone-500 py-10 text-center">No questions match this search.</p>
            ) : (
              <ol className="space-y-2">
                {questions.map((q, idx) => (
                  <li
                    key={idx}
                    className={`flex items-start gap-3 p-3 rounded-lg border text-xs leading-relaxed ${
                      dark ? "bg-white/[0.02] border-white/[0.06] text-stone-200" : "bg-white border-[#D2DFEC] text-stone-800"
                    }`}
                  >
                    <span
                      className={`shrink-0 font-mono font-bold text-[10px] mt-0.5 ${dark ? "text-cyan-400" : "text-cyan-700"}`}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 min-w-0">{q.text}</span>
                    {q.kind === "specific" && (
                      <span className="shrink-0 text-[8.5px] font-black uppercase tracking-wide px-1.5 py-[1px] rounded border bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/25">
                        Specific
                      </span>
                    )}
                    {q.kind === "umbrella" && (
                      <span className="shrink-0 text-[8.5px] font-black uppercase tracking-wide px-1.5 py-[1px] rounded border bg-purple-500/10 text-purple-500 border-purple-500/25">
                        Umbrella
                      </span>
                    )}
                    {q.kind === "other" && (
                      <span className="shrink-0 text-[8.5px] font-black uppercase tracking-wide px-1.5 py-[1px] rounded border bg-amber-500/10 text-amber-600 border-amber-500/25">
                        Others
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )
          ) : illnessCategories.length === 0 ? (
            <p className="text-xs italic text-stone-500 py-10 text-center">
              {totalIllnesses === 0
                ? "No specific illness list is defined for this plan."
                : "No illnesses match this search."}
            </p>
          ) : (
            <div className="space-y-4">
              {illnessCategories.map((cat) => {
                const items = illnessGroups[cat];
                return (
                <div key={cat} className="space-y-1.5">
                  <span
                    className={`inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                      dark
                        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {cat}
                  </span>
                  <ul className="space-y-1 pl-1">
                    {items.map((ill, i) => (
                      <li
                        key={i}
                        className={`flex items-start gap-2 text-xs leading-relaxed py-1 ${
                          dark ? "text-stone-200" : "text-stone-800"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: "var(--accent)" }} />
                        <span>{ill}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
