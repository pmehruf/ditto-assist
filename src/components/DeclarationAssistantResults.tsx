import React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle2,
  List,
  Search,
  RefreshCw,
  AlertTriangle,
  Flag,
  RotateCcw,
  Edit3,
  ChevronDown,
  Compass,
} from "lucide-react";
import { SpecificIllnessLedgerCard } from "./SpecificIllnessLedgerCard";
import { MatchOutput, PlanConfig } from "../types.js";
import { ReportingItem } from "../types/lookup";
import { getLookupResultInfo } from "../utils/matchTier";
import { PED_BORDER_COLOR, PLAN_INSURER_BORDER_COLOR } from "../utils/planInsurerColors";
import { DecisionTracePanel } from "./DecisionTracePanel";

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
  illnessSearchQuery: string;
  setIllnessSearchQuery: (query: string) => void;
  specificIllnessesDict: Record<string, Array<{ category?: string; illness: string }>>;
  planConfigs?: Record<string, PlanConfig>;
  checkIllnessInPlanSpecificList: (pedText: string, plan: string) => { category: string; illness: string } | null;
}

type SidebarCard = "pj" | "si";

// ─────────────────────────────────────────────
// Linked Narrative — chronic-condition advisory
// ─────────────────────────────────────────────
const LINKED_NARRATIVE_SYNONYMS = [
  "diabet", "sugar", "sweet", "insulin", "hyperglyc", "prediabet", "pre-diabet",
  "hyperten", "bp", "blood pressure", "systolic", "diastolic", "pressure",
  "cholesterol", "lipid", "hyperchol", "statins", "triglyceride", "lipoprotein",
];

function pedHasLinkedNarrative(ped: string): boolean {
  const lower = ped.toLowerCase();
  return LINKED_NARRATIVE_SYNONYMS.some((synonym) => {
    if (synonym === "bp") {
      return /\bbp\b/i.test(lower);
    }
    return lower.includes(synonym);
  });
}

// ─────────────────────────────────────────────
// Sidebar card accent palette
// ─────────────────────────────────────────────
// Intensity reference: the Linked PED Narrative advisory panel (dark bg
// rgba(239,68,68,0.07), badges at ~0.16 bg / ~0.40 border). All Quick
// Reference card tints below are scaled to match that same muted level
// rather than solid, fully-saturated accent colors.
const CARD_ACCENTS: Record<SidebarCard, { hex: string; icon: typeof List; label: string; tint: string; tintStrong: string }> = {
  pj: { hex: "#b07cff", icon: List, label: "Payment Journey Questions", tint: "rgba(176,124,255,0.08)", tintStrong: "rgba(176,124,255,0.14)" },
  si: { hex: "#ff9f43", icon: AlertTriangle, label: "Specific Illness List", tint: "rgba(255,159,67,0.08)", tintStrong: "rgba(255,159,67,0.14)" },
};

// Each accordion card's PRIMARY panel (the outer card body, header + content)
// gets a tinted-toward-white/toward-black background matching its own accent
// hue — same design language across all three cards: near-white with a hue
// tinge in light theme, a low-opacity hue wash in dark theme (matching the
// Linked Narrative panel's ~0.07 alpha rather than a solid saturated fill).
const CARD_PANEL_BG: Record<SidebarCard, { dark: string; light: string }> = {
  pj: { dark: "rgba(176,124,255,0.07)", light: "#F8F4FF" },
  si: { dark: "rgba(255,159,67,0.07)", light: "#FFF8EE" },
};

// Nested "secondary" cards inside each accordion (branch cards, table rows,
// list items) use the same near-white-with-tinge (light) / hue-tinted wash
// (dark) treatment, one step stronger than the primary panel above (still
// muted, in the same spirit as Linked Narrative's badges) so they read as
// nested content rather than a duplicate header.
const CARD_SECONDARY_BG: Record<SidebarCard, { dark: string; darkGradient: string; light: string }> = {
  pj: { dark: "rgba(176,124,255,0.10)", darkGradient: "linear-gradient(150deg, rgba(120,80,190,0.16) 0%, rgba(29,21,48,0.45) 100%)", light: "#FBF9FF" },
  si: { dark: "rgba(255,159,67,0.10)", darkGradient: "linear-gradient(150deg, rgba(210,140,50,0.16) 0%, rgba(35,24,14,0.45) 100%)", light: "#FFFBF3" },
};

// ─────────────────────────────────────────────
// PED result card left-border — a flat, theme-appropriate neutral by
// default (charcoal on light cards, silver on dark cards; not a rotating
// per-card palette, that read as inconsistent/buggy when switching
// themes). For plans with a known real-world insurer, this is lightly
// tinted with that insurer's own brand color instead — see
// PLAN_INSURER_BORDER_COLOR below for why those are muted well below the
// insurer's actual marketing saturation rather than used raw.
// ─────────────────────────────────────────────
// PED_BORDER_COLOR (flat neutral fallback) and PLAN_INSURER_BORDER_COLOR
// (per-plan muted insurer brand accent) now live in
// ../utils/planInsurerColors.ts, shared with the Lookup page's queue card —
// see that file for the full design rationale.

// ─────────────────────────────────────────────
// Mapping-tier tag — a small flat, rectangular label (NOT the old circular
// P0/P1/P2 badges) that tells the advisor at a glance how the condition was
// matched. Sourced from src/utils/matchTier.ts — the single canonical
// taxonomy shared with AuditPage.tsx and MyActivityPage.tsx, so the same
// match_type reads identically everywhere in the app. Uses `levelLabel`
// ("Level 1: Direct Match", "Level 2: Category Match", "Level 3: Fallback",
// or the unleveled "Needs Clarification"/"Not a Medical Ailment") rather
// than the shorter `label` so this matches the audit/activity pages exactly.
function getMatchTierInfo(
  matchType: MatchOutput["match_type"],
  dark: boolean,
  source?: string
): { label: string; icon: string; color: string; bg: string; role: string | null; meaning: string } {
  const info = getLookupResultInfo(matchType, source);
  return {
    label: info.label,
    icon: info.icon,
    color: dark ? info.colorDark : info.colorLight,
    bg: dark ? info.bgDark : info.bgLight,
    role: info.role,
    meaning: info.meaning,
  };
}

// ─────────────────────────────────────────────
// Explanation text renderer — the mapping engine wraps emphasized phrases in
// **double asterisks** (and occasionally *single asterisks*); this file
// otherwise renders result.explanation as plain text, which left those
// markers visible as literal asterisks. This renders **bold** segments as
// real emphasis and strips stray single-asterisk wrapping so reasoning text
// reads as polished, professional prose.
//
// Also defensively unescapes literal "\n" (backslash + n, two characters —
// NOT an actual newline) into a real newline before rendering. Gemini's
// ESCALATE/FALLBACK/INVALID explanation templates (server.ts) instruct it to
// place paragraph breaks using this backslash-n pattern; the parent <p> here
// already has `whiteSpace: "pre-line"` so a REAL newline renders as a line
// break correctly, but a model response that reproduces the instruction's
// escape sequence too literally (rather than emitting an actual newline
// character inside its JSON string) leaves the raw "\n" visible as text
// instead of breaking the line. The server-side prompt templates were fixed
// to no longer show Gemini a doubly-escaped example, but this normalizes any
// stray literal "\n" that still comes through, since model output isn't
// perfectly deterministic.
function renderExplanationText(text: string): React.ReactNode {
  const cleaned = String(text || "").replace(/\\n/g, "\n");
  const parts = cleaned.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part.replace(/\*/g, "")}</React.Fragment>;
  });
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
  illnessSearchQuery,
  setIllnessSearchQuery,
  specificIllnessesDict,
  planConfigs = {},
  checkIllnessInPlanSpecificList,
}) => {
  const dark = theme === "dark";
  void lookupPeds;

  // ── State ──
  const [expandedNarratives, setExpandedNarratives] = React.useState<Record<number, boolean>>({});
  const [expandedSI, setExpandedSI] = React.useState<Record<number, boolean>>({});
  const [expandedCards, setExpandedCards] = React.useState<Record<SidebarCard, boolean>>({
    pj: false,
    si: false,
  });

  const toggleCard = (key: SidebarCard) => setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }));

  const planConfig = planConfigs?.[selectedPlan];

  const borderSoft = dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)";
  const accent = dark ? "#58A3FF" : "#0754B7";
  const pedNameColor = dark ? "#7DBBFF" : "#0754B7";
  const questionColor = dark ? "#FFFFFF" : "#0F172A";
  // Alert theme for Linked PED Narrative — it's an advisory warning, not a neutral action
  const alertColor = dark ? "#FCA5A5" : "#B91C1C";
  // Specific Illness uses the same alert-chip treatment, in a light-yellow theme
  const siAlertColor = dark ? "#FDE68A" : "#92400E";

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <motion.div
      key="results-layout"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 100, damping: 15 }}
      className="flex flex-col w-full box-border font-sans relative lg:min-h-0"
    >
      {/* Ambient hero glow */}
      <div
        className={`absolute top-[-4%] left-[-6%] w-[40%] h-[40%] rounded-full blur-[110px] -z-10 pointer-events-none select-none animate-pulse ${
          dark ? "bg-blue-500/10" : "bg-blue-400/14"
        }`}
        style={{ animationDuration: "12s" }}
      />
      <div
        className={`absolute top-[6%] right-[-8%] w-[35%] h-[35%] rounded-full blur-[100px] -z-10 pointer-events-none select-none animate-pulse ${
          dark ? "bg-cyan-400/8" : "bg-sky-400/10"
        }`}
        style={{ animationDuration: "16s" }}
      />

      {/* ═══════════════════════════════════════
          OUTER ROW: LEFT (title + PED results) | RIGHT (persistent full-height sidebar)
          The sidebar starts at the very top — level with the title — and spans the
          full height of this section, independent of the left column's own scroll.
      ═══════════════════════════════════════ */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-5 items-stretch">

        {/* ── LEFT COLUMN: title block + PED results ── */}
        <div className="lg:flex-[3] lg:h-full lg:min-h-0 flex flex-col min-w-0">

          {/* Title block */}
          <div className="shrink-0 pb-3 mb-4 border-b" style={{ borderColor: borderSoft }}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle2 style={{ color: "var(--accent)" }} className="w-5 h-5 shrink-0" />
                <h1
                  style={{ backgroundImage: "var(--gradient-accent)" }}
                  className="text-base sm:text-lg font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r truncate"
                >
                  {/* Uppercase removed: `selectedPlan` is an unbounded,
                      admin-entered plan name — forcing it into tracked-out
                      caps hurt readability on longer plan names and fought
                      with `truncate`. "Mapping Results" no longer needs caps
                      for hierarchy since size/weight/gradient already carry it. */}
                  Mapping Results{selectedPlan ? ` — ${selectedPlan}` : ""}
                </h1>
                {lookupResults.length > 0 && (
                  <span
                    style={{ color: dark ? "rgba(0,211,243,0.55)" : "rgba(7,84,183,0.55)" }}
                    className="text-[10.5px] font-black uppercase tracking-widest select-none shrink-0"
                  >
                    {lookupResults.length} PED{lookupResults.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onMapAnotherPed}
                  style={{
                    backgroundColor: dark ? "rgba(255,255,255,0.08)" : "#AEBFCC",
                    borderColor: dark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.10)",
                    color: dark ? "#E5EDF7" : "#1e293b",
                    clipPath: "polygon(100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 0)",
                  }}
                  className="flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-1.5 border transition-all cursor-pointer active:scale-95 hover:brightness-110 relative isolate overflow-hidden"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      backgroundImage:
                        "linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.08) 50%), linear-gradient(90deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.025) 50%)",
                      backgroundSize: "100% 3px, 3px 100%",
                    }}
                  />
                  <Edit3 className="w-3 h-3" />
                  Edit Input
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  style={{
                    clipPath: "polygon(100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 0)",
                  }}
                  className={`flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-1.5 transition-all cursor-pointer active:scale-95 relative isolate overflow-hidden ${
                    dark
                      ? "bg-red-500/10 text-red-400 hover:bg-red-500/18"
                      : "bg-red-50 text-red-600 hover:bg-red-100"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      zIndex: -1,
                      backgroundImage:
                        "linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.08) 50%), linear-gradient(90deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.025) 50%)",
                      backgroundSize: "100% 3px, 3px 100%",
                    }}
                  />
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* PED RESULTS — scrolls independently within the left column */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
            {isLookupLoading ? (
              <div className="p-16 text-center flex flex-col justify-center items-center gap-4 min-h-[300px]">
                <RefreshCw className="w-7 h-7 text-[#00D3F3] animate-spin" />
                <p className="text-xs font-bold tracking-wider uppercase animate-pulse text-stone-400">
                  Running mapping algorithms…
                </p>
              </div>
            ) : lookupResults.length > 0 ? (
              <div className="animate-fadeIn flex flex-col gap-2.5">
                {lookupResults.map(({ ped, result, source }, idx) => {
                  const siMatch = checkIllnessInPlanSpecificList(ped, selectedPlan);
                  const hasLinkedNarrative = pedHasLinkedNarrative(ped);
                  const isNarrativeExpanded = expandedNarratives[idx] || false;
                  const isSIExpanded = expandedSI[idx] || false;
                  const tierInfo = getMatchTierInfo(result.match_type, dark, source);
                  const questionText =
                    result.matched_question ||
                    planConfig?.anyOther ||
                    "Any other disease/condition not mentioned above?";

                  const planBorderColor = PLAN_INSURER_BORDER_COLOR[selectedPlan] || PED_BORDER_COLOR;
                  const borderColor = dark ? planBorderColor.dark : planBorderColor.light;

                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-2xl border"
                      style={{
                        // Light-theme values bumped up from 0.025/0.1 — at
                        // those alphas the card's faint background/border
                        // barely registered against the page's own light
                        // background, while the dark-theme pair (0.02/0.06)
                        // reads clearly because ANY light tint stands out
                        // against a near-black page. Needed a higher alpha
                        // in light theme to reach the same visible contrast.
                        backgroundColor: dark ? "rgba(255,255,255,0.02)" : "rgba(15,23,42,0.045)",
                        borderColor: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.18)",
                        // Thick colored left edge — a muted hint of the
                        // selected plan's real-world insurer brand color
                        // (not tied to match tier; see
                        // PLAN_INSURER_BORDER_COLOR above), same for every
                        // card in this list since they're all for the same
                        // plan. Falls back to a flat neutral for any plan
                        // without a known insurer mapping.
                        borderLeftWidth: "5px",
                        borderLeftColor: borderColor,
                      }}
                    >
                      {/* ── Row 1: pin + PED name — sized to match the Quick
                          Reference sidebar's card titles (Payment
                          Journey Questions, etc.), not a large
                          heading. ── */}
                      <div className="flex items-center gap-1.5 mb-1 min-w-0">
                        <img
                          src="/assets/.aistudio/icon_dna.png"
                          alt=""
                          aria-hidden="true"
                          className="w-4 h-4 shrink-0 select-none object-contain"
                        />
                        <span
                          style={{ color: pedNameColor }}
                          className="text-[15.5px] font-black tracking-tight truncate"
                        >
                          {/* Uppercase removed: `ped` is the free-text
                              condition name an advisor searched (e.g. "Obstructive
                              sleep apnea") — this is the primary scan target of
                              each result card, so forcing long names into caps
                              hurt exactly the scanability this page exists for. */}
                          {ped}
                        </span>
                      </div>

                      {/* Umbrella questions — plan-specific supplementary questions
                          (tests/medication/hospitalisation). Populated by
                          finalizeOutput's secondary_recommendation whenever a PED
                          carries a hospitalisation/surgery supporting flag — this
                          is independent of whether the question below is the
                          genuine anyOther catch-all (match_type === "FALLBACK") or
                          a real Direct/Category match that ALSO happens to be a
                          named surgical procedure (e.g. Angioplasty). Only in the
                          former case does "check these first" mean "otherwise fall
                          back"; in the latter, both this panel AND the question
                          below independently apply. See the closing note below,
                          which branches on match_type accordingly. */}
                      {result.secondary_recommendation && result.secondary_recommendation.length > 0 && (
                        <div
                          style={{
                            backgroundColor: dark ? "rgba(59,158,255,0.07)" : "rgba(59,158,255,0.06)",
                            borderColor: dark ? "rgba(59,158,255,0.22)" : "rgba(59,158,255,0.28)",
                          }}
                          className="mt-1 mb-1.5 rounded-lg border px-2.5 py-2"
                        >
                          <div
                            style={{ color: dark ? "#93C5FD" : "#1D4ED8" }}
                            className="text-[10.5px] font-black uppercase tracking-wider mb-1 flex items-center gap-1.5"
                          >
                            <List className="w-3 h-3 shrink-0" />
                            Also Check These Umbrella Questions
                          </div>
                          <ul className="space-y-1">
                            {result.secondary_recommendation.map((q, i) => (
                              <li
                                key={i}
                                style={{ color: dark ? "#cbd5e1" : "#334155" }}
                                className="text-[12.5px] leading-relaxed pl-3 relative"
                              >
                                <span
                                  style={{ color: "#3b9eff" }}
                                  className="absolute left-0"
                                  aria-hidden="true"
                                >
                                  •
                                </span>
                                {q}
                              </li>
                            ))}
                          </ul>
                          <div
                            style={{ color: dark ? "#7DA6D9" : "#3B5A80" }}
                            className="text-[11px] font-semibold leading-snug mt-1 pt-1 border-t"
                          >
                            {result.match_type === "FALLBACK"
                              ? "If none of these apply, use the Others question below."
                              : "This condition also has its own question below — check both."}
                          </div>
                        </div>
                      )}

                      {/* ── Row 2: mapped question ── */}
                      <p
                        style={{ color: questionColor }}
                        className="text-[13.5px] font-medium leading-snug"
                      >
                        {result.secondary_recommendation && result.secondary_recommendation.length > 0 && (
                          <span
                            style={{ color: dark ? "#7DA6D9" : "#3B5A80" }}
                            className="block text-[10.5px] font-black uppercase tracking-wider mb-0.5"
                          >
                            {/* This sub-label used to hardcode "Fallback —
                                Others Section" any time the umbrella panel
                                above was shown — but the umbrella panel and
                                the anyOther fallback are independent: a
                                named surgical procedure (e.g. Angioplasty)
                                can carry a hospitalisation/surgery flag
                                (→ umbrella panel shown) while still
                                resolving to a genuine Direct/Category match
                                below, not the generic catch-all. Only say
                                "Fallback — Others Section" when the mapped
                                question actually IS that catch-all. */}
                            {result.match_type === "FALLBACK"
                              ? "Fallback — Others question"
                              : "Also Applies — this condition's question"}
                          </span>
                        )}
                        {questionText}
                      </p>

                      {/* ── Mapping Logic — always shown inline, no toggle ── */}
                      <div
                        style={{ borderLeft: `2px solid ${accent}` }}
                        className="mt-1.5 pl-2.5"
                      >
                        <span
                          style={{ backgroundColor: tierInfo.bg, color: tierInfo.color }}
                          title={`${tierInfo.role ? `${tierInfo.role}. ` : ""}${tierInfo.meaning}`}
                          className="inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md mb-1 select-none"
                        >
                          <span aria-hidden="true">{tierInfo.icon}</span>
                          {tierInfo.label}
                        </span>
                        <p
                          style={{
                            color: dark ? "#94a3b8" : "#475569",
                            whiteSpace: "pre-line",
                          }}
                          className="text-[12.5px] leading-snug font-medium"
                        >
                          {renderExplanationText(result.explanation)}
                        </p>
                        <DecisionTracePanel result={result} dark={dark} />
                      </div>

                      {/* ── Action row: toggles sit directly above the panels they open ── */}
                      {(hasLinkedNarrative || siMatch) && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {hasLinkedNarrative && (
                            <button
                              type="button"
                              onClick={() => setExpandedNarratives((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                              style={{
                                backgroundColor: dark ? "rgba(239,68,68,0.16)" : "#FEE2E2",
                                borderColor: dark ? "rgba(248,113,113,0.55)" : "rgba(185,28,28,0.35)",
                                color: alertColor,
                              }}
                              className="flex items-center justify-center gap-1.5 text-[11px] font-black uppercase tracking-wide px-2.5 py-1.5 min-h-[26px] rounded-lg border transition-all cursor-pointer select-none active:scale-95 hover:brightness-110 shrink-0"
                            >
                              <AlertTriangle className="w-3 h-3 shrink-0 animate-pulse" />
                              Linked PED Narrative
                              <ChevronDown
                                className={`w-3 h-3 shrink-0 transition-transform ${isNarrativeExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                          )}
                          {siMatch && (
                            <button
                              type="button"
                              onClick={() => setExpandedSI((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                              style={{
                                backgroundColor: dark ? "rgba(234,179,8,0.16)" : "#FEF9C3",
                                borderColor: dark ? "rgba(253,224,71,0.55)" : "rgba(146,64,14,0.35)",
                                color: siAlertColor,
                              }}
                              className="flex items-center justify-center gap-1.5 text-[11px] font-black uppercase tracking-wide px-2.5 py-1.5 min-h-[26px] rounded-lg border transition-all cursor-pointer select-none active:scale-95 hover:brightness-110 shrink-0"
                            >
                              <span aria-hidden="true">⚕</span>
                              Specific Illness
                              <ChevronDown
                                className={`w-3 h-3 shrink-0 transition-transform ${isSIExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Linked PED Narrative — expanding panel */}
                      <AnimatePresence initial={false}>
                        {hasLinkedNarrative && isNarrativeExpanded && (
                          <motion.div
                            key="linked-narrative"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="overflow-hidden"
                          >
                            <div
                              className="mt-2 p-3 rounded-xl flex flex-col gap-2 select-none font-sans font-medium border-l-4"
                              style={{
                                backgroundColor: dark ? "rgba(239,68,68,0.07)" : "rgba(254,242,242,0.95)",
                                borderColor: dark ? "#F87171" : "#DC2626",
                              }}
                            >
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                <div className="flex items-start gap-2 max-w-2xl">
                                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: alertColor }} />
                                  <span
                                    className="text-[12px] font-semibold leading-relaxed"
                                    style={{ color: dark ? "#fef2f2" : "var(--text-heading)" }}
                                  >
                                    Advisors must mandatorily discuss the below narrative since this
                                    PED is linked to one of the targeted chronic conditions.
                                  </span>
                                </div>
                                <span
                                  style={{
                                    backgroundColor: dark ? "rgba(248,113,113,0.16)" : "rgba(220,38,38,0.08)",
                                    borderColor: dark ? "rgba(248,113,113,0.40)" : "rgba(220,38,38,0.30)",
                                    color: alertColor,
                                  }}
                                  className="text-[10.5px] font-mono font-black uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 select-none"
                                >
                                  RATING: 2
                                </span>
                              </div>

                              <div className="flex flex-wrap gap-1.5 items-center">
                                <span
                                  className="text-[10.5px] font-bold uppercase tracking-wide mr-1"
                                  style={{ color: dark ? "#94a3b8" : "#475569" }}
                                >
                                  TARGETS:
                                </span>
                                {["Diabetes / Pre-Diabetes", "Hypertension (High BP)", "Hypercholesterolaemia"].map(
                                  (tag) => (
                                    <span
                                      key={tag}
                                      style={{
                                        backgroundColor: dark ? "rgba(248,113,113,0.16)" : "rgba(220,38,38,0.08)",
                                        borderColor: dark ? "rgba(248,113,113,0.40)" : "rgba(220,38,38,0.30)",
                                        color: alertColor,
                                      }}
                                      className="text-[11px] font-semibold px-2 py-0.5 rounded-md border"
                                    >
                                      {tag}
                                    </span>
                                  )
                                )}
                              </div>

                              <div className="space-y-1">
                                <span
                                  className="text-[11.5px] font-extrabold uppercase tracking-wider block"
                                  style={{ color: dark ? "#fef2f2" : "var(--text-heading)" }}
                                >
                                  Advisor Narrative:
                                </span>
                                <blockquote
                                  className="pl-3 text-[13px] italic leading-relaxed font-semibold"
                                  style={{
                                    borderLeft: `2px solid ${alertColor}`,
                                    color: dark ? "#cbd5e1" : "#334155",
                                  }}
                                >
                                  "Usually, people are hospitalized not solely because they have diabetes, high
                                  cholesterol, or hypertension, but due to complications like heart attacks and
                                  strokes that are linked to these conditions. If there is a waiting period for
                                  coverage of these underlying conditions, claims for events such as heart
                                  attacks or strokes may be rejected because they stem from diabetes,
                                  cholesterol, or hypertension."
                                </blockquote>
                                <p
                                  className="text-[11.5px] font-semibold leading-relaxed mt-1"
                                  style={{ color: dark ? "#94a3b8" : "#475569" }}
                                >
                                  <strong style={{ color: dark ? "#eaf3ff" : "var(--text-heading)" }}>
                                    Flexibility Note:
                                  </strong>{" "}
                                  Advisors are fully flexible to use their own words. Ensure the core reasoning
                                  of linked medical risks is clearly explained.
                                </p>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Specific Illness — inline explanation only, no list toggle */}
                      <AnimatePresence initial={false}>
                        {siMatch && isSIExpanded && (
                          <motion.div
                            key="specific-illness"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="overflow-hidden"
                          >
                            <div
                              style={{
                                backgroundColor: dark ? "rgba(245,158,11,0.08)" : "rgba(254,251,235,0.9)",
                                borderColor: dark ? "rgba(245,158,11,0.28)" : "rgba(245,158,11,0.35)",
                              }}
                              className="mt-2 p-3 rounded-xl border flex flex-col gap-1.5"
                            >
                              <div className="flex items-center gap-2 text-amber-500 font-extrabold text-[12px]">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                PED listed under specific illness list
                              </div>
                              <p
                                style={{ color: "var(--text-secondary)" }}
                                className="text-[12px] leading-relaxed font-semibold font-sans"
                              >
                                "{ped.toLowerCase()}" maps to{" "}
                                <span className="text-amber-500 font-bold font-mono">"{siMatch.illness}"</span>{" "}
                                (Category:{" "}
                                <span className="underline decoration-sky-400 underline-offset-2 font-black">
                                  {siMatch.category || "General"}
                                </span>
                                ) in {selectedPlan}'s specific illness list.
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* ── Footer: Flag action, bottom-right corner of the card ── */}
                      <div className="flex justify-end mt-2">
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
                          }}
                          style={{
                            borderColor: dark ? "rgba(239,68,68,0.28)" : "rgba(220,38,38,0.22)",
                            color: dark ? "rgba(248,113,113,0.75)" : "rgba(190,24,24,0.75)",
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wide border bg-transparent transition-all cursor-pointer select-none active:scale-95 opacity-70 hover:opacity-100 shrink-0"
                        >
                          <Flag className="w-2.5 h-2.5" />
                          Flag
                        </button>
                      </div>
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
        </div>

        {/* ── RIGHT COLUMN: persistent, full-height, static sidebar ──
            Flat transparent-grey glass panel (was a navy-tinted
            rgba(16,35,58,0.55) / steel-blue-grey #AEBFCC), matching the
            neutral card treatment used elsewhere (Audit page, My Activity
            Journal) instead of a blue-tinted one. */}
        <div
          className="lg:flex-[1] lg:h-full lg:min-h-0 flex flex-col rounded-2xl border overflow-hidden shrink-0"
          style={{
            backgroundColor: dark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.02)",
            borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
          }}
        >
          {/* Sidebar title + tagline */}
          <div
            className="shrink-0 p-4 border-b"
            style={{ borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)" }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Compass style={{ color: "var(--accent)" }} className="w-4 h-4 shrink-0" />
              <h2
                style={{ backgroundImage: "var(--gradient-accent)" }}
                className="text-[13px] font-black uppercase tracking-widest bg-clip-text text-transparent bg-gradient-to-r"
              >
                Quick Reference
              </h2>
            </div>
          </div>

          {/* Accordion cards — sidebar itself scrolls if content overflows */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-3">
            {(Object.keys(CARD_ACCENTS) as SidebarCard[]).map((key) => {
              const cfg = CARD_ACCENTS[key];
              const Icon = cfg.icon;
              const isOpen = expandedCards[key];
              const panelBg = CARD_PANEL_BG[key];
              return (
                <div
                  key={key}
                  className="rounded-xl border overflow-hidden shrink-0"
                  style={{
                    borderColor: dark ? `${cfg.hex}40` : `${cfg.hex}35`,
                    backgroundColor: dark ? panelBg.dark : panelBg.light,
                  }}
                >
                  <div
                    style={{ backgroundColor: isOpen ? cfg.tintStrong : cfg.tint }}
                    className="w-full flex items-center gap-2.5 p-3 transition-all"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCard(key)}
                      className="flex-1 min-w-0 flex items-center gap-2.5 cursor-pointer select-none hover:brightness-105"
                    >
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: dark ? "rgba(255,255,255,0.08)" : "#ffffff", color: cfg.hex }}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span
                        style={{ color: cfg.hex }}
                        className="flex-1 text-left text-[11px] font-black uppercase tracking-wide truncate"
                      >
                        {cfg.label}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCard(key)}
                      aria-label={isOpen ? "Collapse" : "Expand"}
                      className="shrink-0 cursor-pointer select-none"
                    >
                      <ChevronDown
                        style={{ color: cfg.hex }}
                        className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key={`${key}-content`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="p-3 pt-0.5">
                          {key === "pj" && (
                            <div className="pt-2.5 max-h-[420px] overflow-y-auto custom-scrollbar -mx-1 px-1">
                              <table className="w-full text-left border-collapse font-sans">
                                <thead>
                                  <tr
                                    style={{
                                      backgroundColor: dark ? CARD_SECONDARY_BG.pj.dark : "#EFE7FF",
                                      borderColor: dark ? "rgba(176,124,255,0.30)" : "rgba(176,124,255,0.30)",
                                    }}
                                    className="border-b"
                                  >
                                    <th
                                      style={{ borderColor: dark ? "rgba(176,124,255,0.30)" : "rgba(176,124,255,0.30)", color: dark ? "#FFFFFF" : "var(--text-heading)" }}
                                      className="py-2 px-2 text-center font-black tracking-wider text-[9px] uppercase border-r border-l-4 border-l-transparent w-9"
                                    >
                                      No.
                                    </th>
                                    <th
                                      style={{ color: dark ? "#FFFFFF" : "var(--text-heading)" }}
                                      className="py-2 px-2 font-black tracking-wider text-[9px] uppercase"
                                    >
                                      Declaration Question
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className={`divide-y ${dark ? "divide-[#3d2f5c]" : "divide-purple-100"}`}>
                                  {(() => {
                                    const cfg2 = planConfigs?.[selectedPlan] || { questions: [] };
                                    const questionsList = cfg2.questions || [];
                                    if (questionsList.length === 0) {
                                      return (
                                        <tr>
                                          <td colSpan={2} className="py-6 text-center text-[9.5px] text-stone-400 font-sans">
                                            No questions configured for this plan.
                                          </td>
                                        </tr>
                                      );
                                    }

                                    return questionsList.map((question: string, i: number) => {
                                      const questionId = i + 1;
                                      const normalizedItem = question.toLowerCase().trim();
                                      const isUmbrella = cfg2?.umbrellaQuestions?.some(
                                        (uq: string) => uq.toLowerCase().trim() === normalizedItem
                                      );
                                      const isAnyOther =
                                        cfg2?.anyOther &&
                                        cfg2.anyOther.toLowerCase().trim() === normalizedItem;

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
                                      let rowStyle: React.CSSProperties = {};

                                      if (isMatch) {
                                        if (isFallbackUmbrellaHighlight) {
                                          highlightClass = dark ? "bg-purple-900/40" : "bg-purple-50";
                                          borderLeftStyle = "border-l-purple-500 border-l-[3px]";
                                          textClass = dark ? "text-purple-400 font-extrabold" : "text-purple-900 font-bold";
                                        } else if (isFallbackOthersHighlight) {
                                          highlightClass = dark ? "bg-amber-900/30" : "bg-amber-50";
                                          borderLeftStyle = "border-l-amber-500 border-l-[3px]";
                                          textClass = dark ? "text-amber-400 font-extrabold" : "text-amber-900 font-bold";
                                        } else {
                                          highlightClass = dark ? "bg-blue-900/40" : "bg-blue-50/70";
                                          borderLeftStyle = "border-sky-400 border-l-[3px]";
                                          textClass = dark ? "text-sky-400 font-extrabold" : "text-blue-900 font-bold";
                                        }
                                      } else {
                                        rowStyle = { backgroundColor: dark ? CARD_SECONDARY_BG.pj.dark : CARD_SECONDARY_BG.pj.light };
                                        textClass = dark ? "text-white" : "text-slate-800";
                                      }

                                      let indicatorText = `Q${questionId}`;
                                      if (isMatch) {
                                        if (isFallbackUmbrellaHighlight) indicatorText = `Q${matchIdx + 1}☂`;
                                        else if (isFallbackOthersHighlight) indicatorText = `Q${matchIdx + 1}🌐`;
                                        else indicatorText = `Q${matchIdx + 1}`;
                                      }

                                      return (
                                        <tr key={i} style={rowStyle} className={`transition-all duration-100 ${highlightClass}`}>
                                          <td
                                            style={{ borderColor: dark ? "rgba(176,124,255,0.20)" : "rgba(176,124,255,0.20)", color: dark ? "#FFFFFF" : "var(--text-heading)" }}
                                            className={`py-1.5 px-1.5 text-center border-r border-l-4 font-mono text-[8.5px] whitespace-nowrap ${borderLeftStyle}`}
                                          >
                                            {indicatorText}
                                          </td>
                                          <td className="py-1.5 px-2">
                                            <div className="flex items-start gap-1.5 leading-relaxed font-sans">
                                              {isMatch && (
                                                <span
                                                  className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 animate-pulse ${
                                                    isFallbackUmbrellaHighlight
                                                      ? "bg-purple-500"
                                                      : isFallbackOthersHighlight
                                                      ? "bg-amber-400"
                                                      : "bg-[#00D3F3]"
                                                  }`}
                                                />
                                              )}
                                              <div className={`pr-1 tracking-tight ${textClass}`} style={{ fontSize: "9px", lineHeight: "14px" }}>
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
                          )}

                          {key === "si" && (
                            <div className="pt-2.5 max-h-[420px] overflow-y-auto custom-scrollbar -mx-1 px-1">
                              <SpecificIllnessLedgerCard
                                theme={theme}
                                selectedPlan={selectedPlan}
                                illnessSearchQuery={illnessSearchQuery}
                                setIllnessSearchQuery={setIllnessSearchQuery}
                                specificIllnessesDict={specificIllnessesDict}
                              />
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default DeclarationAssistantResults;
