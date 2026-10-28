/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TOP_PED_DICTIONARY,
  PED_BRIEFS,
  CATEGORY_LABELS,
  PlanConfig,
  PlanRestriction,
  PlanPedOverride,
  MatchOutput,
  SupportingFlags
} from "../types.js";

// Guarantees a valid, non-empty category label for the mapping explanation.
// Every categoryKey used by TOP_PED_DICTIONARY should already have a
// CATEGORY_LABELS entry (see types.ts), but this keeps the sentence builder
// safe even if a new category is added there without a matching label.
export function getCategoryLabel(categoryKey: string): string {
  return CATEGORY_LABELS[categoryKey] || PED_BRIEFS[categoryKey] || "a condition covered under this plan's declaration framework";
}

// Universal Manifestation Routing Policy (secondary manifestations/
// complications of a root disease): a handful of TOP_PED_DICTIONARY
// entries are literally named as an organ-specific complication of a root
// disease (e.g. "diabetic retinopathy" -> categoryKey "eye"), so the O(1)
// dictionary routing stage in the routing engine sends them straight to
// that organ's question. Organ wording still wins when the plan actually
// has a dedicated question for it (Question Wording Is Law / Specificity
// Override) — this table is only consulted when it doesn't, so the
// diagnosis falls back to the root disease's own question instead of the
// generic 'Others' section, since the condition is still, in substance,
// that disease. Keyed by the exact lowercased dictionary term.
export const SECONDARY_MANIFESTATION_ROOT_CATEGORY: Record<string, { rootCategoryKey: string; rootLabel: string }> = {
  "diabetic retinopathy": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
  "diabetic retinopathy eye": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
  "diabetic neuropathy nerve": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
  "diabetic nephropathy kidney": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
};

// Ensures a reasoning string always ends with terminal punctuation before it
// gets joined with the standard advisory footer sentence, so the two never
// run together as one unpunctuated run-on (e.g. "...in this plan Please
// cross-check..."). Also guards against empty/whitespace-only input.
export function ensureSentenceEnding(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return /[.!?…"'*_)\u{1F300}-\u{1FAFF}☀-➿]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function normalizeText(text: string): string {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// The EXACT key TOP_PED_DICTIONARY is looked up by at stage 0.7 (dictionary
// routing, below) — lowercased, punctuation DELETED (not replaced with a
// space: "c-section" -> "csection", not "c section"), internal whitespace
// collapsed. Exported so every write path that adds a live PED->category
// mapping (server.ts's promotePedMappingOverride, the pedMappingOverrides
// repository, the /api/add-ped-mapping "teach it" flow) can key its override
// with the SAME normalization the read path uses — otherwise a term with any
// punctuation (hyphens, apostrophes, parentheses — "C-Section", "Non-Hodgkin's
// Lymphoma") gets stored under a key the routing engine will never
// actually look up, so the override silently never fires.
export function normalizeDictionaryKey(pedText: string): string {
  return String(pedText || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function escapeRegExpForRestriction(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plan-Specific Restrictions (2026-08) — deterministic, keyword-based, no
 * AI involved. Generalizes the old hardcoded requiresInsulinForDiabetes /
 * excludePrediabetes / bypassBenignTumors flags (PlanOverrides in types.ts,
 * now deprecated) into admin-authored `plan_restrictions` DB rows, all
 * evaluated by this one function instead of scattered code-hardcoded
 * checks. See schema.ts's `plan_restrictions` doc comment for the full mode
 * semantics.
 *
 * Returns the matching restriction (so callers can build an explanation
 * from it) when this category's normal question should be DIVERTED to the
 * plan's catch-all for this specific PED text — null when nothing applies
 * and the PED should route to its normal question as usual. Only the
 * FIRST matching active restriction for this categoryKey is applied (a
 * plan is not expected to define more than one rule per category, but
 * order is deterministic — insertion order — if it ever does). */
export function isCategoryRestrictedForPed(
  categoryKey: string,
  pedTextLower: string,
  restrictions: PlanRestriction[] | undefined
): PlanRestriction | null {
  if (!restrictions || restrictions.length === 0) return null;
  for (const r of restrictions) {
    if (!r.isActive || r.categoryKey !== categoryKey) continue;
    if (r.mode === "block_category") return r;
    const matchesAnyKeyword = r.keywords.some((kw) => {
      const needle = kw.trim();
      if (!needle) return false;
      return new RegExp(`\\b${escapeRegExpForRestriction(needle)}\\b`, "i").test(pedTextLower);
    });
    if (r.mode === "require_keywords" && !matchesAnyKeyword) return r;
    if (r.mode === "exclude_keywords" && matchesAnyKeyword) return r;
  }
  return null;
}

export function detectSupportingFlags(ped: string): SupportingFlags {
  const text = normalizeText(ped);
  return {
    tests: /test|investigation|scan|biopsy|lab|xray/i.test(text),
    medication: /medication|medicine|tablet|insulin|drug|treatment/i.test(text),
    // Was just "surgery|operation" literally, so a named procedure like
    // "Appendectomy" or "Knee replacement" never set this flag — meaning
    // getApplicableUmbrellaQuestions() found zero applicable umbrella
    // questions for it and fell back to showing ALL of them, instead of
    // narrowing to just the surgery-specific one. Broadened to also catch
    // procedure-suffix words (-ectomy, -ostomy, -otomy, -plasty, -pexy) and
    // other common ways a surgical procedure gets named.
    hospitalisation: /hospitali[sz]ation|admitted|admission|surgery|surgical|operation|procedure|replacement|transplant|angioplasty|amputation|\w+ectomy|\w+ostomy|\w+otomy|\w+plasty|\w+pexy/i.test(text)
  };
}

export function getApplicableUmbrellaQuestions(config: PlanConfig, flags: SupportingFlags): string[] {
  if (!config.hasUmbrella) return [];
  const selected: string[] = [];
  config.umbrellaQuestions.forEach(q => {
    const qLower = normalizeText(q);
    if (flags.tests && /test|investigation/i.test(qLower)) selected.push(q);
    if (flags.medication && /medication|treatment/i.test(qLower)) selected.push(q);
    if (flags.hospitalisation && /hospitali[sz]ation|surgery/i.test(qLower)) selected.push(q);
  });
  return Array.from(new Set(selected));
}

export function resolvePlanQuestion(q: string, rawQs: string[]): string {
  if (!q || !rawQs) return "";
  const cleanInput = normalizeText(q);
  for (const raw of rawQs) {
    const cleanRaw = normalizeText(raw.replace(/^\s*\d+\.\s*/, ""));
    if (cleanRaw === cleanInput) {
      return raw;
    }
  }
  return "";
}

export function questionForCategory(config: PlanConfig, category: string): string {
  if (!config || !config.categoryMap || config.categoryMap[category] === undefined) {
    return "";
  }
  const target = config.categoryMap[category];
  if (typeof target === "number") {
    return config.questions[target] || "";
  }
  if (typeof target === "string") {
    return resolvePlanQuestion(target, config.questions);
  }
  return "";
}

/** Finds the admin plan-specific PED mapping that applies to this input:
 * an exact alias match first, otherwise the longest contiguous word
 * sequence of the input that is one of an override's aliases (so
 * "OSA since 2019" still resolves to the Obstructive Sleep Apnea override,
 * mirroring the routing engine's stage 0.75). Capped at 15 words. */
function findPlanPedOverride(pedText: string, overrides: PlanPedOverride[]): PlanPedOverride | null {
  const byAlias = new Map<string, PlanPedOverride>();
  for (const o of overrides) for (const a of o.aliases) if (a && !byAlias.has(a)) byAlias.set(a, o);
  if (byAlias.size === 0) return null;
  const key = normalizeDictionaryKey(pedText);
  const exact = byAlias.get(key);
  if (exact) return exact;
  const words = key.split(" ").filter(Boolean);
  if (words.length > 15) return null;
  for (let span = words.length - 1; span > 0; span--) {
    for (let start = 0; start + span <= words.length; start++) {
      const hit = byAlias.get(words.slice(start, start + span).join(" "));
      if (hit) return hit;
    }
  }
  return null;
}

/** ADMIN PLAN-SPECIFIC PED MAPPING — highest-priority stage of
 * the routing engine. An admin (Plan Management → Plan-Specific PED
 * Mappings) can pin one PED to an exact question on one plan, e.g.
 * Obstructive Sleep Apnea → "Nervous, Psychiatric or Mental or Sleep
 * disorder?" on Optima Secure while every other plan keeps routing it by
 * its Respiratory category. This deliberately wins over the PED's category,
 * the dictionary, plan restrictions and the hardcoded plan blocks: it is an
 * explicit human decision for this exact plan+PED pair. Returns null when
 * no override applies, or when the override's target no longer resolves to
 * a question on this plan (stale wording) — normal routing then continues. */
export function applyPlanPedOverride(pedText: string, config: PlanConfig): MatchOutput | null {
  if (!config?.pedOverrides?.length) return null;
  const override = findPlanPedOverride(pedText, config.pedOverrides);
  if (!override) return null;

  const planQuestions = [...(config.questions || []), ...(config.anyOther ? [config.anyOther] : [])];
  const question =
    (override.targetQuestion && resolvePlanQuestion(override.targetQuestion, planQuestions)) ||
    (override.categoryKey && questionForCategory(config, override.categoryKey)) ||
    "";
  if (!question) return null;

  const isCatchAll = normalizeText(question) === normalizeText(config.anyOther || "");
  const output = makeOutput(
    pedText,
    isCatchAll ? "FALLBACK" : "P1",
    question,
    `👉 *${pedText}* (${override.pedName}) is mapped to this question specifically for this plan${override.reason ? ` — ${override.reason}` : ""} (plan-specific PED mapping).`
  );
  output.plan_override = true;
  return output;
}

// ─────────────────────────────────────────────────────────────────────────
// PLAN DECISION ENGINE — approved architecture, 2026-07-29.
//
// Formalizes the one part of the routing engine that is genuinely
// "insurer-specific routing for an already-resolved category," as its own
// named, reusable step — per the architecture review's Rule 2/3/5 and the
// approved "Plan Decision Engine" component. It answers exactly one
// question: given a category this plan config already knows about, what
// does THIS plan want to do with it? There are three possible outcomes,
// and — this is the key finding from the architecture review, confirmed
// against real plan configs — all three already exist in today's data;
// this function only gives them an explicit name and shape instead of
// leaving the distinction implicit inside one long if/else chain:
//
//   - "direct_question": config.categoryMap[category] resolves to a real,
//     specific declaration question (not the plan's catch-all). Rule 2.
//   - "explicit_catchall": config.categoryMap[category] resolves to
//     EXACTLY config.anyOther — i.e. someone deliberately configured this
//     category to fall to the plan's catch-all question. This is not a
//     gap; it's real, existing, intentional config (see the "covid" /
//     "lipid" / "skin" entries in types.ts, one of which has an explicit
//     comment: doing this instead of leaving the category unmapped is
//     exactly what stops the condition from silently falling through to
//     Gemini). Rule 3 — never invoke Gemini when this is the outcome.
//   - "no_mapping": config.categoryMap has no entry at all for this
//     category on this plan. the routing engine's caller should keep
//     evaluating its other deterministic sections (the shared regex/shield
//     sections below), NOT immediately treat this as "Others" — "no
//     mapping" here means "this plan config doesn't cover this category,"
//     not "the input is unclassifiable."
//
// This function receives raw `pedText`/`cleanInputLower` alongside the
// category because two existing, pre-migration nuances need to be
// preserved exactly and can only be evaluated with the original text: the
// "secondary manifestation" root-disease rescue (e.g. "diabetic
// retinopathy" falling back to the Diabetes question when this plan has no
// dedicated Eye question) folds into "direct_question" since it still
// returns a real, specific question — just for a related root category.
//
// Deliberately NOT covered here (by design, not oversight): the ~13
// hardcoded categoryKey special cases above this call site in
// the routing engine (vascular_fallback, acute_infection, allergy,
// neuro_mild, investigation_procedure, etc.) and the diabetes
// insulin-qualifier post-check. Those are either universal, plan-agnostic
// category behaviors that pre-empt plan-specific routing entirely, or a
// per-condition qualifier applied AFTER a direct-question outcome — both
// stay exactly where they already are, unchanged, rather than being
// force-fit into this 3-outcome shape.
// ─────────────────────────────────────────────────────────────────────────
export type PlanDecisionOutcome =
  | { kind: "direct_question"; question: string; explanation: string }
  | { kind: "explicit_catchall"; question: string; explanation: string }
  | { kind: "no_mapping" };

export function resolvePlanDecision(
  categoryKey: string,
  config: PlanConfig,
  pedText: string,
  cleanInputLower: string
): PlanDecisionOutcome {
  const targetQ = questionForCategory(config, categoryKey);
  if (!targetQ) {
    return { kind: "no_mapping" };
  }

  if (targetQ === config.anyOther) {
    const rootFallback = SECONDARY_MANIFESTATION_ROOT_CATEGORY[cleanInputLower];
    if (rootFallback) {
      const rootQ = questionForCategory(config, rootFallback.rootCategoryKey);
      if (rootQ && rootQ !== config.anyOther) {
        const categoryLabel = getCategoryLabel(categoryKey);
        return {
          kind: "direct_question",
          question: rootQ,
          explanation: `"${pedText}" is a complication of the condition covered by this plan's **${rootFallback.rootLabel}** question. This plan has no dedicated **${categoryLabel}** question, so it is declared there instead.`,
        };
      }
    }
    const categoryLabel = getCategoryLabel(categoryKey);
    return {
      kind: "explicit_catchall",
      question: config.anyOther,
      explanation: `"${pedText}" falls under the **${categoryLabel}** category, but this plan has no dedicated declaration question for it. Proceed with the 'Others' section.`,
    };
  }

  const categoryLabel = getCategoryLabel(categoryKey);
  return {
    kind: "direct_question",
    question: targetQ,
    explanation: `"${pedText}" falls under the **${categoryLabel}** category and is a category-level match to this plan's declaration question above.`,
  };
}

export function findQuestion(config: PlanConfig, pattern: RegExp): string {
  return config.questions.find(q => pattern.test(normalizeText(q))) || "";
}

export interface PlanDecisionOverride {
  applied: boolean;
  matchType: MatchOutput["match_type"];
  matchedQuestion: string;
  explanation: string | null;
}

/**
 * Shared HIGH-confidence override rule (2026-07-29, explicit user request):
 * when Gemini (or a replayed AI Memory cache entry) reports a category with
 * HIGH confidence and this plan's Plan Decision Engine has an unambiguous
 * mapping for that category that differs from the question currently
 * selected, use the Plan Decision Engine's routing instead — mirroring how
 * a repository-resolved category is handled (resolvePlanDecision's
 * "direct_question" -> P1 / "explicit_catchall" -> FALLBACK mapping above).
 *
 * Used from BOTH call sites that can hand a condition back to an advisor:
 * the live Gemini path (server.ts Level 3) and the AI Memory cache replay
 * path (server.ts Level 2) — a cached answer recorded before this rule
 * existed, or before a plan's category mapping was corrected, must be
 * corrected on replay too, not just on the next fresh Gemini call. This
 * never writes anything back into ped_repository/ped_aliases/categories —
 * it only decides which answer to show for this one lookup.
 */
export function applyHighConfidenceCategoryOverride(
  currentQuestion: string,
  currentMatchType: MatchOutput["match_type"],
  identifiedCategory: string | null | undefined,
  confidence: string | null | undefined,
  config: PlanConfig,
  pedText: string
): PlanDecisionOverride {
  const noOp: PlanDecisionOverride = { applied: false, matchType: currentMatchType, matchedQuestion: currentQuestion, explanation: null };
  if (!identifiedCategory || (confidence ?? "").toUpperCase() !== "HIGH") return noOp;

  const planDecision = resolvePlanDecision(identifiedCategory, config, pedText, normalizeDictionaryKey(pedText));
  if (planDecision.kind === "no_mapping" || planDecision.question === currentQuestion) return noOp;

  return {
    applied: true,
    matchType: planDecision.kind === "direct_question" ? "P1" : "FALLBACK",
    matchedQuestion: planDecision.question,
    explanation: planDecision.explanation,
  };
}

export function makeOutput(ped: string, matchType: MatchOutput["match_type"], question: string, explanation: string): MatchOutput {
  return { ped_input: ped, match_type: matchType, matched_question: question, explanation };
}

export function sanitizeOutput(output: unknown, ped: string, config: PlanConfig): MatchOutput {
  const obj: Record<string, unknown> =
    output && typeof output === "object" ? { ...(output as Record<string, unknown>) } : {};
  const validTypes: MatchOutput["match_type"][] = ["P0", "P1", "P2", "FALLBACK", "NON_AILMENT", "ESCALATE", "INVALID"];
  if (!validTypes.includes(obj.match_type as MatchOutput["match_type"])) obj.match_type = "FALLBACK";
  obj.ped_input = String(obj.ped_input || ped);
  obj.matched_question = String(obj.matched_question || config.anyOther).trim();
  obj.explanation = String(obj.explanation || `${ped || "This condition"} is not explicitly listed.`);
  return obj as unknown as MatchOutput;
}

function cleanEscalationExplanation(explanation: string, resolvedQ: string): string {
  if (!explanation) return "";
  const indicators = [
    "However, it exhibits complex clinical features",
    "However, *it exhibits complex clinical features",
    "exhibits complex clinical features"
  ];
  for (const ind of indicators) {
    const idx = explanation.indexOf(ind);
    if (idx !== -1) {
      let mainDef = explanation.substring(0, idx).trim();
      mainDef = mainDef.replace(/^📝\s*/, "").replace(/^\*\s*/, "");
      return `👉 **${mainDef}**\n\nThis maps to the specific main question category: **${resolvedQ}**.`;
    }
  }
  return `${explanation}\n\n👉 Mapped directly to specific main question category: **${resolvedQ}**.`;
}

export function resolveConfusionAndEscalation(output: MatchOutput, config: PlanConfig, rawQuestions: string[]): MatchOutput {
  if (!output || output.match_type !== "ESCALATE") return output;

  const confused = output.confused_questions || [];
  if (confused.length === 0) return output;

  // 1. Resolve raw questions, normalize them
  const resolvedConfused = confused.map(q => {
    const resolved = resolvePlanQuestion(q, rawQuestions);
    return resolved || q;
  });

  const fallbackQNorm = normalizeText(config.anyOther);
  const umbrellaNorms = (config.umbrellaQuestions || []).map(u => normalizeText(u));

  // 2. Filter out Any Other and Umbrella questions
  const filteredConfused = resolvedConfused.filter(q => {
    const norm = normalizeText(q);
    if (norm === fallbackQNorm) return false;
    if (umbrellaNorms.includes(norm)) return false;
    return true;
  });

  if (filteredConfused.length === 1) {
    // Resolved to exactly ONE specific main question category!
    const resolvedQ = filteredConfused[0];
    output.match_type = "P1";
    output.matched_question = resolvedQ;
    output.confused_questions = [];
    output.explanation = cleanEscalationExplanation(output.explanation, resolvedQ);
  } else if (filteredConfused.length === 0) {
    // No specific main question can be resolved
    output.match_type = "FALLBACK";
    output.matched_question = config.anyOther;
    output.confused_questions = [];
    output.explanation = `👉 *${output.ped_input}* does not map to any specific medical category in this plan. Proceed with the general section: "${config.anyOther}".`;
  } else {
    // More than 1 specific main question is still confused: update list to show only specific main questions
    output.confused_questions = filteredConfused;
  }

  return output;
}

export function finalizeOutput(output: MatchOutput, ped: string, config: PlanConfig, rawQuestions: string[]): MatchOutput {
  if (!output) return output;
  if (output.match_type === "NON_AILMENT") return output;

  // Resolve any false escalations/confusion with Fallback/Umbrella questions first!
  if (output.match_type === "ESCALATE") {
    output = resolveConfusionAndEscalation(output, config, rawQuestions);
  }

  if (output.match_type === "ESCALATE" || output.match_type === "INVALID") return output;

  if (output.matched_question && output.matched_question !== config.anyOther) {
    const resolved = resolvePlanQuestion(output.matched_question, rawQuestions);
    if (resolved) {
      output.matched_question = resolved;
      if (resolved === config.anyOther) {
        output.match_type = "FALLBACK";
      } else if (output.match_type === "FALLBACK") {
        output.match_type = "P1";
      }
    } else {
      output.match_type = "FALLBACK";
      output.matched_question = config.anyOther;
    }
  } else {
    output.match_type = "FALLBACK";
    output.matched_question = config.anyOther;
  }

  output.supporting_flags = detectSupportingFlags(ped);
  output.secondary_recommendation = (output.match_type === "P1" || output.match_type === "P0" || output.match_type === "FALLBACK") ?
    ((output.match_type === "FALLBACK" && getApplicableUmbrellaQuestions(config, output.supporting_flags).length === 0)
      ? (config.umbrellaQuestions || [])
      : getApplicableUmbrellaQuestions(config, output.supporting_flags))
    : [];

  // ==========================================
  // AUTHORITATIVE DECLARATION FRAMEWORK RULES
  // ==========================================
  const pedLower = String(ped || "").toLowerCase().trim();
  let rawExp = output.explanation || "";

  // 1. Terminology replacements: Always use "Others Section", never "Others", never "Other Conditions" except actual wording.
  // The negative lookahead guards against double-appending when a source
  // string already correctly wrote "Others Section" literally (e.g. the
  // acute_trauma/TB-lymph-node FALLBACK messages below) — without it, "the
  // 'Others Section'" was being turned into the redundant "the 'Others
  // Section Section'" every time this ran.
  rawExp = rawExp.replace(/\bOthers\b(?!\s+Section)/g, "Others Section");
  rawExp = rawExp.replace(/\bother conditions\b/gi, "Others Section");
  rawExp = rawExp.replace(/\bother disease\b/gi, "Others Section");

  // 2. Specific Test vs Generic Test Rules
  const specificTests = [
    { key: "angiography", label: "Angiography" },
    { key: "tmt", label: "TMT / Treadmill Test / Stress Test" },
    { key: "treadmill", label: "TMT / Treadmill Test / Stress Test" },
    { key: "stress test", label: "TMT / Treadmill Test / Stress Test" },
    { key: "ecg", label: "ECG / Echocardiogram" },
    { key: "echo", label: "ECG / Echocardiogram" },
    { key: "echocardiogram", label: "ECG / Echocardiogram" },
    { key: "mri", label: "MRI" },
    { key: "endoscopy", label: "Endoscopy" },
    { key: "colonoscopy", label: "Colonoscopy" },
    { key: "usg", label: "USG / Ultrasound Sonography" },
    { key: "ultrasound", label: "USG / Ultrasound Sonography" },
    { key: "sonography", label: "USG / Ultrasound Sonography" },
  ];

  const mentionsSpecificTest = specificTests.some(st => pedLower.includes(st.key));
  const isTestQuery = /\b(test|scan|profile|report|findings?|xray|x-ray|checkup|investigation|blood test|lab)\b/i.test(pedLower);

  if (isTestQuery) {
    if (mentionsSpecificTest) {
      // Keep actual test name
      specificTests.forEach(st => {
        if (pedLower.includes(st.key)) {
          rawExp = rawExp.replace(new RegExp(`(\\b)${st.key}(\\b)`, "gi"), `$1**${st.label}**$2`);
        }
      });
    } else {
      // Use Generic Test Rule
      rawExp = `Medical tests were done. \n\n${rawExp}`;
    }
  }

  // 3. Medication Rule: use generalized framework language
  if (pedLower.includes("hypertension") && (pedLower.includes("medicat") || pedLower.includes("tablet") || pedLower.includes("drug") || pedLower.includes("pill"))) {
    rawExp = `${rawExp}\n\nMedications of Hypertension going on.`;
  }
  if (pedLower.includes("cholesterol") && (pedLower.includes("medicat") || pedLower.includes("tablet") || pedLower.includes("drug") || pedLower.includes("pill"))) {
    rawExp = `${rawExp}\n\nMedications of Cholesterol going on.`;
  }
  if (pedLower.includes("diabetes") && (pedLower.includes("medicat") || pedLower.includes("tablet") || pedLower.includes("drug") || pedLower.includes("pill") || pedLower.includes("insulin"))) {
    rawExp = `${rawExp}\n\nMedications of Diabetes going on.`;
  }
  if (pedLower.includes("thyroid") && (pedLower.includes("medicat") || pedLower.includes("tablet") || pedLower.includes("drug") || pedLower.includes("pill"))) {
    rawExp = `${rawExp}\n\nMedications of Thyroid going on.`;
  }

  // 4. Medical Details Available Rule
  rawExp = rawExp.replace(/reports? (are )?un.?available/gi, "Medical details available");
  rawExp = rawExp.replace(/reports? are not available/gi, "Medical details available");
  rawExp = rawExp.replace(/no reports/gi, "Medical details available");

  // 5. PX TRIGGER LOGIC
  // We keep the raw medical explanation primary, removing repetitive redundant fallback text as requested.
  let explanationSuffix = "Please cross-check the Declaration Framework personally before taking the final disclosure call.";
  if (output.match_type === "FALLBACK") {
    explanationSuffix = "Check if the umbrella questions are applicable first‼️. If not applicable, declare under the 'Others Section' question.\n\nPlease cross-check the Declaration Framework personally before taking the final disclosure call.";
  } else if (output.secondary_recommendation && output.secondary_recommendation.length > 0) {
    // A genuine direct/category match (P0/P1) that ALSO carries a
    // hospitalisation/surgery supporting flag — e.g. a named surgical
    // procedure like "Angioplasty" that independently maps to a specific
    // illness category (Cardiac/Heart Disease). Both facts are true at
    // once, so say so explicitly instead of leaving the advisor to infer
    // it from the umbrella panel alone: it's a surgical procedure (check
    // the umbrella question(s) shown above too) AND, separately, the PED
    // itself maps to the category question below. This used to render
    // with a hardcoded "Fallback — Others Section" sub-label in the UI
    // even though it's nowhere near the anyOther catch-all — see
    // DeclarationAssistantResults.tsx, which now derives that sub-label
    // from match_type instead of assuming FALLBACK whenever the umbrella
    // panel is shown.
    const pedDisplayName = String(ped || "").trim();
    const pedSentenceCase = pedDisplayName ? pedDisplayName.charAt(0).toUpperCase() + pedDisplayName.slice(1) : "This PED";
    explanationSuffix = `${pedSentenceCase} is flagged as a surgical/hospitalisation-related procedure — check the umbrella question(s) above first as well. Separately, as a diagnosed condition, it maps to the category question below.\n\nPlease cross-check the Declaration Framework personally before taking the final disclosure call.`;
  }
  // Always terminate the reasoning with a period before appending the
  // standardized advisory footer, so the two never run together as one
  // unpunctuated sentence (e.g. "...in this plan Please cross-check...").
  // The UI renders this string with paragraph breaks preserved, so \n\n also
  // gives a clear visual separation between reasoning and the footer.
  output.explanation = `${ensureSentenceEnding(rawExp)}\n\n${explanationSuffix}`;

  return output;
}
