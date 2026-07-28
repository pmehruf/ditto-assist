/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import {
  Target,
  CheckCircle2,
  Info,
  Check,
  X,
  Search,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  ListPlus,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  MASTER_ILLNESSES,
  matchSpecificIllness,
  SpecificIllnessMatchResult,
  MasterIllnessDefinition,
} from "../specificIllnessEngine";
import { DbPlanConfigEntry, SpecificIllnessEntry } from "../types/plans";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { SortableTh } from "./SortableTh";
import { useSortableData, stringComparator, numberComparator } from "../utils/useSortableData";

interface SpecificIllnessLedgerProps {
  theme: "light" | "dark";
  /** Every known plan name (built-in + custom) — populates the plan picker
   * in the "manage" editor below. */
  allPlanNames: string[];
  /** Current DB-backed plan rows, so the editor can preload a plan's
   * existing specificIllnesses when selected. */
  dbPlanConfigs: DbPlanConfigEntry[];
  /** Whether the signed-in user may save changes (Admin/Owner) — read-only
   * users still see the catalog/sandbox, just not the editor's controls. */
  canEdit: boolean;
  /** Persists a plan's full specificIllnesses list. Defined in
   * PlanManagementPage.tsx since it needs access to the hardcoded plan
   * configs (to backfill insurerName/questions/categoryMap when a built-in
   * plan has no DB row yet) and to the shared dbPlanConfigs state setter. */
  onSaveIllnesses: (planName: string, illnesses: SpecificIllnessEntry[]) => Promise<void>;
}

type ManageRow = SpecificIllnessEntry & { key: string };
let manageRowKeySeq = 0;
const nextManageRowKey = () => `manage-row-${Date.now()}-${manageRowKeySeq++}`;

// The four base plans the hardcoded MASTER_ILLNESSES schedules are written
// against (specificIllnessEngine.ts's PLANS_IN_SCOPE default). Shown as
// fixed columns/badges in both the catalog table and the sandbox's plan
// exclusion check, matching the reference screenshots exactly — every row
// always shows all four abbreviations, dimmed when that plan has no
// schedule for the illness rather than being omitted.
const BASE_PLANS = ["Optima Secure", "Care Supreme", "Activ One Max", "Activ Fit Preferred", "Aspire", "Reassure 2.0"];
const PLAN_ABBREVIATIONS: Record<string, string> = {
  "Optima Secure": "OS",
  "Care Supreme": "CS",
  "Activ One Max": "AOM",
  "Activ Fit Preferred": "AFP",
  "Aspire": "ASP",
  "Reassure 2.0": "R2.0",
};
function getPlanAbbrev(name: string): string {
  if (PLAN_ABBREVIATIONS[name]) return PLAN_ABBREVIATIONS[name];
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

const MATCH_TYPE_LABELS: Record<SpecificIllnessMatchResult["match_type"], string> = {
  direct: "Direct",
  alias: "Alias",
  procedure_mapped: "Procedure",
  sub_condition: "Sub-Condition",
  broad_category: "Broad Category",
  no_match: "No Match",
};

const POPULAR_TEST_CONDITIONS = [
  "Piles",
  "BPH",
  "Slipped disc",
  "Cholecystectomy",
  "Psoriasis",
  "DNS",
  "Fibroids",
  "Lump in breast",
];

const CATEGORIES = Array.from(new Set(MASTER_ILLNESSES.map((m) => m.category))).sort();

/**
 * "Specific Illness Ledger" — surfaces the MASTER_ILLNESSES catalog that has
 * lived only inside specificIllnessEngine.ts's source code (never visible in
 * any UI) plus a live sandbox for testing matchSpecificIllness() against a
 * declared PED. Rebuilt from a screenshot of an earlier version of the app
 * that had this as its own page; the underlying data/engine already existed
 * and is unchanged here — this is a read/test surface on top of it, not a
 * new matching pathway. Lives as a second sub-tab inside Plan Management
 * (see PlanManagementPage.tsx's planMgmtView toggle).
 */
export function SpecificIllnessLedger({
  theme,
  allPlanNames,
  dbPlanConfigs,
  canEdit,
  onSaveIllnesses,
}: SpecificIllnessLedgerProps) {
  const dark = theme === "dark";

  const [pedInput, setPedInput] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("All Categories");

  // --- Plan-Specific Illness manager (moved here from the plan add/edit
  // wizard — this is now the one place to add/edit a plan's Specific
  // Illness List, whether that plan is built-in or custom). ---
  const dbByPlanName = useMemo(() => {
    const map: Record<string, DbPlanConfigEntry> = {};
    dbPlanConfigs.forEach((row) => { map[row.planName] = row; });
    return map;
  }, [dbPlanConfigs]);

  const [managePlan, setManagePlan] = useState("");
  const [manageRows, setManageRows] = useState<ManageRow[]>([]);
  const [manageSaving, setManageSaving] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageSaved, setManageSaved] = useState(false);
  // Same view-first/edit-on-request pattern as Category Mapping in
  // PlanManagementPage.tsx: selecting a plan shows its current Specific
  // Illness List read-only; editable inputs only appear once "Edit" is
  // clicked. Reused by the Cancel button (via handleSelectManagePlan) to
  // discard unsaved edits and drop back to view.
  const [manageMode, setManageMode] = useState<"view" | "edit">("view");

  const handleSelectManagePlan = (name: string) => {
    setManagePlan(name);
    setManageError(null);
    setManageSaved(false);
    setManageMode("view");

    const dbEntries = dbByPlanName[name]?.specificIllnesses || [];
    const dbIllnessNamesLower = new Set(dbEntries.map((si) => si.illness.trim().toLowerCase()));

    // Pre-populate with whatever this plan's specific illness list already
    // effectively is, per the hardcoded MASTER_ILLNESSES schedules (parent
    // illness + category) in specificIllnessEngine.ts. Without this, a plan
    // like Care Supreme — which has plenty of specific-illness schedule
    // text baked into MASTER_ILLNESSES's source code but no DB row yet —
    // showed up here as "no entries", which isn't true; it just meant
    // nothing had been migrated into the DB-managed list yet. A hardcoded
    // entry is skipped if a DB entry with the same illness name already
    // exists, so saving doesn't create a duplicate.
    const hardcodedEntries = MASTER_ILLNESSES
      .filter((def) => Boolean(def.plan_schedules[name]))
      .filter((def) => !dbIllnessNamesLower.has(def.parent_illness.trim().toLowerCase()))
      .map((def) => ({ category: def.category as string, illness: def.parent_illness }));

    const combined = [...dbEntries, ...hardcodedEntries];
    setManageRows(combined.map((si) => ({ key: nextManageRowKey(), category: si.category || "", illness: si.illness })));
  };

  const addManageRow = () => setManageRows((prev) => [...prev, { key: nextManageRowKey(), category: "", illness: "" }]);
  const removeManageRow = (key: string) => setManageRows((prev) => prev.filter((r) => r.key !== key));
  const updateManageRow = (key: string, patch: Partial<ManageRow>) =>
    setManageRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const handleSaveManageRows = async () => {
    if (!managePlan) return;
    setManageSaving(true);
    setManageError(null);
    setManageSaved(false);
    try {
      const clean = manageRows
        .map((r) => ({ category: r.category?.trim() || undefined, illness: r.illness.trim() }))
        .filter((r) => r.illness);
      await onSaveIllnesses(managePlan, clean);
      setManageSaved(true);
      setManageMode("view");
      setTimeout(() => setManageSaved(false), 2500);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Failed to save this plan's specific illness list.");
    } finally {
      setManageSaving(false);
    }
  };

  const results = useMemo<SpecificIllnessMatchResult[] | null>(() => {
    const trimmed = pedInput.trim();
    if (!trimmed) return null;
    return matchSpecificIllness(trimmed);
  }, [pedInput]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return MASTER_ILLNESSES.filter((def) => {
      const matchesCategory = catalogCategory === "All Categories" || def.category === catalogCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      const haystack = [
        def.parent_illness,
        def.category,
        ...def.direct_names,
        ...def.aliases,
        ...def.procedures,
        ...def.sub_conditions,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [catalogSearch, catalogCategory]);

  // The Aliases/Procedures/Sub-Conditions/Applicable-Plans columns each hold
  // a list, not a single value, so "sort by this column" sorts by how many
  // entries that row has (most first on ascending... well, smallest first —
  // toggle to descending for "most first"), which is the only well-defined
  // ordering for a list column.
  const { sorted: sortedCatalog, sort: catalogSort, toggleSort: toggleCatalogSort } = useSortableData(
    filteredCatalog,
    {
      parent_illness: stringComparator((def: MasterIllnessDefinition) => def.parent_illness),
      aliases: numberComparator((def: MasterIllnessDefinition) => def.aliases.length),
      procedures: numberComparator((def: MasterIllnessDefinition) => def.procedures.length),
      sub_conditions: numberComparator((def: MasterIllnessDefinition) => def.sub_conditions.length),
      plan_schedules: numberComparator((def: MasterIllnessDefinition) =>
        BASE_PLANS.filter((plan) => Boolean(def.plan_schedules[plan])).length
      ),
    }
  );

  const cardClass = `rounded-2xl border transition-all ${
    dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
  }`;
  const labelClass = `text-[10px] font-black uppercase tracking-wider font-mono ${
    dark ? "text-stone-400" : "text-stone-500"
  }`;
  const inputClass = `w-full text-xs p-2.5 rounded-lg border outline-none transition-colors ${
    dark
      ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA] focus:border-blue-500/40"
      : "bg-white border-stone-200 text-stone-900 focus:border-blue-400"
  }`;

  const pillClass = `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
    dark ? "bg-white/[0.03] border-white/[0.1] text-stone-300" : "bg-stone-50 border-stone-200 text-stone-700"
  }`;
  const procedurePillClass = `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
    dark ? "bg-amber-500/10 border-amber-500/25 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-800"
  }`;
  const subConditionPillClass = `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
    dark ? "bg-teal-500/10 border-teal-500/25 text-teal-300" : "bg-teal-50 border-teal-200 text-teal-800"
  }`;

  return (
    <div className="space-y-5">
      {/* Title block for the ledger sub-tab */}
      <div>
        <h3 className={`text-base font-black tracking-tight ${dark ? "text-white" : "text-stone-900"}`}>
          Specific Illness waiting period ledger
        </h3>
        <p className={`text-xs font-medium mt-0.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
          Compliance matching engine for 2-year specific exclusion waiting periods in Indian health insurance schedules.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT: Matching Ledger Sandbox */}
        <div className={`lg:col-span-5 p-5 space-y-4 ${cardClass}`}>
          <div className="flex items-center gap-2 pb-2.5 border-b border-stone-200 dark:border-stone-850">
            <Target className={`w-4 h-4 ${dark ? "text-violet-400" : "text-violet-600"}`} />
            <h4 className={`text-xs font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
              Matching Ledger Sandbox
            </h4>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Adviser Declared PED (Pre-Existing Condition)</label>
            <div className="relative">
              <input
                value={pedInput}
                onChange={(e) => setPedInput(e.target.value)}
                placeholder="e.g. piles, BPH, slipped disc..."
                className={`${inputClass} pr-8`}
              />
              {pedInput && (
                <button
                  onClick={() => setPedInput("")}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded cursor-pointer ${
                    dark ? "text-stone-500 hover:text-stone-300" : "text-stone-400 hover:text-stone-600"
                  }`}
                  title="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Popular Test Conditions</label>
            <div className="grid grid-cols-2 gap-2">
              {POPULAR_TEST_CONDITIONS.map((cond) => {
                const active = pedInput.trim().toLowerCase() === cond.toLowerCase();
                return (
                  <button
                    key={cond}
                    onClick={() => setPedInput(cond)}
                    className={`text-left text-xs font-semibold px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                      active
                        ? (dark ? "bg-violet-500/15 border-violet-500/40 text-violet-300" : "bg-violet-50 border-violet-300 text-violet-700")
                        : (dark ? "bg-white/[0.02] border-white/[0.06] text-stone-300 hover:bg-white/[0.05]" : "bg-stone-50 border-stone-150 text-stone-700 hover:bg-stone-100")
                    }`}
                  >
                    {cond}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`rounded-xl p-3.5 space-y-2 ${dark ? "bg-white/[0.02] border border-white/[0.06]" : "bg-stone-50 border border-stone-150"}`}>
            <div className="flex items-center gap-1.5">
              <Info className={`w-3.5 h-3.5 ${dark ? "text-sky-400" : "text-sky-600"}`} />
              <span className={`text-[10px] font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
                Compliance Rules Summary
              </span>
            </div>
            <ul className={`text-[11px] leading-relaxed space-y-1 pl-4 list-disc ${dark ? "text-stone-400" : "text-stone-600"}`}>
              <li><b className={dark ? "text-stone-200" : "text-stone-800"}>Rule 1: Direct name match</b> holds exact synonyms.</li>
              <li><b className={dark ? "text-stone-200" : "text-stone-800"}>Rule 2: Procedures map</b> surgical words to diagnosis.</li>
              <li><b className={dark ? "text-stone-200" : "text-stone-800"}>Rule 3: Sub-conditions</b> bind clinical subparts to parents.</li>
              <li><b className={dark ? "text-stone-200" : "text-stone-800"}>Rule 4: Broad categories</b> resolve umbrella classes.</li>
              <li><b className={dark ? "text-stone-200" : "text-stone-800"}>Rule 5: Plan presence</b> validates active specific schedules.</li>
            </ul>
          </div>
        </div>

        {/* RIGHT: Live Sandbox Mapping Results */}
        <div className={`lg:col-span-7 p-5 space-y-4 ${cardClass}`}>
          <div className="flex items-center justify-between pb-2.5 border-b border-stone-200 dark:border-stone-850">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`w-4 h-4 ${dark ? "text-emerald-400" : "text-emerald-600"}`} />
              <h4 className={`text-xs font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
                Live Sandbox Mapping Results
              </h4>
            </div>
            {results && results[0].match_type !== "no_match" && (
              <span className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${
                dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}>
                Specific Wait Mapped
              </span>
            )}
          </div>

          {!results ? (
            <p className={`text-xs italic ${dark ? "text-stone-500" : "text-stone-400"}`}>
              Enter a declared condition on the left to test it against the specific illness matching engine.
            </p>
          ) : (
            results.map((result, idx) => (
              <div key={idx} className="space-y-3">
                <div className={`p-3.5 rounded-xl border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-stone-50 border-stone-150"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-bold ${dark ? "text-white" : "text-stone-900"}`}>
                      "{result.declared_condition}"{" "}
                      {result.matched_listed_illness && (
                        <>
                          <span className={dark ? "text-stone-500" : "text-stone-400"}> → </span>
                          <span className={`underline decoration-dotted ${dark ? "text-sky-300" : "text-sky-700"}`}>
                            {result.matched_listed_illness}
                          </span>
                        </>
                      )}
                    </p>
                    <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded ${
                      result.match_type === "no_match"
                        ? (dark ? "bg-stone-500/15 text-stone-400" : "bg-stone-100 text-stone-500")
                        : (dark ? "bg-blue-500/15 text-blue-300" : "bg-blue-50 text-blue-700 border border-blue-200")
                    }`}>
                      Match Type: {MATCH_TYPE_LABELS[result.match_type]}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-1.5 leading-relaxed ${dark ? "text-stone-400" : "text-stone-600"}`}>
                    {result.notes}
                  </p>
                </div>

                {result.match_type !== "no_match" && (
                  <div className="space-y-2">
                    <label className={labelClass}>Plan Exclusion Check (Does 2-Year Wait Exist?)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {BASE_PLANS.map((plan) => {
                        const applies = result.plans_applicable.includes(plan);
                        const scheduleText = MASTER_ILLNESSES.find(
                          (d) => d.parent_illness === result.matched_listed_illness
                        )?.plan_schedules[plan];
                        return (
                          <div
                            key={plan}
                            className={`p-2.5 rounded-lg border ${
                              applies
                                ? (dark ? "bg-red-500/[0.06] border-red-500/25" : "bg-red-50/60 border-red-200")
                                : (dark ? "bg-white/[0.015] border-white/[0.05]" : "bg-stone-50 border-stone-150")
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-xs font-bold ${
                                applies
                                  ? (dark ? "text-red-300" : "text-red-700")
                                  : (dark ? "text-stone-500" : "text-stone-400")
                              }`}>
                                {plan}
                              </span>
                              {applies ? (
                                <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide ${
                                  dark ? "text-amber-400" : "text-amber-700"
                                }`}>
                                  <AlertTriangle className="w-3 h-3" /> 2-Yr Wait Applies
                                </span>
                              ) : (
                                <span className={`text-[9px] font-black uppercase tracking-wide ${dark ? "text-stone-600" : "text-stone-400"}`}>
                                  No Specific Wait
                                </span>
                              )}
                            </div>
                            {scheduleText && (
                              <p className={`text-[10px] italic mt-1 leading-relaxed ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                "{scheduleText}"
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

        </div>
      </div>

      {/* Plan-Specific Illness Manager — add/edit the DB-backed Specific
          Illness List for any plan (built-in or custom). This is the same
          category+illness row editor that used to live inside the plan
          add/edit wizard; it's been relocated here so all specific-illness
          work happens in one place. */}
      <div className={`p-5 space-y-4 ${cardClass}`}>
        <div className="flex items-center gap-2 pb-2.5 border-b border-stone-200 dark:border-stone-850">
          <ListPlus className={`w-4 h-4 ${dark ? "text-orange-400" : "text-orange-600"}`} />
          <h4 className={`text-xs font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
            Plan-Specific Illness Manager
          </h4>
        </div>

        <div className="space-y-1.5 max-w-sm">
          <label className={labelClass}>Select Plan</label>
          <CustomSelect
            theme={theme}
            value={managePlan}
            onChange={handleSelectManagePlan}
            placeholder="— choose a plan —"
            triggerClassName={`w-full flex items-center justify-between gap-2 text-xs pl-3 pr-8 py-2.5 rounded-lg border outline-none cursor-pointer relative ${
              dark ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA]" : "bg-white border-stone-200 text-stone-900"
            }`}
            options={allPlanNames.map((name) => {
              const count = dbByPlanName[name]?.specificIllnesses?.length || 0;
              return { value: name, label: `${name}${count > 0 ? ` (${count} entr${count === 1 ? "y" : "ies"})` : ""}` };
            })}
          />
        </div>

        {!managePlan ? (
          <p className={`text-xs italic ${dark ? "text-stone-500" : "text-stone-400"}`}>
            Choose a plan above to view or edit its Specific Illness List.
          </p>
        ) : (
          <>
            {!canEdit && (
              <p className={`text-[11px] ${dark ? "text-amber-400" : "text-amber-700"}`}>
                Read-only — Admin clearance is required to make changes.
              </p>
            )}

            <div className="flex items-center justify-between">
              <label className={labelClass}>Illness Entries</label>
              <div className="flex items-center gap-2">
                {manageSaved && (
                  <span className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${dark ? "text-emerald-400" : "text-emerald-600"}`}>
                    <Check className="w-3 h-3" /> Saved
                  </span>
                )}
                {canEdit && manageMode === "edit" && (
                  <button
                    onClick={addManageRow}
                    className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer ${dark ? "text-orange-300 hover:text-orange-200" : "text-orange-600 hover:text-orange-700"}`}
                  >
                    <Plus className="w-3 h-3" /> Add Illness
                  </button>
                )}
                {canEdit && manageMode === "view" && (
                  <button
                    onClick={() => setManageMode("edit")}
                    className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer ${dark ? "text-orange-300 hover:text-orange-200" : "text-orange-600 hover:text-orange-700"}`}
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {manageMode === "view" ? (
                manageRows.length === 0 ? (
                  <p className={`text-[11px] italic ${dark ? "text-stone-500" : "text-stone-400"}`}>
                    No specific illness entries yet for this plan — this is optional. When a looked-up PED matches an illness added here, its result card gets a "Specific Illness" tag for this plan.
                  </p>
                ) : (
                  manageRows.map((row) => (
                    <div key={row.key} className="flex items-center gap-2">
                      <span className={`w-40 shrink-0 truncate text-xs p-2 rounded-lg border ${
                        dark ? "bg-white/[0.015] border-white/[0.05] text-stone-300" : "bg-stone-50 border-stone-150 text-stone-600"
                      }`} title={row.category || undefined}>
                        {row.category || <em className={dark ? "text-stone-600" : "text-stone-400"}>Uncategorized</em>}
                      </span>
                      <span className={`flex-1 text-xs p-2 rounded-lg border ${
                        dark ? "bg-white/[0.015] border-white/[0.05] text-stone-200" : "bg-stone-50 border-stone-150 text-stone-800"
                      }`}>
                        {row.illness}
                      </span>
                    </div>
                  ))
                )
              ) : (
                <>
                  {manageRows.map((row) => (
                    <div key={row.key} className="flex items-center gap-2">
                      <input
                        value={row.category || ""}
                        onChange={(e) => updateManageRow(row.key, { category: e.target.value })}
                        disabled={!canEdit}
                        placeholder="Category (e.g. Gastrointestinal)"
                        // inputClass already carries "w-full" — simply appending
                        // "w-40" here put two conflicting width utilities on the
                        // same element. Tailwind resolves that by CSS source
                        // order (not JSX class order), and "w-full" happened to
                        // win, so this box rendered at full width and squeezed
                        // the illness input next to it down to a sliver. Swap
                        // the "w-full" token out for "w-40" instead of stacking
                        // both, so only one width class ever applies here.
                        className={`${inputClass.replace("w-full", "w-40")} shrink-0 disabled:opacity-60`}
                      />
                      <input
                        value={row.illness}
                        onChange={(e) => updateManageRow(row.key, { illness: e.target.value })}
                        disabled={!canEdit}
                        placeholder="Illness as it appears in the plan's specific illness schedule..."
                        className={`${inputClass} disabled:opacity-60`}
                      />
                      {canEdit && (
                        <button
                          onClick={() => removeManageRow(row.key)}
                          className={`p-2 rounded-lg shrink-0 cursor-pointer ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-50 text-stone-500 hover:text-red-600"}`}
                          title="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {manageRows.length === 0 && (
                    <p className={`text-[11px] italic ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      No specific illness entries yet for this plan — this is optional. When a looked-up PED matches an illness added here, its result card gets a "Specific Illness" tag for this plan.
                    </p>
                  )}
                </>
              )}
            </div>

            <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
              Matched against a customer's declared PED the same way Declaration Questions are — whole-word/phrase matching, not exact-string. Category is a free-text grouping label shown in the advisor's Quick Reference sidebar (e.g. "Gastrointestinal", "Eye", "Orthopedic & Joints"). For a built-in plan (Optima Secure, Care Supreme, Activ One Max, Activ Fit Preferred), rows already shown here are pre-filled from that plan's existing schedule in the master catalog below, so you're always editing the plan's complete list, not just what's been added separately. New entries you add and save here take effect immediately.
            </p>

            {manageMode === "edit" && manageError && (
              <p className={`text-[11px] font-semibold ${dark ? "text-red-400" : "text-red-600"}`}>{manageError}</p>
            )}

            {canEdit && manageMode === "edit" && (
              <div className="flex items-center justify-end gap-2 pt-1">
                <ClippedButton
                  onClick={() => handleSelectManagePlan(managePlan)}
                  disabled={manageSaving}
                  cornerBg={dark ? "#0e2236" : "#ffffff"}
                  title="Discard unsaved changes and revert to the last-saved list"
                  className={`text-xs font-bold uppercase tracking-wide px-3.5 py-2 ${dark ? "text-stone-400 hover:text-stone-200" : "text-stone-500 hover:text-stone-700"}`}
                >
                  Cancel
                </ClippedButton>
                <ClippedButton
                  onClick={handleSaveManageRows}
                  disabled={manageSaving}
                  cornerBg={dark ? "#0e2236" : "#ffffff"}
                  className={`text-xs font-bold uppercase tracking-wide px-4 py-2 ${
                    dark ? "bg-blue-600/20 text-blue-300 hover:bg-blue-600/30" : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {manageSaving ? "Saving…" : "Save Illness List"}
                </ClippedButton>
              </div>
            )}
          </>
        )}
      </div>

      {/* Master Specific Illness Database Catalog — collapsed teaser bar by
          default; expands in place into the full table. */}
      <div className={cardClass}>
        <button
          onClick={() => setShowCatalog((v) => !v)}
          className="w-full flex items-center justify-between gap-3 p-4 cursor-pointer"
        >
          <div className="flex items-center gap-2.5 text-left">
            <FileText className={`w-4 h-4 shrink-0 ${dark ? "text-violet-400" : "text-violet-600"}`} />
            <div>
              <p className={`text-xs font-black uppercase tracking-wider ${dark ? "text-violet-300" : "text-violet-700"}`}>
                Master Specific Illness Database Catalog
              </p>
              <p className={`text-[11px] mt-0.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                Explore listed diseases, aliases, and procedure mappings per Indian rules.
              </p>
            </div>
          </div>
          {showCatalog ? (
            <ChevronUp className={`w-4 h-4 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
          ) : (
            <ChevronDown className={`w-4 h-4 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
          )}
        </button>

        {showCatalog && (
          <div className="px-4 pb-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end">
              <div className="relative sm:w-64">
                <Search className={`w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                <input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search database..."
                  className={`${inputClass} pl-8`}
                />
              </div>
              <div className="sm:w-56">
                <CustomSelect
                  theme={theme}
                  value={catalogCategory}
                  onChange={setCatalogCategory}
                  triggerClassName={`w-full flex items-center justify-between gap-2 text-xs pl-3 pr-8 py-2.5 rounded-lg border outline-none cursor-pointer relative ${
                    dark ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA]" : "bg-white border-stone-200 text-stone-900"
                  }`}
                  options={[
                    { value: "All Categories", label: "All Categories" },
                    ...CATEGORIES.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={`text-[10px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>
                    <SortableTh label="Specific Illness (Parent)" sortKey="parent_illness" activeSort={catalogSort} onSort={toggleCatalogSort} className="pb-2 pr-4 font-black" />
                    <SortableTh label="Diagnostic Aliases / Synonyms (Rule 1)" sortKey="aliases" activeSort={catalogSort} onSort={toggleCatalogSort} className="pb-2 pr-4 font-black" />
                    <SortableTh label="Surgical Procedures (Rule 2)" sortKey="procedures" activeSort={catalogSort} onSort={toggleCatalogSort} className="pb-2 pr-4 font-black" />
                    <SortableTh label="Sub-Conditions (Rule 3)" sortKey="sub_conditions" activeSort={catalogSort} onSort={toggleCatalogSort} className="pb-2 pr-4 font-black" />
                    <SortableTh label="Applicable Plans (Rule 5)" sortKey="plan_schedules" activeSort={catalogSort} onSort={toggleCatalogSort} className="pb-2 font-black" />
                  </tr>
                </thead>
                <tbody className={`divide-y ${dark ? "divide-white/[0.05]" : "divide-stone-150"}`}>
                  {sortedCatalog.map((def) => (
                    <tr key={def.id} className="align-top">
                      <td className="py-3 pr-4 max-w-[13rem]">
                        <p className={`text-sm font-bold ${dark ? "text-white" : "text-stone-900"}`}>{def.parent_illness}</p>
                        <span className={`inline-block mt-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          dark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-700"
                        }`}>
                          {def.category}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1 max-w-[16rem]">
                          {def.aliases.length > 0
                            ? def.aliases.map((a) => <span key={a} className={pillClass}>{a}</span>)
                            : <span className={dark ? "text-stone-600" : "text-stone-400"}>-</span>}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1 max-w-[16rem]">
                          {def.procedures.length > 0
                            ? def.procedures.map((p) => <span key={p} className={procedurePillClass}>{p}</span>)
                            : <span className={dark ? "text-stone-600" : "text-stone-400"}>-</span>}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1 max-w-[14rem]">
                          {def.sub_conditions.length > 0
                            ? def.sub_conditions.map((s) => <span key={s} className={subConditionPillClass}>{s}</span>)
                            : <span className={dark ? "text-stone-600" : "text-stone-400"}>-</span>}
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {BASE_PLANS.map((plan) => {
                            const present = Boolean(def.plan_schedules[plan]);
                            return (
                              <span
                                key={plan}
                                title={def.plan_schedules[plan] || `${plan}: no specific schedule`}
                                className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                  present
                                    ? (dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-700 border border-red-200")
                                    : (dark ? "bg-white/[0.03] text-stone-600" : "bg-stone-100 text-stone-400")
                                }`}
                              >
                                {getPlanAbbrev(plan)}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredCatalog.length === 0 && (
                    <tr>
                      <td colSpan={5} className={`py-6 text-center text-xs ${dark ? "text-stone-500" : "text-stone-400"}`}>
                        No entries match this search/category.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
