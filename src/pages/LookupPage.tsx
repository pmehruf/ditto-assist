/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
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
  ChevronDown,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { DeclarationMapIcon } from "../components/icons";
import { GridTexture } from "../components/GridTexture";
import { PrimaryCtaButton } from "../components/PrimaryCtaButton";
import { MascotWithFallback } from "../components/mascots/MascotWithFallback";
import { DeclarationAssistantResults } from "../components/DeclarationAssistantResults";
import { MatchOutput, PlanConfig } from "../types.js";
import { QAAnnouncement } from "../types/announcements";
import { ReportingItem } from "../types/lookup";
import { AnnouncementContent } from "../utils/announcementHtml";
import { getPlanInsurerColor, hexToRgba, getContrastTextForPlanColor } from "../utils/planInsurerColors";
import { buildGroupedSuggestions } from "../constants/pedSynonymGroups";
import { CustomSelect } from "../components/CustomSelect";

type TabId =
  | "lookup"
  | "audit"
  | "profile_access"
  | "plan_scope"
  | "resources"
  | "active_questions"
  | "my_activity"
  | "qa_announcement_log"
  | "flagged_responses"
  | "announcement_archive";

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

  // Specific illness ledger cross-check
  illnessSearchQuery: string;
  setIllnessSearchQuery: (value: string) => void;
  specificIllnessesDict: Record<string, Array<{ category?: string; illness: string }>>;
  planConfigs: Record<string, PlanConfig>;
  checkIllnessInPlanSpecificList: (pedText: string, plan: string) => { category: string; illness: string } | null;

  // Nav
  setActiveTab: (value: TabId) => void;

  // QA Announcement carousel
  activeAnnouncements: QAAnnouncement[];
  noticeIndex: number;
  setNoticeIndex: (updater: number | ((prev: number) => number)) => void;
  slideDirection: "right-to-left" | "left-to-right";
  setSlideDirection: (value: "right-to-left" | "left-to-right") => void;
}

/**
 * "Ditto Assist" lookup tab — main functional form + results content
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
  illnessSearchQuery,
  setIllnessSearchQuery,
  specificIllnessesDict,
  planConfigs,
  checkIllnessInPlanSpecificList,
  setActiveTab,
  activeAnnouncements,
  noticeIndex,
  setNoticeIndex,
  slideDirection,
  setSlideDirection
}: LookupPageProps) {
  // Quiet per-plan insurer color hint for the queue card (border, queued PED
  // tags, and the total-queue counter) — same muted palette used for the PED
  // result card's left border in DeclarationAssistantResults.tsx. Falls back
  // to the flat neutral PED_BORDER_COLOR for any plan without a known
  // insurer mapping, so the queue card looks the same as before until a plan
  // is selected.
  const queueInsurerColor = getPlanInsurerColor(selectedPlan);
  const queueAccentHex = theme === "dark" ? queueInsurerColor.dark : queueInsurerColor.light;
  const queueCounterTextColor = getContrastTextForPlanColor(theme);

  // The QA Announcement card (right column, intro/pre-results view) needs to
  // match the PED Mapping Engine input column's (left column) actual
  // rendered height exactly, with its own content scrolling internally if
  // it doesn't fit — not the other way around. Flexbox's `items-stretch`
  // alone can't do this: it stretches BOTH siblings to whichever is
  // naturally taller, so if the announcement text is long, the left column
  // would get stretched too, and CSS has no way to say "match sibling A's
  // height, capping and scrolling sibling B" — that needs the actual
  // rendered pixel height, hence measuring it directly.
  const leftColRef = useRef<HTMLDivElement | null>(null);
  const [leftColHeight, setLeftColHeight] = useState<number | null>(null);
  const [isDesktopLayout, setIsDesktopLayout] = useState(true);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)"); // Tailwind's `lg`
    const updateLayout = () => setIsDesktopLayout(mql.matches);
    updateLayout();
    mql.addEventListener("change", updateLayout);
    return () => mql.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    const el = leftColRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect?.height;
      if (height) setLeftColHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {isResultsActive ? (
        <div className="flex flex-col lg:flex-row gap-6 items-stretch w-full lg:flex-1 lg:min-h-0">
          <DeclarationAssistantResults
            theme={theme}
            selectedPlan={selectedPlan}
            lookupPeds={lookupPeds}
            isLookupLoading={isLookupLoading}
            lookupResults={lookupResults}
            onReset={handleClearLookupFields}
            onMapAnotherPed={handleMapAnotherPed}
            setActiveTab={setActiveTab}
            setReportingItem={setReportingItem}
            setReportingNotes={setReportingNotes}
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

          {/* No card/border on this section (per design feedback) — only the
              QA Announcement panel below keeps its own bordered card. The
              grid texture is scoped to the input area only so it doesn't
              bleed into the announcement card. */}
          <div
            className={`w-full flex flex-col lg:flex-row items-center gap-10 lg:gap-16 animate-fade-in ${
              theme === "dark" ? "text-white" : "text-stone-900"
            }`}
          >
            {/* SECTION 1: PED MAPPING ENGINE INPUTS */}
            {/* No local background/texture/glow here on purpose — a bounded
                overlay box (even a borderless one) reads as a "card" the
                moment it's clipped by overflow-hidden. This section now sits
                directly on the shared app-shell background (grid + ambient
                glow blobs already rendered behind every tab in App.tsx), so
                it blends into the page instead of looking like its own panel. */}
            <div
              ref={leftColRef}
              className="flex-1 min-w-0 flex flex-col justify-start relative z-10"
            >
              {/* Title mapping section */}
              <div
                style={{
                  paddingBottom: "clamp(10px, 1.5vh, 20px)",
                  marginBottom: "0px",
                  marginTop: "0px",
                }}
                className={`flex flex-row justify-between items-start gap-4 pb-5 border-b ${
                  theme === "dark"
                    ? "border-white/[0.08]"
                    : "border-stone-400/60"
                }`}
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 select-none mb-1">
                    <div
                      className="w-8 h-0.5 flex-shrink-0"
                      style={{
                        backgroundColor:
                          theme === "dark" ? "#00D3F3" : "#4673a9",
                      }}
                    />
                    <span
                      style={{
                        width: "105px",
                        fontSize: "10px",
                        lineHeight: "12px",
                        color: "var(--accent)",
                        backgroundColor: "var(--accent-subtle-bg)",
                        borderColor: "var(--accent-border)",
                        borderWidth: "1.5px",
                      }}
                      className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border flex items-center justify-center gap-1.5 shrink-0 select-none"
                    >
                      + AI POWERED
                    </span>
                  </div>
                  <h1
                    className="font-black tracking-wider leading-[1.0] uppercase select-none font-sans flex flex-col"
                    style={{ marginTop: "clamp(4px, 0.8vh, 10px)" }}
                  >
                    <span
                      style={{
                        fontSize: "clamp(12px, 2.2vh, 23px)",
                        display: "block",
                        backgroundImage: "var(--gradient-heading)",
                      }}
                      className="bg-clip-text text-transparent bg-gradient-to-r"
                    >
                      PED DECLARATION
                    </span>
                    <span
                      style={{
                        fontSize: "clamp(24px, 4.4vh, 46px)",
                        display: "block",
                        backgroundImage: "var(--gradient-accent)",
                      }}
                      className="bg-clip-text text-transparent bg-gradient-to-r"
                    >
                      MAPPING ENGINE
                    </span>
                  </h1>
                  <span
                    className={`text-xs font-medium select-none block mt-1.5 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}
                  >
                    Search and map conditions to find the perfect match for your
                    declaration.
                  </span>
                </div>

                {/* Declaration Map — helper action, top-right of title section */}
                <button
                  type="button"
                  onClick={() => setActiveTab("resources")}
                  id="open-resources-btn"
                  style={{
                    color: theme === "dark" ? "#00D3F3" : "#0754b7",
                    borderColor:
                      theme === "dark"
                        ? "rgba(0,211,243,0.25)"
                        : "rgba(7,84,183,0.2)",
                    backgroundColor:
                      theme === "dark"
                        ? "rgba(0,211,243,0.07)"
                        : "rgba(7,84,183,0.06)",
                  }}
                  className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide transition-all cursor-pointer select-none shrink-0 mt-1 px-3 py-1.5 rounded-lg border hover:opacity-90 active:scale-95"
                >
                  <DeclarationMapIcon
                    width={14}
                    height={14}
                    color="currentColor"
                    className="shrink-0"
                  />
                  Declaration Map
                </button>
              </div>

              {/* Two boxed input sections, side by side — outlined only, no filled card background */}
              <div
                style={{ marginTop: "1vh" }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {/* BOX A: Health Insurance Plan */}
                <div className="rounded-2xl px-1 py-3 flex flex-col gap-3">
                  <label
                    className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 select-none font-sans ${
                      theme === "dark" ? "text-stone-400" : "text-stone-500"
                    }`}
                  >
                    <ShieldCheck
                      className={`w-3.5 h-3.5 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}
                    />
                    Health Insurance Plan
                  </label>
                  <CustomSelect
                    theme={theme}
                    value={selectedPlan}
                    onChange={setSelectedPlan}
                    placeholder="Select Plan"
                    id="insurance-plan-dropdown"
                    options={productionPlans.map((plan) => ({
                      value: plan,
                      label: plan,
                    }))}
                    triggerClassName={`w-full flex items-center justify-between gap-2 pl-3 pr-8 h-[42px] rounded-xl border outline-none font-bold text-xs transition-all cursor-pointer font-sans shadow-sm relative ${
                      theme === "dark"
                        ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]"
                        : "bg-white border-stone-250 text-stone-850"
                    }`}
                  />
                </div>

                {/* BOX B: Search & Map Condition */}
                {/* pb-1 (not py-3's uniform 12px) — the hint line under the
                    input already adds its own visual breathing room, so the
                    old bottom padding doubled up and pushed the PED queue
                    card too far down. */}
                <div className="rounded-2xl px-1 pt-3 pb-1 flex flex-col gap-3 relative">
                  <label
                    className={`text-[10px] font-black uppercase tracking-widest font-sans flex items-center gap-1.5 select-none ${
                      theme === "dark" ? "text-stone-400" : "text-stone-500"
                    }`}
                  >
                    <Search
                      className={`w-3.5 h-3.5 ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}
                    />
                    Search &amp; Map Condition
                  </label>
                  <div className="relative w-full">
                    <div className="flex items-center gap-2 w-full">
                      <div
                        style={{ borderRadius: "12px", height: "42px" }}
                        className={`flex items-center border transition-all duration-200 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/25 flex-grow ${
                          theme === "dark"
                            ? "bg-[#102236] border-[#1e3e5c]"
                            : "bg-white border-stone-250"
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
                              const query = pedInput.trim();
                              // Synonyms of the same PED (e.g. "High BP" /
                              // "Hypertension" / "Systemic Hypertension")
                              // collapse into a single grouped dropdown row
                              // here — see buildGroupedSuggestions for why
                              // clicking/selecting still inserts the one
                              // specific synonym that matched, not the
                              // joined label.
                              const itemsToDisplay =
                                query.length > 0
                                  ? buildGroupedSuggestions(
                                      dynamicSuggestions,
                                      query,
                                      lookupPeds,
                                    )
                                      .sort((a, b) => {
                                        // Rank by the specific term that matched
                                        // (insertValue), not the display label —
                                        // a grouped row's label balloons to the
                                        // full joined "A Or B Or C" string, which
                                        // would otherwise make close/exact
                                        // matches like "Hypertension" sort behind
                                        // unrelated longer single terms (e.g.
                                        // "Portal hypertension") and get pushed
                                        // out of the top-6 cutoff below.
                                        if (
                                          a.insertValue.length !==
                                          b.insertValue.length
                                        ) {
                                          return (
                                            a.insertValue.length -
                                            b.insertValue.length
                                          );
                                        }
                                        return a.insertValue.localeCompare(
                                          b.insertValue,
                                        );
                                      })
                                      .slice(0, 6)
                                  : [];

                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                if (itemsToDisplay.length > 0) {
                                  setActiveSuggestionIndex(
                                    activeSuggestionIndex <
                                      itemsToDisplay.length - 1
                                      ? activeSuggestionIndex + 1
                                      : 0,
                                  );
                                }
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                if (itemsToDisplay.length > 0) {
                                  setActiveSuggestionIndex(
                                    activeSuggestionIndex > 0
                                      ? activeSuggestionIndex - 1
                                      : itemsToDisplay.length - 1,
                                  );
                                }
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                if (
                                  activeSuggestionIndex >= 0 &&
                                  activeSuggestionIndex < itemsToDisplay.length
                                ) {
                                  handleAddLookupPed(
                                    itemsToDisplay[activeSuggestionIndex]
                                      .insertValue,
                                  );
                                  setActiveSuggestionIndex(-1);
                                } else {
                                  handleAddLookupPed(pedInput);
                                }
                              } else if (e.key === "Escape") {
                                setActiveSuggestionIndex(-1);
                              }
                            }}
                            placeholder="Enter PED"
                            autoComplete="off"
                            style={{
                              borderRadius: "12px",
                              fontFamily: "system-ui",
                            }}
                            className={`w-full pl-3 pr-8 py-2 bg-transparent border-0 outline-none font-bold text-xs ${
                              theme === "dark"
                                ? "text-[#eff6ff] placeholder:text-slate-400 placeholder:font-medium"
                                : "text-stone-850 placeholder:text-stone-400 placeholder:font-medium"
                            }`}
                            id="ped-input"
                          />
                          {/* Decorative dropdown affordance — signals this field also offers
                              a pick-from-list suggestion dropdown, matching the Plan select,
                              even though free text entry is still allowed. */}
                          <ChevronDown
                            className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none shrink-0 ${
                              theme === "dark"
                                ? "text-slate-400"
                                : "text-stone-400"
                            }`}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleAddLookupPed(pedInput);
                          setActiveSuggestionIndex(-1);
                        }}
                        style={{
                          clipPath:
                            "polygon(100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 0)",
                        }}
                        // Brand navy — was a one-off hardcoded blue-gray hex
                        // that predated (and was missed by) the app-wide
                        // primary/neutral CTA navy pass, since it never went
                        // through the bg-blue-600/var(--accent-solid)
                        // classes that pass covered.
                        className="h-[42px] px-4 border shadow-sm flex items-center justify-center gap-1.5 shrink-0 select-none text-xs font-mono font-bold uppercase tracking-[0.2em] transition-all duration-200 active:scale-95 cursor-pointer relative isolate overflow-hidden bg-[var(--action-navy)] border-[var(--action-navy)] text-[var(--on-action-navy)] hover:bg-[var(--action-navy-hover)] hover:border-[var(--action-navy-hover)]"
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
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        ADD
                      </button>
                    </div>

                    {/* Reassures advisors the dropdown is a convenience, not
                        a whitelist — a condition can be typed and added even
                        when nothing in the suggestion list matches it. */}
                    {/* pl-3 lines the first character up with the input's own
                        text ("Enter PED" sits behind the same 12px inset), so
                        the hint reads as belonging to the field rather than
                        hanging off the container's border edge. */}
                    <p
                      className={`mt-1.5 pl-3 text-[10px] font-medium flex items-center gap-1 ${
                        theme === "dark" ? "text-white/75" : "text-slate-700"
                      }`}
                    >
                      <Info className="w-3 h-3 shrink-0" />
                      Can't find it in the dropdown? Type and add it anyway 🚀
                    </p>

                    {/* Floating Dropdown for Suggestions */}
                    {pedInput.trim().length > 0 &&
                      (() => {
                        const query = pedInput.trim();
                        // Same grouping as the onKeyDown handler above — each
                        // synonym cluster shows as one joined row ("A Or B Or
                        // C"); isAdded/insertValue still track the specific
                        // real term so clicking behaves exactly as before.
                        const itemsToDisplay = buildGroupedSuggestions(
                          dynamicSuggestions,
                          query,
                          lookupPeds,
                        )
                          .sort((a, b) => {
                            // Same insertValue-based ranking as the onKeyDown
                            // handler above — see that comment for why sorting
                            // by the joined label buries grouped rows.
                            if (a.insertValue.length !== b.insertValue.length) {
                              return (
                                a.insertValue.length - b.insertValue.length
                              );
                            }
                            return a.insertValue.localeCompare(b.insertValue);
                          })
                          .slice(0, 6);

                        return (
                          <div
                            // Plain opaque hex, not bg-white/bg-stone-900 —
                            // this is a floating panel over arbitrary page
                            // content, not a stationary card, so it must
                            // stay fully opaque regardless of the card
                            // surface's translucency (see CustomSelect.tsx's
                            // panel for the same fix/reasoning).
                            className={`absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border shadow-lg overflow-hidden flex flex-col ${
                              theme === "dark"
                                ? "bg-[#14181f] border-white/[0.08] text-white"
                                : "bg-[#ffffff] border-stone-200 text-stone-900"
                            }`}
                          >
                            {/* max-h raised from 130px and text now wraps
                              instead of truncating — a grouped label like
                              "Type 2 diabetes mellitus Or Type 2 DM Or..."
                              was getting cut off with the old short/
                              single-line row. Font size on the label is a
                              notch smaller (text-[11px] vs the row's
                              text-xs) to fit more of a long joined label
                              per line. */}
                            <div className="max-h-[280px] overflow-y-auto">
                              {itemsToDisplay.length === 0 ? (
                                <div className="px-4 py-3 text-xs italic text-left select-none text-stone-500">
                                  No typing matches...
                                </div>
                              ) : (
                                itemsToDisplay.map((sug, idx) => {
                                  const isAdded = lookupPeds.includes(
                                    sug.insertValue,
                                  );
                                  const isActive =
                                    idx === activeSuggestionIndex;
                                  return (
                                    <button
                                      key={sug.insertValue}
                                      type="button"
                                      disabled={isAdded}
                                      onClick={() => {
                                        handleAddLookupPed(sug.insertValue);
                                        setActiveSuggestionIndex(-1);
                                      }}
                                      onMouseEnter={() =>
                                        setActiveSuggestionIndex(idx)
                                      }
                                      className={`w-full text-left px-3.5 py-2.5 text-xs flex items-start justify-between gap-2 transition-all font-sans font-medium ${
                                        isAdded
                                          ? "opacity-40 cursor-not-allowed"
                                          : isActive
                                            ? "bg-blue-600/20 text-blue-300 border-l-2 border-blue-500 pl-[10px]"
                                            : theme === "dark"
                                              ? "hover:bg-white/[0.04] border-l-2 border-transparent pl-[10px]"
                                              : "hover:bg-stone-100 border-l-2 border-transparent pl-[10px]"
                                      }`}
                                    >
                                      <div className="flex items-start gap-2 min-w-0">
                                        <Stethoscope
                                          className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                            isActive
                                              ? "text-blue-400"
                                              : "text-stone-500"
                                          }`}
                                        />
                                        {/* Two-line display model: canonical name
                                          (line 1, primary) + remaining aliases
                                          (line 2, muted, "•"-separated). Line 2
                                          is hidden when there are no extra
                                          aliases. Replaces the old single long
                                          "A Or B Or C" label for scannability;
                                          insertValue/search are unchanged. */}
                                        <div className="min-w-0 flex flex-col gap-0.5">
                                          <span
                                            className={`text-[12px] font-semibold leading-snug whitespace-normal break-words ${
                                              isActive
                                                ? ""
                                                : theme === "dark"
                                                  ? "text-white"
                                                  : "text-stone-900"
                                            }`}
                                          >
                                            {sug.displayName}
                                          </span>
                                          {sug.aliases.length > 0 &&
                                            (() => {
                                              // Cap the muted alias line so very
                                              // large groups stay compact; every
                                              // alias remains fully searchable —
                                              // this only trims what's *shown*.
                                              const MAX_ALIASES = 6;
                                              const shown = sug.aliases
                                                .slice(0, MAX_ALIASES)
                                                .join(" • ");
                                              const extra =
                                                sug.aliases.length -
                                                MAX_ALIASES;
                                              return (
                                                <span
                                                  className={`text-[10px] leading-snug whitespace-normal break-words ${
                                                    isActive
                                                      ? "text-blue-300/80"
                                                      : theme === "dark"
                                                        ? "text-slate-400"
                                                        : "text-stone-500"
                                                  }`}
                                                >
                                                  {shown}
                                                  {extra > 0
                                                    ? ` +${extra} more`
                                                    : ""}
                                                </span>
                                              );
                                            })()}
                                        </div>
                                      </div>
                                      <Plus
                                        className={`w-3.5 h-3.5 shrink-0 mt-0.5 transition-transform ${
                                          isActive
                                            ? "scale-110 text-current animate-pulse"
                                            : "text-stone-500"
                                        }`}
                                      />
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

              {/* QUEUE BOX — full width below the two boxes */}
              <div
                style={{
                  borderWidth: "1.5px",
                  minHeight: "clamp(130px, 28vh, 300px)",
                  // Tightened (was clamp(10px, 1.5vh, 22px)) alongside the
                  // search box's pb-1 above — together they close the gap the
                  // new under-input hint line opened up.
                  marginTop: "clamp(6px, 1vh, 14px)",
                  padding: "clamp(10px, 1.5vh, 16px)",
                  // Quiet per-plan insurer border hint — see queueAccentHex
                  // comment above. Falls back to the same neutral look as
                  // before when no plan is selected/known.
                  borderColor: selectedPlan ? queueAccentHex : undefined,
                }}
                className={`rounded-2xl relative flex flex-col justify-between border overflow-hidden ${
                  theme === "dark"
                    ? selectedPlan
                      ? "bg-white/[0.04]"
                      : "border-white/[0.12] bg-white/[0.04]"
                    : selectedPlan
                      ? "bg-stone-100/60"
                      : "border-stone-300 bg-stone-100/60"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Selected condition list / empty text */}
                  <div className="flex-grow text-left relative z-10 min-h-[46px] pl-20 pr-2">
                    {lookupPeds.length === 0 ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pointer-events-none">
                        <div
                          className={`text-xs italic font-medium font-sans ${
                            theme === "dark"
                              ? "text-stone-400"
                              : "text-stone-500"
                          }`}
                        >
                          No conditions added to the lookup queue.
                        </div>
                        <span
                          className={`text-[10px] not-italic leading-relaxed mt-1 ${theme === "dark" ? "text-stone-500" : "text-stone-500"}`}
                        >
                          Search or type a condition on the left to start.
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 w-full content-start max-h-[110px] overflow-y-auto pr-1">
                        {lookupPeds.map((tag, idx) => (
                          <div
                            key={`${tag}-${idx}`}
                            style={
                              selectedPlan
                                ? {
                                    backgroundColor: hexToRgba(
                                      queueAccentHex,
                                      theme === "dark" ? 0.16 : 0.1,
                                    ),
                                    borderColor: hexToRgba(
                                      queueAccentHex,
                                      theme === "dark" ? 0.55 : 0.4,
                                    ),
                                  }
                                : undefined
                            }
                            className={`text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-all font-medium border ${
                              selectedPlan
                                ? theme === "dark"
                                  ? "text-[#eff6ff]"
                                  : "text-stone-850"
                                : theme === "dark"
                                  ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]"
                                  : "bg-stone-100 border-stone-250 text-stone-850"
                            }`}
                          >
                            <span
                              className="truncate max-w-[120px]"
                              title={tag}
                            >
                              {tag}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setLookupPeds(
                                  lookupPeds.filter((t) => t !== tag),
                                )
                              }
                              className={`w-4 h-4 rounded-full flex items-center justify-center transition-all cursor-pointer text-xs ${
                                theme === "dark"
                                  ? "hover:bg-white/10 text-slate-400 hover:text-white"
                                  : "hover:bg-stone-300 text-stone-500 hover:text-stone-900"
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
                    <span
                      className={`text-[9px] font-black uppercase tracking-widest ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}
                    >
                      Total Queue
                    </span>
                    <span
                      style={
                        selectedPlan
                          ? {
                              backgroundColor: queueAccentHex,
                              color: queueCounterTextColor,
                            }
                          : undefined
                      }
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${
                        selectedPlan
                          ? ""
                          : theme === "dark"
                            ? "bg-white/10 text-white"
                            : "bg-stone-600 text-white"
                      }`}
                    >
                      {lookupPeds.length}
                    </span>
                  </div>

                  {/* Doctor Mascot — left end of queue card */}
                  <div
                    style={{
                      height: "clamp(100px, 18vh, 175px)",
                      width: "clamp(90px, 16vh, 155px)",
                    }}
                    className="absolute left-0 bottom-0 pointer-events-none select-none overflow-hidden z-0 opacity-90 hidden sm:block"
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
                style={{
                  marginTop: "clamp(14px, 2.4vh, 26px)",
                  fontWeight: "bold",
                  fontSize: "11px",
                }}
                className={`opacity-80 select-none font-sans flex items-center gap-1.5 text-left ${
                  theme === "dark" ? "text-stone-400" : "text-stone-500"
                }`}
              >
                <Info className="w-3.5 h-3.5 shrink-0" />
                Enter one or multiple conditions to map them sequentially
                against the selected plan wording.
              </p>

              {/* Action row: Find a Match / Reset Fields — wrapped in a relative,
                  overflow-hidden shell so the shared GridTexture scan-line
                  texture shows in the gaps around the buttons, matching the
                  app's premium card identity. Rendered at z-0 (behind the
                  buttons) so it doesn't cut across their clipped-corner
                  notches and folded-corner accents.
                  Deliberately NOT rounded (no rounded-2xl) — the buttons sit
                  flush against this shell's edges, so a rounded mask here
                  was leaking onto their outer corners (Find a Match's left
                  side, Reset Fields' top-right), fighting the app's sharp
                  90°-corner + single diagonal-clip button identity. */}
              <div
                style={{ marginTop: "clamp(8px, 1.2vh, 18px)" }}
                className="relative overflow-hidden"
              >
                <GridTexture theme={theme} zIndexClassName="z-0" />
                <div
                  className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-3 pt-1 pb-1 w-full"
                  title={
                    !selectedPlan || lookupPeds.length === 0
                      ? "Select a plan and add at least one condition to proceed"
                      : ""
                  }
                >
                  <PrimaryCtaButton
                    theme={theme}
                    onClick={() => {
                      if (!selectedPlan) return;
                      executeLookupAll(lookupPeds, selectedPlan);
                    }}
                    disabled={
                      isLookupLoading ||
                      lookupPeds.length === 0 ||
                      !selectedPlan
                    }
                    className="w-full sm:w-auto sm:flex-1 !flex items-center justify-center gap-2"
                    style={{ border: "none" }}
                    id="match-disclosure-button"
                    title={
                      !selectedPlan || lookupPeds.length === 0
                        ? "Select a plan and add at least one condition to proceed"
                        : ""
                    }
                  >
                    {isLookupLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-current inline -mt-0.5 mr-2" />
                        Analyzing conditions...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 text-current inline -mt-0.5 mr-2" />
                        Find a Match
                      </>
                    )}
                  </PrimaryCtaButton>

                  <button
                    type="button"
                    onClick={handleClearLookupFields}
                    style={{
                      clipPath:
                        "polygon(100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 0)",
                      paddingTop: "clamp(8px, 1.2vh, 12px)",
                      paddingBottom: "clamp(8px, 1.2vh, 12px)",
                    }}
                    // Deliberately a light/outline "secondary" treatment now,
                    // not a solid dark fill — Reset used to be a plain dark
                    // gray (#374151) which read fine as its own thing when
                    // Find a Match was solid blue, but now that Find a
                    // Match's primary CTA color is ALSO a solid dark navy,
                    // two same-weight dark buttons side by side made Reset
                    // look like a second primary action rather than a
                    // secondary one. Outline/ghost is the standard way to
                    // signal "secondary" next to a solid primary.
                    className={`w-full sm:w-auto sm:flex-1 px-6 text-xs font-mono uppercase font-bold tracking-[0.2em] duration-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer select-none relative isolate overflow-hidden border ${
                      theme === "dark"
                        ? "bg-white/[0.04] border-white/15 text-stone-300 hover:bg-white/[0.08] hover:border-white/25"
                        : "bg-white/60 border-stone-300 text-stone-700 hover:bg-stone-100 hover:border-stone-400"
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
                    <RotateCcw className="w-3.5 h-3.5 text-current" />
                    Reset Fields
                  </button>
                </div>
              </div>
            </div>

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
                const months = [
                  "Jan",
                  "Feb",
                  "Mar",
                  "Apr",
                  "May",
                  "June",
                  "July",
                  "Aug",
                  "Sept",
                  "Oct",
                  "Nov",
                  "Dec",
                ];
                const day = d.getDate();
                const month = months[d.getMonth()];
                let suffix = "th";
                if (day === 1 || day === 21 || day === 31) suffix = "st";
                else if (day === 2 || day === 22) suffix = "nd";
                else if (day === 3 || day === 23) suffix = "rd";
                return `${day}${suffix} ${month}`;
              };

              const diffDays = getDaysDiff(item.effectiveDate);

              // One neat solid fill for every case — unlike the rating
              // badge, this one intentionally does NOT vary color by
              // urgency; only the text changes. Matte (muted, non-neon)
              // terracotta fill with black text, matching the reference look.
              const countdownClasses =
                "bg-[#de7c50] text-black border border-[#c26a3d] font-extrabold";
              const getCountdownBadgeConfig = (diff: number) => {
                if (diff === 0) {
                  return { text: "Effective today", classes: countdownClasses };
                } else if (diff === 1) {
                  return { text: "Live in 1 day", classes: countdownClasses };
                } else if (diff === 2) {
                  return { text: "Live in 2 days", classes: countdownClasses };
                } else if (diff === 3) {
                  return { text: "Live in 3 days", classes: countdownClasses };
                } else if (diff > 3 && diff <= 7) {
                  return {
                    text: `Live in ${diff} days`,
                    classes: countdownClasses,
                  };
                } else if (diff < 0) {
                  const absDiff = Math.abs(diff);
                  const dayLabel = absDiff === 1 ? "day" : "days";
                  return {
                    text: `Active since ${absDiff} ${dayLabel}`,
                    classes: countdownClasses,
                  };
                } else {
                  return {
                    text: `Active from ${formatOrdinal(item.effectiveDate)}`,
                    classes: countdownClasses,
                  };
                }
              };

              const getRatingBadgeConfig = (rating: number | undefined) => {
                if (rating === undefined || rating === 0) {
                  return {
                    text: "No Rating",
                    classes:
                      theme === "dark"
                        ? "bg-stone-500/10 text-stone-400 border border-stone-500/15 font-extrabold"
                        : "bg-stone-55 text-stone-600 border border-stone-205 font-extrabold",
                  };
                }
                // Solid, opaque severity fills (not theme-dependent pale
                // tints) — the card background is now a colorful gradient,
                // so a pale/translucent badge reads as washed-out white
                // instead of a distinct color. 1=Red...4=Green is the actual
                // severity scale; only this rating badge varies this way —
                // the countdown badge next to it intentionally does not.
                // Matte (muted, non-neon) fills with black text throughout —
                // same finish as the countdown badge, not a bright/glossy
                // Tailwind 500-level color.
                if (rating === 1) {
                  return {
                    text: "Rating 1",
                    classes:
                      "bg-[#c1665c] text-black border border-[#a84f46] font-extrabold",
                  };
                } else if (rating === 2) {
                  return {
                    text: "Rating 2",
                    classes:
                      "bg-[#de7c50] text-black border border-[#c26a3d] font-extrabold",
                  };
                } else if (rating === 3) {
                  return {
                    text: "Rating 3",
                    classes:
                      "bg-[#d1a34a] text-black border border-[#b3872f] font-extrabold",
                  };
                } else if (rating === 4) {
                  return {
                    text: "Rating 4",
                    classes:
                      "bg-[#94b06c] text-black border border-[#7a9552] font-extrabold",
                  };
                } else if (rating === -1) {
                  return {
                    text: "Highlight",
                    classes:
                      theme === "dark"
                        ? "bg-purple-500/10 text-purple-400 border border-purple-500/20 font-extrabold"
                        : "bg-purple-55 text-purple-700 border border-purple-200 font-extrabold",
                  };
                }
                return {
                  text: `Rating ${rating}`,
                  classes:
                    "bg-[#6fa08c] text-black border border-[#57806e] font-extrabold",
                };
              };

              const countdownConfig = getCountdownBadgeConfig(diffDays);
              const ratingConfig = getRatingBadgeConfig(item.rating);

              const annType = item.type || "QA Announcement";

              // QA Announcement's card is a forced-light-blue gradient in
              // both themes, so its bold-red text always needs the light
              // (forceLightContrast) branch to stay readable. General/Common
              // Announcement's card now has its own distinct, properly
              // legible background per theme again (dark navy vs a light
              // mint-tinted card — see the secondary-card background below),
              // so it follows the real ambient `theme` like any normal card.
              const renderAnnouncementWithRatings = (text: string) => {
                return (
                  <AnnouncementContent
                    content={text}
                    theme={theme}
                    forceLightContrast={annType !== "General Announcement"}
                  />
                );
              };

              const typeConfig = (() => {
                if (annType === "General Announcement") {
                  // Primary/outer card. Dark theme blends smoothly into the
                  // secondary/body card beneath it because containerBg
                  // layers a transparent-to-teal gradient over #061a2b. Light
                  // theme's base was briefly changed to #EDF6F3 to match the
                  // secondary card's new color, but that made the whole
                  // outer card read as more saturated/vivid than intended —
                  // reverted back to the original, paler #F6F8FA base (the
                  // secondary/body card keeps its own #EDF6F3 independently;
                  // they don't need to share a base color).
                  return {
                    containerClass: "shadow-xs",
                    containerBg:
                      theme === "dark"
                        ? "linear-gradient(135deg, rgba(13,148,136,0) 0%, rgba(13,148,136,0.34) 100%), #061a2b"
                        : "linear-gradient(135deg, rgba(20,184,166,0.05) 0%, rgba(20,184,166,0.24) 100%), #F6F8FA",
                    headerSubColor:
                      theme === "dark"
                        ? "text-emerald-400 font-extrabold"
                        : "text-emerald-900 font-extrabold",
                    titleColor:
                      theme === "dark"
                        ? "text-emerald-300 font-bold"
                        : "text-emerald-700 font-bold",
                  };
                } else {
                  // QA Announcement — primary/outer card. Light theme now
                  // mirrors dark theme's diagonal wash direction (135deg /
                  // to-br: top-left to bottom-right) with a light-blue to
                  // red gradient, rather than the old flat rose-to-red class
                  // (from-rose-200 to-red-300 were close enough in tone to
                  // read as a solid fill). Dark theme keeps its inline
                  // `background` (see containerBg below) — a semi-transparent
                  // red wash over the base dark-navy card, which a Tailwind
                  // bg-* class can't replicate since it just paints flat.
                  return {
                    containerClass:
                      theme === "dark"
                        ? "shadow-xs"
                        : "bg-gradient-to-br from-[#3a608e] via-red-200 to-red-400 shadow-xs",
                    containerBg:
                      theme === "dark"
                        ? "linear-gradient(135deg, rgba(190,18,60,0) 0%, rgba(220,38,38,0.38) 100%), #061a2b"
                        : undefined,
                    headerSubColor:
                      theme === "dark"
                        ? "text-rose-400 font-extrabold"
                        : "text-rose-900 font-extrabold",
                    titleColor:
                      theme === "dark"
                        ? "text-rose-300 font-bold"
                        : "text-rose-700 font-bold",
                  };
                }
              })();

              const containerStyle = typeConfig.containerClass;
              const containerBg = typeConfig.containerBg;

              const motionVariants = {
                enter: (dir: "right-to-left" | "left-to-right") => ({
                  x: dir === "right-to-left" ? 180 : -180,
                  opacity: 0,
                }),
                center: {
                  x: 0,
                  opacity: 1,
                },
                exit: (dir: "right-to-left" | "left-to-right") => ({
                  x: dir === "right-to-left" ? -180 : 180,
                  opacity: 0,
                }),
              };

              return (
                <div
                  style={{
                    // On desktop (side-by-side columns), pin this card's
                    // height to the left column's actual measured pixel
                    // height (see leftColHeight/ResizeObserver above) so the
                    // two always match exactly, with long announcement text
                    // scrolling inside via the Announcement Content div's
                    // own flex-1/min-h-0/overflow-y-auto — rather than this
                    // card growing to fit its content and running past the
                    // left column, which is what happened before. Falls
                    // back to the previous clamp-based height before the
                    // measurement lands, and on mobile (stacked columns,
                    // where matching the left column's height doesn't make
                    // layout sense).
                    height:
                      isDesktopLayout && leftColHeight
                        ? `${leftColHeight}px`
                        : "clamp(380px, 55vh, 650px)",
                    maxHeight:
                      isDesktopLayout && leftColHeight
                        ? `${leftColHeight}px`
                        : "clamp(380px, 55vh, 650px)",
                    paddingBottom: "8px",
                    border: "none",
                    ...(containerBg ? { background: containerBg } : {}),
                  }}
                  className={`p-6 sm:p-8 flex flex-col gap-4 select-none transition-all duration-300 w-full lg:w-96 xl:w-[28rem] flex-shrink-0 overflow-hidden relative rounded-2xl ${containerStyle}`}
                >
                  {/* UPPER HEADER BAR (Row 1 of Layout) */}
                  <div
                    style={{
                      paddingTop: "0px",
                      marginTop: "0px",
                      marginBottom: "0px",
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
                          marginBottom: "0px",
                        }}
                        className="inline-block text-[10px] leading-none font-black uppercase tracking-widest px-2.5 py-1 text-[#1A365D] dark:text-[#D7E5FF] w-fit"
                      >
                        Updates
                      </span>
                      <span
                        className={`block text-[15px] leading-[18px] font-black mt-1 ${
                          theme === "light" &&
                          annType !== "General Announcement"
                            ? "text-[#0f2942]"
                            : "bg-clip-text text-transparent"
                        }`}
                        style={
                          theme === "light" &&
                          annType !== "General Announcement"
                            ? undefined
                            : { backgroundImage: "var(--gradient-heading)" }
                        }
                      >
                        {annType === "General Announcement"
                          ? "Common Announcements"
                          : "QA Announcements"}
                      </span>
                    </div>

                    {/* Badges on Top Right */}
                    <div className="flex flex-wrap items-center gap-1.5 justify-end">
                      {item.effectiveDate && (
                        <span
                          className={`text-[10px] px-2 py-1 tracking-wider whitespace-nowrap flex items-center justify-center font-extrabold h-6 rounded ${countdownConfig.classes}`}
                        >
                          {countdownConfig.text}
                        </span>
                      )}
                      {item.rating !== undefined && item.rating !== 0 && (
                        <span
                          className={`text-[10px] px-2 py-1 tracking-wide rounded whitespace-nowrap flex items-center justify-center font-extrabold h-6 ${ratingConfig.classes}`}
                        >
                          {ratingConfig.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* HORIZONTAL SHARP DIVIDER */}
                  <div className="border-t border-[#4E6981] dark:border-white/[0.08] w-full"></div>

                  {/* BODY CONTENT (Row 2 of Layout) — secondary card. QA
                      Announcements get a light blue background here, same
                      in both themes. General Announcement's card keeps its
                      own dark-navy card in dark theme, and a dedicated light
                      mint-tinted card (#EDF6F3, not a flat near-white gray)
                      in light theme — chosen to actually suit a light
                      backdrop rather than reusing the dark card's colors. */}
                  <div
                    style={{
                      background:
                        annType === "General Announcement"
                          ? theme === "dark"
                            ? "#0a1f33"
                            : "#EDF6F3"
                          : "linear-gradient(135deg, #dbeafe, #bfdbfe)",
                      paddingTop: "10px",
                      paddingBottom: "8px",
                      paddingLeft: "12px",
                      paddingRight: "10px",
                      marginTop: "0px",
                      marginBottom: "0px",
                      borderRadius: "16px",
                      position: "relative",
                      border:
                        annType === "General Announcement"
                          ? theme === "dark"
                            ? "1px solid rgba(255,255,255,0.06)"
                            : "1px solid #A9C9C2"
                          : "1px solid #93c5fd",
                      flexGrow: 1,
                      // Was 220px, which left a large empty block under short
                      // announcements. 170px still clears the 140px mascot
                      // anchored to the primary card's bottom-right, so the
                      // card can shrink to its content without the mascot
                      // overflowing.
                      minHeight: "170px",
                    }}
                    className="flex flex-row items-start justify-between gap-3 md:gap-4 self-stretch w-full min-w-0"
                  >
                    {/* Left Text Block */}
                    <div className="flex-grow flex-1 min-w-0 text-left flex flex-col justify-start h-full">
                      {/* Announcement Title */}
                      <span
                        style={{
                          fontFamily: "system-ui",
                          // QA's secondary card is light blue in both themes,
                          // so this label stays a dark navy in both too.
                          // General Announcement's card differs by theme
                          // again (dark navy vs light mint), so this label
                          // goes back to following it: a muted slate on the
                          // dark card, a deep teal on the new light card.
                          color:
                            annType === "General Announcement"
                              ? theme === "dark"
                                ? "#94a3b8"
                                : "#134E4A"
                              : "#0f2942",
                          marginTop: "0px",
                          marginBottom: "0px",
                        }}
                        className="text-xs md:text-[13px] font-bold tracking-tight uppercase mb-1.5 block"
                      >
                        {item.category || "General Announcement"}
                      </span>

                      {/* General Announcement meta: optional "From" team */}
                      {annType === "General Announcement" && item.from && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
                          {/* Explicit hex instead of text-cyan-800 (which
                              resolves to var(--accent) globally) so this
                              always matches this card's OWN accent, not
                              whatever --accent happens to be elsewhere. */}
                          <span
                            className="text-[9px] font-semibold"
                            style={{
                              color: theme === "dark" ? "#00D3F3" : "#0754B7",
                            }}
                          >
                            From: {item.from}
                          </span>
                        </div>
                      )}

                      {/* Announcement Content — flex-1/min-h-0 so it shares
                          the Left Text Block's height with the Posted Date
                          footer below instead of claiming a hardcoded 45px
                          offset; this is what lets the footer stay pinned to
                          the bottom regardless of how tall this scrolls. */}
                      {/* Scrollbar contrast follows the CARD, not the ambient
                          theme: the QA card is always light-blue, so keying
                          the thumb off `theme` made it invisible in light
                          mode. Only the General card in dark mode is a
                          genuinely dark surface. */}
                      <div
                        style={{
                          overflowY: "auto",
                          overflowX: "hidden",
                          scrollbarWidth: "thin",
                          scrollbarColor:
                            annType === "General Announcement" &&
                            theme === "dark"
                              ? "#5A6E8C transparent"
                              : "#64748B transparent",
                        }}
                        className={`announcement-scroll ${
                          annType === "General Announcement" && theme === "dark"
                            ? "on-dark "
                            : ""
                        }relative w-full flex-1 min-h-0 flex flex-col justify-start bg-transparent pr-1 overflow-x-hidden`}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={item.id}
                            custom={slideDirection}
                            variants={motionVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{
                              type: "spring",
                              stiffness: 220,
                              damping: 26,
                            }}
                            className="w-full text-left"
                          >
                            <div
                              className="text-[12.5px] font-medium leading-relaxed text-stone-850"
                              style={{
                                maxWidth: "100%",
                                fontFamily: "system-ui",
                                marginRight: "0px",
                                // `.text-stone-850` follows the AMBIENT theme
                                // (index.css only force-lightens it under a
                                // `.dark` ancestor), but QA's card is always
                                // light-blue regardless of ambient theme, so
                                // it needs an explicit override; General's
                                // card now differs by theme again (dark navy
                                // vs the new light mint card), so it needs
                                // its own explicit pair too rather than
                                // relying on `.text-stone-850`'s defaults.
                                color:
                                  annType === "General Announcement"
                                    ? theme === "dark"
                                      ? "#F5F7FA"
                                      : "#1E293B"
                                    : "#0f2942",
                              }}
                            >
                              {/* Desktop/MD Floated Spacer to push mascot to bottom right */}
                              <div
                                className="hidden md:block"
                                style={{
                                  float: "right",
                                  height: "84px",
                                  width: "0px",
                                }}
                              />
                              {/* Floated Mascot Placeholder (Invisible Spacer) inside the text flow —
                                  shrunk so the mascot sits tighter in the corner and covers less text. */}
                              <div
                                className="hidden md:block"
                                style={{
                                  float: "right",
                                  clear: "right",
                                  width: "78px",
                                  height: "91px",
                                  marginLeft: "12px",
                                  marginRight: "-7px",
                                  marginTop: "6px",
                                  marginBottom:
                                    sorted.length > 1 ? "-11px" : "2px",
                                }}
                              />
                              {renderAnnouncementWithRatings(item.announcement)}
                            </div>
                          </motion.div>
                        </AnimatePresence>
                      </div>

                      {/* Posted Date — footer, pinned to the bottom-left of
                          the secondary card. Deliberately a sibling of the
                          scrollable Announcement Content div above (not
                          nested inside it) so it never scrolls away with
                          long content and never shifts position as content
                          height changes; the content area is flex-1 above,
                          so this footer always gets pushed to the bottom of
                          the available space instead. */}
                      {item.announcementDate && (
                        <div className="shrink-0 mt-1 pt-1 border-t border-dashed border-stone-300/40 dark:border-white/10">
                          {/* `text-stone-400` follows the AMBIENT theme (index.css
                              remaps it to a pale, dark-surface-tuned color under a
                              `.dark` ancestor — see the note on the body text
                              above), but the QA card is always a light-blue
                              gradient regardless of ambient theme, so that remap
                              made this date read as near-invisible pale-on-pale
                              whenever the app's ambient theme was Dark, even
                              though the card itself never changed. Explicit hex,
                              same pattern as the body text color right above,
                              sidesteps the remap entirely: QA always gets one
                              light gray/charcoal tone (its card never changes),
                              General gets its own theme-dependent pair since its
                              card genuinely does invert (dark navy vs light mint). */}
                          <span
                            className="text-[9.5px] font-semibold tracking-wide"
                            style={{
                              color:
                                annType === "General Announcement"
                                  ? theme === "dark"
                                    ? "#94a3b8"
                                    : "#57534e"
                                  : "#57534e",
                            }}
                          >
                            Posted {formatOrdinal(item.announcementDate)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Fixed Mascot — positioned relative to the PRIMARY card
                      (not the secondary card, like before), anchored to its
                      bottom-right corner and made tall enough that its top
                      portion pokes up slightly above the secondary card's
                      top edge instead of being fully confined inside it. */}
                  <div
                    className="hidden md:flex items-end justify-center shrink-0 py-1 select-none absolute"
                    style={{
                      width: "130px",
                      height: "140px",
                      bottom: sorted.length > 1 ? "0px" : "4px",
                      right: "2px",
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      style={{
                        marginRight: "-20px",
                        paddingLeft: "0px",
                        width: "97px",
                        height: "113px",
                        marginLeft: "20px",
                        marginTop: "0px",
                        marginBottom: "2px",
                      }}
                      className="flex items-end justify-center relative pointer-events-auto"
                    >
                      <MascotWithFallback
                        src="/assets/.aistudio/announcement-mascot.png"
                        alt="Announcement Mascot"
                        className="h-full w-auto object-contain transition-all duration-300 transform-gpu hover:scale-105 pointer-events-none select-none"
                        type="notepad"
                        style={{ maxHeight: "100%", maxWidth: "130px" }}
                      />
                    </div>
                  </div>

                  {/* View All — bottom-left corner of the primary card,
                      mirroring the mascot's bottom-right anchor above. Plain
                      hyperlink styling (no button chrome), inset from the
                      card's own edge/corner-radius rather than flush against
                      it. Jumps to the full Announcements archive (see
                      App.tsx / featurePermissions.ts
                      "announcement_archive"), since this carousel only ever
                      shows the latest ~10 active notices. Not hidden on
                      mobile (unlike the mascot) since it's a real navigation
                      control, not decorative. */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("announcement_archive")}
                    className={`absolute z-10 text-[10.5px] font-bold tracking-tight whitespace-nowrap cursor-pointer underline underline-offset-2 decoration-1 transition-colors ${
                      theme === "dark"
                        ? "text-stone-300 hover:text-stone-100 decoration-stone-300/50"
                        : "text-stone-500 hover:text-stone-700 decoration-stone-400/50"
                    }`}
                    style={{
                      bottom: sorted.length > 1 ? "14px" : "18px",
                      left: "14px",
                    }}
                    title="Browse every posted announcement"
                  >
                    View All Announcements
                  </button>

                  {/* PAGE INDICATOR & ARROWS (Row 3 of Layout) */}
                  {sorted.length >= 1 && (
                    <div
                      style={{
                        paddingTop: "4px",
                        paddingBottom: "2px",
                        marginTop: "2px",
                      }}
                      className="flex flex-col items-center justify-center gap-2 border-t border-dashed border-[#4E6981] dark:border-white/[0.08] w-full shrink-0"
                    >
                      {/* Pagination indicator — slim vertical ticks, matching
                          the established compact look. Previously this was a
                          hardcoded 65px-wide row of round dots, which only
                          *looked* slim because the dots were being squeezed
                          by that fixed width; once the active-announcement cap
                          rose to 10 they squeezed to zero and disappeared.
                          The tick is now its own intrinsic size, so it stays
                          compact and visible at any count. Each tick sits in a
                          padded button so the click target stays usable even
                          though the visible mark is only 3px wide. */}
                      <div className="flex flex-wrap items-center justify-center gap-0.5 select-none max-w-full px-2">
                        {sorted.map((_, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setSlideDirection(
                                idx > noticeIndex
                                  ? "right-to-left"
                                  : "left-to-right",
                              );
                              setNoticeIndex(idx);
                            }}
                            className="shrink-0 py-1 px-[2px] cursor-pointer group leading-none"
                            title={`Go to page ${idx + 1}`}
                          >
                            <span
                              className={`block h-2.5 rounded-[3px] transition-all duration-300 ${
                                idx === noticeIndex
                                  ? theme === "dark"
                                    ? "w-2.5 bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]"
                                    : "w-2.5 bg-blue-600 shadow-[0_0_5px_rgba(37,99,235,0.4)]"
                                  : theme === "dark"
                                    ? "w-[3px] bg-stone-600 group-hover:bg-stone-500"
                                    : "w-[3px] bg-stone-400 group-hover:bg-stone-500"
                              }`}
                            />
                          </button>
                        ))}
                      </div>

                      <div
                        style={{
                          height: "30px",
                        }}
                        className="flex items-center gap-2"
                      >
                        <button
                          onClick={() => {
                            setSlideDirection("left-to-right");
                            setNoticeIndex(
                              (prev) =>
                                (prev - 1 + sorted.length) % sorted.length,
                            );
                          }}
                          style={{
                            width: "28px",
                            height: "28px",
                            backgroundColor:
                              theme === "dark"
                                ? "var(--surface-tint)"
                                : "var(--accent-subtle-bg)",
                          }}
                          className={`hover:scale-[1.03] active:scale-[0.97] rounded-lg transition-all cursor-pointer flex items-center justify-center border ${
                            theme === "dark"
                              ? "border-white/[0.08]"
                              : "border-slate-200 shadow-xs"
                          }`}
                          title="Previous Announcement"
                        >
                          <ChevronLeft
                            className="w-[18px] h-[18px]"
                            style={{ color: "var(--accent)" }}
                          />
                        </button>
                        <button
                          onClick={() => {
                            setSlideDirection("right-to-left");
                            setNoticeIndex(
                              (prev) => (prev + 1) % sorted.length,
                            );
                          }}
                          style={{
                            width: "28px",
                            height: "28px",
                            backgroundColor:
                              theme === "dark"
                                ? "var(--surface-tint)"
                                : "var(--accent-subtle-bg)",
                          }}
                          className={`hover:scale-[1.03] active:scale-[0.97] rounded-lg transition-all cursor-pointer flex items-center justify-center border ${
                            theme === "dark"
                              ? "border-white/[0.08]"
                              : "border-slate-200 shadow-xs"
                          }`}
                          title="Next Announcement"
                        >
                          <ChevronRight
                            className="w-[18px] h-[18px]"
                            style={{ color: "var(--accent)" }}
                          />
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
