/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { Flame, Play, Plus, Trash2, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, Search } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { COMMON_SMOKE_TEST_PEDS } from "../constants/commonSmokeTestPeds";
import { getMatchTierInfo } from "../utils/matchTier";
import { CustomSelect } from "../components/CustomSelect";
import { ClippedButton } from "../components/ClippedButton";

interface CustomSmokeTestPed {
  id: number;
  term: string;
  addedBy: string;
  createdAt: string;
}

interface SmokeTestResult {
  ped: string;
  resolved: boolean;
  match_type?: string;
  matched_question?: string;
  question_number?: number;
  explanation?: string;
}

interface SmokeTestPageProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Owner";
  currentUser: LoggedUser | null;
  productionPlans: string[];
  selectedPlan: string;
  setSelectedPlan: (plan: string) => void;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

/**
 * Smoke Test page — runs a fixed baseline of 100 common PEDs
 * (COMMON_SMOKE_TEST_PEDS), plus any Admin/Owner-added custom entries
 * (the `smoke_test_peds` table), through the deterministic mapping engine
 * for one selected plan at a time, via POST /api/smoke-test. Deliberately
 * bypasses the Gemini AI fallback /api/match would use — an "Unresolved"
 * result here specifically means this PED would silently fall through to
 * AI in production, which is itself the signal this page exists to catch
 * before an advisor hits it live.
 *
 * Visible to every tier (read/run); adding or removing a custom PED is
 * gated to Admin/Owner both here and server-side (requireAdminOrOwner),
 * same pattern as the PED Directory page.
 */
export function SmokeTestPage({
  theme,
  effectiveTier,
  currentUser,
  productionPlans,
  selectedPlan,
  setSelectedPlan,
  setChangeLogs,
}: SmokeTestPageProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Admin" || effectiveTier === "Owner";

  const logAction = (actionType: string, description: string) => {
    setChangeLogs((prev) => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Mehruf P (Owner)",
        role: effectiveTier,
        actionType,
        planName: "Smoke Test",
        description,
      },
      ...prev,
    ]);
  };

  const [customPeds, setCustomPeds] = useState<CustomSmokeTestPed[]>([]);
  const [customLoading, setCustomLoading] = useState(true);
  const [customError, setCustomError] = useState<string | null>(null);
  const [newTerm, setNewTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [results, setResults] = useState<SmokeTestResult[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [filterTier, setFilterTier] = useState<"all" | "1" | "2" | "3" | "unresolved" | "clarify">("all");

  // Baseline PED list panel — lets an Admin/Owner quickly check whether a
  // PED they care about is already covered by the fixed 100-entry baseline
  // (COMMON_SMOKE_TEST_PEDS) before deciding whether it's worth adding as a
  // custom entry below.
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineSearch, setBaselineSearch] = useState("");

  const loadCustomPeds = async () => {
    setCustomLoading(true);
    try {
      const res = await fetch("/api/smoke-test-peds");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load custom PEDs (HTTP ${res.status}).`);
      }
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setCustomPeds(data.entries);
        setCustomError(null);
      }
    } catch (err: any) {
      setCustomError(err.message || "Could not reach the server. Showing the last loaded custom list.");
    } finally {
      setCustomLoading(false);
    }
  };

  useEffect(() => {
    loadCustomPeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default the plan picker to the first available production plan the
  // very first time this page has nothing selected yet — mirrors how the
  // Lookup page's plan picker behaves.
  useEffect(() => {
    if (!selectedPlan && productionPlans.length > 0) {
      setSelectedPlan(productionPlans[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionPlans]);

  const fullPedList = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    [...COMMON_SMOKE_TEST_PEDS, ...customPeds.map((c) => c.term)].forEach((term) => {
      const key = term.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(term.trim());
      }
    });
    return merged;
  }, [customPeds]);

  const runSmokeTest = async () => {
    if (!selectedPlan) return;
    setIsRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/smoke-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName: selectedPlan, peds: fullPedList }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Smoke test failed (HTTP ${res.status}).`);
      setResults(Array.isArray(body.results) ? body.results : []);
    } catch (err: any) {
      setRunError(err.message || "Failed to run the smoke test. Please try again.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleAddCustomPed = async () => {
    const term = newTerm.trim();
    if (!term) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/smoke-test-peds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add this PED (HTTP ${res.status}).`);
      setCustomPeds((prev) => [...prev, body.entry].sort((a, b) => a.term.localeCompare(b.term)));
      logAction("Smoke Test PED Added", `Added "${body.entry.term}" to the Smoke Test custom PED list.`);
      setNewTerm("");
    } catch (err: any) {
      setAddError(err.message || "Failed to add this PED. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteCustomPed = async (entry: CustomSmokeTestPed) => {
    setDeletingId(entry.id);
    try {
      const res = await fetch(`/api/smoke-test-peds/${entry.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to remove this PED (HTTP ${res.status}).`);
      setCustomPeds((prev) => prev.filter((p) => p.id !== entry.id));
      logAction("Smoke Test PED Removed", `Removed "${entry.term}" from the Smoke Test custom PED list.`);
    } catch (err: any) {
      setCustomError(err.message || "Failed to remove this PED. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const summary = useMemo(() => {
    if (!results) return null;
    const counts = { direct: 0, category: 0, fallback: 0, clarify: 0, unresolved: 0 };
    results.forEach((r) => {
      if (!r.resolved) {
        counts.unresolved++;
        return;
      }
      const tier = getMatchTierInfo(r.match_type);
      if (tier.level === 1) counts.direct++;
      else if (tier.level === 2) counts.category++;
      else if (tier.level === 3) counts.fallback++;
      else counts.clarify++;
    });
    return counts;
  }, [results]);

  const filteredResults = useMemo(() => {
    if (!results) return [];
    if (filterTier === "all") return results;
    if (filterTier === "unresolved") return results.filter((r) => !r.resolved);
    return results.filter((r) => {
      if (!r.resolved) return false;
      const tier = getMatchTierInfo(r.match_type);
      if (filterTier === "clarify") return tier.level === null;
      return String(tier.level) === filterTier;
    });
  }, [results, filterTier]);

  const filteredBaseline = useMemo(() => {
    const q = baselineSearch.trim().toLowerCase();
    if (!q) return COMMON_SMOKE_TEST_PEDS;
    return COMMON_SMOKE_TEST_PEDS.filter((p) => p.toLowerCase().includes(q));
  }, [baselineSearch]);

  // Downloads the full (unfiltered) result set for the current run as a
  // CSV — a plain client-side Blob download, no server round-trip needed
  // since the results are already in memory.
  const downloadResultsCsv = () => {
    if (!results || results.length === 0) return;
    const header = ["PED", "Status", "Match Tier", "Matched Question", "Question Number", "Explanation"];
    const escapeCsv = (value: string | number | null | undefined) => {
      const str = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const rows = results.map((r) => {
      if (!r.resolved) {
        return [r.ped, "Unresolved", "", "", "", "No deterministic rule matched — would fall through to the AI fallback in production."];
      }
      const tier = getMatchTierInfo(r.match_type);
      return [r.ped, "Resolved", tier.label, r.matched_question || "", r.question_number ?? "", r.explanation || ""];
    });
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    anchor.href = url;
    anchor.download = `smoke-test-${(selectedPlan || "plan").replace(/\s+/g, "_")}-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  // ── BLACK ANODIZED METAL THEME ───────────────────────────────────────
  // This page is intentionally off-theme: matte black surfaces with
  // restrained orange-ember accents, regardless of the app's light/dark
  // setting. Per spec: orange is a highlight for attention/interaction,
  // never the dominant surface color — depth comes from shadow/elevation,
  // not heavy borders.
  //
  // Typography scale (spec): primary #F2F2F2, secondary #A8A8A8,
  // muted #6B6B6B, accent #E08D4B.
  const headingText = "text-[#F2F2F2]"; // primary — titles, values, PED names
  const secondaryText = "text-[#A8A8A8]"; // descriptions, labels, matched-question text
  const mutedText = "text-[#6B6B6B]"; // lowest emphasis — empty states, footnotes
  const accentText = "text-[#E08D4B]";

  const rowDivider = "border-[rgba(255,255,255,0.06)]";

  // Card hierarchy — three emphasis levels via background/elevation, not
  // heavier borders. Hero = highest emphasis (subtle gradient), Control =
  // medium, Baseline/Results = lowest (slightly lighter bg, doubles as the
  // primary working area). All cards share the same restrained
  // border/shadow escalation on hover.
  const cardTransition = "transition-all duration-200";
  const cardShadow = "shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.55)]";
  // No `overflow-hidden` here (unlike workCard below): this card holds the
  // Plan CustomSelect, whose options panel is an absolutely-positioned
  // dropdown that opens below the trigger. `overflow-hidden` was clipping
  // that panel at the card's bottom edge, hiding/disabling every plan past
  // the first couple. Nothing in this card relies on edge-to-edge clipping,
  // so it's safe to leave visible.
  // z-20: without an explicit z-index here, this card and the results card
  // below it are both merely `position: relative` (z-index: auto), so they
  // tie on stacking order and the later one (results) paints over anything
  // that escapes this card's bounds — including the Plan dropdown's panel,
  // which needs to spill out over the results card, not sit underneath it.
  const controlCard = `relative z-20 rounded-[20px] border border-[rgba(224,141,75,0.12)] hover:border-[rgba(224,141,75,0.40)] bg-[#0B0B0B] ${cardShadow} ${cardTransition}`;
  const controlCardStyle: CSSProperties = { padding: 29 };
  const workCard = `relative overflow-hidden rounded-[20px] border border-[rgba(224,141,75,0.10)] hover:border-[rgba(224,141,75,0.40)] bg-[#0D0D0D] ${cardShadow} ${cardTransition}`;
  const workCardStyle: CSSProperties = { padding: 29 };

  // Inputs
  const inputClass =
    "bg-[#090909] border-[rgba(255,255,255,0.06)] text-[#F2F2F2] placeholder:text-[#6B6B6B] focus:border-[#E08D4B] focus:shadow-[0_0_12px_rgba(224,141,75,0.15)] outline-none transition-all";

  // PED chips — default / hover / selected per spec (selected state applied
  // by call sites that track selection; the shared class below is the
  // default+hover pairing used everywhere chips aren't individually
  // "selected").
  const chipClass =
    "border-[rgba(224,141,75,0.18)] text-[#D8D8D8] bg-[#111111] hover:bg-[#181818] hover:border-[#E08D4B] hover:shadow-[0_0_10px_rgba(224,141,75,0.18)] transition-all";

  // Primary button — gradient fill, no border, 12px radius, restrained
  // hover glow. Kept on the app-wide ClippedButton (shared clipped-corner
  // shape used on every page's primary CTA) — only the fill/shadow colors
  // are page-local, the corner-cut shape itself is the app's identity and
  // isn't overridden here.
  const primaryButtonStyle: CSSProperties = { background: "linear-gradient(180deg, #E29A61, #C77A42)" };
  const primaryButtonClass =
    "hover:brightness-[1.06] hover:shadow-[0_0_18px_rgba(224,141,75,0.25)] transition-all";

  // Referenced so the theme prop stays wired even though the page renders
  // dark regardless; keeps CustomSelect's own chevron/hover in step.
  void dark;

  return (
    // PAGE SURFACE — no background of its own. The ember page backdrop
    // (assets/smoketest_page.png) is rendered one level up, in App.tsx,
    // at the same shell layer as the app's default navy pattern — see the
    // "SMOKE TEST EXCEPTION" comment there. That layer fills the FULL
    // content area regardless of how tall this page's content is, which a
    // background on this div alone could never do: this div only ever
    // covers its own content height, so anywhere the app shell was taller
    // than the content (nearly always, since <main> grows to fill the
    // viewport), the app's navy pattern showed through below the cards.
    // "smoke-test-scope" marks this subtree as exempt from the light-theme
    // compat-layer coercion rules in index.css (heading colors, input colors)
    // — see the matching "SMOKE TEST EXCEPTION" block there.
    <div className="smoke-test-scope relative w-full flex flex-col gap-8">
      {/* PAGE-LEVEL HEADER — standardized layout app-wide (see Coverage
          Projection Studio, the reference implementation): flat, no card
          surface, accent line + title sitting directly on the page. Colors
          stay pinned to this page's own fixed dark palette rather than the
          app's normal light/dark tokens — the page surface itself is
          intentionally always-dark (see the "SMOKE TEST EXCEPTION" in
          App.tsx), so a light-theme header here would be unreadable against
          it regardless of what the app-wide theme toggle is set to. */}
      <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b ${rowDivider}`}>
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${headingText}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: "#E08D4B" }} />
            <span>Smoke Test</span>
          </h1>
          <p className={`text-xs mt-1.5 font-semibold ${secondaryText}`}>
            Runs {fullPedList.length} common PEDs through the deterministic mapping engine for the selected plan — no AI
            fallback. An "Unresolved" result means this PED would silently fall through to the AI fallback in
            production, which is exactly what this page exists to catch early.
          </p>
        </div>
      </div>

      {/* CONTROLS — medium emphasis. Two columns: left = plan + Run + summary; right = Custom PEDs. */}
      <div className={`${controlCard} flex flex-col lg:flex-row`} style={{ ...controlCardStyle, gap: 28 }}>
        <div className="relative z-10 flex flex-wrap items-end flex-1 min-w-0 content-start" style={{ gap: 20 }}>
          <div className="flex flex-col gap-1">
            <label className={`text-[10px] font-black uppercase tracking-wider ${accentText}`}>Plan</label>
            <div className="w-52">
              <CustomSelect
                theme="dark"
                value={selectedPlan}
                onChange={(val) => {
                  setSelectedPlan(val);
                  setResults(null);
                }}
                triggerClassName={`w-full flex items-center justify-between gap-2 text-sm font-semibold rounded-xl pl-3 pr-8 py-2 border outline-none relative ${inputClass}`}
                panelClassName="bg-[#111111] border-[rgba(224,141,75,0.18)] text-[#F2F2F2]"
                selectedOptionClassName="bg-[rgba(224,141,75,0.10)] text-white border-[#E08D4B]"
                checkColorClassName="text-[#E08D4B]"
                options={productionPlans.map((p) => ({ value: p, label: p }))}
              />
            </div>
          </div>

          <ClippedButton
            onClick={runSmokeTest}
            disabled={isRunning || !selectedPlan}
            size="md"
            className={`gap-1.5 text-sm font-bold px-4 py-2 text-white ${primaryButtonClass}`}
            style={primaryButtonStyle}
          >
            {isRunning ? <Flame className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4" />}
            {isRunning ? "Running…" : "Run Smoke Test"}
          </ClippedButton>

          {runError && (
            <span className="text-xs font-semibold text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {runError}
            </span>
          )}

          {summary && (
            <div className="flex flex-wrap items-center gap-2 w-full">
              {(
                [
                  ["Direct", summary.direct, "#6EE7B7"],
                  ["Category", summary.category, "#93C5FD"],
                  ["Fallback", summary.fallback, "#FCD34D"],
                  ["Needs Review", summary.clarify, "#94A3B8"],
                  ["Unresolved", summary.unresolved, "#F87171"],
                ] as const
              ).map(([label, count, c]) => (
                <span
                  key={label}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{ color: c, backgroundColor: `${c}22` }}
                >
                  {label}: {count}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: Custom PEDs */}
        <div className="relative z-10 lg:w-[380px] shrink-0 lg:border-l lg:border-[rgba(255,255,255,0.06)] lg:pl-5 border-t border-[rgba(255,255,255,0.06)] pt-5 lg:border-t-0 lg:pt-0">
          <h3 className={`text-xs font-black uppercase tracking-wider mb-2 flex items-center gap-1.5 ${accentText}`}>
            <Flame className="w-3.5 h-3.5 shrink-0" style={{ color: "#E08D4B" }} />
            Custom PEDs
          </h3>

          {customError && <p className="text-xs font-semibold text-red-400 mb-2">{customError}</p>}

          {canManage && (
            <div className="flex items-center gap-2 mb-2">
              <input
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCustomPed();
                }}
                placeholder="Add a custom PED (e.g. Sarcoidosis)"
                className={`flex-1 min-w-0 text-sm rounded-xl px-3 py-2 border outline-none ${inputClass}`}
              />
              <ClippedButton
                onClick={handleAddCustomPed}
                disabled={adding || !newTerm.trim()}
                size="md"
                className={`gap-1 text-sm font-bold px-3 py-2 text-white shrink-0 ${primaryButtonClass}`}
                style={primaryButtonStyle}
              >
                <Plus className="w-4 h-4" /> Add
              </ClippedButton>
            </div>
          )}
          {addError && <p className="text-xs font-semibold text-red-400 mb-2">{addError}</p>}

          {customLoading ? (
            <p className={`text-xs ${mutedText}`}>Loading custom PEDs…</p>
          ) : customPeds.length === 0 ? (
            <p className={`text-xs ${mutedText}`}>
              None yet — the {COMMON_SMOKE_TEST_PEDS.length} baseline PEDs always run.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {customPeds.map((entry) => (
                <span
                  key={entry.id}
                  className={`flex items-center gap-1.5 text-xs font-semibold pl-3 pr-1.5 py-1 rounded-full border ${chipClass}`}
                  title={`Added by ${entry.addedBy}`}
                >
                  {entry.term}
                  {canManage && (
                    <button
                      onClick={() => handleDeleteCustomPed(entry)}
                      disabled={deletingId === entry.id}
                      className="p-0.5 rounded-full hover:bg-red-500/15 text-red-400 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RESULTS — lowest emphasis, primary working area. */}
      {results && (
        <div className={workCard}>
          <div className={`relative z-10 flex items-center gap-2 px-5 py-3 border-b ${rowDivider}`}>
            <span className={`text-xs font-black uppercase tracking-wider ${accentText}`}>Filter</span>
            {(
              [
                ["all", "All"],
                ["1", "Direct"],
                ["2", "Category"],
                ["3", "Fallback"],
                ["clarify", "Needs Review"],
                ["unresolved", "Unresolved"],
              ] as const
            ).map(([value, label]) => {
              const isActive = filterTier === value;
              const buttonLabel: string = label;
              // `key` deliberately lives on this wrapping Fragment, not on
              // ClippedButton itself — putting it directly on ClippedButton
              // inside this .map() trips a TS/JSX inference quirk here
              // ("Property 'key' does not exist on type ClippedButtonProps",
              // even though key is never part of that props type) that
              // doesn't reproduce on any of this component's non-mapped call
              // sites elsewhere in the app. The Fragment sidesteps it
              // entirely without changing what actually renders.
              return (
                <Fragment key={String(value)}>
                  <ClippedButton
                    onClick={() => setFilterTier(value)}
                    size="sm"
                    className={`text-[11px] font-bold px-2.5 py-1 ${
                      isActive ? "text-white" : `${secondaryText} hover:text-[#F2F2F2]`
                    }`}
                    style={isActive ? primaryButtonStyle : { background: "#111111" }}
                  >
                    {buttonLabel}
                  </ClippedButton>
                </Fragment>
              );
            })}

            <ClippedButton
              onClick={downloadResultsCsv}
              size="sm"
              className={`ml-auto gap-1.5 text-[11px] font-bold px-2.5 py-1 ${secondaryText} hover:text-[#F2F2F2]`}
              style={{ background: "#111111" }}
              title="Download the full result set as a CSV file"
            >
              <Download className="w-3.5 h-3.5" /> Download CSV
            </ClippedButton>
          </div>

          <div className="relative z-10 max-h-[520px] overflow-y-auto">
            {filteredResults.map((r, idx) => {
              const tier = r.resolved ? getMatchTierInfo(r.match_type) : null;
              return (
                <div
                  key={`${r.ped}-${idx}`}
                  className={`flex items-start gap-3 px-5 py-3 border-b last:border-b-0 ${rowDivider}`}
                >
                  <span className={`text-sm font-bold w-48 shrink-0 truncate ${headingText}`}>
                    {r.ped}
                  </span>
                  {r.resolved && tier ? (
                    <>
                      <span
                        className="text-[10.5px] font-black uppercase tracking-wide px-2 py-0.5 rounded shrink-0"
                        style={{ color: tier.colorDark, backgroundColor: tier.bgDark }}
                      >
                        {tier.icon} {tier.label}
                      </span>
                      <span className={`text-xs flex-1 min-w-0 truncate ${secondaryText}`}>
                        {r.matched_question || "—"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10.5px] font-black uppercase tracking-wide px-2 py-0.5 rounded shrink-0 text-red-400 bg-red-500/15">
                        ⚠️ Unresolved (needs AI)
                      </span>
                      <span className={`text-xs flex-1 min-w-0 ${secondaryText}`}>
                        No deterministic rule matched — this PED would go to the Gemini AI fallback in production.
                      </span>
                    </>
                  )}
                </div>
              );
            })}
            {filteredResults.length === 0 && (
              <div className={`px-5 py-8 text-center text-sm ${mutedText}`}>No results in this filter.</div>
            )}
          </div>
        </div>
      )}

      {/* BASELINE PED LIST — lowest emphasis. */}
      <div className={workCard} style={workCardStyle}>
        <div className="relative z-10">
        <button
          onClick={() => setShowBaseline((v) => !v)}
          className="w-full flex items-center justify-between text-left cursor-pointer"
        >
          <span className={`text-xs font-black uppercase tracking-wider ${accentText}`}>
            Baseline PEDs Already Covered ({COMMON_SMOKE_TEST_PEDS.length})
          </span>
          {showBaseline ? (
            <ChevronUp className={`w-4 h-4 ${mutedText}`} />
          ) : (
            <ChevronDown className={`w-4 h-4 ${mutedText}`} />
          )}
        </button>
        <p className={`text-[11.5px] leading-relaxed mt-1 ${secondaryText}`}>
          These {COMMON_SMOKE_TEST_PEDS.length} PEDs are hardcoded into every smoke test run automatically. Check here
          before adding a custom PED above — if it's already in this list, there's no need to add it again.
        </p>

        {showBaseline && (
          <div className="mt-3">
            <div className="relative mb-3">
              <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}`} />
              <input
                value={baselineSearch}
                onChange={(e) => setBaselineSearch(e.target.value)}
                placeholder="Search the baseline list…"
                className={`w-full text-sm rounded-xl pl-8 pr-3 py-2 border outline-none ${inputClass}`}
              />
            </div>
            <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto">
              {filteredBaseline.map((ped) => (
                <span
                  key={ped}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${chipClass}`}
                >
                  {ped}
                </span>
              ))}
              {filteredBaseline.length === 0 && (
                <p className={`text-xs ${mutedText}`}>
                  No match in the baseline list — this PED is safe to add as a custom entry above.
                </p>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {results === null && !isRunning && (
        <div className={`flex items-center gap-2 text-sm ${accentText}`}>
          <CheckCircle2 className="w-4 h-4" /> Select a plan and click "Run Smoke Test" to see results.
        </div>
      )}
    </div>
  );
}
