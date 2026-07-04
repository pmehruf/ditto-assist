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
  RotateCcw,
  Edit3,
  ChevronDown,
  X,
  List,
} from "lucide-react";
import { SpecificIllnessLedgerCard } from "./SpecificIllnessLedgerCard";
import { MatchOutput, PlanConfig } from "../types.js";
import { ReportingItem } from "../types/lookup";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ResultItem {
  ped: string;
  result: MatchOutput;
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

type DrawerMode = null | "pj" | "si";

// ─────────────────────────────────────────────
// Match-type color helpers
// ─────────────────────────────────────────────
function getMatchColors(matchType: string, dark: boolean) {
  switch (matchType) {
    case "P0":
    case "ESCALATE":
      return {
        label: matchType === "P0" ? "P0 — Direct" : "Escalate",
        accent: dark ? "#f87171" : "#dc2626",
        badgeBg: dark ? "rgba(239,68,68,0.14)" : "rgba(254,226,226,0.85)",
        badgeBorder: dark ? "rgba(239,68,68,0.32)" : "rgba(239,68,68,0.28)",
        cardBg: dark
          ? "linear-gradient(150deg, rgba(239,68,68,0.10) 0%, rgba(12,4,4,0) 55%)"
          : "linear-gradient(150deg, #fee2e2 0%, #fef2f2 100%)",
        cardBorder: dark ? "rgba(239,68,68,0.34)" : "rgba(239,68,68,0.42)",
        headerBg: dark
          ? "linear-gradient(90deg, rgba(239,68,68,0.18) 0%, transparent 100%)"
          : "linear-gradient(90deg, rgba(239,68,68,0.16) 0%, transparent 100%)",
        leftBorder: dark ? "#f87171" : "#ef4444",
        shadow: dark ? "0 4px 24px rgba(239,68,68,0.10)" : "0 2px 16px rgba(239,68,68,0.10)",
        divider: dark ? "rgba(239,68,68,0.18)" : "rgba(239,68,68,0.14)",
        questionColor: dark ? "#fecaca" : "#7f1d1d",
        logicBg: dark ? "rgba(239,68,68,0.04)" : "rgba(255,241,241,0.40)",
      };
    case "P1":
      return {
        label: "P1 — Organ/System",
        accent: dark ? "#34d399" : "#059669",
        badgeBg: dark ? "rgba(16,185,129,0.14)" : "rgba(209,250,229,0.85)",
        badgeBorder: dark ? "rgba(16,185,129,0.30)" : "rgba(16,185,129,0.26)",
        cardBg: dark
          ? "linear-gradient(150deg, rgba(16,185,129,0.09) 0%, rgba(3,10,5,0) 55%)"
          : "linear-gradient(150deg, #d1fae5 0%, #ecfdf5 100%)",
        cardBorder: dark ? "rgba(16,185,129,0.32)" : "rgba(16,185,129,0.40)",
        headerBg: dark
          ? "linear-gradient(90deg, rgba(16,185,129,0.16) 0%, transparent 100%)"
          : "linear-gradient(90deg, rgba(16,185,129,0.14) 0%, transparent 100%)",
        leftBorder: dark ? "#34d399" : "#10b981",
        shadow: dark ? "0 4px 24px rgba(16,185,129,0.08)" : "0 2px 16px rgba(16,185,129,0.09)",
        divider: dark ? "rgba(16,185,129,0.16)" : "rgba(16,185,129,0.13)",
        questionColor: dark ? "#a7f3d0" : "#064e3b",
        logicBg: dark ? "rgba(16,185,129,0.04)" : "rgba(240,253,244,0.50)",
      };
    case "P2":
      return {
        label: "P2 — Related",
        accent: dark ? "#22d3ee" : "#0891b2",
        badgeBg: dark ? "rgba(34,211,238,0.13)" : "rgba(207,250,254,0.85)",
        badgeBorder: dark ? "rgba(34,211,238,0.28)" : "rgba(34,211,238,0.25)",
        cardBg: dark
          ? "linear-gradient(150deg, rgba(34,211,238,0.08) 0%, rgba(3,10,15,0) 55%)"
          : "linear-gradient(150deg, #cffafe 0%, #ecfeff 100%)",
        cardBorder: dark ? "rgba(34,211,238,0.28)" : "rgba(34,211,238,0.38)",
        headerBg: dark
          ? "linear-gradient(90deg, rgba(34,211,238,0.14) 0%, transparent 100%)"
          : "linear-gradient(90deg, rgba(34,211,238,0.13) 0%, transparent 100%)",
        leftBorder: dark ? "#22d3ee" : "#06b6d4",
        shadow: dark ? "0 4px 24px rgba(34,211,238,0.07)" : "0 2px 16px rgba(34,211,238,0.08)",
        divider: dark ? "rgba(34,211,238,0.15)" : "rgba(34,211,238,0.12)",
        questionColor: dark ? "#a5f3fc" : "#164e63",
        logicBg: dark ? "rgba(34,211,238,0.04)" : "rgba(236,254,255,0.50)",
      };
    case "NON_AILMENT":
      return {
        label: "Non-Ailment",
        accent: dark ? "#c084fc" : "#9333ea",
        badgeBg: dark ? "rgba(168,85,247,0.14)" : "rgba(237,233,254,0.85)",
        badgeBorder: dark ? "rgba(168,85,247,0.30)" : "rgba(168,85,247,0.26)",
        cardBg: dark
          ? "linear-gradient(150deg, rgba(168,85,247,0.09) 0%, rgba(8,4,14,0) 55%)"
          : "linear-gradient(150deg, #ede9fe 0%, #f5f3ff 100%)",
        cardBorder: dark ? "rgba(168,85,247,0.30)" : "rgba(168,85,247,0.40)",
        headerBg: dark
          ? "linear-gradient(90deg, rgba(168,85,247,0.16) 0%, transparent 100%)"
          : "linear-gradient(90deg, rgba(168,85,247,0.15) 0%, transparent 100%)",
        leftBorder: dark ? "#c084fc" : "#a855f7",
        shadow: dark ? "0 4px 24px rgba(168,85,247,0.08)" : "0 2px 16px rgba(168,85,247,0.08)",
        divider: dark ? "rgba(168,85,247,0.16)" : "rgba(168,85,247,0.13)",
        questionColor: dark ? "#e9d5ff" : "#4c1d95",
        logicBg: dark ? "rgba(168,85,247,0.04)" : "rgba(250,245,255,0.50)",
      };
    case "FALLBACK":
    default:
      return {
        label: "Fallback",
        accent: dark ? "#fbbf24" : "#d97706",
        badgeBg: dark ? "rgba(245,158,11,0.14)" : "rgba(254,243,199,0.85)",
        badgeBorder: dark ? "rgba(245,158,11,0.30)" : "rgba(245,158,11,0.26)",
        cardBg: dark
          ? "linear-gradient(150deg, rgba(245,158,11,0.09) 0%, rgba(14,10,3,0) 55%)"
          : "linear-gradient(150deg, #fef3c7 0%, #fffbeb 100%)",
        cardBorder: dark ? "rgba(245,158,11,0.30)" : "rgba(245,158,11,0.40)",
        headerBg: dark
          ? "linear-gradient(90deg, rgba(245,158,11,0.16) 0%, transparent 100%)"
          : "linear-gradient(90deg, rgba(245,158,11,0.15) 0%, transparent 100%)",
        leftBorder: dark ? "#fbbf24" : "#f59e0b",
        shadow: dark ? "0 4px 24px rgba(245,158,11,0.08)" : "0 2px 16px rgba(245,158,11,0.08)",
        divider: dark ? "rgba(245,158,11,0.16)" : "rgba(245,158,11,0.13)",
        questionColor: dark ? "#fde68a" : "#451a03",
        logicBg: dark ? "rgba(245,158,11,0.04)" : "rgba(255,251,235,0.50)",
      };
  }
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export const DeclarationAssistantResults: React.FC<DeclarationAssistantResultsProps> = ({
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
  const dark = theme === "dark";

  // ── State ──
  const [expandedUmbrellas, setExpandedUmbrellas] = React.useState<Record<number, boolean>>({});
  const [expandedOverlaps, setExpandedOverlaps] = React.useState<Record<string, boolean>>({
    medication: false,
    investigation: false,
    surgery: false,
    hospitalization: false,
  });
  // Kept for API compat — logic now always inline
  const [expandedLogics] = React.useState<Record<number, boolean>>({});
  void expandedLogics;

  // Drawer: one shared panel, mode = "pj" | "si" | null
  const [drawerMode, setDrawerMode] = React.useState<DrawerMode>(null);
  const [activeSIBadgePed, setActiveSIBadgePed] = React.useState<string | null>(null);
  const [showSIList, setShowSIList] = React.useState(false);

  const isFocused =
    Object.values(expandedOverlaps).some((v) => v) &&
    !Object.values(expandedOverlaps).every((v) => v);

  const toggleOverlap = (id: string) =>
    setExpandedOverlaps((prev) => ({ ...prev, [id]: !prev[id] }));

  const planConfig = planConfigs?.[selectedPlan];

  const togglePJDrawer = () => {
    if (drawerMode === "pj") {
      setDrawerMode(null);
    } else {
      setDrawerMode("pj");
      setActiveSIBadgePed(null);
      setShowSIList(false);
    }
  };

  const handleSIBadgeClick = (ped: string) => {
    if (drawerMode === "si" && activeSIBadgePed === ped) {
      setDrawerMode(null);
      setActiveSIBadgePed(null);
      setShowSIList(false);
    } else {
      setActiveSIBadgePed(ped);
      setDrawerMode("si");
      setShowSIList(false);
    }
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setActiveSIBadgePed(null);
    setShowSIList(false);
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <motion.div
      key="results-layout"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 15 }}
      className="flex flex-col gap-3 w-full box-border font-sans"
    >

      {/* ═══════════════════════════════════════
          TOP CONTEXT BAR
      ═══════════════════════════════════════ */}
      <div
        style={{
          backgroundColor: dark ? "rgba(0,211,243,0.04)" : "rgba(7,84,183,0.03)",
          borderColor: dark ? "rgba(0,211,243,0.15)" : "rgba(7,84,183,0.18)",
        }}
        className="flex items-center justify-between gap-4 select-none flex-wrap px-4 py-2.5 rounded-xl border"
      >
        {/* Left: plan badge + count */}
        <div className="flex items-center gap-2.5">
          <CheckCircle2 style={{ color: "var(--accent)" }} className="w-4 h-4 shrink-0" />
          <div className="flex items-center gap-2 flex-wrap">
            {selectedPlan && (
              <span
                style={{
                  backgroundColor: dark ? "rgba(0,211,243,0.10)" : "rgba(7,84,183,0.08)",
                  borderColor: dark ? "rgba(0,211,243,0.28)" : "rgba(7,84,183,0.22)",
                  color: dark ? "#00D3F3" : "#0754b7",
                }}
                className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border"
              >
                {selectedPlan}
              </span>
            )}
            {lookupPeds.length > 0 && (
              <span className={`text-[10px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                {lookupPeds.length} condition{lookupPeds.length > 1 ? "s" : ""} mapped
              </span>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMapAnotherPed}
            className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
              dark
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
            className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
              dark
                ? "border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            }`}
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>
      </div>


      {/* ═══════════════════════════════════════
          MAIN RESULTS AREA + SLIDE-IN DRAWER
      ═══════════════════════════════════════ */}
      <div
        ref={resultsRef}
        className="flex gap-3 w-full min-h-0 overflow-hidden"
        style={{ maxHeight: "calc(100vh - 195px)", minHeight: "360px" }}
      >

        {/* ── LEFT SIDEBAR: OVERLAP CARDS ── */}
        <div
          className="w-[208px] shrink-0 flex flex-col gap-2 overflow-y-auto custom-scrollbar pb-1"
          style={{ scrollbarGutter: "stable" }}
        >
          {/* Sidebar label */}
          <div className="flex items-center gap-1.5 px-1 py-1 shrink-0">
            <Layers style={{ color: "var(--accent)" }} className="w-3 h-3 shrink-0" />
            <span className={`text-[9px] font-black uppercase tracking-widest select-none ${dark ? "text-stone-500" : "text-stone-400"}`}>
              Overlap Rules
            </span>
          </div>

          {/* CARD: PED × Medication */}
          <div
            className={`border rounded-xl overflow-hidden transition-all duration-200 shrink-0 ${
              dark ? "bg-[#0f1f35]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.medication
                ? "border-[#3b9eff]/45"
                : dark ? "border-white/8" : "border-stone-200"
            } ${isFocused && !expandedOverlaps.medication ? "opacity-30 hover:opacity-70" : "opacity-100"}`}
          >
            <button onClick={() => toggleOverlap("medication")} className="w-full text-left p-3 flex gap-2 items-center bg-transparent focus:outline-none cursor-pointer">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 border ${dark ? "bg-white/5 text-[#3b9eff] border-[#3b9eff]/28" : "bg-[#E1EAF7] text-[#1D63ED] border-[#3b9eff]/40"}`}>💊</div>
              <span className={`text-[11px] font-black flex-1 truncate ${dark ? "text-[#daeeff]" : "text-stone-800"}`}>PED × Medication</span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-stone-400 ${expandedOverlaps.medication ? "rotate-180 text-[#3b9eff]" : ""}`} />
            </button>
            {expandedOverlaps.medication && (
              <div className={`px-3 pb-3 border-t text-[10px] leading-relaxed ${dark ? "border-white/5" : "border-stone-100 bg-[#f8fafd]"}`}>
                <div className="mt-2.5 pl-3 border-l-2 border-[#3b9eff] space-y-2">
                  <p className={dark ? "text-stone-300" : "text-stone-700"}><strong>Declare both</strong> PED + medication. Format: "Medications of [condition] going on" — drug name not required.</p>
                  <ol className={`list-decimal pl-3.5 space-y-0.5 font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                    <li>PED Q + Meds in same question</li>
                    <li>PED Q + Meds in umbrella Meds Q</li>
                    <li>PED Q + Meds in Others</li>
                  </ol>
                  <span className={`inline-block text-[10px] font-semibold border rounded-lg px-2 py-1 ${dark ? "bg-white/4 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-200 text-[#1E293B]"}`}>
                    <span className="text-[#3b9eff] font-bold">Care:</span> PED Q = Yes + meds in <strong>Others</strong>
                  </span>
                  <p className={`text-[10px] ${dark ? "text-stone-400" : "text-stone-600"}`}>Missing-medication flag raised for <strong>Diabetes · Cholesterol · HTN · Thyroid</strong> if no medication declared.</p>
                </div>
              </div>
            )}
          </div>

          {/* CARD: PED × Hospitalization */}
          <div
            className={`border rounded-xl overflow-hidden transition-all duration-200 shrink-0 ${
              dark ? "bg-[#0f1f35]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.hospitalization
                ? "border-[#2ed573]/45"
                : dark ? "border-white/8" : "border-stone-200"
            } ${isFocused && !expandedOverlaps.hospitalization ? "opacity-30 hover:opacity-70" : "opacity-100"}`}
          >
            <button onClick={() => toggleOverlap("hospitalization")} className="w-full text-left p-3 flex gap-2 items-center bg-transparent focus:outline-none cursor-pointer">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 border ${dark ? "bg-white/5 text-[#2ed573] border-[#2ed573]/28" : "bg-[#E1F7E8] text-[#0F766E] border-[#2ed573]/40"}`}>🛏️</div>
              <span className={`text-[11px] font-black flex-1 truncate ${dark ? "text-[#daeeff]" : "text-stone-800"}`}>PED × Hospitalization</span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-stone-400 ${expandedOverlaps.hospitalization ? "rotate-180 text-[#2ed573]" : ""}`} />
            </button>
            {expandedOverlaps.hospitalization && (
              <div className={`px-3 pb-3 border-t text-[10px] leading-relaxed ${dark ? "border-white/5" : "border-stone-100 bg-[#f8fafd]"}`}>
                <div className="mt-2.5 pl-3 border-l-2 border-[#2ed573] space-y-3">
                  <div><strong className="block mb-1">Non-active PED (Dengue, COVID, Viral fever):</strong>
                    <ol className={`list-decimal pl-3.5 font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}><li>Hospitalization Q only</li></ol>
                    <span className={`inline-block mt-1 text-[10px] font-semibold border rounded-lg px-2 py-1 ${dark ? "bg-white/4 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-200 text-[#1E293B]"}`}><span className="text-[#3b9eff] font-bold">Care:</span> Hosp Q = Yes + details in Others</span>
                  </div>
                  <div><strong className="block mb-1">Active-PED-linked hospitalization:</strong>
                    <ol className={`list-decimal pl-3.5 font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                      <li>PED in PED/Organ/System Q is <span className="text-red-500 font-extrabold">mandatory</span></li>
                      <li>Hospitalization in same Q / umbrella Hosp Q / Others</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CARD: PED × Investigative Tests */}
          <div
            className={`border rounded-xl overflow-hidden transition-all duration-200 shrink-0 ${
              dark ? "bg-[#0f1f35]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.investigation
                ? "border-[#b07cff]/45"
                : dark ? "border-white/8" : "border-stone-200"
            } ${isFocused && !expandedOverlaps.investigation ? "opacity-30 hover:opacity-70" : "opacity-100"}`}
          >
            <button onClick={() => toggleOverlap("investigation")} className="w-full text-left p-3 flex gap-2 items-center bg-transparent focus:outline-none cursor-pointer">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 border ${dark ? "bg-white/5 text-[#b07cff] border-[#b07cff]/28" : "bg-[#EBE1F7] text-[#7C3AED] border-[#b07cff]/40"}`}>🔬</div>
              <span className={`text-[11px] font-black flex-1 truncate ${dark ? "text-[#daeeff]" : "text-stone-800"}`}>PED × Investigative Tests</span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-stone-400 ${expandedOverlaps.investigation ? "rotate-180 text-[#b07cff]" : ""}`} />
            </button>
            {expandedOverlaps.investigation && (
              <div className={`px-3 pb-3 border-t text-[10px] leading-relaxed ${dark ? "border-white/5" : "border-stone-100 bg-[#f8fafd]"}`}>
                <div className="mt-2.5 pl-3 border-l-2 border-[#b07cff] space-y-2">
                  <div className={`p-2 rounded-lg border font-semibold ${dark ? "bg-[#ff5a6e]/8 border-[#ff5a6e]/40 text-[#ffd9df]" : "bg-red-50 border-red-200 text-red-800"}`}>
                    ⚠ Mandatory: disclose <strong>with or without</strong> diagnosis, findings, or reports.
                  </div>
                  <p className={dark ? "text-stone-300" : "text-stone-700"}><strong>Exception:</strong> test done only to diagnose an already-declared PED need not be named.</p>
                  <div className={`p-2 rounded-lg border ${dark ? "bg-stone-950/20 border-white/5" : "bg-white border-stone-200"}`}>
                    <strong className="block mb-0.5">7 critical tests — name exactly:</strong>
                    <p className="font-mono text-[9px] text-indigo-500 dark:text-blue-300 font-extrabold">Angiography · TRT · ECG · MRI · Endoscopy · Colonoscopy · USG</p>
                  </div>
                  <p className={dark ? "text-stone-400" : "text-stone-600"}>Any other test → <strong>"Medical tests were done."</strong></p>
                </div>
              </div>
            )}
          </div>

          {/* CARD: PED × Surgery */}
          <div
            className={`border rounded-xl overflow-hidden transition-all duration-200 shrink-0 ${
              dark ? "bg-[#0f1f35]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.surgery
                ? "border-[#ff9f43]/45"
                : dark ? "border-white/8" : "border-stone-200"
            } ${isFocused && !expandedOverlaps.surgery ? "opacity-30 hover:opacity-70" : "opacity-100"}`}
          >
            <button onClick={() => toggleOverlap("surgery")} className="w-full text-left p-3 flex gap-2 items-center bg-transparent focus:outline-none cursor-pointer">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 border ${dark ? "bg-white/5 text-[#ff9f43] border-[#ff9f43]/28" : "bg-[#FEF3C7] text-[#D97706] border-[#ff9f43]/40"}`}>🔪</div>
              <span className={`text-[11px] font-black flex-1 truncate ${dark ? "text-[#daeeff]" : "text-stone-800"}`}>PED × Surgery</span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform text-stone-400 ${expandedOverlaps.surgery ? "rotate-180 text-[#ff9f43]" : ""}`} />
            </button>
            {expandedOverlaps.surgery && (
              <div className={`px-3 pb-3 border-t text-[10px] leading-relaxed ${dark ? "border-white/5" : "border-stone-100 bg-[#f8fafd]"}`}>
                <div className="mt-2.5 pl-3 border-l-2 border-[#ff9f43] space-y-3">
                  <div><strong className="block mb-1">Cured/one-time (Cataract, Kidney stones):</strong>
                    <ol className={`list-decimal pl-3.5 font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}><li>Surgeries Q or Organ/System Q <span className="text-emerald-500 font-extrabold">(PED Q optional)</span></li></ol>
                    <span className={`inline-block mt-1 text-[10px] font-semibold border rounded-lg px-2 py-1 ${dark ? "bg-white/4 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-200 text-[#1E293B]"}`}><span className="text-[#3b9eff] font-bold">Care:</span> Surgery Q = Yes + name in Others</span>
                  </div>
                  <div><strong className="block mb-1">Linked to active PED (Angioplasty + heart):</strong>
                    <ol className={`list-decimal pl-3.5 font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                      <li>PED in PED/Organ/System Q is <span className="text-red-500 font-black">mandatory</span></li>
                      <li>Surgery in same Q / umbrella Surgery Q / Others</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>{/* end overlap sidebar */}

        {/* ── MAPPING RESULTS CARD ── */}
        <div
          ref={mappingResultCardRef}
          style={{
            background: dark
              ? "linear-gradient(160deg, #0a1e32 0%, #061525 45%, #030e18 100%)"
              : "linear-gradient(160deg, #f0f6ff 0%, #ffffff 50%, #f5f8ff 100%)",
            borderColor: dark ? "rgba(0,211,243,0.20)" : "rgba(7,84,183,0.20)",
            boxShadow: dark
              ? "0 8px 40px rgba(0,0,0,0.50), 0 0 28px rgba(0,211,243,0.07)"
              : "0 4px 32px rgba(7,84,183,0.10)",
          }}
          className="flex-1 min-w-0 rounded-2xl overflow-hidden flex flex-col border relative transition-all"
        >
          {/* Ambient glow — Declaration Map style */}
          <div
            className="absolute top-0 right-0 w-80 h-56 rounded-full blur-3xl pointer-events-none"
            style={{ background: dark ? "rgba(0,211,243,0.05)" : "rgba(7,84,183,0.04)" }}
          />
          <div
            className="absolute bottom-0 left-0 w-64 h-40 rounded-full blur-3xl pointer-events-none"
            style={{ background: dark ? "rgba(88,163,255,0.04)" : "rgba(7,84,183,0.03)" }}
          />

          {/* Card header */}
          <div
            style={{
              borderColor: dark ? "rgba(0,211,243,0.18)" : "rgba(7,84,183,0.18)",
              background: dark
                ? "linear-gradient(90deg, rgba(0,211,243,0.09) 0%, transparent 70%)"
                : "linear-gradient(90deg, rgba(7,84,183,0.06) 0%, transparent 70%)",
            }}
            className="px-5 py-3 border-b flex items-center gap-2.5 shrink-0 relative"
          >
            <CheckCircle2 style={{ color: "var(--accent)" }} className="w-4 h-4 shrink-0" />
            <span
              className={`text-xs font-black uppercase tracking-widest flex-1 ${
                dark
                  ? "bg-gradient-to-r from-[#00D3F3] via-[#58A3FF] to-[#00D3F3] bg-clip-text text-transparent"
                  : "text-[#04233F]"
              }`}
            >
              Mapping Results
            </span>
            <span
              style={{ color: dark ? "rgba(0,211,243,0.50)" : "rgba(7,84,183,0.50)" }}
              className="text-[9px] font-black uppercase tracking-widest select-none"
            >
              {lookupResults.length > 0 ? `${lookupResults.length} PED${lookupResults.length > 1 ? "s" : ""}` : ""}
            </span>
          </div>

          {/* Caution banner */}
          <div
            style={{
              borderColor: dark ? "rgba(245,158,11,0.22)" : "rgba(245,158,11,0.22)",
              backgroundColor: dark ? "rgba(245,158,11,0.08)" : "rgba(254,251,235,0.70)",
            }}
            className="px-5 py-2 border-b flex items-center gap-2 relative"
          >
            <span className="text-[10px] shrink-0">⚠️</span>
            <span className={`text-[9.5px] uppercase font-black tracking-wide ${dark ? "text-amber-400" : "text-amber-600"}`}>
              Caution: Verify results. Tool can make mistakes.
            </span>
          </div>

          {/* Scrollable result list — flex-1 fills remaining card height */}
          <div
            className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar relative"
            style={{ minHeight: "200px" }}
          >
            {isLookupLoading ? (
              <div className="p-16 text-center flex flex-col justify-center items-center gap-4 min-h-[300px]">
                <RefreshCw className="w-7 h-7 text-[#00D3F3] animate-spin" />
                <p className="text-xs font-bold tracking-wider uppercase animate-pulse text-stone-400">
                  Running mapping algorithms…
                </p>
              </div>
            ) : lookupResults.length > 0 ? (
              <div className="space-y-4 animate-fadeIn">
                {lookupResults.map(({ ped, result, source }, idx) => {
                  const m = getMatchColors(result.match_type, dark);
                  const isFallback =
                    result.match_type === "FALLBACK" ||
                    (planConfig && result.matched_question === planConfig.anyOther);
                  const siMatch = checkIllnessInPlanSpecificList(ped, selectedPlan);
                  const isUmbrellaExpanded = expandedUmbrellas[idx] || false;
                  const isSIActive = drawerMode === "si" && activeSIBadgePed === ped;
                  const isPJActive = drawerMode === "pj";

                  return (
                    <div
                      key={idx}
                      style={{
                        background: m.cardBg,
                        borderColor: m.cardBorder,
                        borderLeftColor: m.leftBorder,
                        boxShadow: m.shadow,
                      }}
                      className="rounded-xl border border-l-[3px] overflow-hidden transition-all duration-150"
                    >
                      {/* ── PED Card Header ── */}
                      <div
                        style={{
                          background: m.headerBg,
                          borderColor: m.divider,
                        }}
                        className="px-4 py-2.5 border-b flex items-center justify-between gap-2 flex-wrap"
                      >
                        {/* Left: badge + name */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            style={{
                              backgroundColor: m.badgeBg,
                              borderColor: m.badgeBorder,
                              color: m.accent,
                            }}
                            className="text-[8.5px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0 select-none"
                          >
                            {m.label}
                          </span>
                          <div
                            className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
                            style={{ backgroundColor: m.accent }}
                          />
                          <span
                            style={{ color: dark ? "#eaf3ff" : "var(--text-heading)" }}
                            className="text-sm font-black tracking-wide truncate"
                          >
                            {ped}
                          </span>
                        </div>

                        {/* Right: SI badge + PJ button */}
                        <div className="flex items-center gap-2 shrink-0">
                          {siMatch && (
                            <button
                              type="button"
                              onClick={() => handleSIBadgeClick(ped)}
                              className={`flex items-center gap-1 text-[8.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded border transition-all cursor-pointer select-none active:scale-95 ${
                                isSIActive
                                  ? "border-amber-400/55 bg-amber-500/18 text-amber-400"
                                  : dark
                                  ? "border-amber-400/28 bg-amber-500/7 text-amber-500/80 hover:border-amber-400/45 hover:text-amber-400"
                                  : "border-amber-400/40 bg-amber-50 text-amber-600 hover:bg-amber-100"
                              }`}
                            >
                              ⚕ Specific Illness
                            </button>
                          )}
                          {selectedPlan && (
                            <button
                              type="button"
                              onClick={togglePJDrawer}
                              className={`flex items-center gap-1.5 text-[8.5px] font-black uppercase tracking-wide px-2.5 py-1 rounded border transition-all cursor-pointer select-none active:scale-95 ${
                                isPJActive
                                  ? "border-[#58A3FF]/45 bg-[#58A3FF]/14 text-[#58A3FF]"
                                  : dark
                                  ? "border-white/[0.10] bg-white/[0.04] text-stone-400 hover:text-stone-300 hover:border-white/15"
                                  : "border-slate-200 bg-white/70 text-slate-500 hover:bg-white"
                              }`}
                            >
                              <Layers className="w-3 h-3" />
                              Journey
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ── PED Card Body: LEFT (mapped question) | RIGHT (logic + buttons) ── */}
                      <div className="flex" style={{ minHeight: "100px" }}>

                        {/* LEFT: Mapped question output — 55% */}
                        <div
                          className="flex flex-col p-5 border-r"
                          style={{
                            flex: "55 55 0%",
                            borderColor: m.divider,
                          }}
                        >
                          {isFallback ? (
                            /* FALLBACK: umbrella accordion + others */
                            <>
                              <div
                                style={{
                                  backgroundColor: dark ? "rgba(0,30,60,0.60)" : "rgba(245,249,255,0.90)",
                                  borderColor: dark ? "rgba(88,163,255,0.18)" : "rgba(7,84,183,0.18)",
                                }}
                                className="rounded-xl border overflow-hidden mb-3"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedUmbrellas((prev) => ({ ...prev, [idx]: !prev[idx] }))
                                  }
                                  style={{
                                    backgroundColor: dark ? "rgba(0,18,40,0.80)" : "rgba(240,247,255,0.90)",
                                  }}
                                  className="w-full p-4 text-left flex items-center justify-between transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                >
                                  <div>
                                    <p
                                      style={{ color: "var(--accent)" }}
                                      className="text-[9.5px] font-black uppercase tracking-widest mb-1"
                                    >
                                      ① Umbrella Questions — Check First
                                    </p>
                                    <p className={`text-[10.5px] italic font-medium ${dark ? "text-stone-400" : "text-stone-600"}`}>
                                      Meds · Tests · Treatment · Hospitalization · Surgery
                                    </p>
                                  </div>
                                  <ChevronDown
                                    className={`w-4 h-4 shrink-0 transition-transform ${isUmbrellaExpanded ? "rotate-180" : ""}`}
                                    style={{ color: "var(--text-secondary)" }}
                                  />
                                </button>
                                {isUmbrellaExpanded && (
                                  <div className="px-4 pb-4 space-y-2">
                                    {planConfig?.umbrellaQuestions && planConfig.umbrellaQuestions.length > 0 ? (
                                      planConfig.umbrellaQuestions.map((uq: string, k: number) => (
                                        <div
                                          key={k}
                                          style={{
                                            backgroundColor: "var(--panel-bg-strong)",
                                            borderColor: "var(--panel-border-strong)",
                                            color: dark ? "#FFFFFF" : "var(--text-primary)",
                                          }}
                                          className="p-3 rounded-lg border flex items-start gap-2 text-xs font-semibold leading-relaxed"
                                        >
                                          <span className="text-blue-500 mt-0.5 shrink-0">☂</span>
                                          <span>{uq}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <div
                                        style={{
                                          backgroundColor: "var(--panel-bg-strong)",
                                          borderColor: "var(--panel-border-strong)",
                                          color: "var(--text-secondary)",
                                        }}
                                        className="p-3 rounded-lg border text-xs font-semibold leading-relaxed"
                                      >
                                        Generic: medication, prolonged treatment, hospitalization, or surgical advice umbrella questions.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              <p
                                style={{ color: "var(--text-primary)" }}
                                className="text-[11px] font-semibold leading-relaxed px-1 mb-3"
                              >
                                If umbrella questions don't apply, proceed with Others Section:
                              </p>

                              <div
                                style={{
                                  backgroundColor: dark ? "rgba(0,18,40,0.80)" : "rgba(240,247,255,0.90)",
                                  borderColor: dark ? "rgba(88,163,255,0.18)" : "rgba(7,84,183,0.18)",
                                }}
                                className="p-4 rounded-xl border"
                              >
                                <p
                                  style={{ color: m.accent }}
                                  className="text-[9.5px] font-black uppercase tracking-widest mb-2"
                                >
                                  ② Others Section (Last Option)
                                </p>
                                <p
                                  style={{ color: dark ? "#FFFFFF" : "var(--text-primary)" }}
                                  className="text-xs font-bold leading-relaxed"
                                >
                                  {result.matched_question ||
                                    planConfig?.anyOther ||
                                    "Any other disease/condition not mentioned above?"}
                                </p>
                              </div>
                            </>
                          ) : (
                            /* NON-FALLBACK: prominent mapped question */
                            <div className="flex flex-col h-full justify-center gap-2">
                              <div className="flex items-center gap-1.5 select-none">
                                <Check className="w-3.5 h-3.5 shrink-0" style={{ color: m.accent }} />
                                <span
                                  style={{ color: m.accent }}
                                  className="text-[9px] font-black uppercase tracking-widest"
                                >
                                  Mapped Declaration Question
                                </span>
                              </div>
                              <p
                                style={{ color: m.questionColor }}
                                className="text-sm font-bold leading-relaxed font-sans text-balance"
                              >
                                {result.matched_question}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* RIGHT: Mapping logic + buttons — 45% */}
                        <div
                          className="flex flex-col p-4 gap-3"
                          style={{
                            flex: "45 45 0%",
                            backgroundColor: dark ? m.logicBg : undefined,
                          }}
                        >
                          {/* Logic label */}
                          <div className="flex items-center gap-1.5 select-none">
                            <FileText className="w-3 h-3 shrink-0" style={{ color: m.accent }} />
                            <span
                              style={{ color: m.accent }}
                              className="text-[9px] font-black uppercase tracking-widest"
                            >
                              Mapping Logic
                            </span>
                          </div>

                          {/* Logic text — always visible, no accordion */}
                          <p
                            className="text-[10.5px] leading-relaxed font-sans flex-1"
                            style={{ color: dark ? "#94a3b8" : "#475569" }}
                          >
                            {result.explanation}
                          </p>

                          {/* Tags row */}
                          <div className="flex flex-wrap gap-1.5">
                            {source && (
                              <span
                                style={{
                                  backgroundColor: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                                  borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                                  color: dark ? "#64748b" : "#64748b",
                                }}
                                className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border select-none"
                              >
                                {source}
                              </span>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: m.divider }}>
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
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide bg-red-600 hover:bg-red-700 text-white transition-all cursor-pointer select-none active:scale-95 shadow-sm"
                            >
                              <Flag className="w-3 h-3" />
                              Flag
                            </button>
                          </div>
                        </div>

                      </div>{/* end body flex */}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Empty state */
              <div className="p-10 text-center flex flex-col items-center justify-center gap-5 min-h-[280px]">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: dark ? "rgba(0,211,243,0.05)" : "rgba(7,84,183,0.05)",
                    borderColor: dark ? "rgba(0,211,243,0.12)" : "rgba(7,84,183,0.12)",
                    border: "1px solid",
                  }}
                >
                  <Search className="w-5 h-5 animate-pulse" style={{ color: "var(--accent)" }} />
                </div>
                <div className="space-y-1.5 max-w-xs mx-auto">
                  <h3 className={`text-sm font-black ${dark ? "text-stone-300" : "text-stone-700"}`}>
                    Awaiting Mapping Evaluation
                  </h3>
                  <p className="text-xs leading-relaxed font-semibold text-stone-500">
                    Select a policy and add patient declarations to begin.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>{/* end mapping results card */}


        {/* ── SLIDE-IN DRAWER (PJ / SI) ── */}
        <AnimatePresence>
          {drawerMode !== null && (
            <motion.div
              ref={sidebarRef}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 348, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="overflow-hidden shrink-0"
            >
              <div
                className="w-[348px] rounded-2xl border overflow-hidden flex flex-col"
                style={{
                  background: dark
                    ? "linear-gradient(160deg, #0b2240 0%, #071830 100%)"
                    : "linear-gradient(160deg, #f0f5ff 0%, #ffffff 100%)",
                  borderColor:
                    drawerMode === "pj"
                      ? dark ? "rgba(88,163,255,0.28)" : "rgba(7,84,183,0.22)"
                      : dark ? "rgba(245,158,11,0.28)" : "rgba(245,158,11,0.22)",
                  boxShadow:
                    drawerMode === "pj"
                      ? dark ? "0 8px 32px rgba(0,0,0,0.35), 0 0 24px rgba(88,163,255,0.08)" : "0 4px 24px rgba(7,84,183,0.10)"
                      : dark ? "0 8px 32px rgba(0,0,0,0.35), 0 0 24px rgba(245,158,11,0.06)" : "0 4px 24px rgba(245,158,11,0.10)",
                }}
              >
                {/* Drawer header */}
                <div
                  ref={rightHeaderRef}
                  style={{
                    borderColor:
                      drawerMode === "pj"
                        ? dark ? "rgba(88,163,255,0.20)" : "rgba(7,84,183,0.18)"
                        : dark ? "rgba(245,158,11,0.20)" : "rgba(245,158,11,0.18)",
                    background:
                      drawerMode === "pj"
                        ? dark ? "linear-gradient(90deg, rgba(88,163,255,0.10) 0%, transparent 100%)" : "linear-gradient(90deg, rgba(7,84,183,0.06) 0%, transparent 100%)"
                        : dark ? "linear-gradient(90deg, rgba(245,158,11,0.10) 0%, transparent 100%)" : "linear-gradient(90deg, rgba(245,158,11,0.06) 0%, transparent 100%)",
                  }}
                  className="px-4 py-3 border-b flex items-center justify-between shrink-0"
                >
                  <span
                    className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 select-none ${
                      dark
                        ? drawerMode === "pj"
                          ? "bg-gradient-to-r from-[#00D3F3] to-[#58A3FF] bg-clip-text text-transparent"
                          : "text-amber-400"
                        : drawerMode === "pj"
                        ? "text-[#04233F]"
                        : "text-amber-700"
                    }`}
                  >
                    {drawerMode === "pj" ? (
                      <>
                        <Layers style={{ color: "var(--accent)" }} className="w-4 h-4 shrink-0" />
                        Payment Journey Questions
                      </>
                    ) : (
                      <>
                        <Activity className="w-4 h-4 shrink-0 text-amber-400" />
                        Specific Illness
                      </>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {drawerMode === "pj" && selectedPlan && (
                      <span style={{ color: "var(--accent)" }} className="text-[9.5px] font-black uppercase tracking-widest">
                        {selectedPlan}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={closeDrawer}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                        dark ? "text-stone-400 hover:text-stone-200 hover:bg-white/5" : "text-stone-400 hover:text-stone-600 hover:bg-black/5"
                      }`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Drawer content */}
                {drawerMode === "pj" ? (
                  /* ─── PAYMENT JOURNEY TABLE ─── */
                  <div className="overflow-y-auto w-full custom-scrollbar" style={{ maxHeight: "65vh" }}>
                    <table className="w-full text-left border-collapse font-sans">
                      <thead>
                        <tr
                          style={{
                            backgroundColor: "var(--panel-bg)",
                            borderColor: "var(--panel-border)",
                          }}
                          className="border-b"
                        >
                          <th
                            style={{
                              borderColor: "var(--panel-border)",
                              color: dark ? "#FFFFFF" : "var(--text-heading)",
                            }}
                            className="py-2.5 px-4 text-center font-black tracking-wider text-[9.5px] uppercase border-r w-14"
                          >
                            No.
                          </th>
                          <th
                            style={{ color: dark ? "#FFFFFF" : "var(--text-heading)" }}
                            className="py-2.5 px-4 font-black tracking-wider text-[9.5px] uppercase"
                          >
                            Declaration Question
                          </th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${dark ? "divide-[#1F4A7A]" : "divide-slate-200"}`}>
                        {(() => {
                          const cfg = planConfigs?.[selectedPlan] || { questions: [] };
                          const questionsList = cfg.questions || [];
                          if (questionsList.length === 0) {
                            return (
                              <tr>
                                <td colSpan={2} className="py-8 text-center text-xs text-stone-400 font-sans">
                                  No questions configured for this plan.
                                </td>
                              </tr>
                            );
                          }

                          return questionsList.map((question: string, i: number) => {
                            const questionId = i + 1;
                            const normalizedItem = question.toLowerCase().trim();
                            const isUmbrella = cfg?.umbrellaQuestions?.some(
                              (uq: string) => uq.toLowerCase().trim() === normalizedItem
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
                                const normC7 = (result.matched_question || "").toLowerCase().trim();
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
                                highlightClass = dark ? "bg-purple-900/40" : "bg-purple-50";
                                borderLeftStyle = "border-l-purple-500 border-l-[4px]";
                                textClass = dark ? "text-purple-400 font-extrabold" : "text-purple-900 font-bold";
                              } else if (isFallbackOthersHighlight) {
                                highlightClass = dark ? "bg-amber-900/30" : "bg-amber-50";
                                borderLeftStyle = "border-l-amber-500 border-l-[4px]";
                                textClass = dark ? "text-amber-400 font-extrabold" : "text-amber-900 font-bold";
                              } else {
                                highlightClass = dark ? "bg-blue-900/40" : "bg-blue-50/70";
                                borderLeftStyle = "border-sky-400 border-l-[4px]";
                                textClass = dark ? "text-sky-400 font-extrabold" : "text-blue-900 font-bold";
                              }
                            } else {
                              highlightClass = dark ? "bg-[#11365A]" : "bg-white";
                              textClass = dark ? "text-slate-350" : "text-slate-800";
                            }

                            let indicatorText = `Q${questionId}`;
                            if (isMatch) {
                              if (isFallbackUmbrellaHighlight) indicatorText = `Q${matchIdx + 1}☂`;
                              else if (isFallbackOthersHighlight) indicatorText = `Q${matchIdx + 1}🌐`;
                              else indicatorText = `Q${matchIdx + 1}`;
                            }

                            return (
                              <tr key={i} className={`transition-all duration-100 ${highlightClass}`}>
                                <td
                                  style={{
                                    borderColor: "var(--panel-border)",
                                    color: dark ? "#FFFFFF" : "var(--text-heading)",
                                  }}
                                  className={`py-3 px-4 text-center border-r border-l-4 font-mono text-[10px] whitespace-nowrap ${borderLeftStyle}`}
                                >
                                  {indicatorText}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex items-start gap-2.5 leading-relaxed font-sans">
                                    {isMatch && (
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 animate-pulse ${
                                          isFallbackUmbrellaHighlight
                                            ? "bg-purple-500"
                                            : isFallbackOthersHighlight
                                            ? "bg-amber-400"
                                            : "bg-[#00D3F3]"
                                        }`}
                                      />
                                    )}
                                    <div
                                      className={`pr-2 tracking-tight ${textClass}`}
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
                ) : (
                  /* ─── SPECIFIC ILLNESS PANEL ─── */
                  <div
                    className="overflow-y-auto p-4 custom-scrollbar space-y-4"
                    style={{ maxHeight: "65vh" }}
                  >
                    {activeSIBadgePed !== null && (() => {
                      const activePed: string = activeSIBadgePed;
                      const match = checkIllnessInPlanSpecificList(activePed, selectedPlan);
                      if (!match) {
                        return (
                          <div className="py-6 text-center">
                            <p className="text-xs text-stone-400 font-semibold">
                              No specific illness mapping found for this PED.
                            </p>
                          </div>
                        );
                      }
                      return (
                        <>
                          {/* PED label */}
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="text-[9px] font-black uppercase tracking-widest text-amber-400 select-none"
                            >
                              PED
                            </span>
                            <span
                              style={{ color: dark ? "#eaf3ff" : "var(--text-heading)" }}
                              className="text-sm font-black truncate"
                            >
                              {activePed}
                            </span>
                          </div>

                          {/* Amber illness info block */}
                          <div
                            style={{
                              backgroundColor: dark ? "rgba(245,158,11,0.08)" : "rgba(254,251,235,0.90)",
                              borderColor: dark ? "rgba(245,158,11,0.28)" : "rgba(245,158,11,0.35)",
                            }}
                            className="p-3.5 rounded-xl border flex flex-col gap-2"
                          >
                            <div className="flex items-center gap-2 text-amber-500 font-extrabold text-[11px]">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                              PED listed under specific illness list
                            </div>
                            <p
                              style={{ color: "var(--text-secondary)" }}
                              className="text-[10.5px] leading-relaxed font-semibold font-sans"
                            >
                              "{activePed.toLowerCase()}" maps to{" "}
                              <span className="text-amber-500 font-bold font-mono">"{match.illness}"</span>{" "}
                              (Category:{" "}
                              <span className="underline decoration-sky-400 underline-offset-2 font-black">
                                {match.category || "General"}
                              </span>
                              ) in {selectedPlan}'s specific illness list.
                            </p>
                          </div>

                          {/* View full list toggle */}
                          <button
                            type="button"
                            onClick={() => setShowSIList((p) => !p)}
                            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[9.5px] font-black uppercase tracking-wider transition-all cursor-pointer active:scale-95 ${
                              dark
                                ? "border-amber-400/22 bg-amber-500/6 text-amber-400 hover:bg-amber-500/12"
                                : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            }`}
                          >
                            <List className="w-3.5 h-3.5" />
                            {showSIList ? "Hide" : "View"} Specific Illness List
                          </button>

                          {showSIList && (
                            <div className="animate-fadeIn">
                              <SpecificIllnessLedgerCard
                                theme={theme}
                                selectedPlan={selectedPlan}
                                illnessSearchQuery={illnessSearchQuery}
                                setIllnessSearchQuery={setIllnessSearchQuery}
                                specificIllnessesDict={specificIllnessesDict}
                              />
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>{/* end results area + drawer */}

      {/* overlap cards moved to left sidebar ↑ */}
      {false && (<div>
      <div className="flex flex-col gap-4">

        {/* ── PAIR 1: Medication + Hospitalization ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* CARD 1: PED × Medication */}
          <div
            className={`border rounded-2xl overflow-hidden transition-all duration-300 flex flex-col ${
              dark ? "bg-[#10233a]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.medication
                ? "border-[#3b9eff]/50 ring-1 ring-[#3b9eff]/20"
                : dark ? "border-white/10" : "border-stone-250"
            } ${
              isFocused && !expandedOverlaps.medication
                ? "opacity-30 hover:opacity-60 scale-[0.98]"
                : "opacity-100"
            }`}
          >
            <button
              onClick={() => toggleOverlap("medication")}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer shrink-0"
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                  dark
                    ? "bg-white/5 text-[#3b9eff] border-[#3b9eff]/30"
                    : "bg-[#E1EAF7] text-[#1D63ED] border-[#3b9eff]/55"
                }`}
              >
                💊
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-base font-black ${dark ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED × Medication
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                  expandedOverlaps.medication ? "rotate-180 text-[#3b9eff]" : ""
                }`}
              />
            </button>

            {expandedOverlaps.medication ? (
              <div
                className={`px-4 pb-5 border-t flex-1 ${
                  dark ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"
                }`}
              >
                <div className="mt-4 pl-3.5 border-l-2 border-[#3b9eff] space-y-4">
                  <div className="space-y-1.5">
                    <p className={`text-xs leading-relaxed ${dark ? "text-stone-300" : "text-stone-750"}`}>
                      <strong>Declare both the PED and the medication.</strong>{" "}
                      Use the general format — "Medications of [condition] going on" — the drug name is not required.
                    </p>
                    <div className="mt-3 space-y-2">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${dark ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                        <li>PED Q + Meds in the <strong>same</strong> question</li>
                        <li>PED Q + Meds in the generic umbrella Meds Q</li>
                        <li>PED Q + Meds in the Others section</li>
                      </ol>
                    </div>
                    <div className="mt-3">
                      <span
                        className={`inline-block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                          dark
                            ? "bg-white/5 border-white/5 text-[#cfe0f5]"
                            : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                        }`}
                      >
                        <span className="text-[#3b9eff] font-bold">Care:</span>{" "}
                        PED Q = Yes + medication in <strong>Others</strong>
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-3.5">
                    <p className={`text-xs leading-relaxed ${dark ? "text-stone-400" : "text-stone-700"}`}>
                      A <strong>missing-medication flag</strong> is raised for{" "}
                      <strong>Diabetes · Cholesterol · Hypertension · Thyroid</strong>{" "}
                      if the PED is declared but no medication is.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-3 opacity-40 select-none">
                <span className="text-[10px] font-semibold text-stone-400">Click to expand</span>
              </div>
            )}
          </div>

          {/* CARD 2: PED × Hospitalization */}
          <div
            className={`border rounded-2xl overflow-hidden transition-all duration-300 flex flex-col ${
              dark ? "bg-[#10233a]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.hospitalization
                ? "border-[#2ed573]/50 ring-1 ring-[#2ed573]/20"
                : dark ? "border-white/10" : "border-stone-250"
            } ${
              isFocused && !expandedOverlaps.hospitalization
                ? "opacity-30 hover:opacity-60 scale-[0.98]"
                : "opacity-100"
            }`}
          >
            <button
              onClick={() => toggleOverlap("hospitalization")}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer shrink-0"
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                  dark
                    ? "bg-white/5 text-[#2ed573] border-[#2ed573]/30"
                    : "bg-[#E1F7E8] text-[#0F766E] border-[#2ed573]/55"
                }`}
              >
                🛏️
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-base font-black ${dark ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED × Hospitalization
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                  expandedOverlaps.hospitalization ? "rotate-180 text-[#2ed573]" : ""
                }`}
              />
            </button>

            {expandedOverlaps.hospitalization ? (
              <div
                className={`px-4 pb-5 border-t flex-1 ${
                  dark ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"
                }`}
              >
                <div className="mt-4 pl-3.5 border-l-2 border-[#2ed573] space-y-5">
                  <div className="space-y-2">
                    <strong className="text-xs block">
                      Non-active PED — one-time &amp; not organ-related (Dengue, COVID, Viral fever).
                    </strong>
                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${dark ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                        <li>Hospitalization Q only</li>
                      </ol>
                    </div>
                    <span
                      className={`inline-block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                        dark ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                      }`}
                    >
                      <span className="text-[#3b9eff] font-bold">Care:</span>{" "}
                      Hospitalization Q = Yes + details in <strong>Others</strong>
                    </span>
                  </div>
                  <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-4 space-y-2">
                    <strong className="text-xs block">
                      Active-PED-linked hospitalization (hospitalized for Diabetes).
                    </strong>
                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${dark ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                        <li>
                          Declaration of the PED in PED / Organ / System (by priority order) is{" "}
                          <span className="text-red-500 font-extrabold">mandatory</span>
                        </li>
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
                    <span
                      className={`block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                        dark ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                      }`}
                    >
                      <span className="text-[#3b9eff] font-bold">Care:</span>{" "}
                      PED/Organ Q = Yes → Hospitalization Q = Yes → Others = PED name{" "}
                      <span className="text-red-500 font-extrabold">(mandatory)</span>{" "}
                      + details{" "}
                      <span className="text-[#2ed573] font-bold">(optional)</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-3 opacity-40 select-none">
                <span className="text-[10px] font-semibold text-stone-400">Click to expand</span>
              </div>
            )}
          </div>

        </div>{/* end pair 1 */}


        {/* ── PAIR 2: Investigation + Surgery ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* CARD 3: PED/No-PED × Investigative Tests */}
          <div
            className={`border rounded-2xl overflow-hidden transition-all duration-300 flex flex-col ${
              dark ? "bg-[#10233a]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.investigation
                ? "border-[#b07cff]/50 ring-1 ring-[#b07cff]/20"
                : dark ? "border-white/10" : "border-stone-250"
            } ${
              isFocused && !expandedOverlaps.investigation
                ? "opacity-30 hover:opacity-60 scale-[0.98]"
                : "opacity-100"
            }`}
          >
            <button
              onClick={() => toggleOverlap("investigation")}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer shrink-0"
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                  dark
                    ? "bg-white/5 text-[#b07cff] border-[#b07cff]/30"
                    : "bg-[#EBE1F7] text-[#7C3AED] border-[#b07cff]/55"
                }`}
              >
                🔬
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-base font-black ${dark ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED/No-PED × Investigative Tests
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                  expandedOverlaps.investigation ? "rotate-180 text-[#b07cff]" : ""
                }`}
              />
            </button>

            {expandedOverlaps.investigation ? (
              <div
                className={`px-4 pb-5 border-t flex-1 ${
                  dark ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"
                }`}
              >
                <div className="mt-4 pl-3.5 border-l-2 border-[#b07cff] space-y-4">
                  <div
                    className={`p-3 rounded-xl border font-semibold ${
                      dark
                        ? "bg-[#ff5a6e]/10 border-[#ff5a6e]/50 text-[#ffd9df]"
                        : "bg-red-50 border-red-200 text-red-800"
                    }`}
                  >
                    <div className="text-xs">
                      <span className="text-red-500 font-bold dark:text-[#ff8a9a]">⚠ Mandatory declaration:</span>{" "}
                      Disclose <strong>with or without a diagnosis</strong> (exception applicable),{" "}
                      <strong>with or without findings</strong>, and{" "}
                      <strong>with or without reports</strong>.
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className={`text-xs leading-relaxed ${dark ? "text-stone-300" : "text-stone-750"}`}>
                      <strong>Exception:</strong> if a test was done <strong>only</strong> to diagnose an already-declared PED
                      (e.g. an <strong>ECG</strong> that revealed a declared heart condition), you need{" "}
                      <strong>not</strong> name it.
                    </p>
                    <div className="mt-3 space-y-2">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${dark ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                        <li>Umbrella Question — Investigative Tests</li>
                        <li>Others Section</li>
                      </ol>
                    </div>
                    <div className="mt-3 space-y-4">
                      <div
                        className={`p-3 rounded-xl border ${
                          dark ? "bg-stone-950/20 border-white/5" : "bg-white border-stone-200 shadow-xs"
                        }`}
                      >
                        <strong className="text-xs block font-bold mb-1">7 critical tests — name exactly:</strong>
                        <p className="font-mono text-xs text-indigo-500 dark:text-blue-300 font-extrabold leading-relaxed">
                          Angiography · TRT (Treadmill Test) / Stress Test · ECG · MRI · Endoscopy · Colonoscopy · USG
                        </p>
                      </div>
                      <div
                        className={`p-3 rounded-xl border ${
                          dark ? "bg-stone-950/20 border-white/5" : "bg-white border-stone-200 shadow-xs"
                        }`}
                      >
                        <strong className="text-xs block font-bold mb-1">Any other test:</strong>
                        <p className={`text-xs m-0 ${dark ? "text-[#90a6c4]" : "text-stone-600"}`}>
                          → use the generic phrase <strong>"Medical tests were done."</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-3 opacity-40 select-none">
                <span className="text-[10px] font-semibold text-stone-400">Click to expand</span>
              </div>
            )}
          </div>

          {/* CARD 4: PED × Surgery */}
          <div
            className={`border rounded-2xl overflow-hidden transition-all duration-300 flex flex-col ${
              dark ? "bg-[#10233a]" : "bg-white shadow-xs"
            } ${
              expandedOverlaps.surgery
                ? "border-[#ff9f43]/50 ring-1 ring-[#ff9f43]/20"
                : dark ? "border-white/10" : "border-stone-250"
            } ${
              isFocused && !expandedOverlaps.surgery
                ? "opacity-30 hover:opacity-60 scale-[0.98]"
                : "opacity-100"
            }`}
          >
            <button
              onClick={() => toggleOverlap("surgery")}
              className="w-full text-left p-4 flex gap-3.5 items-center bg-transparent focus:outline-none cursor-pointer shrink-0"
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${
                  dark
                    ? "bg-white/5 text-[#ff9f43] border-[#ff9f43]/30"
                    : "bg-[#FEF3C7] text-[#D97706] border-[#ff9f43]/55"
                }`}
              >
                🔪
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-base font-black ${dark ? "text-[#e9f1fb]" : "text-stone-900"}`}>
                  PED × Surgery
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${
                  expandedOverlaps.surgery ? "rotate-180 text-[#ff9f43]" : ""
                }`}
              />
            </button>

            {expandedOverlaps.surgery ? (
              <div
                className={`px-4 pb-5 border-t flex-1 ${
                  dark ? "border-white/5" : "border-stone-250 bg-[#F8FAFD]"
                }`}
              >
                <div className="mt-4 pl-3.5 border-l-2 border-[#ff9f43] space-y-5">
                  <div className="space-y-2">
                    <strong className="text-xs block">
                      Cured / one-time (Cataract, Kidney stones) — the surgery is the key declaration.
                    </strong>
                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${dark ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                        <li>
                          Surgeries Q or Organ / System Q{" "}
                          <span className="text-emerald-500 dark:text-emerald-400 font-extrabold">(PED Q is optional)</span>
                        </li>
                      </ol>
                    </div>
                    <span
                      className={`inline-block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                        dark ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                      }`}
                    >
                      <span className="text-[#3b9eff] font-bold">Care:</span>{" "}
                      Surgery Q = Yes + surgery name in <strong>Others</strong>
                    </span>
                  </div>
                  <div className="border-t border-dashed border-stone-200 dark:border-white/5 pt-4 space-y-2">
                    <strong className="text-xs block">
                      Linked to active PED (heart condition + Angioplasty) — PED is extremely important here; its declaration is{" "}
                      <span className="text-red-500">mandatory</span> in the PED / Organ / System specific question, along with the surgery.
                    </strong>
                    <div className="space-y-1">
                      <span className={`block text-[10px] uppercase font-bold tracking-wider ${dark ? "text-[#9fcbff]" : "text-stone-500"}`}>
                        Declaration Options
                      </span>
                      <ol className={`list-decimal pl-4 text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-600"}`}>
                        <li>
                          Declaration of the PED in PED / Organ / System (by priority order) is{" "}
                          <span className="text-red-500 font-black">mandatory</span>
                        </li>
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
                    <span
                      className={`block text-[11px] font-semibold border rounded-lg px-2.5 py-1.5 leading-normal ${
                        dark ? "bg-white/5 border-white/5 text-[#cfe0f5]" : "bg-[#DDE5F0] border-stone-250 text-[#1E293B]"
                      }`}
                    >
                      <span className="text-[#3b9eff] font-bold">Care:</span>{" "}
                      PED/Organ Q = Yes → Surgery Q = Yes → Others = PED name{" "}
                      <span className="text-red-500 font-extrabold">(mandatory)</span>{" "}
                      + surgery name{" "}
                      <span className="text-[#2ed573] font-bold">(optional)</span>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-3 opacity-40 select-none">
                <span className="text-[10px] font-semibold text-stone-400">Click to expand</span>
              </div>
            )}
          </div>

        </div>{/* end pair 2 */}

      </div>{/* end overlapping questions */}
      </div>)}{/* end false dead block */}

    </motion.div>
  );
};

export default DeclarationAssistantResults;
