/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2, Pencil, X, Sparkles, Wand2, AlertTriangle, Check, ChevronDown, ChevronUp, PowerOff } from "lucide-react";
import { getPlanConfig, CATEGORY_LABELS, guessCategoryMap } from "../types.js";
import { DbPlanConfigEntry, PlanQuestionEntry, PlanQuestionTag, SpecificIllnessEntry } from "../types/plans";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { ClippedButton } from "../components/ClippedButton";
import { SpecificIllnessLedger } from "../components/SpecificIllnessLedger";
import { CustomSelect } from "../components/CustomSelect";

interface PlanManagementPageProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Developer";
  dbPlanConfigs: DbPlanConfigEntry[];
  setDbPlanConfigs: Dispatch<SetStateAction<DbPlanConfigEntry[]>>;
  dbPlanConfigsLoadError: string | null;
  fetchPlanConfigs: () => Promise<void>;
  confirmDestructiveAction: (actionDescription: string, onConfirm: () => void) => void;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  currentUser?: LoggedUser | null;
}

type FormQuestion = PlanQuestionEntry & { key: string };
type FormSpecificIllness = SpecificIllnessEntry & { key: string };

let rowKeySeq = 0;
const nextRowKey = () => `row-${Date.now()}-${rowKeySeq++}`;

/** Reconstructs a hardcoded (types.ts) plan's questions into the same
 * tagged {text, tag} shape the DB / wizard use, so editing a built-in plan
 * pre-fills the form exactly like editing a DB-backed one would. */
/**
 * Canonical display order for a plan's questions: Specific → Umbrella →
 * Others (Catch-all). Source arrays list them in insurer order, which mixes
 * the catch-all in ahead of umbrella questions; this normalises it wherever
 * questions are shown. Array.prototype.sort is stable, so the original
 * order is preserved WITHIN each group.
 */
const TAG_ORDER: Record<PlanQuestionTag, number> = {
  "Specific": 0,
  "Umbrella": 1,
  "Catch-all": 2,
};
function sortByTagOrder<T extends { tag: PlanQuestionTag }>(list: T[]): T[] {
  return [...list].sort((a, b) => (TAG_ORDER[a.tag] ?? 0) - (TAG_ORDER[b.tag] ?? 0));
}

function taggedQuestionsFromHardcoded(config: ReturnType<typeof getPlanConfig>[string]): FormQuestion[] {
  const umbrellaSet = new Set((config.umbrellaQuestions || []).map((q) => q.toLowerCase().trim()));
  const rows = config.questions.map((text) => {
    let tag: PlanQuestionTag = "Specific";
    if (umbrellaSet.has(text.toLowerCase().trim())) tag = "Umbrella";
    else if (config.anyOther && text.toLowerCase().trim() === config.anyOther.toLowerCase().trim()) tag = "Catch-all";
    return { key: nextRowKey(), text, tag };
  }).concat(
    (config.umbrellaQuestions || [])
      .filter((uq) => !config.questions.some((q) => q.toLowerCase().trim() === uq.toLowerCase().trim()))
      .map((text) => ({ key: nextRowKey(), text, tag: "Umbrella" as PlanQuestionTag }))
  );
  return sortByTagOrder(rows);
}

/** Fills in every category with NO mapping at all (not even a keyword/AI
 * suggestion) with the plan's catch-all question — used after the "Refine
 * with AI" server round-trip, whose response can omit a category the same
 * way guessCategoryMap's keyword rules can (see guessCategoryMap's own
 * comment in types.ts for why an unmapped category is a real problem, not
 * just a cosmetic gap: it makes the deterministic engine skip this plan
 * for that category and fall through to the Gemini fallback, which can
 * misjudge a real diagnosis as an ambiguous symptom). */
function fillUnmappedCategories(map: Record<string, string>, anyOther: string): Record<string, string> {
  if (!anyOther) return map;
  const filled = { ...map };
  Object.keys(CATEGORY_LABELS).forEach((key) => {
    if (filled[key] === undefined) filled[key] = anyOther;
  });
  return filled;
}

function normalizeCategoryMapToStrings(categoryMap: Record<string, string | number>, questions: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(categoryMap || {}).forEach(([key, val]) => {
    if (typeof val === "string") out[key] = val;
    else if (typeof val === "number" && questions[val]) out[key] = questions[val];
  });
  return out;
}

/**
 * Declaration Assistant Control (renamed from "Plan Management" — the
 * function name/route key stay as PlanManagementPage/plan_scope, only the
 * user-facing label changed, to avoid an unnecessary rename across every
 * import site) — add or edit an insurance plan's declaration questionnaire,
 * its category-to-question mapping, and take a plan out of service for
 * advisors (with a note) while its logic is being reworked. Backed by
 * Postgres (plan_configs table via /api/plan-configs); a plan saved here is
 * immediately usable for real matching, since /api/match reads from the
 * same table server-side (see dbRowToPlanConfig in server.ts) — and refuses
 * to match against a plan disabled here.
 *
 * This replaces what used to be inert scaffolding in App.tsx (draftPlans /
 * planQuestionsState / productionPlans in localStorage, never wired to any
 * UI and never seen by /api/match at all).
 */
export function PlanManagementPage({
  theme,
  effectiveTier,
  dbPlanConfigs,
  setDbPlanConfigs,
  dbPlanConfigsLoadError,
  fetchPlanConfigs,
  confirmDestructiveAction,
  setChangeLogs,
  currentUser,
}: PlanManagementPageProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Admin" || effectiveTier === "Developer";
  // Edit/Delete are actionable Developer-only — Admin still sees the buttons
  // (so the UI doesn't look feature-incomplete) but they render disabled.
  // Add Plan stays fully enabled for Admin.
  const isDeveloper = effectiveTier === "Developer";

  useEffect(() => {
    fetchPlanConfigs();
    // Refresh once when the page is opened, in case another admin changed
    // something since the app first loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hardcodedConfigs = useMemo(() => getPlanConfig(), []);
  const dbByName = useMemo(() => {
    const map: Record<string, DbPlanConfigEntry> = {};
    dbPlanConfigs.forEach((row) => { map[row.planName] = row; });
    return map;
  }, [dbPlanConfigs]);

  const allPlanNames = useMemo(() => {
    const names = new Set<string>([...Object.keys(hardcodedConfigs), ...Object.keys(dbByName)]);
    return Array.from(names).sort();
  }, [hardcodedConfigs, dbByName]);

  // Top-level sub-tab: plan configuration (existing list/form wizard below)
  // vs. the Specific Illness Ledger (catalog + matching sandbox for the
  // hardcoded MASTER_ILLNESSES schedules in specificIllnessEngine.ts, which
  // previously had no UI at all).
  const [planMgmtView, setPlanMgmtView] = useState<"plans" | "category-mapping" | "illness-ledger">("plans");

  // --- Form state (view === "list" | "form") ---
  const [view, setView] = useState<"list" | "form">("list");
  // Clicking a plan row on the list expands it in place to show every
  // declaration question that's been added for it — a flat list, no
  // grouping by Specific/Umbrella/Catch-all tag (that distinction only
  // matters for matching, not for "what's actually on this plan"). Only
  // one plan expanded at a time. Kept separate from the edit wizard's
  // `questions` state below since this is read-only browsing, not editing.
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [isNewPlan, setIsNewPlan] = useState(true);
  const [originalPlanName, setOriginalPlanName] = useState<string | null>(null);
  const [planName, setPlanName] = useState("");
  const [insurerName, setInsurerName] = useState("");
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [specificIllnesses, setSpecificIllnesses] = useState<FormSpecificIllness[]>([]);
  // Not directly editable in this wizard (niche, rarely-touched clinical
  // guard flags) — carried through unchanged so customizing a built-in plan
  // (e.g. Care Supreme's requiresInsulinForDiabetes) doesn't silently drop
  // behavior the underwriting rules depend on elsewhere in engine.ts.
  const [overrides, setOverrides] = useState<DbPlanConfigEntry["overrides"]>(undefined);
  // Takes this plan out of service for advisors (declaration dropdown shows
  // disabledNote and blocks search) without deleting its configuration —
  // e.g. while its questions/mapping engine logic is being reworked. See
  // schema.ts's plan_configs.disabled comment.
  const [disabled, setDisabled] = useState(false);
  const [disabledNote, setDisabledNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refiningWithAi, setRefiningWithAi] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  // Opening an existing plan shows its current questions/mapping read-only
  // first ("view") — editable inputs/selects only render once "Edit" is
  // clicked ("edit"). A brand-new plan has nothing to view yet, so it opens
  // straight into "edit". Cancelling out of edit mode reverts the form's
  // fields to what's actually saved (via populateFormFields) and drops back
  // to "view" rather than leaving the wizard.
  const [formMode, setFormMode] = useState<"view" | "edit">("edit");

  const specificAndCatchAllTexts = useMemo(
    () => questions.filter((q) => q.tag !== "Umbrella" && q.text.trim()).map((q) => q.text.trim()),
    [questions]
  );

  // --- Category Mapping manager (its own sub-tab, separate from the
  // add/edit wizard's inline "Category → Question Mapping" section above —
  // lets an admin browse/update any plan's category mapping without opening
  // the full wizard, same rationale as the Specific Illness Ledger's
  // Plan-Specific Illness Manager below). ---
  const [manageCatPlan, setManageCatPlan] = useState("");
  const [manageCatMap, setManageCatMap] = useState<Record<string, string>>({});
  const [manageCatSaving, setManageCatSaving] = useState(false);
  const [manageCatError, setManageCatError] = useState<string | null>(null);
  const [manageCatSaved, setManageCatSaved] = useState(false);
  const [manageCatRefining, setManageCatRefining] = useState(false);
  const [manageCatAiNotice, setManageCatAiNotice] = useState<string | null>(null);
  // Same view-first/edit-on-request pattern as formMode above, scoped to
  // this standalone Category Mapping tab.
  const [manageCatMode, setManageCatMode] = useState<"view" | "edit">("view");

  // Candidate question texts a category can be mapped to for the currently
  // selected plan — Specific/Catch-all questions only (Umbrella questions
  // aren't PED-routing targets), sourced from the plan's DB row if it has
  // one, else reconstructed from the hardcoded config.
  const manageCatQuestionTexts = useMemo(() => {
    if (!manageCatPlan) return [];
    const dbRow = dbByName[manageCatPlan];
    if (dbRow) {
      return dbRow.questions
        .filter((q) => q.tag !== "Umbrella" && q.text.trim())
        .map((q) => q.text.trim());
    }
    const hardcoded = hardcodedConfigs[manageCatPlan];
    if (!hardcoded) return [];
    return taggedQuestionsFromHardcoded(hardcoded)
      .filter((q) => q.tag !== "Umbrella" && q.text.trim())
      .map((q) => q.text.trim());
  }, [manageCatPlan, dbByName, hardcodedConfigs]);

  // The selected plan's catch-all question — passed to guessCategoryMap /
  // fillUnmappedCategories so Suggest/Refine with AI default any category
  // with no keyword or AI match to it, instead of leaving it unmapped.
  const manageCatAnyOther = useMemo(() => {
    if (!manageCatPlan) return "";
    const dbRow = dbByName[manageCatPlan];
    if (dbRow) return dbRow.anyOther || "";
    return hardcodedConfigs[manageCatPlan]?.anyOther || "";
  }, [manageCatPlan, dbByName, hardcodedConfigs]);

  const handleSelectManageCatPlan = (name: string) => {
    setManageCatPlan(name);
    setManageCatError(null);
    setManageCatSaved(false);
    setManageCatAiNotice(null);
    // Reset to the read-only view every time a plan is (re)selected —
    // including when this function is reused by the Cancel button to
    // discard unsaved edits and revert to the last-saved mapping.
    setManageCatMode("view");

    // Pre-populate from the plan's DB row if it has one, else from the
    // hardcoded getPlanConfig() script — so a built-in plan (Optima Secure,
    // Care Supreme, Activ One Max, Activ Fit Preferred) always shows its
    // real, currently-live category mapping here, never an empty slate.
    const dbRow = dbByName[name];
    if (dbRow) {
      setManageCatMap(dbRow.categoryMap || {});
    } else {
      const hardcoded = hardcodedConfigs[name];
      setManageCatMap(hardcoded ? normalizeCategoryMapToStrings(hardcoded.categoryMap, hardcoded.questions) : {});
    }
  };

  const applyKeywordSuggestionsForManageCat = () => {
    const suggested = guessCategoryMap(manageCatQuestionTexts);
    const matchedCount = Object.keys(suggested).length;
    setManageCatMap(fillUnmappedCategories(suggested, manageCatAnyOther));
    setManageCatAiNotice(
      matchedCount > 0
        ? `Keyword rules matched ${matchedCount} of ${Object.keys(CATEGORY_LABELS).length} categories from this plan's current question wording — the rest default to the catch-all question below.`
        : "No keyword matches found in this plan's questions — map categories manually below."
    );
  };

  const refineWithAiForManageCat = async () => {
    if (!manageCatPlan) return;
    setManageCatRefining(true);
    setManageCatAiNotice(null);
    try {
      const dbRow = dbByName[manageCatPlan];
      const insurer = dbRow?.insurerName || "Not specified";
      const res = await fetch("/api/ai-plan-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: manageCatPlan,
          insurerName: insurer,
          questions: manageCatQuestionTexts.map((text) => ({ text })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `AI refinement failed (HTTP ${res.status}).`);

      const mappings: Array<{ question: string; mappedCategory: string | null }> = body.categoryMappings || [];
      const refined: Record<string, string> = {};
      mappings.forEach((m) => {
        if (m.mappedCategory) refined[m.mappedCategory] = m.question;
      });
      const matchedCount = Object.keys(refined).length;
      setManageCatMap(fillUnmappedCategories(refined, manageCatAnyOther));
      setManageCatAiNotice(
        body.usedAi
          ? `AI matched ${matchedCount} categories — the rest default to the catch-all question below; review before saving.`
          : `No GEMINI_API_KEY is configured on the server, so this ran the same keyword rules as "Suggest" (matched ${matchedCount} categories).`
      );
    } catch (err: unknown) {
      setManageCatAiNotice(err instanceof Error ? err.message : "AI refinement failed. Keyword-rule suggestions are still available.");
    } finally {
      setManageCatRefining(false);
    }
  };

  const logAction = (actionType: string, description: string, forPlanName: string) => {
    setChangeLogs(prev => [
      {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userName: currentUser?.name || currentUser?.email || "Unknown",
        role: effectiveTier,
        actionType,
        planName: forPlanName,
        description,
      },
      ...prev,
    ]);
  };

  const openNewPlanForm = () => {
    setIsNewPlan(true);
    setOriginalPlanName(null);
    setPlanName("");
    setInsurerName("");
    setQuestions([
      { key: nextRowKey(), text: "", tag: "Specific" },
      { key: nextRowKey(), text: "Any other disease / condition not mentioned above?", tag: "Catch-all" },
    ]);
    setCategoryMap({});
    setSpecificIllnesses([]);
    setOverrides(undefined);
    setDisabled(false);
    setDisabledNote("");
    setSaveError(null);
    setAiNotice(null);
    // Nothing exists yet for a brand-new plan, so there's no read-only
    // state worth showing — go straight to the editable form.
    setFormMode("edit");
    setView("form");
  };

  /** Loads a plan's current saved fields into the form. Split out from
   * openEditForm so Cancel (mid-edit) can re-run the same population logic
   * to discard unsaved changes and revert to the read-only view, without
   * also re-running the open-time-only resets (isNewPlan/originalPlanName/
   * view/errors) that openEditForm does around it. */
  const populateFormFields = (name: string) => {
    const dbRow = dbByName[name];
    if (dbRow) {
      setInsurerName(dbRow.insurerName);
      setQuestions(dbRow.questions.map((q) => ({ key: nextRowKey(), text: q.text, tag: q.tag })));
      setCategoryMap(dbRow.categoryMap || {});
      setSpecificIllnesses((dbRow.specificIllnesses || []).map((si) => ({ key: nextRowKey(), category: si.category || "", illness: si.illness })));
      setOverrides(dbRow.overrides);
      setDisabled(!!dbRow.disabled);
      setDisabledNote(dbRow.disabledNote || "");
    } else {
      const config = hardcodedConfigs[name];
      const tagged = taggedQuestionsFromHardcoded(config);
      setInsurerName("");
      setQuestions(tagged);
      setCategoryMap(normalizeCategoryMapToStrings(config.categoryMap, config.questions));
      // Built-in plans (Optima Secure, Care Supreme, etc.) keep their
      // original Specific Illness List working through the legacy
      // MASTER_ILLNESSES engine even with nothing entered here — this
      // wizard section only needs entries for illnesses beyond that
      // existing catalog, so it starts empty rather than attempting a
      // full reconstruction from a different hardcoded source.
      setSpecificIllnesses([]);
      setOverrides(config.overrides);
      // Built-in plans have no DB row yet, so no disabled state exists —
      // start enabled/no-note, same as a brand-new plan.
      setDisabled(false);
      setDisabledNote("");
    }
  };

  const openEditForm = (name: string) => {
    setIsNewPlan(false);
    setOriginalPlanName(name);
    setPlanName(name);
    setSaveError(null);
    setAiNotice(null);
    populateFormFields(name);
    // Show the plan's current questions/mapping read-only first — editing
    // is a deliberate next step, not the default landing state.
    setFormMode("view");
    setView("form");
  };

  /** Cancel button inside the wizard: for a new plan (nothing to revert to)
   * this just closes back to the list, same as before. For an existing
   * plan being edited, it discards any unsaved changes by re-loading the
   * last-saved fields and drops back to the read-only view instead of
   * leaving the wizard entirely. */
  const handleCancelForm = () => {
    if (isNewPlan || !originalPlanName) {
      setView("list");
      return;
    }
    setSaveError(null);
    setAiNotice(null);
    populateFormFields(originalPlanName);
    setFormMode("view");
  };

  /**
   * Appends an empty question row and then scrolls it into view and focuses
   * it.
   *
   * The scroll/focus is the point, not a nicety: the Add Question button sits
   * above a list that is usually taller than the viewport, so the new row
   * appeared off-screen at the bottom. With no visible change anywhere near
   * the button, the button read as broken.
   */
  const addQuestionRow = () => {
    const key = nextRowKey();
    setQuestions(prev => [...prev, { key, text: "", tag: "Specific" }]);
    setPendingFocusKey(key);
  };

  // Key of a freshly added row awaiting scroll+focus. Handled in an effect
  // rather than inline because the input does not exist in the DOM until
  // React has committed the state update above.
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingFocusKey) return;
    const el = questionInputRefs.current[pendingFocusKey];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }
    setPendingFocusKey(null);
  }, [pendingFocusKey]);

  // Live map of row key -> input element, populated by each row's ref
  // callback below.
  const questionInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const removeQuestionRow = (key: string) => {
    setQuestions(prev => prev.filter((q) => q.key !== key));
  };
  const updateQuestionRow = (key: string, patch: Partial<FormQuestion>) => {
    setQuestions(prev => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  };

  const applyKeywordSuggestions = () => {
    const catchAllText = questions.find((q) => q.tag === "Catch-all")?.text.trim() || "";
    const suggested = guessCategoryMap(specificAndCatchAllTexts);
    const matchedCount = Object.keys(suggested).length;
    // Regenerates from the current question wording and overwrites existing
    // values — previously this only filled *empty* categories, which meant
    // clicking it while editing an already-populated plan (the common case)
    // silently did nothing, since almost every category already had some
    // value. This button is "recompute suggestions from what's typed now",
    // not "fill gaps" — any manual tweak an admin wants to keep should be
    // re-applied after clicking it, same as clicking Refine with AI.
    // Every category the keyword rules didn't genuinely match still gets
    // defaulted to the catch-all question via fillUnmappedCategories, so
    // none are left silently unmapped (see its comment for why that
    // matters for matching, not just completeness).
    setCategoryMap(fillUnmappedCategories(suggested, catchAllText));
    setAiNotice(
      matchedCount > 0
        ? `Keyword rules matched ${matchedCount} of ${Object.keys(CATEGORY_LABELS).length} categories from the current question wording — the rest default to the catch-all question below.`
        : "No keyword matches found in the current questions — try adding more specific wording (e.g. \"diabetes\", \"hypertension\") or map categories manually below."
    );
  };

  const refineWithAi = async () => {
    setRefiningWithAi(true);
    setAiNotice(null);
    try {
      const res = await fetch("/api/ai-plan-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: planName.trim() || "Untitled Plan",
          insurerName: insurerName.trim(),
          questions: specificAndCatchAllTexts.map((text) => ({ text })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `AI refinement failed (HTTP ${res.status}).`);

      const mappings: Array<{ question: string; mappedCategory: string | null }> = body.categoryMappings || [];
      // Overwrite (not merge-preserve) so this button visibly does
      // something even when re-run — matches the "recompute" semantics of
      // the Suggest button now.
      const refined: Record<string, string> = {};
      mappings.forEach((m) => {
        if (m.mappedCategory) refined[m.mappedCategory] = m.question;
      });
      const matchedCount = Object.keys(refined).length;
      const catchAllText = questions.find((q) => q.tag === "Catch-all")?.text.trim() || "";
      // Same fill-the-gaps step as Suggest — the AI (or its keyword-rule
      // fallback below) can just as easily leave a category out entirely.
      setCategoryMap(fillUnmappedCategories(refined, catchAllText));
      setAiNotice(
        body.usedAi
          ? `AI matched ${matchedCount} categories — the rest default to the catch-all question below; review before saving.`
          : `No GEMINI_API_KEY is configured on the server, so this ran the same keyword rules as "Suggest" (matched ${matchedCount} categories). Set GEMINI_API_KEY to get real AI refinement.`
      );
    } catch (err: unknown) {
      setAiNotice(err instanceof Error ? err.message : "AI refinement failed. Keyword-rule suggestions are still available.");
    } finally {
      setRefiningWithAi(false);
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    const trimmedName = planName.trim();
    const trimmedInsurer = insurerName.trim();
    const cleanQuestions = questions
      .map((q) => ({ text: q.text.trim(), tag: q.tag }))
      .filter((q) => q.text);
    // Specific Illness List is optional (unlike Declaration Questions) —
    // most plans, especially new ones, won't have entries yet, and that's
    // fine since the tag simply won't appear for this plan until an admin
    // adds some.
    const cleanSpecificIllnesses = specificIllnesses
      .map((si) => ({ category: si.category?.trim() || undefined, illness: si.illness.trim() }))
      .filter((si) => si.illness);

    if (!trimmedName) return setSaveError("Plan name is required.");
    if (!trimmedInsurer) return setSaveError("Insurer name is required.");
    if (cleanQuestions.length === 0) return setSaveError("Add at least one declaration question.");
    if (!cleanQuestions.some((q) => q.tag === "Catch-all")) {
      return setSaveError("Tag one question as \"Catch-all\" (e.g. \"Any other disease...?\") so unmatched PEDs have somewhere to route.");
    }

    setSaving(true);
    try {
      const isRename = !isNewPlan && originalPlanName && originalPlanName !== trimmedName;
      // A PUT only works if a plan_configs row already exists under
      // originalPlanName. That's true for a plan someone already
      // added/edited through this page ("Custom" in the list), but NOT for
      // a built-in plan (Optima Secure, Care Supreme, etc.) being
      // customized for the very first time — those only exist in the
      // hardcoded getPlanConfig() so far, with no DB row yet. Using PUT for
      // that case 404'd with "Plan not found." POST (upsert) is safe
      // either way, so use it whenever there's no existing DB row to PUT.
      const hasExistingDbRow = !isNewPlan && !!originalPlanName && !!dbByName[originalPlanName];
      const shouldCreate = isNewPlan || isRename || !hasExistingDbRow;
      const url = shouldCreate ? "/api/plan-configs" : `/api/plan-configs/${encodeURIComponent(originalPlanName!)}`;
      const method = shouldCreate ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: trimmedName,
          insurerName: trimmedInsurer,
          questions: cleanQuestions,
          categoryMap,
          specificIllnesses: cleanSpecificIllnesses,
          overrides,
          disabled,
          // Sent regardless of the checkbox state (not just when disabled)
          // so toggling disable off temporarily doesn't discard the note —
          // it's just not shown/enforced anywhere while disabled is false.
          disabledNote: disabledNote.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save this plan (HTTP ${res.status}).`);

      // Renaming a plan that already had its own DB row (hasExistingDbRow)
      // creates a new row under the new name via POST above — clean up the
      // old row so it doesn't linger as an orphaned duplicate.
      if (isRename && hasExistingDbRow) {
        fetch(`/api/plan-configs/${encodeURIComponent(originalPlanName!)}`, { method: "DELETE" }).catch((err) => {
          console.error("Failed to clean up the old plan name after rename:", err);
        });
      }

      const savedRow: DbPlanConfigEntry = {
        planName: body.entry.planName,
        insurerName: body.entry.insurerName,
        questions: body.entry.questions || [],
        categoryMap: body.entry.categoryMap || {},
        anyOther: body.entry.anyOther,
        hasUmbrella: !!body.entry.hasUmbrella,
        umbrellaQuestions: body.entry.umbrellaQuestions || [],
        specificIllnesses: body.entry.specificIllnesses || [],
        overrides: body.entry.overrides || undefined,
        disabled: !!body.entry.disabled,
        disabledNote: body.entry.disabledNote || null,
        addedBy: body.entry.addedBy,
      };
      setDbPlanConfigs(prev => {
        const withoutOld = isRename ? prev.filter((r) => r.planName !== originalPlanName) : prev.filter((r) => r.planName !== savedRow.planName);
        return [...withoutOld, savedRow];
      });

      logAction(
        isNewPlan ? "Plan Added" : "Plan Edited",
        isNewPlan
          ? `Added plan "${trimmedName}" (${trimmedInsurer}) with ${cleanQuestions.length} declaration questions and ${cleanSpecificIllnesses.length} specific illness entries.`
          : `Edited plan "${trimmedName}" — ${cleanQuestions.length} declaration questions, ${Object.keys(categoryMap).length} categories mapped, ${cleanSpecificIllnesses.length} specific illness entries.`,
        trimmedName
      );

      setView("list");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save this plan.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (name: string) => {
    confirmDestructiveAction(`Delete the custom plan "${name}" permanently`, async () => {
      try {
        const res = await fetch(`/api/plan-configs/${encodeURIComponent(name)}`, { method: "DELETE" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to delete this plan (HTTP ${res.status}).`);
        setDbPlanConfigs(prev => prev.filter((r) => r.planName !== name));
        logAction("Plan Deleted", `Deleted custom plan "${name}".`, name);
      } catch (err: unknown) {
        console.error("Failed to delete plan:", err);
      }
    });
  };

  // Quick disable/enable toggle right on the plan list row, so an admin
  // doesn't have to open the full Edit wizard just to take a plan out of
  // service. Same partial-update-vs-backfill pattern as
  // saveCategoryMapForPlan/saveSpecificIllnessesForPlan above: PUTs just
  // `disabled` for a plan that already has a DB row, or POSTs the full
  // hardcoded payload the first time a built-in-only plan is toggled.
  // Disabling is gated behind confirmDestructiveAction (it immediately
  // blocks every advisor from searching this plan); re-enabling isn't,
  // since undoing that is safe and shouldn't need a confirmation click.
  // Any existing disabledNote is preserved either way — this toggle never
  // clears or prompts for a note; that stays a job for the Edit wizard's
  // "Plan Availability" section.
  const [togglingPlan, setTogglingPlan] = useState<string | null>(null);
  const setPlanDisabled = async (name: string, nextDisabled: boolean) => {
    setTogglingPlan(name);
    try {
      const dbRow = dbByName[name];
      const hasExistingDbRow = !!dbRow;
      const url = hasExistingDbRow ? `/api/plan-configs/${encodeURIComponent(name)}` : "/api/plan-configs";
      const method = hasExistingDbRow ? "PUT" : "POST";

      let payload: Record<string, unknown> = { disabled: nextDisabled };
      if (!hasExistingDbRow) {
        const hardcoded = hardcodedConfigs[name];
        if (!hardcoded) throw new Error(`"${name}" isn't a recognized plan.`);
        const tagged = taggedQuestionsFromHardcoded(hardcoded);
        payload = {
          planName: name,
          insurerName: "Not specified",
          questions: tagged.map((q) => ({ text: q.text, tag: q.tag })),
          categoryMap: normalizeCategoryMapToStrings(hardcoded.categoryMap, hardcoded.questions),
          overrides: hardcoded.overrides,
          specificIllnesses: [],
          disabled: nextDisabled,
        };
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this plan (HTTP ${res.status}).`);

      const savedRow: DbPlanConfigEntry = {
        planName: body.entry.planName,
        insurerName: body.entry.insurerName,
        questions: body.entry.questions || [],
        categoryMap: body.entry.categoryMap || {},
        anyOther: body.entry.anyOther,
        hasUmbrella: !!body.entry.hasUmbrella,
        umbrellaQuestions: body.entry.umbrellaQuestions || [],
        specificIllnesses: body.entry.specificIllnesses || [],
        overrides: body.entry.overrides || undefined,
        disabled: !!body.entry.disabled,
        disabledNote: body.entry.disabledNote ?? null,
        addedBy: body.entry.addedBy,
      };
      setDbPlanConfigs(prev => [...prev.filter((r) => r.planName !== savedRow.planName), savedRow]);
      logAction(
        nextDisabled ? "Plan Disabled" : "Plan Enabled",
        nextDisabled
          ? `Disabled "${name}" — advisors can no longer search it until it's re-enabled.`
          : `Re-enabled "${name}" — advisors can search it again.`,
        name
      );
    } catch (err: unknown) {
      console.error(`Failed to ${nextDisabled ? "disable" : "enable"} plan:`, err);
      window.alert(err instanceof Error ? err.message : `Failed to ${nextDisabled ? "disable" : "enable"} this plan.`);
    } finally {
      setTogglingPlan(null);
    }
  };

  const handleQuickToggleDisabled = (name: string, currentlyDisabled: boolean) => {
    if (currentlyDisabled) {
      setPlanDisabled(name, false);
      return;
    }
    confirmDestructiveAction(
      `Disable "${name}" — advisors won't be able to search this plan until you re-enable it`,
      () => setPlanDisabled(name, true)
    );
  };

  /**
   * Saves a plan's Specific Illness List on its own, from the Specific
   * Illness Ledger tab — without going through the full add/edit wizard.
   * - If the plan already has a DB row (any custom plan, or a built-in one
   *   already customized once), this PUTs just `specificIllnesses`; the PUT
   *   endpoint applies partial updates (see server.ts), so the plan's other
   *   fields are left untouched.
   * - If the plan is still purely hardcoded (a built-in plan with no DB row
   *   yet), POST requires a full payload, so this backfills insurerName /
   *   questions / categoryMap from the hardcoded config — the same source
   *   openEditForm() uses when a built-in plan is customized for the first
   *   time via the wizard.
   */
  const saveSpecificIllnessesForPlan = async (targetPlanName: string, illnesses: SpecificIllnessEntry[]) => {
    const dbRow = dbByName[targetPlanName];
    const hasExistingDbRow = !!dbRow;

    const url = hasExistingDbRow
      ? `/api/plan-configs/${encodeURIComponent(targetPlanName)}`
      : "/api/plan-configs";
    const method = hasExistingDbRow ? "PUT" : "POST";

    let payload: Record<string, unknown> = { specificIllnesses: illnesses };
    if (!hasExistingDbRow) {
      const hardcoded = hardcodedConfigs[targetPlanName];
      if (!hardcoded) {
        throw new Error(`"${targetPlanName}" isn't a recognized plan.`);
      }
      const tagged = taggedQuestionsFromHardcoded(hardcoded);
      payload = {
        planName: targetPlanName,
        insurerName: "Not specified",
        questions: tagged.map((q) => ({ text: q.text, tag: q.tag })),
        categoryMap: normalizeCategoryMapToStrings(hardcoded.categoryMap, hardcoded.questions),
        overrides: hardcoded.overrides,
        specificIllnesses: illnesses,
      };
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Failed to save specific illnesses (HTTP ${res.status}).`);

    const savedRow: DbPlanConfigEntry = {
      planName: body.entry.planName,
      insurerName: body.entry.insurerName,
      questions: body.entry.questions || [],
      categoryMap: body.entry.categoryMap || {},
      anyOther: body.entry.anyOther,
      hasUmbrella: !!body.entry.hasUmbrella,
      umbrellaQuestions: body.entry.umbrellaQuestions || [],
      specificIllnesses: body.entry.specificIllnesses || [],
      overrides: body.entry.overrides || undefined,
      addedBy: body.entry.addedBy,
    };
    setDbPlanConfigs(prev => [...prev.filter((r) => r.planName !== savedRow.planName), savedRow]);
    logAction(
      "Plan Edited",
      `Updated specific illness list for "${targetPlanName}" — ${illnesses.length} entr${illnesses.length === 1 ? "y" : "ies"}.`,
      targetPlanName
    );
  };

  /**
   * Saves a plan's Category → Question Mapping on its own, from the Category
   * Mapping tab — same shape as saveSpecificIllnessesForPlan above (PUT
   * partial-updates an existing DB row; POST backfills the full hardcoded
   * payload the first time a built-in plan is touched).
   */
  const saveCategoryMapForPlan = async (targetPlanName: string, newCategoryMap: Record<string, string>) => {
    const dbRow = dbByName[targetPlanName];
    const hasExistingDbRow = !!dbRow;

    const url = hasExistingDbRow
      ? `/api/plan-configs/${encodeURIComponent(targetPlanName)}`
      : "/api/plan-configs";
    const method = hasExistingDbRow ? "PUT" : "POST";

    let payload: Record<string, unknown> = { categoryMap: newCategoryMap };
    if (!hasExistingDbRow) {
      const hardcoded = hardcodedConfigs[targetPlanName];
      if (!hardcoded) {
        throw new Error(`"${targetPlanName}" isn't a recognized plan.`);
      }
      const tagged = taggedQuestionsFromHardcoded(hardcoded);
      payload = {
        planName: targetPlanName,
        insurerName: "Not specified",
        questions: tagged.map((q) => ({ text: q.text, tag: q.tag })),
        categoryMap: newCategoryMap,
        overrides: hardcoded.overrides,
        specificIllnesses: [],
      };
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Failed to save category mapping (HTTP ${res.status}).`);

    const savedRow: DbPlanConfigEntry = {
      planName: body.entry.planName,
      insurerName: body.entry.insurerName,
      questions: body.entry.questions || [],
      categoryMap: body.entry.categoryMap || {},
      anyOther: body.entry.anyOther,
      hasUmbrella: !!body.entry.hasUmbrella,
      umbrellaQuestions: body.entry.umbrellaQuestions || [],
      specificIllnesses: body.entry.specificIllnesses || [],
      overrides: body.entry.overrides || undefined,
      addedBy: body.entry.addedBy,
    };
    setDbPlanConfigs(prev => [...prev.filter((r) => r.planName !== savedRow.planName), savedRow]);
    logAction(
      "Plan Edited",
      `Updated category mapping for "${targetPlanName}" — ${Object.keys(newCategoryMap).length} of ${Object.keys(CATEGORY_LABELS).length} categories mapped.`,
      targetPlanName
    );
  };

  const handleSaveManageCatMap = async () => {
    if (!manageCatPlan) return;
    setManageCatSaving(true);
    setManageCatError(null);
    setManageCatSaved(false);
    try {
      await saveCategoryMapForPlan(manageCatPlan, manageCatMap);
      setManageCatSaved(true);
      setManageCatMode("view");
      setTimeout(() => setManageCatSaved(false), 2500);
    } catch (err) {
      setManageCatError(err instanceof Error ? err.message : "Failed to save this plan's category mapping.");
    } finally {
      setManageCatSaving(false);
    }
  };

  const inputClass = `w-full text-xs p-2 rounded-lg border outline-none transition-colors ${
    dark
      ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA] focus:border-blue-500/40"
      : "bg-white border-stone-200 text-stone-900 focus:border-blue-400"
  }`;

  return (
    <div className="space-y-5 text-left">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            dark ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Declaration Assistant Control</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            {planMgmtView === "plans"
              ? "Add or edit a plan's declaration questionnaire. Category-to-question mapping is suggested automatically — review it, then save; it's live for matching immediately."
              : planMgmtView === "category-mapping"
                ? "Browse and edit how each plan's declaration questions map to the engine's PED categories — the same category-to-question logic the deterministic engine consults when routing a matched condition."
                : "Explore the hardcoded specific-illness schedules and test how a declared PED maps against them."}
          </p>
        </div>

        {/* Add Plan — top-right, aligned with the title. The sub-tab toggle
            used to share this column, but now sits left-aligned below the
            header separator instead (see below), directly above the card
            it controls. */}
        {planMgmtView === "plans" && view === "list" && canEdit && (
          <ClippedButton
            onClick={openNewPlanForm}
            size="md"
            cornerBg={dark ? "#10141b" : "#e6f0fb"}
            className="relative z-10 shrink-0 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-blue-500/20"
          >
            <Plus className="w-3.5 h-3.5" /> Add Plan
          </ClippedButton>
        )}
      </div>

      {/* Sub-tab toggle — same role="tablist" pill pattern used on the
          Activity Log page's User Activity / Modification History switch,
          for visual consistency across sub-tabbed pages. Left-aligned,
          sitting directly above the card it controls, rather than
          right-aligned in the header. */}
      <div role="tablist" aria-label="Plan management view" className={`flex p-0.5 rounded-lg border shrink-0 select-none w-fit ${
        dark ? "bg-stone-900/40 border-stone-800" : "bg-stone-100 border-stone-250"
      }`}>
        <button
          role="tab" aria-selected={planMgmtView === "plans"} onClick={() => setPlanMgmtView("plans")}
          className={`px-2.5 py-1 rounded-md text-[10.5px] font-black uppercase tracking-wider transition-all cursor-pointer ${
            planMgmtView === "plans"
              ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] shadow-md font-extrabold"
              : dark
                ? "text-stone-400 hover:text-stone-200"
                : "text-stone-600 hover:text-stone-900 font-bold"
          }`}
        >
          Plan Configuration
        </button>
        <button
          role="tab" aria-selected={planMgmtView === "category-mapping"} onClick={() => setPlanMgmtView("category-mapping")}
          className={`px-2.5 py-1 rounded-md text-[10.5px] font-black uppercase tracking-wider transition-all cursor-pointer ${
            planMgmtView === "category-mapping"
              ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] shadow-md font-extrabold"
              : dark
                ? "text-stone-400 hover:text-stone-200"
                : "text-stone-600 hover:text-stone-900 font-bold"
          }`}
        >
          Category Mapping
        </button>
        <button
          role="tab" aria-selected={planMgmtView === "illness-ledger"} onClick={() => setPlanMgmtView("illness-ledger")}
          className={`px-2.5 py-1 rounded-md text-[10.5px] font-black uppercase tracking-wider transition-all cursor-pointer ${
            planMgmtView === "illness-ledger"
              ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)] shadow-md font-extrabold"
              : dark
                ? "text-stone-400 hover:text-stone-200"
                : "text-stone-600 hover:text-stone-900 font-bold"
          }`}
        >
          Specific Illness Ledger
        </button>
      </div>

      {planMgmtView === "illness-ledger" ? (
        <SpecificIllnessLedger
          theme={theme}
          allPlanNames={allPlanNames}
          dbPlanConfigs={dbPlanConfigs}
          canEdit={canEdit}
          onSaveIllnesses={saveSpecificIllnessesForPlan}
        />
      ) : planMgmtView === "category-mapping" ? (
        <div className={`rounded-2xl border p-5 space-y-5 transition-all ${
          dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
        }`}>
          <div className="flex items-center gap-2 pb-2.5 border-b border-stone-200 dark:border-stone-850">
            <Wand2 className={`w-4 h-4 ${dark ? "text-cyan-400" : "text-cyan-600"}`} />
            <h3 className={`text-xs font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>
              Category → Question Mapping
            </h3>
          </div>

          <div className="space-y-1.5 max-w-sm">
            <label className={`block text-[10px] font-bold uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Select Plan
            </label>
            <CustomSelect
              theme={theme}
              value={manageCatPlan}
              onChange={handleSelectManageCatPlan}
              placeholder="— choose a plan —"
              triggerClassName={`w-full flex items-center justify-between gap-2 text-xs pl-3 pr-8 py-2.5 rounded-lg border outline-none cursor-pointer relative ${
                dark ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA]" : "bg-white border-stone-200 text-stone-900"
              }`}
              options={allPlanNames.map((name) => {
                const count = Object.keys(dbByName[name]?.categoryMap || hardcodedConfigs[name]?.categoryMap || {}).length;
                return { value: name, label: `${name} (${count} of ${Object.keys(CATEGORY_LABELS).length} mapped)` };
              })}
            />
          </div>

          {!manageCatPlan ? (
            <p className={`text-xs italic ${dark ? "text-stone-500" : "text-stone-400"}`}>
              Choose a plan above to view or edit how its declaration questions map to each PED category — this is the
              same category-to-question logic the deterministic engine uses to route a matched condition to the right
              question. Built-in plans (Optima Secure, Care Supreme, Activ One Max, Activ Fit Preferred) show their
              real, currently-live mapping from the underlying config, not a blank slate.
            </p>
          ) : (
            <>
              {!canEdit && (
                <p className={`text-[11px] ${dark ? "text-amber-400" : "text-amber-700"}`}>
                  Read-only — Admin clearance is required to make changes.
                </p>
              )}

              {manageCatQuestionTexts.length === 0 && (
                <p className={`text-[11px] ${dark ? "text-amber-400" : "text-amber-700"}`}>
                  This plan has no Specific/Catch-all declaration questions yet — add some on the Plan Configuration
                  tab first, then come back here to map categories to them.
                </p>
              )}

              <div className="flex items-center justify-between">
                <label className={`block text-[10px] font-bold uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`}>
                  {Object.keys(manageCatMap).length} of {Object.keys(CATEGORY_LABELS).length} categories mapped
                </label>
                <div className="flex items-center gap-2">
                  {manageCatSaved && (
                    <span className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${dark ? "text-emerald-400" : "text-emerald-600"}`}>
                      <Check className="w-3 h-3" /> Saved
                    </span>
                  )}
                  {canEdit && manageCatMode === "edit" && (
                    <>
                      <button
                        onClick={applyKeywordSuggestionsForManageCat}
                        disabled={manageCatQuestionTexts.length === 0}
                        className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${dark ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-700"}`}
                        title="Instant, free keyword-based suggestions"
                      >
                        <Wand2 className="w-3 h-3" /> Suggest
                      </button>
                      <button
                        onClick={refineWithAiForManageCat}
                        disabled={manageCatRefining || manageCatQuestionTexts.length === 0}
                        className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${dark ? "text-purple-300 hover:text-purple-200" : "text-purple-600 hover:text-purple-700"}`}
                        title="Refine with AI (Gemini) — reviews wording more carefully than keyword rules"
                      >
                        <Sparkles className="w-3 h-3" /> {manageCatRefining ? "Refining…" : "Refine with AI"}
                      </button>
                    </>
                  )}
                  {canEdit && manageCatMode === "view" && (
                    <button
                      onClick={() => setManageCatMode("edit")}
                      className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer ${dark ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-700"}`}
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  )}
                </div>
              </div>

              {manageCatMode === "edit" && manageCatAiNotice && (
                <p className={`text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>{manageCatAiNotice}</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className={`text-[10.5px] w-32 shrink-0 truncate ${dark ? "text-stone-400" : "text-stone-500"}`} title={label}>
                      {label}
                    </span>
                    {manageCatMode === "view" ? (
                      <span className={`flex-1 min-w-0 text-[11px] p-1.5 rounded-lg border truncate ${
                        dark ? "bg-white/[0.015] border-white/[0.05] text-stone-200" : "bg-stone-50 border-stone-150 text-stone-800"
                      }`} title={manageCatMap[key] || undefined}>
                        {manageCatMap[key] || <em className={dark ? "text-stone-600" : "text-stone-400"}>— none —</em>}
                      </span>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <CustomSelect
                          theme={theme}
                          value={manageCatMap[key] || ""}
                          disabled={!canEdit}
                          onChange={(val) => setManageCatMap(prev => {
                            const next = { ...prev };
                            if (val) next[key] = val;
                            else delete next[key];
                            return next;
                          })}
                          placeholder="— none —"
                          triggerClassName={`w-full flex items-center justify-between gap-2 text-[11px] pl-1.5 pr-6 py-1.5 rounded-lg border outline-none disabled:opacity-60 relative ${
                            dark ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA]" : "bg-white border-stone-200 text-stone-900"
                          }`}
                          options={[
                            { value: "", label: "— No mapping (skip to next matching rule / AI fallback) —" },
                            ...manageCatQuestionTexts.map((text) => ({ value: text, label: text })),
                          ]}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
                This is the same category-to-question mapping the deterministic engine consults when a searched PED
                resolves to a category (e.g. "diabetes") — it decides which of this plan's declaration questions the
                PED should be flagged against. New entries you add and save here take effect immediately.
              </p>

              {manageCatMode === "edit" && manageCatError && (
                <p className={`text-[11px] font-semibold ${dark ? "text-red-400" : "text-red-600"}`}>{manageCatError}</p>
              )}

              {canEdit && manageCatMode === "edit" && (
                <div className="flex items-center justify-end gap-2 pt-1">
                  <ClippedButton
                    onClick={() => handleSelectManageCatPlan(manageCatPlan)}
                    disabled={manageCatSaving}
                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                    title="Discard unsaved changes and revert to the last-saved mapping"
                    className={`text-xs font-bold uppercase tracking-wide px-3.5 py-2 ${dark ? "text-stone-400 hover:text-stone-200" : "text-stone-500 hover:text-stone-700"}`}
                  >
                    Cancel
                  </ClippedButton>
                  <ClippedButton
                    onClick={handleSaveManageCatMap}
                    disabled={manageCatSaving}
                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                    className={`text-xs font-bold uppercase tracking-wide px-4 py-2 ${
                      dark ? "bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30" : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {manageCatSaving ? "Saving…" : "Save Category Mapping"}
                  </ClippedButton>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
      {dbPlanConfigsLoadError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-semibold">
          ⚠️ {dbPlanConfigsLoadError}
        </div>
      )}

      {view === "list" ? (
        <div className={`rounded-2xl border p-5 transition-all ${
          dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
        }`}>
          <div className="space-y-2">
            {allPlanNames.map((name) => {
              const dbRow = dbByName[name];
              const insurer = dbRow?.insurerName || "—";
              const questionCount = dbRow ? dbRow.questions.length : hardcodedConfigs[name]?.questions.length || 0;
              const mappedCount = Object.keys(dbRow?.categoryMap || hardcodedConfigs[name]?.categoryMap || {}).length;
              const illnessCount = dbRow?.specificIllnesses?.length || 0;
              const isExpanded = expandedPlan === name;
              // Flat list of every declaration question on this plan,
              // regardless of Specific/Umbrella/Catch-all tag — only
              // computed when a row is actually expanded.
              const planQuestions: FormQuestion[] = isExpanded
                ? (dbRow
                    // DB rows carry their own tags; sort them the same way
                    // taggedQuestionsFromHardcoded already does, so both
                    // sources display Specific → Umbrella → Others.
                    ? sortByTagOrder(dbRow.questions.map((q) => ({ key: `${name}-${q.text}`, text: q.text, tag: q.tag })))
                    : hardcodedConfigs[name]
                      ? taggedQuestionsFromHardcoded(hardcodedConfigs[name])
                      : [])
                : [];
              return (
                <div
                  key={name}
                  className={`rounded-xl border transition-all ${
                    dark ? "border-white/[0.06] bg-white/[0.02]" : "border-stone-100 bg-stone-50/60"
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedPlan(isExpanded ? null : name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedPlan(isExpanded ? null : name);
                      }
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer"
                    aria-expanded={isExpanded}
                    title={isExpanded ? "Collapse" : "Show this plan's declaration questions"}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronUp className={`w-3.5 h-3.5 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                      ) : (
                        <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold truncate ${dark ? "text-white" : "text-stone-900"}`}>{name}</span>
                          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                            dbRow
                              ? (dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700 border border-emerald-200")
                              : (dark ? "bg-white/[0.06] text-stone-400" : "bg-stone-100 text-stone-500")
                          }`}>
                            {dbRow ? "Custom" : "Built-in"}
                          </span>
                          {dbRow?.disabled && (
                            <span
                              className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                                dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700 border border-amber-200"
                              }`}
                              title={dbRow.disabledNote || "Disabled — advisors can't search this plan"}
                            >
                              <PowerOff className="w-2.5 h-2.5" /> Disabled
                            </span>
                          )}
                        </div>
                        <p className={`text-[11px] mt-0.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                          {insurer} · {questionCount} question{questionCount === 1 ? "" : "s"} · {mappedCount} categories mapped
                          {illnessCount > 0 && <> · {illnessCount} specific illness{illnessCount === 1 ? "" : "es"}</>}
                        </p>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <ClippedButton
                          onClick={() => handleQuickToggleDisabled(name, !!dbRow?.disabled)}
                          disabled={!isDeveloper || togglingPlan === name}
                          cornerBg={dark ? "#0e2236" : "#ffffff"}
                          className={`p-2 flex items-center gap-1 ${
                            dbRow?.disabled
                              ? (dark ? "hover:bg-emerald-500/15 text-amber-300 hover:text-emerald-300" : "hover:bg-emerald-50 text-amber-600 hover:text-emerald-700")
                              : (dark ? "hover:bg-rose-500/15 text-stone-300 hover:text-rose-400" : "hover:bg-rose-50 text-stone-600 hover:text-rose-600")
                          }`}
                          title={
                            !isDeveloper
                              ? "Developer clearance required to change plan availability"
                              : dbRow?.disabled
                                ? "Re-enable this plan for advisors"
                                : "Disable this plan — advisors won't be able to search it"
                          }
                        >
                          <PowerOff className="w-3.5 h-3.5" />
                        </ClippedButton>
                        <ClippedButton
                          onClick={() => openEditForm(name)}
                          disabled={!isDeveloper}
                          cornerBg={dark ? "#0e2236" : "#ffffff"}
                          className={`p-2 ${dark ? "hover:bg-white/10 text-stone-300" : "hover:bg-stone-200 text-stone-600"}`}
                          title={!isDeveloper ? "Developer clearance required to edit plans" : dbRow ? "Edit plan" : "Customize this built-in plan"}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </ClippedButton>
                        {dbRow && (
                          <ClippedButton
                            onClick={() => handleDelete(name)}
                            disabled={!isDeveloper}
                            cornerBg={dark ? "#0e2236" : "#ffffff"}
                            className={`p-2 ${dark ? "hover:bg-red-500/15 text-stone-300 hover:text-red-400" : "hover:bg-red-50 text-stone-600 hover:text-red-600"}`}
                            title={!isDeveloper ? "Developer clearance required to delete plans" : "Delete this custom plan"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </ClippedButton>
                        )}
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className={`px-4 pb-3.5 pt-0.5 border-t ${dark ? "border-white/[0.06]" : "border-stone-150"}`}>
                      {planQuestions.length === 0 ? (
                        <p className={`text-xs italic pt-2.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                          No declaration questions added for this plan yet.
                        </p>
                      ) : (
                        <ul className="pt-2.5 space-y-1.5">
                          {planQuestions.map((q, idx) => (
                            <li key={q.key} className="flex items-start gap-2">
                              <span className={`text-[10px] font-bold shrink-0 mt-0.5 w-4 text-right ${dark ? "text-stone-500" : "text-stone-400"}`}>
                                {idx + 1}.
                              </span>
                              <span className={`text-xs leading-relaxed ${dark ? "text-stone-200" : "text-stone-800"}`}>
                                {q.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={`rounded-2xl border p-5 space-y-5 transition-all ${
          dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"
        }`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-black uppercase tracking-wide ${dark ? "text-white" : "text-stone-900"}`}>
              {isNewPlan ? "Add Plan" : formMode === "view" ? `Viewing "${originalPlanName}"` : `Edit "${originalPlanName}"`}
            </h3>
            <div className="flex items-center gap-2">
              {!isNewPlan && formMode === "view" && isDeveloper && (
                <ClippedButton
                  onClick={() => setFormMode("edit")}
                  cornerBg={dark ? "#0e2236" : "#ffffff"}
                  className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 ${dark ? "bg-blue-600/20 text-blue-300 hover:bg-blue-600/30" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  <Pencil className="w-3 h-3" /> Edit
                </ClippedButton>
              )}
              <button
                onClick={() => setView("list")}
                className={`p-1.5 rounded-lg cursor-pointer ${dark ? "hover:bg-white/10 text-stone-400" : "hover:bg-stone-200 text-stone-500"}`}
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {saveError && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wide mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>Plan Name</label>
              {formMode === "view" ? (
                <p className={`text-sm font-bold px-2 py-2 ${dark ? "text-white" : "text-stone-900"}`}>{planName || "—"}</p>
              ) : (
                <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Secure Health Plus" className={inputClass} />
              )}
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wide mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>Insurer Name</label>
              {formMode === "view" ? (
                <p className={`text-sm font-bold px-2 py-2 ${dark ? "text-white" : "text-stone-900"}`}>{insurerName || "—"}</p>
              ) : (
                <input value={insurerName} onChange={(e) => setInsurerName(e.target.value)} placeholder="e.g. HDFC ERGO" className={inputClass} />
              )}
            </div>
          </div>

          {/* Plan Availability — takes this plan out of service for
              advisors (declaration dropdown shows disabledNote, search is
              blocked) without deleting anything here. Shown in both view
              and edit mode so an admin can see at a glance whether a plan
              is currently disabled even without opening Edit. */}
          <div>
            <label className={`block text-[10px] font-bold uppercase tracking-wide mb-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Plan Availability
            </label>
            {formMode === "view" ? (
              disabled ? (
                <div className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs font-semibold ${
                  dark ? "bg-amber-500/10 border-amber-500/25 text-amber-200" : "bg-amber-50 border-amber-200 text-amber-900"
                }`}>
                  <PowerOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Disabled — advisors see a note and can&apos;t search this plan.
                    {disabledNote ? ` "${disabledNote}"` : ""}
                  </span>
                </div>
              ) : (
                <p className={`text-xs font-semibold px-2 py-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>Enabled</p>
              )
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={disabled}
                    onChange={(e) => setDisabled(e.target.checked)}
                    className="w-3.5 h-3.5 shrink-0 cursor-pointer accent-amber-500"
                  />
                  <span className={`text-xs font-semibold ${dark ? "text-stone-200" : "text-stone-800"}`}>
                    Disable this plan — takes it out of service for advisors (e.g. while its questions/mapping logic is being reworked)
                  </span>
                </label>
                {disabled && (
                  <textarea
                    value={disabledNote}
                    onChange={(e) => setDisabledNote(e.target.value)}
                    placeholder="Note shown to advisors when they select this plan, e.g. &quot;Journey update in progress — check back soon.&quot;"
                    rows={2}
                    className={inputClass}
                  />
                )}
              </div>
            )}
          </div>

          {/* Declaration Questions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`block text-[10px] font-bold uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`}>
                Declaration Questions
              </label>
              {formMode === "edit" && (
                <button
                  onClick={addQuestionRow}
                  className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer ${dark ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-700"}`}
                >
                  <Plus className="w-3 h-3" /> Add Question
                </button>
              )}
            </div>
            {formMode === "view" ? (
              <div className="space-y-1.5">
                {questions.map((q) => (
                  <div key={q.key} className="flex items-center gap-2">
                    <span className={`flex-1 text-xs p-2 rounded-lg border ${
                      dark ? "bg-white/[0.015] border-white/[0.05] text-stone-200" : "bg-stone-50 border-stone-150 text-stone-800"
                    }`}>
                      {q.text || <em className={dark ? "text-stone-600" : "text-stone-400"}>(empty)</em>}
                    </span>
                    <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded ${
                      dark ? "bg-white/[0.06] text-stone-300" : "bg-stone-150 text-stone-600"
                    }`}>
                      {q.tag}
                    </span>
                  </div>
                ))}
                {questions.length === 0 && (
                  <p className={`text-xs italic ${dark ? "text-stone-500" : "text-stone-400"}`}>No declaration questions yet.</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {questions.map((q) => (
                  <div key={q.key} className="flex items-center gap-2">
                    <input
                      ref={(el) => { questionInputRefs.current[q.key] = el; }}
                      value={q.text}
                      onChange={(e) => updateQuestionRow(q.key, { text: e.target.value })}
                      placeholder="Question text as it appears on the proposal form..."
                      className={inputClass}
                    />
                    <div className="w-[104px] shrink-0">
                      <CustomSelect
                        theme={theme}
                        value={q.tag}
                        onChange={(val) => updateQuestionRow(q.key, { tag: val as PlanQuestionTag })}
                        triggerClassName={`w-full flex items-center justify-between gap-1 text-xs pl-2 pr-6 py-2 rounded-lg border outline-none relative ${
                          dark ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA]" : "bg-white border-stone-200 text-stone-900"
                        }`}
                        options={[
                          { value: "Specific", label: "Specific" },
                          { value: "Umbrella", label: "Umbrella" },
                          { value: "Catch-all", label: "Catch-all" },
                        ]}
                      />
                    </div>
                    <button
                      onClick={() => removeQuestionRow(q.key)}
                      className={`p-2 rounded-lg shrink-0 cursor-pointer ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-50 text-stone-500 hover:text-red-600"}`}
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {/* Second Add Question control, at the END of the list.
                    The header button is far above the fold on a long list,
                    so this one sits exactly where the new row appears. */}
                <button
                  onClick={addQuestionRow}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                    dark
                      ? "border-white/[0.12] text-blue-300 hover:bg-white/[0.04] hover:border-blue-400/40"
                      : "border-stone-300 text-blue-600 hover:bg-blue-50/60 hover:border-blue-300"
                  }`}
                >
                  <Plus className="w-3 h-3" /> Add Question
                </button>
              </div>
            )}
            {formMode === "edit" && (
              <p className={`text-[10.5px] mt-2 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                Tag "Umbrella" for general tests/medication/hospitalisation questions, and exactly one "Catch-all" for the "any other condition" question.
              </p>
            )}
          </div>

          {/* Category Mapping */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`block text-[10px] font-bold uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`}>
                Category → Question Mapping ({Object.keys(categoryMap).length} of {Object.keys(CATEGORY_LABELS).length} mapped)
              </label>
              {formMode === "edit" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={applyKeywordSuggestions}
                    className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer ${dark ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-700"}`}
                    title="Instant, free keyword-based suggestions"
                  >
                    <Wand2 className="w-3 h-3" /> Suggest
                  </button>
                  <button
                    onClick={refineWithAi}
                    disabled={refiningWithAi || specificAndCatchAllTexts.length === 0}
                    className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${dark ? "text-purple-300 hover:text-purple-200" : "text-purple-600 hover:text-purple-700"}`}
                    title="Refine with AI (Gemini) — reviews wording more carefully than keyword rules"
                  >
                    <Sparkles className="w-3 h-3" /> {refiningWithAi ? "Refining…" : "Refine with AI"}
                  </button>
                </div>
              )}
            </div>

            {formMode === "edit" && aiNotice && (
              <p className={`text-[10.5px] mb-2 ${dark ? "text-stone-400" : "text-stone-500"}`}>{aiNotice}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={`text-[10.5px] w-32 shrink-0 truncate ${dark ? "text-stone-400" : "text-stone-500"}`} title={label}>{label}</span>
                  {formMode === "view" ? (
                    <span className={`flex-1 min-w-0 text-[11px] p-1.5 rounded-lg border truncate ${
                      dark ? "bg-white/[0.015] border-white/[0.05] text-stone-200" : "bg-stone-50 border-stone-150 text-stone-800"
                    }`} title={categoryMap[key] || undefined}>
                      {categoryMap[key] || <em className={dark ? "text-stone-600" : "text-stone-400"}>— none —</em>}
                    </span>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <CustomSelect
                        theme={theme}
                        value={categoryMap[key] || ""}
                        onChange={(val) => setCategoryMap(prev => {
                          const next = { ...prev };
                          if (val) next[key] = val;
                          else delete next[key];
                          return next;
                        })}
                        placeholder="— none —"
                        triggerClassName={`w-full flex items-center justify-between gap-2 text-[11px] pl-1.5 pr-6 py-1.5 rounded-lg border outline-none relative ${
                          dark ? "bg-white/[0.03] border-white/[0.08] text-[#F5F7FA]" : "bg-white border-stone-200 text-stone-900"
                        }`}
                        options={[
                          { value: "", label: "— No mapping (skip to next matching rule / AI fallback) —" },
                          ...specificAndCatchAllTexts.map((text) => ({ value: text, label: text })),
                        ]}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Specific Illness List — moved out of this wizard and into its
              own dedicated editor on the Specific Illness Ledger sub-tab
              (a plan can be picked there without needing to open its full
              edit form). specificIllnesses itself is still carried through
              this form's save payload unchanged, so entries added there
              survive editing a plan's questions/mapping here. */}
          <div className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 ${
            dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-150 bg-stone-50"
          }`}>
            <p className={`text-[11px] ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Specific Illness List management now lives on the <b className={dark ? "text-stone-200" : "text-stone-700"}>Specific Illness Ledger</b> sub-tab
              {specificIllnesses.length > 0 && <> — {specificIllnesses.length} entr{specificIllnesses.length === 1 ? "y" : "ies"} currently saved for this plan</>}.
            </p>
            <ClippedButton
              onClick={() => setPlanMgmtView("illness-ledger")}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-3 py-2 ${dark ? "bg-orange-500/15 text-orange-300 hover:bg-orange-500/25" : "bg-orange-50 text-orange-700 hover:bg-orange-100"}`}
            >
              Manage in Ledger
            </ClippedButton>
          </div>

          {formMode === "edit" && (
            <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <ClippedButton
                onClick={handleCancelForm}
                cornerBg={dark ? "#0e2236" : "#ffffff"}
                className={`text-xs font-bold uppercase tracking-wide px-3.5 py-2 ${dark ? "text-stone-400 hover:text-stone-200" : "text-stone-500 hover:text-stone-700"}`}
              >
                Cancel
              </ClippedButton>
              <ClippedButton
                onClick={handleSave}
                disabled={saving}
                cornerBg={dark ? "#0e2236" : "#ffffff"}
                className={`text-xs font-bold uppercase tracking-wide px-4 py-2 ${
                  dark ? "bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30" : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {saving ? "Saving…" : isNewPlan ? "Save & Go Live" : "Save Changes"}
              </ClippedButton>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}
