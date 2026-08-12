/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState } from "react";
import { ShieldCheck, CheckCircle2, Search, Stethoscope, X, AlertTriangle, Circle, Tag, BookOpen } from "lucide-react";
import { MASTER_ILLNESSES, matchSpecificIllness, type SpecificIllnessMatchResult } from "../specificIllnessEngine";
import { buildGroupedSuggestions } from "../constants/pedSynonymGroups";

interface SpecificIllnessCheckPageProps {
  theme: "light" | "dark";
  /** Same flat suggestion list the Declaration Assistant's PED autocomplete
   * uses (App.tsx's dynamicSuggestions) — passed down rather than rebuilt
   * here so both surfaces stay in sync with exactly one source of truth. */
  dynamicSuggestions: string[];
}

// Same fixed display set the Admin Zone's underlying sandbox uses (see
// SpecificIllnessLedger.tsx's BASE_PLANS) — used here to report which plans
// have NO specific-illness wait for a matched condition, alongside the
// per-plan detail cards for the plans that do.
const BASE_PLANS = ["Optima Secure", "Care Supreme", "Activ One Max", "Activ Fit Preferred", "Aspire", "Reassure 2.0"];

const QUICK_EXAMPLES = ["Piles", "BPH", "Slipped disc", "Cholecystectomy", "Psoriasis", "DNS", "Fibroids", "Lump in breast"];

// Plain-language explanation per match type — same underlying
// matchSpecificIllness() classification as the Admin Zone tool, just worded
// for a general advisor instead of exposing the engine's internal rule
// names ("direct"/"alias"/"procedure_mapped"/"sub_condition"/"broad_category").
function plainLanguageNote(result: SpecificIllnessMatchResult): string {
  const matched = result.matched_listed_illness;
  if (!matched) {
    return "This condition isn't on any plan's specific illness list, so the standard 36-month non-specific waiting period applies instead of a fixed 2-year wait.";
  }
  switch (result.match_type) {
    case "direct":
    case "alias":
      return `"${result.declared_condition}" is recognized as ${matched}.`;
    case "procedure_mapped":
      return `"${result.declared_condition}" is a procedure linked back to ${matched}.`;
    case "sub_condition":
      return `"${result.declared_condition}" is a recognized sub-type of ${matched}.`;
    case "broad_category":
      return `"${result.declared_condition}" falls under the broader ${matched} category.`;
    default:
      return `Matched to ${matched}.`;
  }
}

/**
 * "Specific Illness Check" — general-user-facing read-only surface over the
 * same specificIllnessEngine.ts matchSpecificIllness() logic the Admin
 * Zone's Specific Illness Ledger sandbox uses (see SpecificIllnessLedger.tsx,
 * embedded in Plan Management). Deliberately excludes that tool's
 * Plan-Specific Illness Manager (DB editor) and Master Catalog table — both
 * are admin-facing data-management surfaces, not part of "check a
 * condition" — and drops internal terminology (match-type labels,
 * "sandbox"/"ledger", confidence levels, numbered rule references) in favor
 * of plain-language copy. The matching logic itself is untouched and
 * identical to the admin tool's — this is a presentation layer on top of
 * it, not a new pathway.
 *
 * Layout/interaction model is deliberately ported from the Declaration
 * Assistant's PED entry (LookupPage.tsx) rather than the Admin Zone's static
 * two-column form: a single top search bar with the same live autocomplete
 * dropdown (buildGroupedSuggestions, keyboard nav, "type it anyway" hint),
 * and results flowing top-to-bottom below it instead of a side-by-side
 * input/results split.
 */
export function SpecificIllnessCheckPage({ theme, dynamicSuggestions }: SpecificIllnessCheckPageProps) {
  const dark = theme === "dark";
  const inputRef = useRef<HTMLInputElement>(null);

  const [pedInput, setPedInput] = useState("");
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const suggestions = useMemo(() => {
    const query = pedInput.trim();
    if (!query || !dropdownOpen) return [];
    return buildGroupedSuggestions(dynamicSuggestions, query, [])
      .sort((a, b) => {
        if (a.insertValue.length !== b.insertValue.length) return a.insertValue.length - b.insertValue.length;
        return a.insertValue.localeCompare(b.insertValue);
      })
      .slice(0, 6);
  }, [pedInput, dropdownOpen, dynamicSuggestions]);

  const selectValue = (value: string) => {
    setPedInput(value);
    setDropdownOpen(false);
    setActiveSuggestionIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const results = useMemo<SpecificIllnessMatchResult[] | null>(() => {
    const trimmed = pedInput.trim();
    if (!trimmed) return null;
    return matchSpecificIllness(trimmed);
  }, [pedInput]);

  const labelClass = `text-[10px] font-black uppercase tracking-wider font-mono ${dark ? "text-stone-400" : "text-stone-500"}`;
  const cardClass = `rounded-2xl border transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[var(--border-strong)] shadow-card"}`;

  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Specific Illness Check</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Check whether a declared medical condition carries a 2-year specific illness waiting period under any plan.
          </p>
        </div>
      </div>

      <div className="space-y-5 pb-6">
        {/* SEARCH — same interaction model as the Declaration Assistant's PED
            entry: live autocomplete dropdown, keyboard nav, and a "type it
            anyway" hint rather than a locked suggestion whitelist. */}
        <section className={`${cardClass} p-5 space-y-3`}>
          <label className={`${labelClass} flex items-center gap-1.5`}>
            <Search className={`w-3.5 h-3.5 ${dark ? "text-stone-400" : "text-stone-500"}`} />
            Medical Condition
          </label>

          <div className="relative w-full">
            <div
              style={{ borderRadius: "12px", height: "42px" }}
              className={`flex items-center border transition-all duration-200 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/25 w-full ${
                dark ? "bg-[#102236] border-[#1e3e5c]" : "bg-white border-stone-250"
              }`}
            >
              <div className="relative flex-grow flex items-center">
                <input
                  ref={inputRef}
                  type="text"
                  value={pedInput}
                  onChange={(e) => {
                    setPedInput(e.target.value);
                    setActiveSuggestionIndex(-1);
                    setDropdownOpen(e.target.value.trim().length > 0);
                  }}
                  onFocus={() => {
                    if (pedInput.trim().length > 0) setDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (suggestions.length > 0) {
                        setActiveSuggestionIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
                      }
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (suggestions.length > 0) {
                        setActiveSuggestionIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
                      }
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
                        selectValue(suggestions[activeSuggestionIndex].insertValue);
                      } else {
                        setDropdownOpen(false);
                      }
                    } else if (e.key === "Escape") {
                      setDropdownOpen(false);
                      setActiveSuggestionIndex(-1);
                    }
                  }}
                  placeholder="e.g. piles, BPH, slipped disc..."
                  autoComplete="off"
                  style={{ borderRadius: "12px", fontFamily: "system-ui" }}
                  className={`w-full pl-3 pr-8 py-2 bg-transparent border-0 outline-none font-bold text-xs ${
                    dark ? "text-[#eff6ff] placeholder:text-slate-400 placeholder:font-medium" : "text-stone-850 placeholder:text-stone-400 placeholder:font-medium"
                  }`}
                />
                {pedInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setPedInput("");
                      setDropdownOpen(false);
                      inputRef.current?.focus();
                    }}
                    className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded cursor-pointer ${
                      dark ? "text-stone-500 hover:text-stone-300" : "text-stone-400 hover:text-stone-600"
                    }`}
                    title="Clear"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Floating suggestion dropdown — identical shape/behavior to the
                Declaration Assistant's, minus the "already added" chip-list
                concept (this page checks one condition at a time). */}
            {dropdownOpen && pedInput.trim().length > 0 && (
              <div
                className={`absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border shadow-lg overflow-hidden flex flex-col ${
                  dark ? "bg-[#14181f] border-white/[0.08] text-white" : "bg-[#ffffff] border-stone-200 text-stone-900"
                }`}
              >
                <div className="max-h-[280px] overflow-y-auto">
                  {suggestions.length === 0 ? (
                    <div className="px-4 py-3 text-xs italic text-left select-none text-stone-500">No typing matches...</div>
                  ) : (
                    suggestions.map((sug, idx) => {
                      const isActive = idx === activeSuggestionIndex;
                      return (
                        <button
                          key={sug.insertValue}
                          type="button"
                          onClick={() => selectValue(sug.insertValue)}
                          onMouseEnter={() => setActiveSuggestionIndex(idx)}
                          className={`w-full text-left px-3.5 py-2.5 text-xs flex items-start justify-between gap-2 transition-all font-sans font-medium ${
                            isActive
                              ? "bg-blue-600/20 text-blue-300 border-l-2 border-blue-500 pl-[10px]"
                              : dark
                                ? "hover:bg-white/[0.04] border-l-2 border-transparent pl-[10px]"
                                : "hover:bg-stone-100 border-l-2 border-transparent pl-[10px]"
                          }`}
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            <Stethoscope className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isActive ? "text-blue-400" : "text-stone-500"}`} />
                            <div className="min-w-0 flex flex-col gap-0.5">
                              <span
                                className={`text-[12px] font-semibold leading-snug whitespace-normal break-words ${
                                  isActive ? "" : dark ? "text-white" : "text-stone-900"
                                }`}
                              >
                                {sug.displayName}
                              </span>
                              {sug.aliases.length > 0 && (
                                <span className={`text-[10px] leading-snug whitespace-normal break-words ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                  {sug.aliases.slice(0, 6).join(" • ")}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <p className={`pl-0.5 text-[10px] font-medium flex items-center gap-1 ${dark ? "text-white/75" : "text-slate-700"}`}>
            Can't find it in the dropdown? Type it anyway — matching still works.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className={`${labelClass} shrink-0`}>Try an example:</span>
            {QUICK_EXAMPLES.map((cond) => {
              const active = pedInput.trim().toLowerCase() === cond.toLowerCase();
              return (
                <button
                  key={cond}
                  onClick={() => selectValue(cond)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                    active
                      ? dark
                        ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                        : "bg-violet-50 border-violet-300 text-violet-700"
                      : dark
                        ? "bg-white/[0.02] border-white/[0.06] text-stone-300 hover:bg-white/[0.05]"
                        : "bg-stone-50 border-stone-150 text-stone-700 hover:bg-stone-100"
                  }`}
                >
                  {cond}
                </button>
              );
            })}
          </div>
        </section>

        {/* RESULTS — flows below the search, top-to-bottom, instead of a
            side-by-side static split. */}
        {results && (
          <div className="space-y-5">
            {results.map((result, idx) => {
              const applicablePlans = result.plans_applicable;
              const notApplicablePlans = BASE_PLANS.filter((p) => !applicablePlans.includes(p));
              const definition = MASTER_ILLNESSES.find((d) => d.parent_illness === result.matched_listed_illness);

              return (
                <div key={idx} className={`${cardClass} p-5 space-y-4`}>
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-stone-200 dark:border-stone-850">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className={`w-4 h-4 ${dark ? "text-violet-400" : "text-violet-600"}`} />
                      <p className={`text-sm font-bold ${dark ? "text-white" : "text-stone-900"}`}>
                        "{result.declared_condition}"
                        {result.matched_listed_illness && (
                          <>
                            <span className={dark ? "text-stone-500" : "text-stone-400"}> → </span>
                            <span className={`underline decoration-dotted ${dark ? "text-sky-300" : "text-sky-700"}`}>{result.matched_listed_illness}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${
                        result.match_type === "no_match"
                          ? dark
                            ? "bg-stone-500/15 text-stone-400"
                            : "bg-stone-100 text-stone-500"
                          : dark
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      }`}
                    >
                      {result.match_type === "no_match" ? (
                        <>
                          <Circle className="w-2.5 h-2.5" /> No Specific Illness Match
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-2.5 h-2.5" /> Specific Illness Match Found
                        </>
                      )}
                    </span>
                  </div>

                  <p className={`text-[11px] leading-relaxed ${dark ? "text-stone-400" : "text-stone-600"}`}>{plainLanguageNote(result)}</p>

                  {result.match_type !== "no_match" && (
                    <>
                      {applicablePlans.length > 0 && (
                        <div className="space-y-2">
                          <label className={labelClass}>Plan-by-Plan Mapping</label>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {applicablePlans.map((plan) => {
                              const scheduleText = definition?.plan_schedules[plan];
                              return (
                                <div
                                  key={plan}
                                  className={`p-3.5 rounded-xl border space-y-2 ${dark ? "bg-red-500/[0.06] border-red-500/25" : "bg-red-50/60 border-red-200"}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={`text-xs font-black ${dark ? "text-red-300" : "text-red-700"}`}>{plan}</span>
                                    <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide ${dark ? "text-amber-400" : "text-amber-700"}`}>
                                      <AlertTriangle className="w-3 h-3" /> 2-Yr Wait Applies
                                    </span>
                                  </div>

                                  <div className="space-y-1">
                                    <div className="flex items-start gap-1.5">
                                      <ShieldCheck className={`w-3 h-3 mt-0.5 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                                      <p className={`text-[11px] leading-relaxed ${dark ? "text-stone-300" : "text-stone-700"}`}>
                                        <span className="font-bold">Mapped as:</span> {result.matched_listed_illness}
                                      </p>
                                    </div>
                                    {definition?.category && (
                                      <div className="flex items-start gap-1.5">
                                        <Tag className={`w-3 h-3 mt-0.5 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                                        <p className={`text-[11px] leading-relaxed ${dark ? "text-stone-300" : "text-stone-700"}`}>
                                          <span className="font-bold">Category:</span> {definition.category}
                                        </p>
                                      </div>
                                    )}
                                    {scheduleText && (
                                      <div className="flex items-start gap-1.5">
                                        <BookOpen className={`w-3 h-3 mt-0.5 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                                        <p className={`text-[11px] italic leading-relaxed ${dark ? "text-stone-400" : "text-stone-600"}`}>
                                          <span className="not-italic font-bold">Plan rule:</span> "{scheduleText}"
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {notApplicablePlans.length > 0 && (
                        <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
                          <span className="font-bold">No specific illness wait</span> under: {notApplicablePlans.join(", ")} — the standard 36-month non-specific PED wait applies instead.
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
