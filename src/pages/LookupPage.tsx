/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ShieldCheck,
  Search,
  Stethoscope,
  Plus,
  X,
  Info,
  RefreshCw,
  RotateCcw,
  Layers,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { MascotWithFallback } from "../components/mascots/MascotWithFallback";
import { DeclarationAssistantResults } from "../components/DeclarationAssistantResults";
import { MatchOutput, PlanConfig } from "../types.js";
import { QAAnnouncement } from "../types/announcements";
import { ReportingItem } from "../types/lookup";
import { renderFormattedAnnouncement } from "../utils/renderFormattedAnnouncement";

type TabId =
  | "lookup"
  | "audit"
  | "profile_access"
  | "plan_scope"
  | "resources"
  | "active_questions"
  | "my_activity"
  | "qa_announcement_log"
  | "flagged_responses";

interface LookupPageProps {
  theme: "light" | "dark";
  isResultsActive: boolean;

  // Plan + PED input
  selectedPlan: string;
  setSelectedPlan: (value: string) => void;
  productionPlans: string[];
  pedInput: string;
  setPedInput: (value: string) => void;
  pedInputRef: RefObject<HTMLInputElement>;
  activeSuggestionIndex: number;
  setActiveSuggestionIndex: (value: number) => void;
  dynamicSuggestions: string[];
  lookupPeds: string[];
  setLookupPeds: (value: string[]) => void;
  handleAddLookupPed: (pedText: string) => void;

  // Lookup execution + results
  isLookupLoading: boolean;
  lookupResults: Array<{ ped: string; result: MatchOutput; source: string }>;
  executeLookupAll: (peds: string[], plan: string) => void;
  handleClearLookupFields: () => void;
  handleMapAnotherPed: () => void;

  // Reporting a mismatch from within results
  setReportingItem: (value: ReportingItem | null) => void;
  setReportingNotes: (value: string) => void;
  setReportingPriority: (value: "Pending" | "Urgent" | "Resolved" | "Ignored") => void;

  // Layout refs (measured heights for the results split view)
  mappingResultCardRef: RefObject<HTMLDivElement>;
  resultsRef: RefObject<HTMLDivElement>;
  sidebarRef: RefObject<HTMLDivElement>;
  rightHeaderRef: RefObject<HTMLDivElement>;

  // Specific illness ledger cross-check
  illnessSearchQuery: string;
  setIllnessSearchQuery: (value: string) => void;
  specificIllnessesDict: Record<string, Array<{ category?: string; illness: string }>>;
  planConfigs: Record<string, PlanConfig>;
  checkIllnessInPlanSpecificList: (pedText: string, plan: string) => { category: string; illness: string } | null;

  // Nav
  setActiveTab: (value: TabId) => void;

  // Chronic-condition special instruction advisory toggle
  userAdvisoryToggle: boolean | null;
  setUserAdvisoryToggle: (value: boolean) => void;
  advisoryHasBeenExpanded: boolean;
  setAdvisoryHasBeenExpanded: (value: boolean) => void;

  // QA Announcement carousel
  qaAnnouncements: QAAnnouncement[];
  activeAnnouncements: QAAnnouncement[];
  noticeIndex: number;
  setNoticeIndex: (updater: number | ((prev: number) => number)) => void;
  slideDirection: "right-to-left" | "left-to-right";
  setSlideDirection: (value: "right-to-left" | "left-to-right") => void;
}

/**
 * "Declaration Assistant" lookup tab — main functional form + results content
 * (the `!showIntro` branch). Extracted verbatim from App.tsx (Phase 1.3). The
 * `activeTab === "lookup" && !showIntro` condition and wrapping
 * `<motion.div key="lookup">` deliberately stay in App.tsx (see
 * ResourcesPage.tsx for why — moving them here would break the
 * AnimatePresence exit animation).
 *
 * Note: a permanently-dead `{false && (...)}` block (an old, superseded
 * "Detailed Workspace" layout that was replaced by
 * `<DeclarationAssistantResults>` and could never render) was dropped during
 * this extraction rather than carried over — it contributed zero rendered
 * behavior, so removing it changes nothing at runtime.
 */
export function LookupPage({
  theme,
  isResultsActive,
  selectedPlan,
  setSelectedPlan,
  productionPlans,
  pedInput,
  setPedInput,
  pedInputRef,
  activeSuggestionIndex,
  setActiveSuggestionIndex,
  dynamicSuggestions,
  lookupPeds,
  setLookupPeds,
  handleAddLookupPed,
  isLookupLoading,
  lookupResults,
  executeLookupAll,
  handleClearLookupFields,
  handleMapAnotherPed,
  setReportingItem,
  setReportingNotes,
  setReportingPriority,
  mappingResultCardRef,
  resultsRef,
  sidebarRef,
  rightHeaderRef,
  illnessSearchQuery,
  setIllnessSearchQuery,
  specificIllnessesDict,
  planConfigs,
  checkIllnessInPlanSpecificList,
  setActiveTab,
  userAdvisoryToggle,
  setUserAdvisoryToggle,
  advisoryHasBeenExpanded,
  setAdvisoryHasBeenExpanded,
  qaAnnouncements,
  activeAnnouncements,
  noticeIndex,
  setNoticeIndex,
  slideDirection,
  setSlideDirection
}: LookupPageProps) {
  return (
    <>
      {isResultsActive ? (
        <div className="flex flex-col lg:flex-row gap-6 items-start w-full">
          <DeclarationAssistantResults
            theme={theme}
            selectedPlan={selectedPlan}
            lookupPeds={lookupPeds}
            isLookupLoading={isLookupLoading}
            lookupResults={lookupResults}
            onReset={handleClearLookupFields}
            onMapAnotherPed={handleMapAnotherPed}
            setReportingItem={setReportingItem}
            setReportingNotes={setReportingNotes}
            setReportingPriority={setReportingPriority}
            mappingResultCardRef={mappingResultCardRef}
            resultsRef={resultsRef}
            sidebarRef={sidebarRef}
            rightHeaderRef={rightHeaderRef}
            illnessSearchQuery={illnessSearchQuery}
            setIllnessSearchQuery={setIllnessSearchQuery}
            specificIllnessesDict={specificIllnessesDict}
            planConfigs={planConfigs}
            checkIllnessInPlanSpecificList={checkIllnessInPlanSpecificList}
          />
        </div>
      ) : (
        <>
          <div className="mb-2" />

          {/* TWO SECTIONS PLACED DIRECTLY ON THE PAGE BACKGROUND (no card/box wrapper) */}
          <div
            style={{ minHeight: "520px" }}
            className={`w-full relative flex flex-col lg:flex-row items-stretch gap-8 lg:gap-10 animate-fade-in ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            {/* SECTION 1: PED MAPPING ENGINE INPUTS */}
            <div className="flex-1 min-w-0 flex flex-col justify-start relative z-10">

              {/* Title mapping section */}
              <div
                style={{
                  paddingBottom: "18px",
                  marginBottom: "0px",
                  marginTop: "0px"
                }}
                className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b ${
                  theme === "dark" ? "border-white/[0.08]" : "border-stone-200"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 select-none mb-1">
                    <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
                    <span
                      style={{
                        width: "105px",
                        fontSize: "10px",
                        lineHeight: "12px",
                        color: "var(--accent)",
                        backgroundColor: "var(--accent-subtle-bg)",
                        borderColor: "var(--accent-border)",
                        borderWidth: "1.5px"
                      }}
                      className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border flex items-center justify-center gap-1.5 shrink-0 select-none"
                    >
                      + AI POWERED
                    </span>
                  </div>
                  <span
                    style={{ fontSize: "20px", lineHeight: "21px", display: "block", marginTop: "8px" }}
                    className="text-lg font-black tracking-wider uppercase select-none font-sans bg-clip-text text-transparent bg-gradient-to-r from-[#00D3F3] to-[#58A3FF]"
                  >
                    PED DECLARATION MAPPING ENGINE
                  </span>
                  <span className={`text-xs font-medium select-none block mt-1 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>
                    Search and map conditions to find the perfect match for your declaration.
                  </span>
                </div>
              </div>

              {/* Two boxed input sections, side by side — outlined only, no filled card background */}
              <div
                style={{ marginTop: "1vh" }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {/* BOX A: Health Insurance Plan */}
                <div
                  className={`rounded-2xl border p-4 sm:p-5 flex flex-col gap-3 ${
                    theme === "dark" ? "border-white/[0.12] bg-transparent" : "border-stone-250 bg-transparent"
                  }`}
                >
                  <label
                    className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 select-none font-sans ${
                      theme === "dark" ? "text-stone-400" : "text-stone-500"
                    }`}
                  >
                    <ShieldCheck className={`w-3.5 h-3.5 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`} />
                    Health Insurance Plan
                  </label>
                  <div className="relative w-full">
                    <select
                      value={selectedPlan}
                      onChange={(e) => setSelectedPlan(e.target.value)}
                      style={{
                        borderRadius: "12px",
                        height: "40.5px",
                        paddingTop: "8.5px",
                        paddingBottom: "8.5px",
                        paddingRight: "30px"
                      }}
                      className={`w-full pl-3 pr-9 py-3 rounded-xl border outline-none font-bold text-xs transition-all cursor-pointer font-sans shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 ${
                        theme === "dark"
                          ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]"
                          : "bg-white border-stone-250 text-stone-850"
                      }`}
                      id="insurance-plan-dropdown"
                    >
                      <option value="" className={theme === "dark" ? "bg-[#102236] text-slate-400 font-medium" : "bg-white text-stone-400 font-medium"}>
                        Select Plan
                      </option>
                      {productionPlans.map((plan) => (
                        <option key={plan} value={plan} className={theme === "dark" ? "bg-[#102236] text-[#eff6ff] font-medium" : "bg-white text-stone-850 font-medium"}>
                          {plan}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* BOX B: Search & Map Condition */}
                <div
                  className={`rounded-2xl border p-4 sm:p-5 flex flex-col gap-3 relative ${
                    theme === "dark" ? "border-white/[0.12] bg-transparent" : "border-stone-250 bg-transparent"
                  }`}
                >
                  <label
                    className={`text-[10px] font-black uppercase tracking-widest font-sans flex items-center gap-1.5 select-none ${
                      theme === "dark" ? "text-stone-400" : "text-stone-500"
                    }`}
                  >
                    <Search className={`w-3.5 h-3.5 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`} />
                    Search &amp; Map Condition
                  </label>
                  <div className="relative w-full">
                    <div className="flex items-center gap-2 w-full">
                      <div
                        style={{ borderRadius: "12px" }}
                        className={`flex items-center border transition-all duration-200 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/25 flex-grow ${
                          theme === "dark" ? "bg-[#102236] border-[#1e3e5c]" : "bg-white border-stone-250"
                        }`}
                      >
                        <div className="relative flex-grow flex items-center">
                          <input
                            ref={pedInputRef}
                            type="text"
                            value={pedInput}
                            onChange={(e) => {
                              setPedInput(e.target.value);
                              setActiveSuggestionIndex(-1);
                            }}
                            onKeyDown={(e) => {
                              const query = pedInput.trim().toLowerCase();
                              const itemsToDisplay = pedInput.trim().length > 0
                                ? dynamicSuggestions.filter(item =>
                                    item.toLowerCase().includes(query) && !lookupPeds.includes(item)
                                  ).sort((a, b) => {
                                    if (a.length !== b.length) {
                                      return a.length - b.length;
                                    }
                                    return a.localeCompare(b);
                                  }).slice(0, 6)
                                : [];

                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                if (itemsToDisplay.length > 0) {
                                  setActiveSuggestionIndex(
                                    activeSuggestionIndex < itemsToDisplay.length - 1 ? activeSuggestionIndex + 1 : 0
                                  );
                                }
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                if (itemsToDisplay.length > 0) {
                                  setActiveSuggestionIndex(
                                    activeSuggestionIndex > 0 ? activeSuggestionIndex - 1 : itemsToDisplay.length - 1
                                  );
                                }
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                if (activeSuggestionIndex >= 0 && activeSuggestionIndex < itemsToDisplay.length) {
                                  handleAddLookupPed(itemsToDisplay[activeSuggestionIndex]);
                                  setActiveSuggestionIndex(-1);
                                } else {
                                  handleAddLookupPed(pedInput);
                                }
                              } else if (e.key === "Escape") {
                                setActiveSuggestionIndex(-1);
                              }
                            }}
                            placeholder="Enter PED"
                            style={{ borderRadius: "12px", fontFamily: "system-ui" }}
                            className={`w-full pl-3 pr-3 py-2 bg-transparent border-0 outline-none font-bold text-xs ${
                              theme === "dark"
                                ? "text-[#eff6ff] placeholder:text-[#52708b] placeholder:font-medium"
                                : "text-stone-850 placeholder:text-stone-400 placeholder:font-medium"
                            }`}
                            id="ped-input"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleAddLookupPed(pedInput);
                          setActiveSuggestionIndex(-1);
                        }}
                        style={{ borderRadius: "12px" }}
                        className={`h-[38px] px-4 border shadow-sm flex items-center justify-center shrink-0 select-none text-[11px] font-black uppercase tracking-widest transition-all duration-305 active:scale-95 cursor-pointer ${
                          theme === "dark"
                            ? "bg-[#365c75] border-[#293b52] text-white hover:bg-[#416984]"
                            : "bg-[#4673a9] border-[#4673a9] text-white hover:bg-[#3a608e]"
                        }`}
                      >
                        + ADD
                      </button>
                    </div>

                    {/* Floating Dropdown for Suggestions */}
                    {pedInput.trim().length > 0 && (() => {
                      const query = pedInput.trim().toLowerCase();
                      const itemsToDisplay = dynamicSuggestions.filter(item =>
                        item.toLowerCase().includes(query) && !lookupPeds.includes(item)
                      ).sort((a, b) => {
                        if (a.length !== b.length) {
                          return a.length - b.length;
                        }
                        return a.localeCompare(b);
                      }).slice(0, 6);

                      return (
                        <div className={`absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border shadow-lg overflow-hidden flex flex-col ${
                          theme === "dark" ? "bg-stone-900 border-white/[0.08] text-white" : "bg-white border-stone-200 text-stone-900"
                        }`}>
                          <div className="max-h-[130px] overflow-y-auto">
                            {itemsToDisplay.length === 0 ? (
                              <div className="px-4 py-3 text-xs italic text-left select-none text-stone-500">
                                No typing matches...
                              </div>
                            ) : (
                              itemsToDisplay.map((sug, idx) => {
                                const isAdded = lookupPeds.includes(sug);
                                const isActive = idx === activeSuggestionIndex;
                                return (
                                  <button
                                    key={sug}
                                    type="button"
                                    disabled={isAdded}
                                    onClick={() => {
                                      handleAddLookupPed(sug);
                                      setActiveSuggestionIndex(-1);
                                    }}
                                    onMouseEnter={() => setActiveSuggestionIndex(idx)}
                                    className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-all font-sans font-medium ${
                                      isAdded
                                        ? "opacity-40 cursor-not-allowed"
                                        : isActive
                                          ? "bg-blue-600/20 text-blue-300 border-l-2 border-blue-500 pl-[10px]"
                                          : theme === "dark"
                                            ? "hover:bg-white/[0.04] border-l-2 border-transparent pl-[10px]"
                                            : "hover:bg-stone-100 border-l-2 border-transparent pl-[10px]"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 truncate">
                                      <Stethoscope className={`w-3.5 h-3.5 shrink-0 ${
                                        isActive
                                          ? "text-blue-400"
                                          : "text-stone-500"
                                      }`} />
                                      <span className="truncate">{sug}</span>
                                    </div>
                                    <Plus className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                                      isActive ? "scale-110 text-current animate-pulse" : "text-stone-500"
                                    }`} />
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* QUEUE BOX — full width below the two boxes (plain outlined box, no card fill) */}
              <div
                style={{ borderWidth: "1.5px" }}
                className={`mt-4 p-4 rounded-2xl relative min-h-[90px] flex flex-col justify-between border overflow-hidden ${
                  theme === "dark" ? "border-white/[0.12] bg-transparent" : "border-stone-300 bg-transparent"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Selected condition list / empty text */}
                  <div className="flex-grow text-left relative z-10 min-h-[46px] pr-20">
                    {lookupPeds.length === 0 ? (
                      <div
                        className={`text-xs italic text-left select-none font-medium font-sans py-1 ${
                          theme === "dark" ? "text-stone-400" : "text-stone-500"
                        }`}
                      >
                        No conditions added to the lookup queue. <br />
                        <span className={`text-[10px] not-italic leading-relaxed block mt-1 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}>Search or type a condition on the left to start.</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 w-full content-start max-h-[110px] overflow-y-auto pr-1">
                        {lookupPeds.map((tag, idx) => (
                          <div
                            key={`${tag}-${idx}`}
                            className={`text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-all font-medium border ${
                              theme === "dark" ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-stone-100 border-stone-250 text-stone-850"
                            }`}
                          >
                            <span className="truncate max-w-[120px]" title={tag}>{tag}</span>
                            <button
                              type="button"
                              onClick={() => setLookupPeds(lookupPeds.filter(t => t !== tag))}
                              className={`w-4 h-4 rounded-full flex items-center justify-center transition-all cursor-pointer text-xs ${
                                theme === "dark" ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-stone-300 text-stone-500 hover:text-stone-900"
                              }`}
                              title={`Remove ${tag}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Total queued counter, top-right */}
                  <div className="flex flex-col items-center gap-1 shrink-0 select-none">
                    <span className={`text-[9px] font-black uppercase tracking-widest ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>Total Queue</span>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${
                      theme === "dark" ? "bg-white/10 text-white" : "bg-stone-900 text-white"
                    }`}>{lookupPeds.length}</span>
                  </div>

                  {/* Doctor Mascot */}
                  <div
                    style={{ height: "90px", width: "84px" }}
                    className="absolute right-16 bottom-0 pointer-events-none select-none overflow-hidden z-0 opacity-90 hidden sm:block"
                  >
                    <MascotWithFallback
                      src="/assets/.aistudio/doctor-mascot.png"
                      alt="Doctor Mascot"
                      className="object-contain w-full h-full"
                      type="doctor"
                    />
                  </div>
                </div>
              </div>

              {/* Helper text */}
              <p
                className={`opacity-80 select-none font-sans flex items-center gap-1.5 text-left mt-2 ${
                  theme === "dark" ? "text-stone-400" : "text-stone-500"
                }`}
                style={{ fontWeight: "bold", fontSize: "11px" }}
              >
                <Info className="w-3.5 h-3.5 shrink-0" />
                Enter one or multiple conditions to map them sequentially against the selected plan wording.
              </p>

              {/* Action row: Find a Match / Reset Fields / Declaration Map */}
              <div
                style={{ marginTop: "12px" }}
                className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1 pb-1 w-full"
                title={(!selectedPlan || lookupPeds.length === 0) ? "Select a plan and add at least one condition to proceed" : ""}
              >
                <button
                  onClick={() => {
                    if (!selectedPlan) return;
                    executeLookupAll(lookupPeds, selectedPlan);
                  }}
                  disabled={isLookupLoading || lookupPeds.length === 0 || !selectedPlan}
                  style={{
                    backgroundColor: (isLookupLoading || lookupPeds.length === 0 || !selectedPlan) ? undefined : "#009dff",
                    borderColor: (isLookupLoading || lookupPeds.length === 0 || !selectedPlan) ? undefined : "#56ffd7"
                  }}
                  className="w-full sm:w-auto sm:flex-1 py-2.5 px-5 border rounded-xl font-semibold text-xs tracking-wide transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-[0.98] bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-100 disabled:text-slate-400 disabled:border disabled:border-slate-200 disabled:cursor-not-allowed"
                  id="match-disclosure-button"
                  title={(!selectedPlan || lookupPeds.length === 0) ? "Select a plan and add at least one condition to proceed" : ""}
                >
                  {isLookupLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-current" />
                      Analyzing conditions...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 text-current" />
                      Find a Match
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleClearLookupFields}
                  style={
                    theme === "dark"
                      ? { backgroundColor: "#1C2C3D", borderColor: "#3B4A5A", color: "#A3B2C2" }
                      : { backgroundColor: "var(--surface-elevated)", borderColor: "var(--border-strong)", color: "var(--text-secondary)" }
                  }
                  className="w-full sm:w-auto sm:flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide border duration-200 transition-all hover:brightness-110 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer select-none shadow-sm"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-current" />
                  Reset Fields
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("resources");
                  }}
                  style={{ backgroundColor: "#448b9a", color: "#ffffff" }}
                  className="w-full sm:w-auto sm:flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide border border-[#448b9a] transition-all hover:brightness-110 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer select-none shadow-sm"
                  id="open-resources-btn"
                >
                  <Layers className="w-3.5 h-3.5 text-current" />
                  Declaration Map
                </button>
              </div>

              {/* Reusable / Universal Special Instruction block for PEDs (Collapsible Intelligent Layout) */}
              {(() => {
                const lowercasePeds = lookupPeds.map(p => p.toLowerCase());

                // Check if any entered PED matches synonyms for our rules
                const matchesRule = (ruleSynonyms: string[]) => {
                  return lowercasePeds.some(ped =>
                    ruleSynonyms.some(synonym => {
                      if (synonym === "bp") {
                        // Enforce exact word boundaries for "bp" so it does not match "bph"
                        return /\bbp\b/i.test(ped);
                      }
                      return ped.includes(synonym);
                    })
                  );
                };

                const chronicSynonyms = [
                  "diabet", "sugar", "sweet", "insulin", "hyperglyc", "prediabet", "pre-diabet",
                  "hyperten", "bp", "blood pressure", "systolic", "diastolic", "pressure",
                  "cholesterol", "lipid", "hyperchol", "statins", "triglyceride", "lipoprotein"
                ];

                const isMatched = matchesRule(chronicSynonyms);

                if (!isMatched) {
                  return null; // Completely hidden (removed)
                }

                const isExpanded = userAdvisoryToggle === true;

                if (!isExpanded) {
                  const shouldGlow = !advisoryHasBeenExpanded;
                  return (
                    <div
                      onClick={() => {
                        setUserAdvisoryToggle(true);
                        setAdvisoryHasBeenExpanded(true);
                      }}
                      style={{
                        background: theme === "dark"
                          ? "linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(217, 119, 6, 0.08) 100%)"
                          : "linear-gradient(135deg, #FFFDF5 0%, #FEF9C3 100%)",
                        borderColor: theme === "dark" ? "rgba(245, 158, 11, 0.3)" : "rgba(234, 179, 8, 0.4)",
                        fontWeight: "bold"
                      }}
                      className={`mt-4 w-full flex items-center justify-between gap-4 p-4 rounded-xl border text-xs transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md ${
                      shouldGlow
                        ? theme === "dark"
                          ? "text-amber-300 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.25)] animate-notification-glow"
                          : "text-amber-850 border-amber-400 shadow-[0_0_15px_rgba(234, 179, 8, 0.2)] animate-notification-glow"
                        : theme === "dark"
                          ? "text-amber-300"
                          : "text-amber-850"
                    }`}>
                      <div className="flex items-center gap-2.5 text-left">
                        <div className="relative">
                          <AlertTriangle className={`w-4 h-4 shrink-0 select-none ${shouldGlow ? "animate-bounce" : ""} ${
                            theme === "dark" ? "text-amber-400" : "text-amber-800"
                          }`} style={{ animationDuration: shouldGlow ? "2s" : undefined }} />
                          {shouldGlow && (
                            <span className="absolute -top-1 -right-1 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                          )}
                        </div>
                        <span className={`font-sans font-medium transition-colors ${theme === "dark" ? "text-amber-300" : "text-amber-800"}`}>
                          <strong className={theme === "dark" ? "text-amber-400" : "text-amber-800"}>
                            Waring : Special Instruction Alert. Click to know more!
                          </strong>
                        </span>
                      </div>
                      <ChevronDown className={`w-4 h-4 shrink-0 ${theme === "dark" ? "text-amber-400" : "text-amber-800"}`} />
                    </div>
                  );
                }

                return (
                  <div
                    className={`mt-4 w-full p-4.5 rounded-xl border transition-all duration-300 relative overflow-hidden shadow-md ${
                      theme === "dark"
                        ? "bg-slate-900 border-slate-700 text-slate-100"
                        : "bg-white border-slate-300 text-slate-900"
                    }`}
                  >
                    <div className="flex flex-col space-y-3.5 text-left select-none font-sans font-medium">
                      {/* Line 1: Header to click-collapse + Rating */}
                      <div
                        onClick={() => setUserAdvisoryToggle(false)}
                        className={`flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b pb-2.5 cursor-pointer hover:opacity-85 transition-opacity ${
                        theme === "dark" ? "border-slate-800" : "border-slate-200"
                      }`}>
                        <div className="flex items-start gap-2 max-w-2xl">
                          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${theme === "dark" ? "text-red-400" : "text-red-600"}`} />
                          <span className={`text-[11px] md:text-[11.5px] font-semibold leading-relaxed ${theme === "dark" ? "text-slate-200" : "text-[#0F172A]"}`}>
                            Advisors must mandatorily discuss the below narrative if the lead has any of the targeted PEDs mentioned below as a pre-existing condition.
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                          <span className={`text-[10px] font-mono font-black border uppercase tracking-wider px-2.5 py-0.5 rounded-md ${
                            theme === "dark"
                              ? "bg-slate-800 text-slate-100 border-slate-700"
                              : "bg-slate-900 text-white border-slate-950"
                          }`}>
                            RATING: 2
                          </span>
                          <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                        </div>
                      </div>

                      {/* Line 2: Condition Tags */}
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className={`text-[10px] font-bold uppercase tracking-wide mr-1 ${theme === "dark" ? "text-slate-400" : "text-slate-600"}`}>TARGETS:</span>
                        {["Diabetes / Pre-Diabetes", "Hypertension (High BP)", "Hypercholesterolaemia"].map((tag, idx) => (
                          <span key={idx} className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                            theme === "dark"
                              ? "bg-slate-800 border-slate-700 text-slate-200"
                              : "bg-stone-50 border-stone-200 text-slate-800"
                          }`}>
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Line 3: Advisor Narrative & Compact Flexibility Note */}
                      <div className="space-y-1.5">
                        <span className={`text-[10.5px] font-extrabold uppercase tracking-wider block ${
                          theme === "dark" ? "text-white" : "text-[#04233f]"
                        }`}>
                          Advisor Narrative:
                        </span>
                        <blockquote className={`pl-3 border-l-2 border-slate-400 text-xs italic leading-relaxed font-semibold ${
                          theme === "dark" ? "text-slate-200" : "text-stone-900"
                        }`}>
                          "Usually, people are hospitalized not solely because they have diabetes, high cholesterol, or hypertension, but due to complications like heart attacks and strokes that are linked to these conditions. If there is a waiting period for coverage of these underlying conditions, claims for events such as heart attacks or strokes may be rejected because they stem from diabetes, cholesterol, or hypertension."
                        </blockquote>
                        <p className={`text-[10px] font-semibold leading-relaxed mt-1 ${theme === "dark" ? "text-slate-300" : "text-slate-700"}`}>
                          <strong className={theme === "dark" ? "text-white font-extrabold" : "text-slate-950 font-extrabold"}>Flexibility Note:</strong> Advisors are fully flexible to use their own words. Ensure the core reasoning of linked medical risks is clearly explained.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* SECTION DIVIDER (Separating Left Inputs & Right Announcement) */}
            <div className={`w-full h-[1px] lg:w-[1px] lg:h-auto shrink-0 self-stretch ${
              theme === "dark" ? "bg-white/[0.08]" : "bg-stone-200"
            }`} />

            {/* QA Announcement Horizontal Card spanning full content width */}
            {(() => {
              const sorted = [...activeAnnouncements];
              if (sorted.length === 0) return null;

              const index = noticeIndex % sorted.length;
              const item = sorted[index];

              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const getDaysDiff = (dateStr: string) => {
                const targetDate = new Date(dateStr);
                targetDate.setHours(0, 0, 0, 0);
                const diffTime = targetDate.getTime() - today.getTime();
                return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              };

              const formatOrdinal = (dStr: string) => {
                const d = new Date(dStr);
                const months = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
                const day = d.getDate();
                const month = months[d.getMonth()];
                let suffix = "th";
                if (day === 1 || day === 21 || day === 31) suffix = "st";
                else if (day === 2 || day === 22) suffix = "nd";
                else if (day === 3 || day === 23) suffix = "rd";
                return `${day}${suffix} ${month}`;
              };

              const diffDays = getDaysDiff(item.effectiveDate);

              const getCountdownBadgeConfig = (diff: number) => {
                if (diff === 0) {
                  return {
                    text: "Effective today",
                    classes: theme === "dark"
                      ? "bg-red-500/20 text-red-500 dark:text-red-400 border border-red-500/35 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.2)]"
                      : "bg-red-105 text-red-700 border-red-305 animate-pulse font-extrabold",
                  };
                } else if (diff === 1) {
                  return {
                    text: "Live in 1 day",
                    classes: theme === "dark"
                      ? "bg-red-500/15 text-red-400 dark:text-red-300 border border-red-500/25 animate-pulse"
                      : "bg-red-55 text-red-650 border border-red-200 animate-pulse font-extrabold",
                  };
                } else if (diff === 2) {
                  return {
                    text: "Live in 2 days",
                    classes: theme === "dark"
                      ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 font-extrabold"
                      : "bg-indigo-50/65 text-indigo-200 border border-indigo-505/30 font-extrabold",
                  };
                } else if (diff === 3) {
                  return {
                    text: "Live in 3 days",
                    classes: theme === "dark"
                      ? "bg-indigo-500/10 text-indigo-305 border border-indigo-500/15 font-extrabold"
                      : "bg-indigo-50/50 text-indigo-205 border border-indigo-505/25 font-extrabold",
                  };
                } else if (diff > 3 && diff <= 7) {
                  return {
                    text: `Live in ${diff} days`,
                    classes: theme === "dark"
                      ? "bg-sky-500/15 text-sky-305 border border-sky-500/20 font-extrabold"
                      : "bg-sky-50/60 text-sky-200 border border-sky-500/30 font-extrabold",
                  };
                } else if (diff < 0) {
                  const absDiff = Math.abs(diff);
                  const dayLabel = absDiff === 1 ? "day" : "days";
                  return {
                    text: `Active since ${absDiff} ${dayLabel}`,
                    classes: theme === "dark"
                      ? "bg-teal-500/10 text-teal-400 border border-teal-500/15 font-extrabold"
                      : "bg-teal-55 text-teal-800 border border-teal-205 font-extrabold",
                  };
                } else {
                  return {
                    text: `Active from ${formatOrdinal(item.effectiveDate)}`,
                    classes: theme === "dark"
                      ? "bg-stone-500/10 text-stone-400 border border-stone-500/15 font-extrabold"
                      : "bg-slate-55 text-slate-600 border border-slate-205 font-extrabold",
                  };
                }
              };

              const getRatingBadgeConfig = (rating: number | undefined) => {
                if (rating === undefined || rating === 0) {
                  return {
                    text: "No Rating",
                    classes: theme === "dark"
                      ? "bg-stone-500/10 text-stone-400 border border-stone-500/15 font-extrabold"
                      : "bg-stone-55 text-stone-600 border border-stone-205 font-extrabold",
                  };
                }
                if (rating === 1) {
                  return {
                    text: "Rating 1",
                    classes: theme === "dark"
                      ? "bg-red-500/20 text-red-400 border border-red-500/35 font-extrabold shadow-[0_0_8px_rgba(239,68,68,0.25)]"
                      : "bg-red-55 text-red-700 border border-red-200 font-extrabold",
                  };
                } else if (rating === 2) {
                  return {
                    text: "Rating 2",
                    classes: theme === "dark"
                      ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-extrabold"
                      : "bg-indigo-50/60 text-indigo-200 border border-indigo-500/30 font-extrabold",
                  };
                } else if (rating === 3) {
                  return {
                    text: "Rating 3",
                    classes: theme === "dark"
                      ? "bg-sky-500/15 text-sky-305 border border-sky-500/20 font-extrabold"
                      : "bg-sky-50/60 text-sky-200 border border-sky-500/30 font-extrabold",
                  };
                } else if (rating === 4) {
                  return {
                    text: "Rating 4",
                    classes: theme === "dark"
                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 font-extrabold"
                      : "bg-blue-55 text-blue-700 border border-blue-200 font-extrabold",
                  };
                } else if (rating === -1) {
                  return {
                    text: "Highlight",
                    classes: theme === "dark"
                      ? "bg-purple-500/10 text-purple-400 border border-purple-500/20 font-extrabold"
                      : "bg-purple-55 text-purple-700 border border-purple-200 font-extrabold",
                  };
                }
                return {
                  text: `Rating ${rating}`,
                  classes: theme === "dark"
                    ? "bg-teal-500/10 text-teal-400 border border-teal-500/15 font-extrabold"
                    : "bg-teal-55 text-teal-800 border border-teal-200 font-extrabold",
                };
              };

              const countdownConfig = getCountdownBadgeConfig(diffDays);
              const ratingConfig = getRatingBadgeConfig(item.rating);

              const renderAnnouncementWithRatings = (text: string) => {
                return renderFormattedAnnouncement(text, theme, true);
              };

              const annType = item.type || "QA Announcement";

              const typeConfig = (() => {
                if (annType === "General Announcement") {
                  return {
                    containerClass: "bg-gradient-to-br from-emerald-500/10 via-blue-500/[0.03] to-blue-500/[0.06] dark:from-emerald-500/15 dark:via-[#0f172a] dark:to-[#0f172a] border-emerald-500/25 dark:border-emerald-500/30 shadow-xs",
                    headerSubColor: "text-emerald-600 dark:text-emerald-450 font-extrabold",
                    titleColor: "text-emerald-700 dark:text-emerald-350 font-bold",
                  };
                } else {
                  // QA Announcement
                  return {
                    containerClass: "bg-gradient-to-br from-rose-500/10 via-blue-500/[0.03] to-blue-500/[0.06] dark:from-rose-500/15 dark:via-[#0f172a] dark:to-[#0f172a] border-rose-500/25 dark:border-rose-500/30 shadow-xs",
                    headerSubColor: "text-rose-600 dark:text-rose-400 font-extrabold",
                    titleColor: "text-rose-700 dark:text-rose-300 font-bold",
                  };
                }
              })();

              const containerStyle = typeConfig.containerClass;

              const motionVariants = {
                enter: (dir: "right-to-left" | "left-to-right") => ({
                  x: dir === "right-to-left" ? 180 : -180,
                  opacity: 0
                }),
                center: {
                  x: 0,
                  opacity: 1
                },
                exit: (dir: "right-to-left" | "left-to-right") => ({
                  x: dir === "right-to-left" ? -180 : 180,
                  opacity: 0
                })
              };

              return (
                <div
                  style={{
                    minHeight: "500px",
                  }}
                  className={`p-6 sm:p-8 flex flex-col gap-4 select-none transition-all duration-300 w-full lg:w-80 xl:w-96 flex-shrink-0 overflow-hidden relative rounded-2xl border ${containerStyle}`}
                >

                  {/* UPPER HEADER BAR (Row 1 of Layout) */}
                  <div
                    style={{
                      paddingTop: "0px",
                      marginTop: "0px",
                      marginBottom: "0px"
                    }}
                    className="flex flex-row items-center justify-between gap-3 w-full"
                  >
                    <div className="text-left flex flex-col justify-center">
                      <span
                        style={{
                          paddingLeft: "0px",
                          paddingBottom: "1.5px",
                          paddingTop: "1.5px",
                          marginTop: "0px",
                          marginBottom: "0px"
                        }}
                        className="inline-block text-[10px] leading-none font-black uppercase tracking-widest px-2.5 py-1 rounded bg-[#EFF6FF] dark:bg-[#0E1F33] text-[#1A365D] dark:text-[#D7E5FF] w-fit"
                      >
                        Updates
                      </span>
                      <span className="block text-[15px] leading-[18px] font-black mt-1 bg-gradient-to-r from-[#00D3F3] to-[#58A3FF] bg-clip-text text-transparent">
                        {(() => {
                          const annType = item.type || "QA Announcement";
                          if (annType === "General Announcement") {
                            return "Common Announcements";
                          }
                          return "QA Announcements";
                        })()}
                      </span>
                    </div>

                    {/* Badges on Top Right */}
                    <div className="flex flex-wrap items-center gap-1.5 justify-end">
                      <span
                        className={`text-[10px] px-2 py-1 tracking-wider whitespace-nowrap flex items-center justify-center font-extrabold h-6 rounded ${countdownConfig.classes}`}
                        style={{
                          backgroundColor: "#de7c50",
                          color: "#170505",
                        }}
                      >
                        {countdownConfig.text}
                      </span>
                      {item.rating !== undefined && item.rating !== 0 && (
                        <span
                          className={`text-[10px] px-2 py-1 tracking-wide rounded border whitespace-nowrap flex items-center justify-center font-extrabold h-6 ${ratingConfig.classes}`}
                          style={{
                            backgroundColor: "#94b06c",
                            color: "#000000",
                          }}
                        >
                          {ratingConfig.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* HORIZONTAL SHARP DIVIDER */}
                  <div className="border-t border-stone-200 dark:border-white/[0.08] w-full"></div>

                  {/* BODY CONTENT (Row 2 of Layout) */}
                  <div
                    style={{
                      backgroundColor: "#c7cfd6",
                      paddingTop: "12px",
                      paddingBottom: "12px",
                      paddingLeft: "12px",
                      paddingRight: "10px",
                      marginTop: "-7px",
                      marginBottom: "-5px",
                      borderRadius: "16px",
                      height: "calc(100% - 40px)",
                      position: "relative"
                    }}
                    className="flex flex-row items-start justify-between gap-3 md:gap-4 self-stretch w-full min-w-0"
                  >

                    {/* Left Text Block */}
                    <div className="flex-grow flex-1 min-w-0 text-left flex flex-col justify-start h-full">
                      {/* Announcement Title */}
                      <span
                        style={{ fontFamily: "system-ui", color: "#420606", marginTop: "0px", marginBottom: "0px" }}
                        className="text-xs md:text-[13px] font-bold tracking-tight uppercase mb-2 block"
                      >
                        {item.category || "General Announcement"}
                      </span>

                      {/* General Announcement meta: optional "From" team */}
                      {annType === "General Announcement" && item.from && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
                          <span className="text-[9px] text-cyan-800 font-semibold">
                            From: {item.from}
                          </span>
                        </div>
                      )}

                      {/* Announcement Content */}
                      <div
                        style={{
                          height: "calc(100% - 45px)",
                          maxHeight: "calc(100% - 45px)",
                          overflowY: "auto",
                          overflowX: "hidden",
                          scrollbarWidth: "thin",
                          scrollbarColor: theme === "dark" ? "#2B3E5A transparent" : "#CBD5E1 transparent"
                        }}
                        className="relative w-full flex flex-col justify-start bg-transparent pr-1 overflow-x-hidden"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={item.id}
                            custom={slideDirection}
                            variants={motionVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ type: "spring", stiffness: 220, damping: 26 }}
                            className="w-full text-left"
                          >
                            <div
                              className="text-[12.5px] font-medium leading-relaxed text-stone-850"
                              style={{ maxWidth: '100%', fontFamily: "system-ui", marginRight: "0px" }}
                            >
                              {/* Desktop/MD Floated Spacer to push mascot to bottom right */}
                              <div className="hidden md:block" style={{ float: 'right', height: '120px', width: '0px' }} />
                              {/* Floated Mascot Placeholder (Invisible Spacer) inside the text flow */}
                              <div
                                className="hidden md:block"
                                style={{
                                  float: 'right',
                                  clear: 'right',
                                  width: '112.71199999999999px',
                                  height: '130px',
                                  marginLeft: '16px',
                                  marginRight: '-10px',
                                  marginTop: '8px',
                                  marginBottom: sorted.length > 1 ? "-16px" : "3px"
                                }}
                              />
                              {renderAnnouncementWithRatings(item.announcement)}
                            </div>
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Fixed Mascot aligned to the bottom-right of the Row 2 container, overlapping correctly */}
                    <div
                      className="hidden md:flex items-end justify-center shrink-0 py-1 select-none absolute"
                      style={{
                        width: '150px',
                        height: '150px',
                        bottom: sorted.length > 1 ? "-11px" : "0px",
                        right: "0px",
                        pointerEvents: "none"
                      }}
                    >
                      <div
                        style={{
                          marginRight: "-35px",
                          paddingLeft: "0px",
                          width: "112.71199999999999px",
                          height: "130px",
                          marginLeft: "23px",
                          marginTop: "0px",
                          marginBottom: "3px"
                        }}
                        className="flex items-end justify-center relative pointer-events-auto"
                      >
                        <MascotWithFallback
                          src="/assets/.aistudio/announcement-mascot.png"
                          alt="Announcement Mascot"
                          className="h-full w-auto object-contain transition-all duration-300 transform-gpu hover:scale-105 pointer-events-none select-none"
                          type="notepad"
                          style={{ maxHeight: '100%', maxWidth: '150px' }}
                        />
                      </div>
                    </div>

                  </div>

                  {/* PAGE INDICATOR & ARROWS (Row 3 of Layout) */}
                  {sorted.length > 1 && (
                    <div
                      style={{
                        height: "55px",
                        marginTop: "-2px",
                        paddingTop: "1.5px",
                        paddingBottom: "-11px",
                        marginBottom: "-33px"
                      }}
                      className="flex flex-col items-center justify-center gap-2 pt-3 mt-1 border-t border-dashed border-stone-200 dark:border-white/[0.08] w-full"
                    >
                      <div
                        style={{
                          width: "65px",
                          height: "12px",
                          fontSize: "10px",
                          lineHeight: "15px",
                          marginBottom: "-1px",
                          marginTop: "-21px"
                        }}
                        className="flex items-center justify-center gap-2 py-1 select-none"
                      >
                        {sorted.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSlideDirection(idx > noticeIndex ? "right-to-left" : "left-to-right");
                              setNoticeIndex(idx);
                            }}
                            className={`w-2 h-2 rounded-full transition-all duration-300 cursor-pointer ${
                              idx === noticeIndex
                                ? (theme === "dark" ? "bg-cyan-400 w-4 shadow-[0_0_8px_rgba(34,211,238,0.5)]" : "bg-blue-600 w-4 shadow-[0_0_6px_rgba(37,99,235,0.3)]")
                                : (theme === "dark" ? "bg-stone-700 hover:bg-stone-600" : "bg-stone-300 hover:bg-stone-400")
                            }`}
                            title={`Go to page ${idx + 1}`}
                          />
                        ))}
                      </div>

                      <div
                        style={{
                          height: "14px",
                          marginBottom: "-11px"
                        }}
                        className="flex items-center gap-2"
                      >
                        <button
                          onClick={() => {
                            setSlideDirection("left-to-right");
                            setNoticeIndex((prev) => (prev - 1 + sorted.length) % sorted.length);
                          }}
                          style={{
                            width: "28px",
                            height: "28px",
                            backgroundColor: theme === "dark" ? "var(--surface-tint)" : "var(--accent-subtle-bg)"
                          }}
                          className={`hover:scale-[1.03] active:scale-[0.97] rounded-lg transition-all cursor-pointer flex items-center justify-center border ${
                            theme === "dark"
                              ? "border-white/[0.08]"
                              : "border-slate-200 shadow-xs"
                          }`}
                          title="Previous Announcement"
                        >
                          <ChevronLeft className="w-[18px] h-[18px]" style={{ color: "var(--accent)" }} />
                        </button>
                        <button
                          onClick={() => {
                            setSlideDirection("right-to-left");
                            setNoticeIndex((prev) => (prev + 1) % sorted.length);
                          }}
                          style={{
                            width: "28px",
                            height: "28px",
                            backgroundColor: theme === "dark" ? "var(--surface-tint)" : "var(--accent-subtle-bg)"
                          }}
                          className={`hover:scale-[1.03] active:scale-[0.97] rounded-lg transition-all cursor-pointer flex items-center justify-center border ${
                            theme === "dark"
                              ? "border-white/[0.08]"
                              : "border-slate-200 shadow-xs"
                          }`}
                          title="Next Announcement"
                        >
                          <ChevronRight className="w-[18px] h-[18px]" style={{ color: "var(--accent)" }} />
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              );
            })()}
          </div>
        </>
      )}
    </>
  );
}
