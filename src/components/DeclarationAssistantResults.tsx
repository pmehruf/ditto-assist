import React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle2,
  Layers,
  Search,
  Check,
  RefreshCw,
  AlertTriangle,
  Flag,
  FileText,
  Activity,
  ChevronLeft,
  RotateCcw,
  Edit3,
  ChevronDown,
} from "lucide-react";
import { SpecificIllnessLedgerCard } from "./SpecificIllnessLedgerCard";
import { PlanConfig } from "../types.js";
import { ReportingItem } from "../types/lookup";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ResultItem {
  ped: string;
  result: {
    ped_input: string;
    match_type:
    | "STANDARD_EXCLUSION"
    | "STANDARD_QUESTION"
    | "SPECIFIC_ILLNESS"
    | "UMBRELLA_EXCLUSION"
    | "OTHERS_EXCLUSION"
    | "FALLBACK";
    matched_question: string;
    explanation: string;
  };
  source: string;
}

interface DeclarationAssistantResultsProps {
  theme: string;
  selectedPlan: string;
  lookupPeds: string[];
  isLookupLoading: boolean;
  lookupResults: ResultItem[];
  onReset: () => void;
  onMapAnotherPed: () => void;
  setReportingItem: (item: ReportingItem | null) => void;
  setReportingNotes: (notes: string) => void;
  setReportingPriority: (prio: string) => void;
  mappingResultCardRef: React.RefObject<HTMLDivElement | null>;
  resultsRef: React.RefObject<HTMLDivElement | null>;
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  rightHeaderRef: React.RefObject<HTMLDivElement | null>;
  illnessSearchQuery: string;
  setIllnessSearchQuery: (query: string) => void;
  specificIllnessesDict: Record<string, Array<{ category?: string; illness: string }>>;
  planConfigs?: Record<string, PlanConfig>;
  checkIllnessInPlanSpecificList: (pedText: string, plan: string) => { category: string; illness: string } | null;
}


// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export const DeclarationAssistantResults: React.FC<
  DeclarationAssistantResultsProps
> = ({
  theme,
  selectedPlan,
  lookupPeds,
  isLookupLoading,
  lookupResults,
  onReset,
  onMapAnotherPed,
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
  planConfigs = {},
  checkIllnessInPlanSpecificList,
}) => {
  const [expandedLogics, setExpandedLogics] = React.useState<
    Record<number, boolean>
  >({});
  const [expandedUmbrellas, setExpandedUmbrellas] = React.useState<
    Record<number, boolean>
  >({});
  const [expandedOverlaps, setExpandedOverlaps] = React.useState<
    Record<string, boolean>
  >({
    medication: true,
    investigation: true,
    surgery: true,
    hospitalization: true,
  });

  const toggleLogicExpanded = (index: number) => {
    setExpandedLogics((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const isFocused = Object.values(expandedOverlaps).some((v) => v) && !Object.values(expandedOverlaps).every((v) => v);

  const toggleOverlap = (id: string) => {
    setExpandedOverlaps((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const planConfig = planConfigs?.[selectedPlan];

  return (
    <motion.div
      key="results-layout"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 15 }}
      className="flex flex-col gap-5 w-full box-border font-sans"
    >
      {/* Back navigation row */}
      <div className="flex items-center gap-3 select-none">
        <style>{`
          #back-btn-focused {
            width: 77.8px !important;
            font-weight: normal !important;
            font-size: 13.5px !important;
            padding-right: 6px !important;
            padding-left: 21px !important;
            height: 27.6px !important;
            color: #000000 !important;
            background-color: #e9aa21 !important;
          }
          #back-btn-focused svg {
            margin-left: -15px !important;
            margin-right: -9px !important;
            border-color: #a3a3a8 !important;
          }
          #back-btn-focused svg path {
            font-size: 11.5px !important;
            width: auto !important;
            padding-top: -9px !important;
            padding-bottom: 5px !important;
            margin-top: -1px !important;
            margin-bottom: 17px !important;
          }
        `}</style>
        <button
          id="back-btn-focused"
          type="button"
          onClick={onMapAnotherPed}
          style={{
            backgroundColor: "#e9aa21",
            borderColor: "#000000",
            color: "#000000",
            marginBottom: "0px"
          }}
          className="group flex items-center gap-2 text-xs font-black uppercase tracking-wider px-4 py-2 rounded-xl border transition-all duration-200 cursor-pointer opacity-80 hover:opacity-100 hover:scale-[1.01] active:scale-95 shadow-md active:opacity-100 hover:brightness-110 active:brightness-90"
          title="Go back"
        >
          <ChevronLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-1" />
          Back
        </button>
        <span
          className={`text-[10px] font-medium leading-none ${theme === "dark" ? "text-stone-400" : "text-slate-400"}`}
        >
          {selectedPlan && (
            <>
              <span className="font-black text-[#58A3FF]">{selectedPlan}</span>
              {lookupPeds.length > 0 && (
                <> &nbsp;·&nbsp; {lookupPeds.length} condition{lookupPeds.length > 1 ? "s" : ""}</>
              )}
            </>
          )}
        </span>
      </div>


      {/* TWO-SECTION LAYOUT: Left (Results + PayQ + Illness) | Right (Overlap Cards) */}
      <div className="grid grid-cols-1 xl:grid-cols-[45%_55%] gap-6 w-full items-start">

        {/* ─────────────── LEFT COLUMN ─────────────── */}
        <div className="flex flex-col gap-4">


        {/* LEFT COLUMN: MAPPING RESULT FEED */}
        <div
          ref={resultsRef}
          className="flex flex-col min-h-0 w-full"
        >
          <div
            ref={mappingResultCardRef}
            style={{
              backgroundColor: theme === "dark" ? "#09223C" : "#ffffff",
              borderColor: theme === "dark" ? "#1A3B62" : "#C7CFD6",
            }}
            className="rounded-2xl overflow-hidden flex flex-col border transition-all shadow-[0_0_40px_rgba(59,130,246,0.08)]"
          >
            {/* Header with actions */}
            <div
              style={{
                borderColor: theme === "dark" ? "#1A3B62" : "#C7CFD6",
                backgroundColor: theme === "dark" ? "#041629" : "#ffffff"
              }}
              className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-3 shrink-0"
            >
              <span
                className="text-xs font-black uppercase tracking-wider flex items-center gap-2 select-none bg-gradient-to-r from-[#00D3F3] to-[#58A3FF] bg-clip-text text-transparent"
              >
                <CheckCircle2
                  style={{ color: "#00D3F3" }}
                  className="w-4 h-4 shrink-0"
                />
                Mapping Results
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onMapAnotherPed}
                  className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${theme === "dark"
                      ? "border-white/[0.08] bg-white/[0.03] text-stone-300 hover:bg-white/[0.06]"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100 shadow-xs"
                    }`}
                >
                  <Edit3 className="w-3 h-3" />
                  Edit Input
                </button>

                <button
                  type="button"
                  onClick={onReset}
                  className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${theme === "dark"
                      ? "border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                      : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    }`}
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
            </div>

            {/* Caution banner */}
            <div
              style={{
                borderColor: theme === "dark" ? "#1A3B62" : "#C7CFD6",
                backgroundColor: "rgba(245, 158, 11, 0.12)"
              }}
              className="px-5 py-2 border-b flex items-center gap-2"
            >
              <span className="text-[10px] shrink-0">⚠️</span>
              <span className="text-[9.5px] uppercase font-black tracking-wide text-amber-400">
                Caution: Verify results. Tool can make mistakes.
              </span>
            </div>

            {/* Scrollable Result list */}
            <div className="overflow-y-auto p-5 space-y-5 custom-scrollbar" style={{ maxHeight: "42vh", minHeight: "200px" }}>
              {isLookupLoading ? (
                <div className="p-16 text-center flex flex-col justify-center items-center gap-4 min-h-[300px]">
                  <RefreshCw className="w-7 h-7 text-[#00D3F3] animate-spin" />
                  <p className="text-xs font-bold tracking-wider uppercase animate-pulse text-stone-400">
                    Running mapping algorithms…
                  </p>
                </div>
              ) : lookupResults.length > 0 ? (
                <div className="space-y-5 animate-fadeIn">
                  {lookupResults.map(({ ped, result, source }, idx) => {
                    let accentBorder = "";
                    if (result.match_type === "STANDARD_EXCLUSION")
                      accentBorder = "border-l-red-500/80";
                    else if (result.match_type === "STANDARD_QUESTION")
                      accentBorder = "border-l-emerald-500/80";
                    else if (result.match_type === "SPECIFIC_ILLNESS")
                      accentBorder = "border-l-cyan-400/80";
                    else if (result.match_type === "UMBRELLA_EXCLUSION")
                      accentBorder = "border-l-purple-500/80";
                    else if (result.match_type === "OTHERS_EXCLUSION")
                      accentBorder = "border-l-amber-500/80";
                    else
                      accentBorder = "border-l-slate-400/80";

                    const isLogicExpanded = expandedLogics[idx] || false;
                    const isFallback =
                      result.match_type === "FALLBACK" ||
                      (planConfig &&
                        result.matched_question === planConfig.anyOther);

                    return (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: theme === "dark" ? "#11365A" : "#C7CFD6",
                          borderColor: theme === "dark" ? "#1F4A7A" : "#C7CFD6"
                        }}
                        className={`rounded-xl border border-l-4 overflow-hidden ${accentBorder} shadow-xs transition-colors duration-150`}
                      >
                        {/* PED Name Header */}
                        <div
                          style={{
                            borderColor: theme === "dark" ? "#1F4A7A" : "#E2E8F0",
                            backgroundColor: "#000000"
                          }}
                          className="px-5 py-1 border-b flex flex-wrap justify-between items-center gap-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              style={{ backgroundColor: "#00D3F3" }}
                              className="w-2 h-2 rounded-full shrink-0 animate-pulse"
                            />
                            <span
                              style={{ color: theme === "dark" ? "#ffffff" : "#04233F" }}
                              className="text-sm font-black tracking-wide"
                            >
                              {ped}
                            </span>
                          </div>
                          {(() => {
                            const isIllnessMatch =
                              checkIllnessInPlanSpecificList(ped, selectedPlan);
                            if (isIllnessMatch) {
                              return (
                                <span className="border border-amber-400/40 text-amber-500 dark:text-amber-400 px-2 py-0.5 rounded text-[8px] uppercase font-mono font-black tracking-wider select-none bg-amber-500/5">
                                  Specific Illness
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        {/* Content Area */}
                        <div style={{ backgroundColor: "#43687a" }} className="p-5 space-y-4">
                          {/* Simplified Mapped Question - Placeless Border Card direct on PED card */}
                          {isFallback ? (
                            <>
                              {/* Umbrella Questions header & accordion */}
                              <div
                                style={{
                                  backgroundColor: theme === "dark" ? "#1E4D7E" : "rgba(59, 130, 246, 0.12)",
                                  borderColor: idx === 4 ? "#1c76cb" : (theme === "dark" ? "#2D67A4" : "#3b82f6")
                                }}
                                className="rounded-xl border overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedUmbrellas((prev) => ({
                                      ...prev,
                                      [idx]: !prev[idx],
                                    }));
                                  }}
                                  style={{ backgroundColor: "#030e21" }}
                                  className="w-full p-4 text-left flex items-center justify-between transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                >
                                  <div>
                                    <p
                                      style={{ color: theme === "dark" ? "#58A3FF" : "#04233F" }}
                                      className="text-[9.5px] font-black uppercase tracking-widest mb-1"
                                    >
                                      ① Umbrella Questions — Check First
                                    </p>
                                    <p
                                      className={`text-[10.5px] italic font-medium ${theme === "dark"
                                          ? "text-stone-400"
                                          : "text-stone-600"
                                        }`}
                                    >
                                      Meds · Tests · Treatment · Hospitalization · Surgery
                                    </p>
                                  </div>
                                  <ChevronDown
                                    className={`w-4 h-4 shrink-0 transition-transform ${expandedUmbrellas[idx] ? "rotate-180" : ""}`}
                                    style={{ color: theme === "dark" ? "#cbd5e1" : "#04233F" }}
                                  />
                                </button>
                                {expandedUmbrellas[idx] && (
                                  <div className="px-4 pb-4 space-y-2">
                                    {planConfig?.umbrellaQuestions &&
                                      planConfig.umbrellaQuestions.length > 0 ? (
                                      planConfig.umbrellaQuestions.map(
                                        (uq: string, k: number) => (
                                          <div
                                            key={k}
                                            style={{
                                              backgroundColor: theme === "dark" ? "#2A5F96" : "#FFFFFF",
                                              borderColor: theme === "dark" ? "#3B7DBF" : "#B0BCC8",
                                              color: theme === "dark" ? "#ffffff" : "#2d3748"
                                            }}
                                            className="p-3 rounded-lg border flex items-start gap-2 text-xs font-semibold leading-relaxed"
                                          >
                                            <span className="text-blue-500 mt-0.5 shrink-0">
                                              ☂
                                            </span>
                                            <span>{uq}</span>
                                          </div>
                                        )
                                      )
                                    ) : (
                                      <div
                                        style={{
                                          backgroundColor: theme === "dark" ? "#2A5F96" : "#FFFFFF",
                                          borderColor: theme === "dark" ? "#3B7DBF" : "#B0BCC8",
                                          color: theme === "dark" ? "#cbd5e1" : "#2d3748"
                                        }}
                                        className="p-3 rounded-lg border text-xs font-semibold leading-relaxed"
                                      >
                                        Generic: medication, prolonged
                                        treatment, hospitalization, or surgical
                                        advice umbrella questions.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              <p
                                style={{
                                  color: theme === "dark" ? "#e2e8f0" : "#2d3748"
                                }}
                                className="text-[11px] font-semibold leading-relaxed px-1"
                              >
                                If umbrella questions don't apply, proceed with Others Section:
                              </p>

                              {/* Others fallback sub-section */}
                              <div
                                style={{
                                  backgroundColor: "#030e21",
                                  borderColor: idx === 4 ? "#247855" : (theme === "dark" ? "#2D67A4" : "#B0BCC8")
                                }}
                                className="p-4 rounded-xl border"
                              >
                                <p
                                  style={{ color: theme === "dark" ? "#58A3FF" : "#04233F" }}
                                  className="text-[9.5px] font-black uppercase tracking-widest mb-2"
                                >
                                  ② Others Section (Last Option)
                                </p>
                                <p
                                  style={{ color: theme === "dark" ? "#ffffff" : "#1F1F1F" }}
                                  className="text-xs font-bold leading-relaxed"
                                >
                                  {result.matched_question ||
                                    planConfig?.anyOther ||
                                    "Any other disease/condition not mentioned above?"}
                                </p>
                              </div>
                            </>
                          ) : (
                            /* DIRECT QUESTION RENDERING: NO BORDER CONTAINER, REDUCED TYPE SIZE */
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 opacity-90 select-none">
                                <Check
                                  className={`w-3.5 h-3.5 shrink-0 ${theme === "dark"
                                      ? "text-[#58A3FF]"
                                      : "text-[#04233F]"
                                    }`}
                                />
                                <span
                                  style={{ color: theme === "dark" ? "#58A3FF" : "#04233F" }}
                                  className="text-[9.5px] font-black uppercase tracking-widest"
                                >
                                  Mapped Declaration Question
                                </span>
                              </div>
                              <p
                                style={{ color: "#000000" }}
                                className="text-xs font-bold leading-relaxed pl-5 text-balance font-sans"
                              >
                                {result.matched_question}
                              </p>
                            </div>
                          )}

                          {/* Mapping Logic + Flag Mismatch Accordion link */}
                          <div 
                            style={idx === 4 ? { borderColor: "#b6aaff" } : undefined}
                            className="flex items-center gap-2.5 w-full"
                          >
                            <div
                              style={{
                                borderColor: idx === 4 ? "#b6aaff" : (theme === "dark" ? "#1F4A7A" : "#B0BCC8")
                              }}
                              className="flex-grow border rounded-xl overflow-hidden"
                            >
                              <button
                                type="button"
                                onClick={() => toggleLogicExpanded(idx)}
                                style={{
                                  backgroundColor: "#000000"
                                }}
                                className="w-full p-2.5 px-3.5 flex items-center justify-between text-left select-none transition-all cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <FileText
                                    className={`w-3.5 h-3.5 shrink-0 ${theme === "dark"
                                        ? "text-[#00D3F3]"
                                        : "text-[#04233F]"
                                      }`}
                                  />
                                  <span
                                    style={{ color: theme === "dark" ? "#ffffff" : "#04233F" }}
                                    className="text-[10px] font-black uppercase tracking-wider"
                                  >
                                    Mapping Logic
                                  </span>
                                </div>
                                <ChevronDown
                                  className={`w-3.5 h-3.5 transition-transform text-stone-400 ${isLogicExpanded ? "rotate-180" : ""}`}
                                />
                              </button>
                              {isLogicExpanded && (
                                <div
                                  style={{
                                    borderColor: theme === "dark" ? "#1F4A7A" : "#B0BCC8",
                                    backgroundColor: theme === "dark" ? "#1E4D7E" : "#FFFFFF",
                                    color: theme === "dark" ? "#e2e8f0" : "#2d3748"
                                  }}
                                  className="p-4 border-t"
                                >
                                  {(() => {
                                    const match = checkIllnessInPlanSpecificList(
                                      ped,
                                      selectedPlan
                                    );
                                    if (!match) return null;
                                    return (
                                      <div
                                        style={{
                                          backgroundColor: theme === "dark" ? "rgba(245, 158, 11, 0.08)" : "rgba(245, 158, 11, 0.15)",
                                          borderColor: theme === "dark" ? "rgba(245, 158, 11, 0.25)" : "#f59e0b"
                                        }}
                                        className="p-3.5 rounded-xl border flex flex-col gap-1.5 mb-3"
                                      >
                                        <div className="flex items-center gap-2 text-amber-500 font-extrabold text-[11px]">
                                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                                          PED listed under specific illness list
                                        </div>
                                        <p
                                          style={{ color: theme === "dark" ? "#cbd5e1" : "#1F1F1F" }}
                                          className="text-[10.5px] leading-relaxed font-semibold font-sans"
                                        >
                                          "{ped.toLowerCase()}" maps to{" "}
                                          <span className="text-amber-500 font-bold font-mono">
                                            "{match.illness}"
                                          </span>{" "}
                                          (Category:{" "}
                                          <span className="underline decoration-sky-400 underline-offset-2 font-black">
                                            {match.category || "General"}
                                          </span>
                                          ) in {selectedPlan}'s specific illness List.
                                        </p>
                                      </div>
                                    );
                                  })()}
                                  <p className="text-xs leading-relaxed font-sans">
                                    {result.explanation}
                                  </p>
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setReportingItem({
                                  planName: selectedPlan || "Optima Secure",
                                  pedInput: ped,
                                  mappedQuestion: result.matched_question,
                                  matchType: result.match_type,
                                  source,
                                  explanation: result.explanation,
                                });
                                setReportingNotes("");
                                setReportingPriority("Urgent");
                              }}
                              className="px-3 py-2.5 rounded-xl text-white bg-red-600 hover:bg-red-700 text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer select-none active:scale-95 shrink-0 shadow-sm"
                            >
                              <Flag className="w-3.5 h-3.5 text-white shrink-0" />
                              <span>Flag</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-10 text-center flex flex-col items-center justify-center gap-5 min-h-[280px]">
                  <div className="w-11 h-11 rounded-full bg-blue-500/5 border border-blue-500/10 flex items-center justify-center">
                    <Search className="w-5 h-5 text-blue-400 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 max-w-xs mx-auto">
                    <h3 className="text-sm font-black text-stone-300">
                      Awaiting Mapping Evaluation
                    </h3>
                    <p className="text-xs leading-relaxed font-semibold text-stone-500">
                      Select a policy and add patient declarations to begin.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: PAYMENT JOURNEY QUESTIONS */}
        {selectedPlan && (
          <div
            ref={sidebarRef}
            id="payment-journey-questions-view"
            style={{
              backgroundColor: theme === "dark" ? "#09223C" : "#FFFFFF",
              borderColor: theme === "dark" ? "#1A3B62" : "#C7CFD6",
            }}
            className="rounded-2xl border overflow-hidden flex flex-col transition-all shadow-[0_0_40px_rgba(59,130,246,0.08)]"
          >
            {/* Header */}
            <div
              ref={rightHeaderRef}
              style={{
                borderColor: theme === "dark" ? "#1A3B62" : "#C7CFD6",
                backgroundColor: theme === "dark" ? "#041629" : "#EFF6FF"
              }}
              className="px-5 py-3 border-b flex items-center justify-between shrink-0 animate-fadeIn"
            >
              <span
                className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 select-none ${
                  theme === "dark"
                    ? "bg-gradient-to-r from-[#00D3F3] to-[#58A3FF] bg-clip-text text-transparent"
                    : "text-[#04233F]"
                }`}
              >
                <Layers
                  style={{ color: theme === "dark" ? "#00D3F3" : "#04233F" }}
                  className="w-4 h-4 shrink-0"
                />
                Payment Journey Questions
              </span>
              <span
                style={{ color: theme === "dark" ? "#00D3F3" : "#04233F" }}
                className="text-[9.5px] font-black uppercase tracking-widest"
              >
                {selectedPlan}
              </span>
            </div>

            {/* Scrollable table container */}
            <div className="overflow-y-auto w-full custom-scrollbar" style={{ maxHeight: "32vh" }}>
              <table className="w-full text-left border-collapse font-sans">
                <thead>
                  <tr
                    style={{
                      backgroundColor: theme === "dark" ? "#11365A" : "#EFF6FF",
                      borderColor: theme === "dark" ? "#1F4A7A" : "#C7CFD6"
                    }}
                    className="border-b"
                  >
                    <th
                      style={{
                        borderColor: theme === "dark" ? "#1F4A7A" : "#C7CFD6",
                        color: theme === "dark" ? "#ffffff" : "#04233F"
                      }}
                      className="py-2.5 px-4 text-center font-black tracking-wider text-[9.5px] uppercase border-r w-16"
                    >
                      No.
                    </th>
                    <th
                      style={{
                        color: theme === "dark" ? "#ffffff" : "#04233F"
                      }}
                      className="py-2.5 px-5 font-black tracking-wider text-[9.5px] uppercase"
                    >
                      Declaration Question
                    </th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${theme === "dark" ? "divide-[#1F4A7A]" : "divide-slate-200"}`}>
                  {(() => {
                    const cfg = planConfigs?.[selectedPlan] || {
                      questions: [],
                    };
                    const questionsList = cfg.questions || [];
                    if (questionsList.length === 0) {
                      return (
                        <tr>
                          <td
                            colSpan={2}
                            className="py-8 text-center text-xs text-stone-400 font-sans"
                          >
                            No questions configured for this plan.
                          </td>
                        </tr>
                      );
                    }

                    return questionsList.map((question: string, i: number) => {
                      const questionId = i + 1;
                      const normalizedItem = question.toLowerCase().trim();
                      const isUmbrella = cfg?.umbrellaQuestions?.some(
                        (uq: string) =>
                          uq.toLowerCase().trim() === normalizedItem
                      );
                      const isAnyOther =
                        cfg?.anyOther &&
                        cfg.anyOther.toLowerCase().trim() === normalizedItem;

                      let isMatch = false;
                      let isFallbackUmbrellaHighlight = false;
                      let isFallbackOthersHighlight = false;
                      let matchIdx = -1;

                      lookupResults.forEach(({ result }, idx) => {
                        if (result) {
                          const normC7 = (
                            result.matched_question || ""
                          ).toLowerCase().trim();
                          if (result.match_type === "FALLBACK") {
                            if (isUmbrella) {
                              isMatch = true;
                              isFallbackUmbrellaHighlight = true;
                              matchIdx = idx;
                            } else if (isAnyOther) {
                              isMatch = true;
                              isFallbackOthersHighlight = true;
                              matchIdx = idx;
                            }
                          } else if (normC7 === normalizedItem) {
                            isMatch = true;
                            matchIdx = idx;
                          }
                        }
                      });

                      let highlightClass = "";
                      let borderLeftStyle = "border-l-transparent";
                      let textClass = "";

                      if (isMatch) {
                        if (isFallbackUmbrellaHighlight) {
                          highlightClass =
                            theme === "dark"
                              ? "bg-purple-900/40"
                              : "bg-purple-50";
                          borderLeftStyle = "border-l-purple-500 border-l-[4px]";
                          textClass =
                            theme === "dark" ? "text-purple-400 font-extrabold" : "text-purple-900 font-bold";
                        } else if (isFallbackOthersHighlight) {
                          highlightClass =
                            theme === "dark"
                              ? "bg-amber-900/30"
                              : "bg-amber-50";
                          borderLeftStyle = "border-l-amber-500 border-l-[4px]";
                          textClass =
                            theme === "dark" ? "text-amber-400 font-extrabold" : "text-amber-900 font-bold";
                        } else {
                          highlightClass =
                            theme === "dark"
                              ? "bg-blue-900/40"
                              : "bg-blue-50/70";
                          borderLeftStyle = "border-sky-400 border-l-[4px]";
                          textClass =
                            theme === "dark" ? "text-sky-400 font-extrabold" : "text-blue-900 font-bold";
                        }
                      } else {
                        highlightClass = theme === "dark" ? "bg-[#11365A]" : "bg-white";
                        textClass = theme === "dark" ? "text-slate-350" : "text-slate-800";
                      }

                      let indicatorText = `Q${questionId}`;
                      if (isMatch) {
                        if (isFallbackUmbrellaHighlight)
                          indicatorText = `Q${matchIdx + 1}☂`;
                        else if (isFallbackOthersHighlight)
                          indicatorText = `Q${matchIdx + 1}🌐`;
                        else indicatorText = `Q${matchIdx + 1}`;
                      }

                      return (
                        <tr
                          key={i}
                          className={`transition-all duration-100 ${highlightClass}`}
                        >
                          <td
                            style={{
                              borderColor: theme === "dark" ? "#1F4A7A" : "#E2E8F0",
                              color: theme === "dark" ? "#ffffff" : "#04233F"
                            }}
                            className={`py-3 px-4 text-center border-r border-l-4 font-mono text-[10px] whitespace-nowrap ${borderLeftStyle}`}
                          >
                            {indicatorText}
                          </td>
                          <td className="py-3 px-5">
                            <div className="flex items-start gap-2.5 leading-relaxed font-sans">
                              {isMatch && (
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 animate-pulse ${isFallbackUmbrellaHighlight
                                      ? "bg-purple-500"
                                      : isFallbackOthersHighlight
                                        ? "bg-amber-400"
                                        : "bg-[#00D3F3]"
                                    }`}
                                />
                              )}
                              <div
                                className={`pr-4 tracking-tight ${textClass}`}
                                style={{ fontSize: "10px", lineHeight: "16px" }}
                              >
                                {question}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

          {/* SPECIFIC ILLNESS PANEL */}
        {/* SPECIFIC ILLNESS CARD (Right column of Row 2) */}
        <div className="flex flex-col min-h-0 w-full animate-fadeIn">
          <div
            style={{
              backgroundColor: theme === "dark" ? "#09223C" : "#FFFFFF",
              borderColor: theme === "dark" ? "#1A3B62" : "#C7CFD6",
            }}
            className="rounded-2xl border overflow-hidden flex flex-col shadow-[0_0_40px_rgba(59,130,246,0.08)]"
          >
            {/* Header */}
            <div
              style={{
                borderColor: theme === "dark" ? "#1A3B62" : "#C7CFD6",
                backgroundColor: theme === "dark" ? "#041629" : "#EFF6FF"
              }}
              className="px-5 py-3 border-b flex items-center justify-between shrink-0"
            >
              <span
                className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 select-none ${
                  theme === "dark"
                    ? "bg-gradient-to-r from-[#00D3F3] to-[#58A3FF] bg-clip-text text-transparent"
                    : "text-[#04233F]"
                }`}
              >
                <Activity
                  style={{ color: theme === "dark" ? "#00D3F3" : "#04233F" }}
                  className="w-4 h-4 shrink-0"
                />
                Specific Illness List
              </span>
            </div>

            {/* Scrolling inside the card */}
            <div className="p-4 overflow-y-auto" style={{ maxHeight: "28vh" }}>
              <SpecificIllnessLedgerCard
                theme={theme}
                selectedPlan={selectedPlan}
                illnessSearchQuery={illnessSearchQuery}
                setIllnessSearchQuery={setIllnessSearchQuery}
                specificIllnessesDict={specificIllnessesDict}
              />
            </div>
          </div>
        </div>

        </div>{/* end LEFT COLUMN */}

        {/* ─────────────── RIGHT COLUMN: Overlap cards directly on background ─────────────── */}
        <div className="flex flex-col gap-4">

          {/* Section label — sits directly on page background */}
          <div className="flex items-center gap-2.5 px-1 select-none">
            <Layers
              style={{ color: theme === "dark" ? "#00D3F3" : "#04233F" }}
              className="w-4 h-4 shrink-0"
            />
            <span
              className={`text-xs font-black uppercase tracking-wider ${
                theme === "dark"
                  ? "bg-gradient-to-r from-[#00D3F3] to-[#58A3FF] bg-clip-text text-transparent"
                  : "text-[#04233F]"
              }`}
            >
              Overlapping Questions
            </span>
            <p className={`text-[9.5px] font-medium leading-none ml-1 ${theme === "dark" ? "text-[#58A3FF]" : "text-[#556070]"}`}>
              — PED declaration intersections, key clinical queries
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">

              {/* CARD 1: PED × Medication */}
              <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
                theme === "dark" ? "bg-[#10233a]" : "bg-white shadow-xs"
              } ${
                expandedOverlaps.medication
                  ? "border-[#3b9eff]/50 ring-1 ring-[#3b9eff]/20"
                  : theme === "dark" ? "border-white/10" : "border-stone-250"
              } ${
                isFocused && !expandedOverlaps.medication ? "opacity-30 hover:opacity-60 scale-[0.98]" : "opacity-100"
              }`}>
                <button
                  onClick={() => toggleOverlap("medication")}
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
                    <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                      PED × Medication
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                    expandedOverlaps.medication ? "transform rotate-180 text-[#3b9eff]" : ""
                  }`} />
                </button>

                {expandedOverlaps.medication && (
                  <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                    <div className="mt-4 pl-3.5 border-l-2 border-[#3b9eff] space-y-4">
                      <div className="space-y-1.5">
                        <p className={`text-xs leading-relaxed ${theme === "dark" ? "text-stone-300" : "text-stone-750"}`}>
                          <strong>Declare both the PED and the medication.</strong> Use the general format — "Medications of [condition] going on" — the drug name is not required.
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

              {/* CARD 2: PED/No-PED × Investigative Tests */}
              <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
                theme === "dark" ? "bg-[#10233a]" : "bg-white shadow-xs"
              } ${
                expandedOverlaps.investigation
                  ? "border-[#b07cff]/50 ring-1 ring-[#b07cff]/20"
                  : theme === "dark" ? "border-white/10" : "border-stone-250"
              } ${
                isFocused && !expandedOverlaps.investigation ? "opacity-30 hover:opacity-60 scale-[0.98]" : "opacity-100"
              }`}>
                <button
                  onClick={() => toggleOverlap("investigation")}
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
                    <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                      PED/No-PED × Investigative Tests
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                    expandedOverlaps.investigation ? "transform rotate-180 text-[#b07cff]" : ""
                  }`} />
                </button>

                {expandedOverlaps.investigation && (
                  <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                    <div className="mt-4 pl-3.5 border-l-2 border-[#b07cff] space-y-4">
                      <div className={`p-3 rounded-xl border font-semibold ${
                        theme === "dark" ? "bg-[#ff5a6e]/10 border-[#ff5a6e]/50 text-[#ffd9df]" : "bg-red-50 border-red-200 text-red-800"
                      }`}>
                        <div className="text-xs">
                          <span className="text-red-500 font-bold dark:text-[#ff8a9a]">⚠ Mandatory declaration:</span> Disclose <strong>with or without a diagnosis</strong> (exception applicable), <strong>with or without findings</strong>, and <strong>with or without reports</strong>.
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
                            <strong className="text-xs block font-bold mb-1">7 critical tests — name exactly:</strong>
                            <p className="font-mono text-xs text-indigo-500 dark:text-blue-300 font-extrabold leading-relaxed">
                              Angiography · TRT (Treadmill Test) / Stress Test · ECG · MRI · Endoscopy · Colonoscopy · USG
                            </p>
                          </div>
                          <div className={`p-3 rounded-xl border ${
                            theme === "dark" ? "bg-stone-950/20 border-white/5" : "bg-white border-stone-200 shadow-xs"
                          }`}>
                            <strong className="text-xs block font-bold mb-1">Any other test:</strong>
                            <p className={`text-xs m-0 ${theme === "dark" ? "text-[#90a6c4]" : "text-stone-600"}`}>
                              → use the generic phrase <strong>"Medical tests were done."</strong>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* CARD 3: PED × Surgery */}
              <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
                theme === "dark" ? "bg-[#10233a]" : "bg-white shadow-xs"
              } ${
                expandedOverlaps.surgery
                  ? "border-[#ff9f43]/50 ring-1 ring-[#ff9f43]/20"
                  : theme === "dark" ? "border-white/10" : "border-stone-250"
              } ${
                isFocused && !expandedOverlaps.surgery ? "opacity-30 hover:opacity-60 scale-[0.98]" : "opacity-100"
              }`}>
                <button
                  onClick={() => toggleOverlap("surgery")}
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
                    <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                      PED × Surgery
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                    expandedOverlaps.surgery ? "transform rotate-180 text-[#ff9f43]" : ""
                  }`} />
                </button>

                {expandedOverlaps.surgery && (
                  <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                    <div className="mt-4 pl-3.5 border-l-2 border-[#ff9f43] space-y-5">
                      <div className="space-y-2">
                        <strong className="text-xs block">
                          Cured / one-time (Cataract, Kidney stones) — the surgery is the key declaration.
                        </strong>
                        <div className="space-y-1">
                          <span className={`block text-[10px] uppercase font-bold tracking-wider ${theme === "dark" ? "text-[#9fcbff]" : "text-stone-500"}`}>
                            Declaration Options
                          </span>
                          <ol className={`list-decimal pl-4 text-xs font-semibold ${theme === "dark" ? "text-stone-400" : "text-stone-600"}`}>
                            <li>Surgeries Q or Organ / System Q <span className="text-emerald-500 dark:text-emerald-400 font-extrabold">(PED Q is optional)</span></li>
                          </ol>
                        </div>
                        <span className={`inline-block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                          theme === "dark" ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                        }`}>
                          <span className="text-[#3b9eff] font-bold">Care:</span> Surgery Q = Yes + surgery name in <strong>Others</strong>
                        </span>
                      </div>
                      <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-4 space-y-2">
                        <strong className="text-xs block">
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
                          <span className="text-[#3b9eff] font-bold">Care:</span> PED/Organ Q = Yes → Surgery Q = Yes → Others = PED name <span className="text-red-500 font-extrabold">(mandatory)</span> + surgery name <span className="text-[#2ed573] font-bold">(optional)</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* CARD 4: PED × Hospitalization */}
              <div className={`border rounded-2xl overflow-hidden transition-all duration-300 ${
                theme === "dark" ? "bg-[#10233a]" : "bg-white shadow-xs"
              } ${
                expandedOverlaps.hospitalization
                  ? "border-[#2ed573]/50 ring-1 ring-[#2ed573]/20"
                  : theme === "dark" ? "border-white/10" : "border-stone-250"
              } ${
                isFocused && !expandedOverlaps.hospitalization ? "opacity-30 hover:opacity-60 scale-[0.98]" : "opacity-100"
              }`}>
                <button
                  onClick={() => toggleOverlap("hospitalization")}
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
                    <div className={`text-base font-black ${theme === "dark" ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                      PED × Hospitalization
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                    expandedOverlaps.hospitalization ? "transform rotate-180 text-[#2ed573]" : ""
                  }`} />
                </button>

                {expandedOverlaps.hospitalization && (
                  <div className={`px-4 pb-5 border-t ${theme === "dark" ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"}`}>
                    <div className="mt-4 pl-3.5 border-l-2 border-[#2ed573] space-y-5">
                      <div className="space-y-2">
                        <strong className="text-xs block">
                          Non-active PED — one-time &amp; not organ-related (Dengue, COVID, Viral fever).
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
                      <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-4 space-y-2">
                        <strong className="text-xs block">
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
                          <span className="text-[#3b9eff] font-bold">Care:</span> PED/Organ Q = Yes → Hospitalization Q = Yes → Others = PED name <span className="text-red-500 font-extrabold">(mandatory)</span> + details <span className="text-[#2ed573] font-bold">(optional)</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>

        </div>{/* end RIGHT COLUMN */}

      </div>{/* end TWO-SECTION LAYOUT */}
    </motion.div>
  );
};

export default DeclarationAssistantResults;
