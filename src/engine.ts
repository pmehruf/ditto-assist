/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TOP_PED_DICTIONARY,
  PED_BRIEFS,
  CATEGORY_LABELS,
  PlanConfig,
  MatchOutput,
  SupportingFlags
} from "./types.js";

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
// dictionary routing stage in classifyDeterministic sends them straight to
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
// Lymphoma") gets stored under a key classifyDeterministic will never
// actually look up, so the override silently never fires.
export function normalizeDictionaryKey(pedText: string): string {
  return String(pedText || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

// Snapshot of TOP_PED_DICTIONARY's compiled values, captured at module load
// — before pedMappingLive.ts's ensurePedOverridesLoaded ever runs (that's
// lazy, on the first request that needs it) and before any in-place merge of
// DB overrides. Used by the plan-specific override blocks in
// classifyDeterministic (stage 0.4) below to tell "TOP_PED_DICTIONARY still
// holds this term's original compiled default" apart from "an admin has
// actually changed this term's category via PED Library / AI Mapping
// Review since then" — those two cases must be handled differently there.
// A naive "does TOP_PED_DICTIONARY have a truthy entry for this term"
// check is NOT enough: several plan-specific blocks intentionally route a
// term family to a DIFFERENT category than the term's own generic
// dictionary default (e.g. "pulmonary embolism"/"varicose vein" default to
// the plan-agnostic "vascular_fallback" category, which has no dedicated
// question on most plans, while Activ Fit Preferred's proposal wording
// explicitly calls these out under its heart/peripheral-vascular-disease
// question) — that divergence is deliberate, not a bug, and must be
// preserved for terms nobody has actually re-categorized yet.
const STATIC_DICTIONARY_SNAPSHOT: Record<string, string> = { ...TOP_PED_DICTIONARY };

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

// ─────────────────────────────────────────────────────────────────────────
// PLAN DECISION ENGINE — approved architecture, 2026-07-29.
//
// Formalizes the one part of classifyDeterministic that is genuinely
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
//     category on this plan. classifyDeterministic's caller should keep
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
// classifyDeterministic (vascular_fallback, acute_infection, allergy,
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

export function checkNaturalLifeStages(pedText: string): MatchOutput | null {
  const text = String(pedText || "").toLowerCase().replace(/\s+/g, " ").trim();

  // 1. HARD FIREWALL: If it contains 'ectopic', it MUST NOT be caught by the natural life stage firewall.
  if (/\bectopic\b/i.test(text)) {
    return null;
  }

  // HARD FIREWALL: pregnancy-induced/gestational hypertension is a named
  // hypertensive disorder (TOP_PED_DICTIONARY explicitly categorizes it as
  // "hypertension"), not a natural physiological state — the bare "pregnan*"
  // token below would otherwise swallow it as NON_AILMENT before the
  // hypertension question is ever reached. Same bypass pattern as "ectopic".
  if (/\b(pregnancy[\s-]induced hypertension|gestational hypertension)\b/i.test(text)) {
    return null;
  }

  // 2. Optimized regex (Includes menstruation and periods)
  //
  // "c-section"/"lscs"/"caesarean" and "no pre-existing disease" were added
  // here to close a gap where TOP_PED_DICTIONARY tags them with the
  // "natural_life_stage" categoryKey (see types.ts), but the dictionary tag
  // alone is not enough to resolve them: the "natural_life_stage" categoryKey
  // handler (below, and in the 0.7 dictionary-routing stage) delegates
  // entirely to this function re-testing the raw PED text, ignoring how it
  // got here. Without a literal trigger token here for these terms, the
  // dictionary-tagged entries "c-section delivery", "csection delivery",
  // "c - section", "c section", "no pre-existing disease", and
  // "no preexisting disease" stayed unresolved (fell through to the AI
  // fallback) even after being added to the dictionary.
  const nonAilmentRegex = /\b(menstruat(e|ion|ing)|my period(s)?|regular period(s)?|menopaus(e|al)|peri-?menopaus(e|al)|post-?menopaus(e|al)|puberty|healthy|none|normal|fit|perfect|nil|n\/?a|not\s*applicable|no\s+pre-?existing|routine\s*checkup|general\s*checkup|master\s*health|executive\s*checkup|vaccin(ation|e|ed)|immuniz(ation|ed)|pregnan(cy|t)|childbirth|c\s*-?\s*section|caesarean|cesarean|lscs|post-?partum|post-?natal|lactat(ion|ing)|breastfeed(ing)?)\b/i;

  if (nonAilmentRegex.test(text)) {
    let shortExplanation = "a natural physiological state or routine event";

    if (/menopaus|puberty|lactat|breastfeed/i.test(text)) {
      shortExplanation = "a natural biological life stage or physiological transition";
    } else if (/healthy|none|normal|fit|perfect|nil|n\/?a|applicable|no\s+pre-?existing/i.test(text)) {
      shortExplanation = "an explicit declaration of normal health status or empty field placeholder";
    } else if (/checkup|vaccin|immuniz/i.test(text)) {
      shortExplanation = "a routine preventative wellness check or standard immunization event";
    } else if (/pregnan|childbirth|c\s*-?\s*section|caesarean|cesarean|lscs|post-?partum|post-?natal/i.test(text)) {
      shortExplanation = "a natural physiological life event";
    }

    const customReason = `⚠️ "${pedText}" is not a medical ailment, progressive chronic disease, or injury; it is classified as ${shortExplanation} and hence no specific questionnaire match applies.\n\nIf there are underlying chronic comorbidities or specific long-term secondary medical conditions, please clear the field and search again using that explicit diagnosis.`;

    return {
      ped_input: pedText,
      match_type: "NON_AILMENT",
      matched_question: "No questions applicable",
      explanation: customReason
    };
  }
  return null;
}

export function applyPostGuards(output: MatchOutput, ped: string, planName: string, config: PlanConfig): MatchOutput {
  const pedLower = normalizeText(ped);
  const matchedQ = normalizeText(output.matched_question || "");
  const fallbackQ = config.anyOther;

  // Care Supreme Diabetes Type 1 Restriction Post-guard
  if (config.overrides && config.overrides.requiresInsulinForDiabetes) {
    const isGestationalOrType2 = /\b(gestational|gdm|pregnancy[- ]diabetes|pregnancy induced|maternal|type 2|type-2|typeii|type ii|t2dm|t2d)\b/i.test(pedLower);
    const hasInsulinOrType1 = /\b(type\s*1|type-1|typei|type i|t1dm|t1d|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i.test(pedLower);
    
    if (isGestationalOrType2 && !hasInsulinOrType1) {
      const diabetesQuestion = questionForCategory(config, "diabetes");
      if (diabetesQuestion && normalizeText(output.matched_question) === normalizeText(diabetesQuestion)) {
        output.match_type = "FALLBACK";
        output.matched_question = fallbackQ;
        output.explanation = `*${ped}* is a non-severe diabetes lineage (Gestational or Type-2 Diabetes without insulin requirement).\n\nBecause this plan ("${planName}") strictly restricts its primary diabetes question to confirmed Type 1, insulin-dependent, or severe diabetes complications, this condition is routed under the general section: "${config.anyOther}".`;
        return output;
      }
    }
  }

  if (/\brheumatoid arthritis\b/i.test(pedLower) && /nervous|psychiatric|sleep/i.test(matchedQ)) {
    const musculoskeletalQ = questionForCategory(config, "musculoskeletal") || questionForCategory(config, "autoimmune");
    if (musculoskeletalQ) {
      output.match_type = "P1";
      output.matched_question = musculoskeletalQ;
      return output;
    }
  }

  if (/\b(sjogren|sle|lupus|scleroderma)\b/i.test(pedLower) &&
    /eye|vision|ear|nose|throat|lung|respiratory|stomach/i.test(matchedQ)) {

    const immuneQ = questionForCategory(config, "autoimmune");
    if (immuneQ) {
      output.match_type = "P1";
      output.matched_question = immuneQ;
      return output;
    }

    output.match_type = "FALLBACK";
    output.matched_question = fallbackQ;
    output.explanation = `${ped} is a systemic autoimmune condition and should not be routed by organ association alone in this plan.`;
    return output;
  }

  return output;
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

// PED Repository DB migration, Phase 3 (PED_REPOSITORY_DB_MIGRATION_DESIGN.md
// §4) — the optional `dbSource` param below. Defined structurally here
// (not imported from src/server/pedRuntimeCache.ts) to avoid a circular
// import: that module imports the repositories, which import
// normalizeDictionaryKey from THIS file. TypeScript's structural typing
// means server.ts can still pass pedRuntimeCache's Map/function straight in
// with no shared type import needed.
export interface DbDictionarySource {
  /** normalizeDictionaryKey(text) -> the PED it resolves to, mirroring
   * TOP_PED_DICTIONARY's shape but carrying pedId too (needed for the
   * plan-override lookup below). */
  aliasLookup: Map<string, { pedId: number; categoryKey: string | null }>;
  /** (planName, pedId) -> this plan's category override for that PED, if
   * any — the generic DB-backed replacement for the 4 hardcoded
   * "0.4 PLAN-SPECIFIC OVERRIDES & INTERCEPTS" blocks below. */
  planOverrideLookup: (planName: string, pedId: number) => { categoryKey: string; reason: string | null } | null;
}

/**
 * `dbSource` is entirely optional and additive — every existing call site
 * (tests, server.ts today) that omits it gets byte-for-byte identical
 * behavior to before this parameter existed: TOP_PED_DICTIONARY and the 4
 * hardcoded plan-specific blocks below are untouched and remain the
 * default/fallback path. Only a caller that explicitly passes a populated
 * `dbSource` (server.ts, gated behind `PED_SOURCE=db`) exercises the
 * DB-backed lookup instead. See PED_REPOSITORY_DB_MIGRATION_DESIGN.md §4.
 */
export function classifyDeterministic(
  ped: string,
  planName: string,
  config: PlanConfig,
  dbSource?: DbDictionarySource | null
): MatchOutput | null {
  const text = normalizeText(ped);
  const pedText = String(ped || "").trim();
  let q = "";

  // 0. NATURAL LIFE STAGE FIREWALL
  const lifeStageCheck = checkNaturalLifeStages(pedText);
  if (lifeStageCheck) return lifeStageCheck;

  // 0.4 PLAN-SPECIFIC OVERRIDES & INTERCEPTS
  //
  // Each block below hardcodes a categoryKey for a family of terms whose
  // exact wording this one plan's proposal form calls out under a specific
  // question. They fire before the dictionary stage (0.7), so historically
  // they completely shadowed TOP_PED_DICTIONARY/ped_mapping_overrides for
  // these terms on these plans: a PED Library edit (e.g. re-categorizing
  // Obstructive Sleep Apnea from Congenital to Respiratory) would save
  // successfully and take effect on every other plan, but this plan would
  // silently keep returning the old hardcoded result forever — reported
  // 2026-07-28 ("still gave previous mapping result on lookup" for OSA on
  // what turned out to be Activ Fit Preferred).
  //
  // Fix: look up the term's CURRENT live category in TOP_PED_DICTIONARY
  // first (the same source PED Library edits write into) and use that if
  // present; only fall back to the historical hardcoded category (and its
  // plan-specific explanation) when no live entry exists for this exact
  // term. This makes every future PED Library / AI Mapping Review edit
  // reach these plans too, without losing the original intent (accurate
  // routing that matches each plan's actual proposal-form wording) for
  // terms nobody has ever touched.
  const dictKeyForPed = normalizeDictionaryKey(pedText);
  const currentDictCategory = TOP_PED_DICTIONARY[dictKeyForPed];
  // Only "live" if it's actually different from the term's original
  // compiled default — see STATIC_DICTIONARY_SNAPSHOT above for why.
  const liveOverrideCategory =
    currentDictCategory !== undefined && currentDictCategory !== STATIC_DICTIONARY_SNAPSHOT[dictKeyForPed]
      ? currentDictCategory
      : undefined;

  // DB-BACKED GENERIC PLAN OVERRIDE (Phase 3) — the eventual replacement
  // for the 4 hardcoded blocks below (PED_REPOSITORY_DB_MIGRATION_DESIGN.md
  // §4), reachable only when a caller explicitly passes `dbSource`
  // (server.ts, gated behind PED_SOURCE=db). Takes precedence over the
  // hardcoded blocks when this exact term resolves to a real ped_repository
  // row that has a plan_overrides row for (planName, pedId); otherwise
  // falls straight through to the hardcoded blocks below, unchanged. With
  // no `dbSource` (every existing call site today), this whole branch is
  // skipped and behavior is identical to before this parameter existed.
  if (dbSource) {
    const dbEntry = dbSource.aliasLookup.get(dictKeyForPed);
    if (dbEntry) {
      const dbOverride = dbSource.planOverrideLookup(planName, dbEntry.pedId);
      if (dbOverride) {
        const qTarget = questionForCategory(config, dbOverride.categoryKey);
        if (qTarget) {
          return makeOutput(
            pedText,
            "P1",
            qTarget,
            `👉 *${pedText}* maps to the ${getCategoryLabel(dbOverride.categoryKey)} question in this plan${dbOverride.reason ? ` — ${dbOverride.reason}` : ""} (PED Repository, plan override).`
          );
        }
      }
    }
  }

  if (planName === "Activ Fit Preferred") {
    // 1. Sleep Apnea / OSA override to congenital/genetic question in AFP
    if (/\b(obstructive sleep apnea|sleep apnea|osa)\b/i.test(text)) {
      const targetCategory = liveOverrideCategory || "genetic";
      const qTarget = questionForCategory(config, targetCategory);
      if (qTarget) {
        return makeOutput(
          pedText,
          "P1",
          qTarget,
          liveOverrideCategory && liveOverrideCategory !== "genetic"
            ? `👉 *${pedText}* maps to the ${CATEGORY_LABELS[liveOverrideCategory] || liveOverrideCategory} question in this plan, per its current PED Library category.`
            : `👉 *${pedText}* maps to the congenital/genetic/disability question in this plan (which explicitly names Obstructive Sleep Apnea).`
        );
      }
    }

    // 2. DVT, PE, and varicose veins override of the general vascular/venous condition shield to heart (peripheral vascular disease) question in AFP
    if (/\b(deep vein thrombosis|dvt|pulmonary embolism|pulmonary thromboembolism|venous thromboembolism|vte|varicose veins?|lymphedema|raynaud disease|raynaud phenomenon)\b/i.test(text)) {
      const targetCategory = liveOverrideCategory || "heart";
      const qTarget = questionForCategory(config, targetCategory);
      if (qTarget) {
        return makeOutput(
          pedText,
          "P1",
          qTarget,
          liveOverrideCategory && liveOverrideCategory !== "heart"
            ? `👉 *${pedText}* maps to the ${CATEGORY_LABELS[liveOverrideCategory] || liveOverrideCategory} question in this plan, per its current PED Library category.`
            : `👉 *${pedText}* maps to the heart/peripheral vascular disease question in this plan (which explicitly lists peripheral vascular disease).`
        );
      }
    }
  }

  if (planName === "Care Supreme") {
    // Crohn's, Ulcerative Colitis, and IBD override to Blood and / or Immunity question in Care Supreme
    if (/\b(crohn|colitis|ulcerative colitis|ibd)\b/i.test(text)) {
      const targetCategory = liveOverrideCategory || "blood";
      const qTarget = questionForCategory(config, targetCategory);
      if (qTarget) {
        return makeOutput(
          pedText,
          "P1",
          qTarget,
          liveOverrideCategory && liveOverrideCategory !== "blood"
            ? `👉 *${pedText}* maps to the ${CATEGORY_LABELS[liveOverrideCategory] || liveOverrideCategory} question in this plan, per its current PED Library category.`
            : `👉 *${pedText}* maps to the Blood and / or Immunity question in this plan (which explicitly names Crohn's disease and Ulcerative Colitis).`
        );
      }
    }
  }

  if (planName === "Optima Secure") {
    // Autoimmune joint diseases override to Musculoskeletal question in Optima Secure
    if (/\b(rheumatoid arthritis|ra\b|ankylosing spondylitis|psoriatic arthritis|reactive arthritis|reiter syndrome)\b/i.test(text)) {
      const targetCategory = liveOverrideCategory || "musculoskeletal";
      const qTarget = questionForCategory(config, targetCategory);
      if (qTarget) {
        return makeOutput(
          pedText,
          "P1",
          qTarget,
          liveOverrideCategory && liveOverrideCategory !== "musculoskeletal"
            ? `👉 *${pedText}* maps to the ${CATEGORY_LABELS[liveOverrideCategory] || liveOverrideCategory} question in this plan, per its current PED Library category.`
            : `👉 *${pedText}* maps to the musculoskeletal/arthritis question in this plan.`
        );
      }
    }
  }

  // 0.5 FAST-PATH SAFETY FIREWALLS & SHIELDS (INTERCEPT BOTH DICTIONARY & REGEX FLOWS)
  
  // A. GLOBAL DIAGNOSTICS & TEST FIREWALL
  // "positive hiv test", "std profile", and "lipid profile high" are
  // explicitly curated in TOP_PED_DICTIONARY as "hiv"/"hiv"/"lipid" —
  // deliberate disease-category assignments — but each contains "test" or
  // "profile", so without this carve-out they were always caught here first
  // and sent to a generic test-result message instead of ever reaching that
  // dictionary categorization.
  if (!(/\b(stress test|treadmill test|tmt|tolerance test|positive hiv test|std profile|lipid profile high)\b/i.test(text)) &&
    /\b(test|scan|profile|usg|ultrasound|mri|x-?ray|checkup|report)\b/i.test(text)) {
    return makeOutput(
      pedText,
      "FALLBACK",
      config.anyOther,
      `"${pedText}" indicates a medical test, scan, or report rather than a formal diagnosis. Please declare the specific structural diagnosis this test revealed. If none, declare the test itself under the 'medical tests and investigations' section.`
    );
  }

  // B. ACUTE INFECTIOUS FIREWALL
  if (/\b(malaria|dengue|typhoid|viral fever|flu|influenza|chikungunya|hepatitis a|cholera|food poisoning|gastroenteritis|pneumonia|measles|mumps|rubella|chickenpox|varicella|rotavirus|common cold)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther,
      `${pedText} is typically an acute/transient infection and should be declared under 'Any other disease' or 'Hospitalization/medication' sections if applicable.`);
  }

  // C. HYPOGLYCAEMIA SHIELD
  if (/\bhypoglyc\w*/i.test(text)) {
    // "hypoglycemia episode" and "reactive hypoglycemia" are explicitly
    // curated in TOP_PED_DICTIONARY as "diabetes" — production's own
    // deliberate categorization — but neither phrase contains a
    // diabetes-qualifying word for the generic pass-through check below, so
    // without this exact-phrase carve-out they were always intercepted here
    // and sent to FALLBACK instead of ever reaching that dictionary entry.
    const isDictionaryCuratedHypoglycemia = /\b(hypoglycemia episode|reactive hypoglycemia)\b/i.test(text);
    if (isDictionaryCuratedHypoglycemia || /\b(diabet\w*|insulin|dm\b|t1d|t2d|hba1c)\b/i.test(text)) {
      // let it fall through to normal checks or dictionary
    } else {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is a low blood sugar episode, not a diabetes diagnosis.* ` +
        `If this occurred in the context of diagnosed diabetes or insulin use, ` +
        `declare diabetes under its relevant category instead.`);
    }
  }

  // D. DVT / PULMONARY EMBOLISM SHIELD
  if (/\b(deep vein thrombosis|dvt|pulmonary embolism|pulmonary thromboembolism|venous thromboembolism|vte|thromboembolism)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther,
      `*${pedText} is a thromboembolic or venous vascular condition, not a primary heart disease.* ` +
      `DVT and pulmonary embolism are managed under vascular/coagulation medicine. ` +
      `Cardiac involvement, when it occurs, is a downstream complication — not the condition's identity. ` +
      `Declare under the 'Others' section.`);
  }

  // E. GANGRENE SHIELD
  if (/\bgangrene\b/i.test(text)) {
    if (/\b(diabet\w*|foot|toe|peripheral artery|pad|arterial|vascular)\b/i.test(text)) {
      // allow flow through
    } else {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is tissue death that can result from multiple causes* ` +
        `(diabetes, arterial disease, or infection). ` +
        `The underlying diagnosed condition should be declared in its relevant category.`);
    }
  }

  // F. HYPOTENSION / LOW BP SHIELD
  if (/\b(hypotension|low bp|low blood pressure|bp low|decreased bp)\b/i.test(text)) {
    const lowBpQ = questionForCategory(config, "hypotension");
    if (lowBpQ) {
      return makeOutput(pedText, "P1", lowBpQ, `${pedText} is a direct category match for this plan's low blood pressure question.`);
    }
    return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} refers to low blood pressure.* The policy questions strictly target Hypertension (High Blood Pressure). Therefore, this condition must be declared under the 'Others' section.`);
  }

  // G. GESTATIONAL & TYPE 2 DIABETES INTERCEPT COUPLING
  if (config.overrides && config.overrides.requiresInsulinForDiabetes) {
    const isGestationalOrType2 = /\b(gestational|gdm|pregnancy[- ]diabetes|pregnancy induced|maternal|type 2|type-2|typeii|type ii|t2dm|t2d)\b/i.test(text);
    const hasInsulinOrType1 = /\b(type\s*1|type-1|typei|type i|t1dm|t1d|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i.test(text);
    // "gestational hypertension" / "pregnancy induced hypertension" are named
    // hypertensive disorders (TOP_PED_DICTIONARY categorizes them as
    // "hypertension", not "diabetes"), but they share the qualifying words
    // "gestational"/"pregnancy induced" with this diabetes-only shield's
    // trigger list above. Without this exclusion, the shield swallowed them
    // purely on keyword presence and produced a diabetes-lineage-restriction
    // message for a condition that was never about diabetes at all. Only
    // bypass when the text is exclusively about hypertension (no diabetes
    // wording present), so genuine comorbid mentions ("gestational diabetes
    // with hypertension") still correctly trigger the diabetes shield.
    const isNamedHypertensionNotDiabetes = /\bhypertension\b/i.test(text) && !/\b(diabet\w*|blood sugar|dm\b)\b/i.test(text);
    if (isGestationalOrType2 && !hasInsulinOrType1 && !isNamedHypertensionNotDiabetes) {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is a specific non-severe lineage category (Gestational or Type-2 Diabetes without insulin requirement).* This plan ("${planName}") has a specific, strict question that covers ONLY Type 1 Diabetes, diabetes on insulin, or connected with blindness/ulcers. Therefore, this condition does not map to the primary diabetes question and must be declared under the general section: "${config.anyOther}".`);
    }
  }

  // H. PREDIABETES PLAN-AWARE INTERCEPT
  if (/\b(pre[- ]?diabet\w*|borderline diabetes|impaired fasting glucose|impaired glucose tolerance)\b/i.test(text)) {
    if (config.overrides && (config.overrides.excludePrediabetes || config.overrides.requiresInsulinForDiabetes)) {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is an elevated blood sugar finding.*\n\n` +
        `*However, this plan's diabetes question applies only to confirmed diagnoses or specified severe conditions:* ` +
        `*Type 1 Diabetes, diabetes on insulin, or connected with blindness/ulcers.* ` +
        `Prediabetes does not qualify for the primary diabetes question and should be declared under the 'Others' section.`);
    }
  }

  // I. HPV HIV-ONLY COUPLING FIX
  if (/\b(hpv|human papillomavirus)\b/i.test(text)) {
    const qStd = questionForCategory(config, "hiv");
    if (qStd && !/\b(std|sexually transmitted)\b/i.test(qStd)) {
      return makeOutput(
        pedText,
        "P1",
        config.anyOther,
        `${pedText} is a sexually transmitted infection, but this plan's specific question is restricted to HIV/AIDS. Therefore, it is correctly routed to 'Any other disease/condition'.`
      );
    }
  }

  // B. Check Explicit Policy Wording (Chunking) — run BEFORE the dictionary
  // routing below so an exact, verbatim wording match always wins as "P0"
  // (Direct Match). Previously this ran *after* dictionary routing, so any
  // PED with a TOP_PED_DICTIONARY entry (nearly all common PEDs, including
  // "diabetes") short-circuited to "P1" (Category Match) even when its name
  // was also literally one of the /-separated chunks in the plan's own
  // question wording — e.g. "Diabetes" against "Diabetes / High blood sugar
  // / Sugar in urine?" was tagged Category Match instead of Direct Match.
  // Exact wording is the strongest possible signal, so it must be checked
  // first regardless of whether a dictionary category also exists.
  const cleanInputForChunking = text.replace(/[^\w\s]/g, "").trim();
  if (cleanInputForChunking.length > 2) {
    for (const question of config.questions) {
      if (question === config.anyOther) continue;

      const chunks = question.toLowerCase().split(/[/,()]|\bor\b/);
      for (let chunk of chunks) {
        chunk = chunk.replace(/^\s*\d+\.\s*/, "").replace(/[^\w\s]/g, "").trim();
        if (chunk === cleanInputForChunking) {
          return makeOutput(pedText, "P0", question,
            `Exact condition match🎯: "${pedText}" is explicitly listed in this plan's questionnaire.`);
        }
      }
    }
  }

  // 0.7 O(1) DICTIONARY ROUTING
  // Punctuation is stripped above the dictionary-key level, but internal
  // whitespace was not re-collapsed afterward — a term like "c - section"
  // (hyphen flanked by spaces) stripped to "c  section" (double space),
  // which could never equal a normally-spaced dictionary key. Collapsing
  // runs of whitespace after stripping is purely additive: it only makes
  // MORE inputs match an existing single-spaced key, never changes what an
  // already-reachable key matches.
  const cleanInputLower = normalizeDictionaryKey(text);
  // DB-BACKED DICTIONARY LOOKUP (Phase 3): when `dbSource` is provided,
  // prefer its alias Map over TOP_PED_DICTIONARY — `normalized_alias` is
  // always written via this exact same normalizeDictionaryKey (see
  // pedAliasesRepository.ts), so no case-insensitive scan fallback is
  // needed the way the legacy branch below has one. Falls through to
  // TOP_PED_DICTIONARY when dbSource is absent (every existing call site
  // today) or this exact key isn't in the DB-backed alias set yet.
  let categoryKey = dbSource ? dbSource.aliasLookup.get(cleanInputLower)?.categoryKey ?? undefined : TOP_PED_DICTIONARY[cleanInputLower];
  if (!categoryKey && !dbSource) {
    const matchedKey = Object.keys(TOP_PED_DICTIONARY).find(k => k.toLowerCase() === cleanInputLower);
    if (matchedKey) {
      categoryKey = TOP_PED_DICTIONARY[matchedKey];
    }
  }

  // 0.75 FREE-TEXT PLAN-OVERRIDE RESOLUTION (added 2026-08-08 — production
  // readiness fix). Stage 0.4 above only fires on an EXACT alias match, so a
  // PED with a plan_overrides row could still fall through to the disease-
  // family regex sections below when the advisor's text doesn't exactly
  // match a stored alias (e.g. "Family history of Marfan syndrome" instead
  // of exactly "Marfan Syndrome") — those regex sections resolve a category
  // directly and never consult plan_overrides, so the same underlying PED
  // could reach two different questions depending only on phrasing. That
  // violates the approved architecture's intent: every identification path
  // that resolves to the same canonical PED must reach the plan-override
  // stage before category routing.
  //
  // Fix, scoped as narrowly as possible: if the exact match above found
  // nothing, try every contiguous word-sequence in the input against the
  // same alias map, longest first, exactly the way the regex sections below
  // already do substring/word-boundary matching — but tied back to a real
  // pedId so plan_overrides can be checked. If a plan override exists for
  // the matched PED, return it immediately, identically to stage 0.4. If NO
  // override exists for the matched PED, this is a deliberate no-op —
  // `categoryKey` is left untouched and control falls through to the regex
  // sections completely unchanged, exactly as before this stage existed.
  // This only ever changes behavior for the specific case being fixed
  // (a plan override that free text would otherwise have missed); it never
  // changes which category free text resolves to when no override applies.
  //
  // Gated behind `dbSource` (PED_SOURCE=db) like every other Phase 3
  // addition — a no-op on the legacy path. Capped at 15 words to bound the
  // worst case; real declarations are short phrases, not paragraphs.
  if (!categoryKey && dbSource) {
    const words = cleanInputLower.split(" ").filter(Boolean);
    if (words.length <= 15) {
      let bestPedId: number | null = null;
      let bestSpan = 0;
      for (let start = 0; start < words.length; start++) {
        for (let end = words.length; end > start; end--) {
          const span = end - start;
          if (span <= bestSpan) break; // no shorter span from here can beat the current best
          const candidate = words.slice(start, end).join(" ");
          const entry = dbSource.aliasLookup.get(candidate);
          if (entry) {
            bestPedId = entry.pedId;
            bestSpan = span;
            break;
          }
        }
      }
      if (bestPedId !== null) {
        const dbOverride = dbSource.planOverrideLookup(planName, bestPedId);
        if (dbOverride) {
          const qTarget = questionForCategory(config, dbOverride.categoryKey);
          if (qTarget) {
            return makeOutput(
              pedText,
              "P1",
              qTarget,
              `👉 *${pedText}* maps to the ${getCategoryLabel(dbOverride.categoryKey)} question in this plan${dbOverride.reason ? ` — ${dbOverride.reason}` : ""} (PED Repository, plan override — matched via free-text phrase, not an exact alias).`
            );
          }
        }
      }
    }
  }

  // Override: benign CNS tumors → benign_growth (not neoplasm)
  if (/\b(meningioma|acoustic\s*neuroma|craniopharyngioma|benign\s*brain\s*tu?mou?r)\b/i.test(text)) {
    categoryKey = "benign_growth";
  }
  if (categoryKey) {

    // Handle special dictionary cases (Firewalls & Ambiguous Symptoms)
    if (categoryKey === "vascular_fallback") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a vascular/venous condition.* It does not map to the severe cardiovascular/heart disease questions and should be declared under the 'Others Section'.`);
    }
    if (categoryKey === "autoimmune" && planName === "Optima Secure") {
      return makeOutput(
        pedText,
        "FALLBACK",
        config.anyOther,
        `*${pedText}* is a systemic autoimmune condition. Since this plan has no dedicated immunity or autoimmune category question, it is routed to the general section: "${config.anyOther}".`
      );
    }
    if (categoryKey === "acute_infection") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `${pedText} is typically an acute/transient infection and should be declared under 'Any other disease' or 'Hospitalization/medication' sections if applicable.`);
    }
    if (categoryKey === "allergy") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `*Allergies are hypersensitivity responses, not immune system disorders or respiratory diseases.*\n\nIf the allergy has led to a diagnosed condition, declare that condition in its relevant section.`);
    }
    if (categoryKey === "gynecomastia") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a condition of breast tissue enlargement in males. It's not an endocrine or thyroid disorder by itself.*\n\nIf the gynaecomastia is a diagnosed result of a hormonal disorder, declare the underlying disorder under Endocrine/Thyroid.`);
    }
    if (categoryKey === "ambiguous_symptom") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a general or ambiguous symptom/deficiency.* Because it can be caused by numerous minor issues, it does not automatically map to a disease category.`);
    }
    if (categoryKey === "eosinophilia_finding") {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is a blood test finding, not a primary blood disorder.*\n\n` +
        `Elevated eosinophil count is typically a secondary finding caused by allergies, ` +
        `parasitic infections, or drug reactions — not a structural blood disease like ` +
        `anaemia, haemophilia, or thalassaemia.\n\n` +
        `If eosinophilia is caused by a diagnosed underlying condition, declare that ` +
        `condition under its relevant category instead.`);
    }
    if (categoryKey === "lifestyle") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a lifestyle habit.* Declare this in the others section if specific lifestyle/habits section is not present in the proposal form`);
    }
    if (categoryKey === "natural_life_stage") {
      return checkNaturalLifeStages(pedText);
    }
    if (categoryKey === "acute_trauma") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `"${pedText}" indicates an acute injury or physical trauma rather than a specific illness category. Declare it under this plan's hospitalisation/surgery umbrella question if applicable, otherwise under the 'Others Section'.`);
    }
    // Governed-data equivalent of the legacy "8b. MILD / PERIPHERAL
    // NEUROLOGICAL" regex fallback (see below): mild/peripheral nerve
    // conditions (Bell's palsy, migraine, carpal tunnel syndrome, essential
    // tremor, trigeminal neuralgia, nerve pain) are deliberately routed away
    // from the severe "neuro" question (Stroke/Paralysis/Epilepsy) to avoid
    // over-flagging a generally mild, often self-resolving condition as
    // high-severity. Reproduces stage 8b's exact fallback logic — prefer the
    // plan's "psychiatric" question only if its own wording actually covers
    // "nervous" conditions, else fall back to the plan's "neuro" question —
    // but keyed off a governed ped_repository.categoryKey ("neuro_mild")
    // instead of a hardcoded PED-name regex list, per Checkpoint B decision
    // (2026-07-28): preserve the exact underwriting intent, move it to data.
    if (categoryKey === "neuro_mild") {
      let mildTarget = "psychiatric";
      const psychQ = questionForCategory(config, "psychiatric") || "";
      if (!psychQ.toLowerCase().includes("nervous")) {
        mildTarget = "neuro";
      }
      const qMild = questionForCategory(config, mildTarget);
      if (qMild) {
        return makeOutput(
          pedText,
          "P1",
          qMild,
          `${pedText} is a mild or peripheral nerve condition routed to the general nervous system question to avoid high-severity stroke flags (PED Repository governed category).`
        );
      }
    }
    // Governed-data equivalent of the legacy "23. DIAGNOSTICS" regex
    // fallback: a diagnostic/investigative procedure (e.g. Cystoscopy) is not
    // itself a disease diagnosis, so it should never be forced into a disease
    // category question — it belongs under this plan's medical
    // tests/investigations umbrella question instead. Per Checkpoint B
    // decision (2026-07-28): the repository should store the bare procedure
    // name only ("Cystoscopy", not "Cystoscopy done"), and its routing comes
    // from this categoryKey rather than being assigned a disease category.
    if (categoryKey === "investigation_procedure") {
      return makeOutput(
        pedText,
        "FALLBACK",
        config.anyOther,
        `"${pedText}" is a diagnostic or investigative procedure, not a formal disease diagnosis. Please declare the specific structural diagnosis this procedure revealed, if any. If none, check if this plan's umbrella medical tests/investigations question applies first; otherwise declare it under the 'Others' section (PED Repository governed category).`
      );
    }
    if (categoryKey === "benign_growth") {
      if (config.overrides && config.overrides.bypassBenignTumors) {
        return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a benign condition.* This plan's primary question strictly targets malignant cancers. Benign growths map to the 'Others' section.`);
      }
      const neoplasmQ = questionForCategory(config, "neoplasm");
      if (neoplasmQ) return makeOutput(pedText, "P1", neoplasmQ, `${pedText} is a generic tumour, cyst, polyp, or growth explicitly covered under this plan's primary question.`);
    }

    // PLAN DECISION ENGINE (approved architecture, 2026-07-29): given this
    // already-resolved category, ask the plan-specific decision step what
    // it wants to do with it. See resolvePlanDecision's doc comment above
    // for why this is exactly the pre-existing behavior, just named and
    // structured explicitly rather than left as an inline if/else.
    const planDecision = resolvePlanDecision(categoryKey, config, pedText, cleanInputLower);
    if (planDecision.kind === "explicit_catchall") {
      return makeOutput(pedText, "FALLBACK", planDecision.question, planDecision.explanation);
    }
    if (planDecision.kind === "direct_question") {
      // Plan-specific qualifier: diabetes is only routed to this plan's
      // primary diabetes question when the wording explicitly requires a
      // Type-1/insulin-dependent/complication-level qualifier — applied
      // AFTER the Plan Decision Engine's own outcome, since it isn't about
      // whether a mapping exists, but whether THIS specific condition
      // qualifies for the mapping that does.
      if (categoryKey === "diabetes" && config.overrides && config.overrides.requiresInsulinForDiabetes) {
        if (!/\b(type\s*1|type1|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i.test(pedText)) {
          return makeOutput(pedText, "FALLBACK", config.anyOther,
            `${pedText} does not meet the specific Type 1/Insulin-dependent qualifier for this plan's primary question.`);
        }
      }
      return makeOutput(pedText, "P1", planDecision.question, planDecision.explanation);
    }
    // planDecision.kind === "no_mapping": this plan's config doesn't cover
    // this category at all — fall through to the shared regex/shield
    // sections below, unchanged from pre-refactor behavior.
  }

  // (Removed: byte-identical duplicates of shields 0.5A "GLOBAL DIAGNOSTICS &
  // TEST FIREWALL" and 0.5B "ACUTE INFECTIOUS FIREWALL" used to sit here,
  // numbered "0.6" and "1." — both were 100% dead code, since 0.5A/0.5B run
  // earlier in the pipeline with no escape condition and always intercept
  // first. Confirmed via full pipeline trace before removal.)

  // 1.5 COVID-19
  if (/\b(covid[\s-]?19?|post[\s-]covid|long[\s-]covid|covid complications|coronavirus)\b/i.test(text)) {
    q = questionForCategory(config, "covid");
    if (q) return makeOutput(pedText, "P1", q, `*${pedText}* is a Covid-19 related condition.`);
  }

  // 2. MALIGNANT CANCERS
  if (/\b(cancer|carcinoma|sarcoma|lymphoma|leukemia|leukaemia|malignancy|malignant|melanoma|oncology|metastasis)\b/i.test(text)) {
    q = questionForCategory(config, "neoplasm");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a malignant neoplasm or cancer requiring primary disclosure.`);
  }

  // 3. STD / HPV
  if (/\b(hpv|human papillomavirus|std|sexually transmitted disease|syphilis|gonorrhea|chlamydia|herpes)\b/i.test(text)) {
    let qStd = questionForCategory(config, "hiv");

    // Issue 10 Fix: Prevent HPV from mapping to strict HIV-only questions
    if (/\b(hpv|human papillomavirus)\b/i.test(text)) {
      if (qStd && !/\b(std|sexually transmitted)\b/i.test(qStd)) {
        qStd = config.anyOther;
        if (qStd) {
          return makeOutput(
            pedText,
            "P1",
            qStd,
            `${pedText} is a sexually transmitted infection, but this plan's specific question is restricted to HIV/AIDS. Therefore, it is correctly routed to 'Any other disease/condition'.`
          );
        }
      }
    }

    if (qStd) {
      return makeOutput(pedText, "P1", qStd, `${pedText} is classified as a sexually transmitted disease/infection.`);
    }
  }

  // 4. LIPIDS
  if (/\b(cholesterol\w*|cholestrol\w*|hypercholest\w*|lipid disorder|triglycerid\w*|dyslipid\w*|hyperlipid\w*|ldl|hdl|high cholesterol)\b/i.test(text)) {
    const lipidQ = findQuestion(config, /lipid|cholesterol/i);
    if (lipidQ) return makeOutput(pedText, "P1", lipidQ, `${pedText} is a cardiovascular risk factor explicitly covered by the plan.`);
    return makeOutput(pedText, "FALLBACK", config.anyOther, `${pedText} is a lipid disorder with no primary category question in this plan.`);
  }

  // (Removed: a byte-identical duplicate of shield 0.5C "HYPOGLYCAEMIA
  // SHIELD" used to sit here, numbered "4.5" — functionally dead, since
  // 0.5C runs earlier with the identical regex and identical pass-through
  // condition on the same unmutated `text`, so it could never reach a
  // different verdict than 0.5C already had.)

  // 5. DIABETES
  // (Removed: a byte-identical duplicate of shield 0.5G "GESTATIONAL &
  // TYPE 2 DIABETES INTERCEPT COUPLING" used to sit here, numbered "5.0" —
  // dead for any plan with `requiresInsulinForDiabetes` set, since 0.5G runs
  // earlier with the identical regex and identical override-flag condition.)

  // 5a. PREDIABETES — PLAN-AWARE ROUTING
  if (/\b(pre[- ]?diabet\w*|borderline diabetes|impaired fasting glucose|impaired glucose tolerance)\b/i.test(text)) {
    if (config.overrides && (config.overrides.excludePrediabetes || config.overrides.requiresInsulinForDiabetes)) {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is an elevated blood sugar finding.*\n\n` +
        `*However, this plan's diabetes question applies only to confirmed diagnoses or specified severe conditions:* ` +
        `*Type 1 Diabetes, diabetes on insulin, or connected with blindness/ulcers.* ` +
        `Prediabetes does not qualify for the primary diabetes question and should be declared under the 'Others' section.`);
    }
    q = questionForCategory(config, "diabetes");
    if (q) return makeOutput(pedText, "P1", q,
      `${pedText} indicates elevated blood sugar levels that fall under this plan's diabetes or high blood sugar category.`);
  }

  // 5b. CONFIRMED DIABETES
  if (/\b(diabet\w*|dm\s*1|dm\s*2|t1dm|t2dm|t1d|t2d|type\s*1\s*dm|type\s*2\s*dm|high blood sugar|dm\b|high sugar|insulin dependent|diabetic foot|diabetic gangrene|diabetic neuropathy|diabetic retinopathy|hyperglycemia)\b/i.test(text)) {
    // Diabetic foot/gangrene/neuropathy/retinopathy are complications OF diabetes,
    // not diabetes itself — "is a diabetes or high blood sugar condition" is
    // medically inaccurate for these. Name the affected organ/system so the
    // advisor sees *why* an eye/nerve/foot condition is routed to the
    // diabetes question instead of its own category question, rather than
    // just being told it's "a complication" with no rationale.
    const DIABETES_COMPLICATION_ORGANS: Record<string, string> = {
      "diabetic retinopathy": "an eye",
      "diabetic neuropathy": "a nerve",
      "diabetic foot": "a foot/limb",
      "diabetic gangrene": "a tissue/vascular",
    };
    const diabetesComplicationHit = Object.entries(DIABETES_COMPLICATION_ORGANS).find(([term]) => text.includes(term));
    const diabetesDescription = diabetesComplicationHit
      ? `${pedText} is ${diabetesComplicationHit[1]} complication caused by diabetes — not an independent ${diabetesComplicationHit[1].replace(/^an?\s+/, "")} condition`
      : `${pedText} is a diabetes or high blood sugar condition`;
    if (config.overrides && config.overrides.requiresInsulinForDiabetes) {
      if (/\b(type\s*1|type1|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i.test(text)) {
        q = questionForCategory(config, "diabetes");
        if (q) return makeOutput(pedText, "P1", q, `${diabetesDescription} and meets the high-severity diabetes qualifiers for this plan.`);
      }
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `${pedText} does not meet the specific Type 1/Insulin-dependent qualifier for this plan's primary question.`);
    }
    q = questionForCategory(config, "diabetes");
    if (q) return makeOutput(pedText, "P1", q, `${diabetesDescription}.`);
  }

  // (Removed: byte-identical duplicates of shields 0.5D "DVT / PULMONARY
  // EMBOLISM SHIELD" and 0.5E "GANGRENE SHIELD" used to sit here, numbered
  // "5.6" and "5.7" — both dead for the same reason as the others above:
  // 0.5D/0.5E run earlier with identical regex and conditions.)

  // 6. HEART / CARDIAC / VASCULAR
  // NOTE: bare "stent" is intentionally excluded from the main alternation
  // below — a stent is used in the biliary tract, ureter, esophagus, etc.,
  // not just coronary arteries, and an unqualified \bstent\b here was
  // misrouting e.g. "biliary stent placement" to heart questions. It's
  // handled separately just below, gated on a nearby cardiac-context word
  // (see KIDNEY/RENAL rule 11 and DIGESTIVE rule 13 for where the
  // non-cardiac stent variants route instead).
  if (
    /\b(coronary|cad|ihd|ischemic heart|ischaemic heart|heart attack|myocardial|angina|atrial fibrillation|afib|arrhythmia|cardiomyopathy|tachycardia|bradycardia|heart failure|chf|congestive heart|bypass|cabg|angioplasty|ptca|valve disease|pacemaker|murmur|rheumatic heart|aortic aneurysm|peripheral vascular|pad|pvd|vascular disease|circulatory disorder|aortic stenosis|heart block|endocarditis|myocarditis)\b/i.test(text) ||
    (/\bstent\b/i.test(text) && /\b(coronary|cardiac|heart|artery|arteries)\b/i.test(text))
  ) {
    q = questionForCategory(config, "heart");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a cardiac or circulatory system condition.`);
  }

  // (Removed: a byte-identical duplicate of shield 0.5F "HYPOTENSION / LOW
  // BP SHIELD" used to sit here, numbered "6.5" — dead for the same reason
  // as the others above: 0.5F runs earlier with an identical, unconditional
  // regex match.)

  // 7. HYPERTENSION
  if (/\b(hyperten\w*|htn|high bp|high blood pressure|essential hypertension|bp high|elevated bp)\b/i.test(text)) {
    q = questionForCategory(config, "hypertension");
    if (q) {
      // Universal Manifestation Routing Policy: a named complication
      // (retinopathy, nephropathy, etc.) is diagnosis wording for a
      // specific organ disease first — if THIS plan has a dedicated
      // question whose wording covers that organ, it wins (Specificity
      // Override / Question Wording Is Law), same as any other organ
      // condition. Hypertension is only the fallback home for it when the
      // plan has no such dedicated question — never automatic just
      // because hypertension is the underlying cause.
      const HYPERTENSION_COMPLICATION_ORGANS: Record<string, { organCategoryKey: string; organLabel: string; organQuestionName: string }> = {
        "retinopathy": { organCategoryKey: "eye", organLabel: "an eye", organQuestionName: "eye disease" },
        "nephropathy": { organCategoryKey: "kidney", organLabel: "a kidney", organQuestionName: "kidney disease" },
        "encephalopathy": { organCategoryKey: "neuro", organLabel: "a brain/neurological", organQuestionName: "neurological" },
        "cardiomyopathy": { organCategoryKey: "heart", organLabel: "a cardiac", organQuestionName: "heart disease" },
        "heart disease": { organCategoryKey: "heart", organLabel: "a cardiac", organQuestionName: "heart disease" },
      };
      const complicationHit = Object.entries(HYPERTENSION_COMPLICATION_ORGANS).find(([term]) => text.includes(term));
      if (complicationHit) {
        const [, info] = complicationHit;
        const organQ = info.organCategoryKey === "eye"
          ? questionForCategory(config, "eye") || questionForCategory(config, "eyeEnt")
          : questionForCategory(config, info.organCategoryKey);
        if (organQ && organQ !== config.anyOther) {
          return makeOutput(pedText, "P1", organQ,
            `${pedText} is ${info.organLabel} complication of hypertension. This plan's ${info.organQuestionName} question explicitly covers it, so it is declared there rather than under Hypertension / High Blood Pressure.`);
        }
        return makeOutput(pedText, "P1", q,
          `${pedText} is ${info.organLabel} complication caused by hypertension. This plan has no dedicated ${info.organQuestionName} question, so it is declared under the Hypertension / High Blood Pressure question instead.`);
      }
      return makeOutput(pedText, "P1", q, `${pedText} is classified under Hypertension/High Blood Pressure.`);
    }
  }

  // 8a. SEVERE NEUROLOGICAL
  if (/\b(stroke|paralysis|epilepsy|seizure|seizures?|fits|multiple sclerosis|parkinson|parkinson's|brain haemorrhage|tia|transient ischemic attack|alzheimer|alzheimer's|dementia|motor neuron|mnd)\b/i.test(text)) {
    q = questionForCategory(config, "neuro");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a severe neurological condition.`);
  }

  // 8b. MILD / PERIPHERAL NEUROLOGICAL
  // Spine-qualified radiculopathy (cervical/lumbar/thoracic) is nerve-root
  // compression caused by disc/vertebral pathology — an orthopedic/spinal
  // condition, not a primary nerve disorder. The musculoskeletal regex
  // (section 18 below) explicitly lists "cervical radiculopathy" for this
  // reason, but bare "radiculopathy" here was matching first and returning
  // before section 18 ever ran. Skip this section for the spine-qualified
  // phrasing so it falls through to musculoskeletal; unqualified
  // "radiculopathy" still routes here.
  //
  // Sciatica is the same pattern: TOP_PED_DICTIONARY explicitly categorizes
  // it as "musculoskeletal" (lumbar nerve-root compression, usually from a
  // herniated disc — not a primary nerve disorder either), and that exact
  // term now also appears in section 18's regex. Only the bare exact term
  // reached the dictionary's correct categorization; any qualified phrasing
  // ("sciatica pain", "chronic sciatica", "lumbar sciatica") was matching
  // the bare "sciatica" alternative here first. Skip this section for any
  // sciatica phrasing so it falls through to musculoskeletal instead.
  const isSpineRadiculopathy = /\b(cervical|lumbar|thoracic|spinal)\s+radiculopathy\b/i.test(text);
  const isSciatica = /\bsciatica\b/i.test(text);
  if (!isSpineRadiculopathy && !isSciatica && /\b(migraine|carpal tunnel|radiculopathy|essential tremor|neuropathy|bell's palsy|trigeminal neuralgia|nerve pain)\b/i.test(text)) {
    let targetCategory = "psychiatric";
    const psychQ = questionForCategory(config, "psychiatric") || "";

    if (!psychQ.toLowerCase().includes("nervous")) {
      targetCategory = "neuro";
    }

    q = questionForCategory(config, targetCategory);
    if (q) {
      return makeOutput(
        pedText,
        "P1",
        q,
        `${pedText} is a mild or peripheral nerve condition routed to the general nervous system question to avoid high-severity stroke flags.`
      );
    }
  }

  // 9. PSYCHIATRIC / MENTAL HEALTH / SLEEP
  if (/\b(bipolar|depression|depressive disorder|anxiety|schizophrenia|ptsd|post.?traumatic stress|ocd|obsessive.?compulsive|insomnia|obstructive sleep apnea|sleep apnea|osa\b|sleep disorder|psychosis|mental illness|psychiatric condition|psychological disorder|adhd|autism|panic disorder|panic attack|anorexia|bulimia|eating disorder)\b/i.test(text)) {
    q = questionForCategory(config, "psychiatric") || findQuestion(config, /mental|psychiatric|sleep/i);
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a psychiatric, mental health, or sleep disorder condition.`);
  }

  // 9.5 EXTRAPULMONARY TB SHIELD
  if (/\b(spine tb|bone tb|skeletal tb|pott'?s disease|spinal tuberculosis)\b/i.test(text)) {
    q = questionForCategory(config, "musculoskeletal");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a form of extrapulmonary tuberculosis affecting the bones/spine.`);
  }
  if (/\b(brain tb|meningeal tb|tb meningitis|neurological tb)\b/i.test(text)) {
    q = questionForCategory(config, "neuro") || findQuestion(config, /stroke|paralysis|epilepsy|fits/i);
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a form of extrapulmonary tuberculosis affecting the nervous system/brain.`);
  }
  if (/\b(intestinal tb|abdominal tb|gastrointestinal tb)\b/i.test(text)) {
    q = questionForCategory(config, "digestive");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a form of extrapulmonary tuberculosis affecting the digestive tract.`);
  }
  if (/\b(renal tb|kidney tb|urinary tb|genitourinary tb)\b/i.test(text)) {
    q = questionForCategory(config, "kidney");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a form of extrapulmonary tuberculosis affecting the kidneys/urinary tract.`);
  }
  if (/\b(lymph node tb|lymph gland tb|tb lymphadenitis)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther, `${pedText} is a form of extrapulmonary tuberculosis affecting the lymph nodes. It should be declared under the 'Others Section' to trigger general Umbrella questions.`);
  }

  // 10. RESPIRATORY / PULMONARY
  if (/\b(asthma|copd|chronic obstructive|bronchitis|emphysema|tuberculosis|tb|ipf|pulmonary fibrosis|ild|lung disease|lung infection|pneumonia|sarcoidosis of lung|pleural effusion|cystic fibrosis|bronchiectasis|pneumothorax|respiratory failure)\b/i.test(text)) {
    q = questionForCategory(config, "respiratory");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a respiratory or pulmonary condition.`);
  }

  // 11. KIDNEY / RENAL
  if (/\b(chronic kidney disease|ckd|aki|esrd|end.?stage renal|kidney stone|renal calculus|renal calculi|nephrolithiasis|ureteric stone|bladder stone|renal failure|kidney transplant|renal transplant|dialysis|nephritis|pyelonephritis|nephrotic syndrome|nephro|urinary tract infection|uti|cystitis|urinary incontinence|urinary obstruction|puj obstruction|pelviureteric|ureteric stent|ureteral stent|urethral stent|dj stent|double.?j stent)\b/i.test(text)) {
    q = questionForCategory(config, "kidney");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a kidney, renal, or urinary tract condition.`);
  }

  // 12. REPRODUCTIVE
  if (/\b(prostate disease|prostatitis|bph|benign prostatic hyperplasia|prostatomegaly|ectopic pregnancy|endometriosis|adenomyosis|infertility|ivf|pcos|pmos|p-?cos|pcod|p-?cod|polycystic|ovarian cyst|ovarian disorder|uterine disorder|menstrual disorder|cervical disorder|vaginal disorder|pid|testicular disorder|varicocele|hydrocele|phimosis|epididymitis|erectile dysfunction|reproductive disorder|fibroid|fibroadenoma|myoma|fibromyoma|breast lump|breast cyst|breast lesion|fibrocystic)\b/i.test(text)) {
    q = questionForCategory(config, "reproductive") || questionForCategory(config, "kidney");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a reproductive organ or hormonal disorder.`);
  }

  // 13. DIGESTIVE
  if (/\b(gerd|acid reflux|gastroesophageal|gord|irritable bowel|ibs|ibd|achalasia|peptic ulcer|gastric ulcer|stomach ulcer|gastritis|gastric issue|stomach disease|intestinal disorder|bowel obstruction|duodenal ulcer|crohn|colitis|ulcerative colitis|piles|ha?emorrhoid\w*|anal fissure|anal fistula|appendicitis|appendix|diverticulitis|diverticular disease|celiac|coeliac|pancreatitis|pancreatic disease|gall bladder disease|gallbladder disease|gall.?stone|cholelithiasis|cholecystitis|biliary stent|biliary stone|bile duct stent|cbd stent|common bile duct stent|esophageal stent|oesophageal stent|pancreatic duct stent|hernia|inguinal hernia|hiatal hernia|hiatus hernia|umbilical hernia|colon polyp|rectal polyp|gastric polyp|stomach polyp|intestinal polyp)\b/i.test(text)) {
    if (planName === "Activ Fit Preferred" && /\bulcer\b/i.test(text)) {
      const qNeoplasm = questionForCategory(config, "neoplasm");
      return makeOutput(pedText, "P0", qNeoplasm, `Exact condition match🎯: "${pedText}" is explicitly listed in this plan's tumor/ulcer questionnaire.`);
    }
    q = questionForCategory(config, "digestive");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a digestive or gastrointestinal condition.`);
  }

  // 14. LIVER / HEPATIC
  if (/\b(liver disease|liver disorder|liver infection|liver abscess|jaundice|cirrhosis|hepatomegaly|fatty liver|hepatic steatosis|alcoholic liver|nash|nafld|hepatitis|portal hypertension|ascites|liver failure|liver transplant|wilson.?disease)\b/i.test(text)) {
    q = questionForCategory(config, "liver") || questionForCategory(config, "digestive") || findQuestion(config, /liver|jaundice/i);
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a chronic liver or hepatic condition.`);
  }

  // 15. ENDOCRINE
  if (/\b(thyroid|hyperthyroid|hypothyroid|thyrotoxicosis|goitr?e?|goite?r|graves|hashimoto|endocrine|pituitary|adrenal|cushing|addison|parathyroid|prolactinoma|hormonal imbalance)\b/i.test(text)) {
    q = questionForCategory(config, "endocrine");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is an endocrine or hormonal system disorder.`);
  }

  // 16a. BLOOD DISORDERS
  if (/\b(thalassemia|thalassaemia|haemophilia|hemophilia|anaemia|anemia|polycythemia|hemochromatosis|neutropenia|hypereosinophilic syndrome|blood disorder|bleeding disorder|clotting disorder|thrombocytopenia|purpura|sickle cell|von willebrand|bone marrow failure|aplastic anaemia)\b/i.test(text)) {
    q = questionForCategory(config, "blood");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a blood disorder condition.`);
  }

  // 16b. GENETIC & CONGENITAL & INBORN METABOLIC DISORDERS
  if (
    /\b(down syndrome|chromosomal abnormality|cystic fibrosis|turner syndrome|klinefelter|marfan|noonan|prader-willi|edwards syndrome|patau syndrome|rett syndrome|neurofibromatosis|huntington|albinism|gaucher|pompe|tay-sachs|neimann-pick)\b/i.test(text) ||
    /\b(congenital|hereditary|familial|inherited|autosomal|recessive|dominant|chromosomal|trisomy|inborn error|metabolic disorder|genetic disease|genetic disorder|birth defect)\b/i.test(text) ||
    /\b(cleft lip|cleft palate|congenital heart|atrial septal defect|ventricular septal defect|tetralogy of fallot|spina bifida|clubfoot|anencephaly|microcephaly|hydrocephalus)\b/i.test(text) ||
    /\b(rpi deficiency|ribose-5-phosphate|g6pd deficiency|glucose-6-phosphate dehydrogenase|pyruvate kinase deficiency|alpha-1 antitrypsin deficiency|enzyme deficiency|pompe disease|gaucher disease|tay-sachs|neimann-pick|maple syrup urine|phenylketonuria|pku|homocystinuria|galactosemia|glycogen storage disease|mucopolysaccharidosis)\b/i.test(text)
  ) {
    if (/\b(g6pd|glucose-6-phosphate dehydrogenase|pyruvate kinase|thalassemia|thalassaemia|haemophilia|hemophilia|sickle cell|von willebrand)\b/i.test(text)) {
      q = questionForCategory(config, "blood");
      if (q) {
        let explanationDetail = `👉 ${pedText} is an inherited metabolic blood disorder and maps to this plan's primary blood/genetic disorder question.`;
        if (/\b(g6pd|glucose-6-phosphate dehydrogenase)\b/i.test(text)) {
          explanationDetail = `👉 Glucose-6-phosphate dehydrogenase (G6PD) deficiency is an inherited metabolic blood disorder structure and maps to this plan's primary blood/genetic question.`;
        }
        return makeOutput(pedText, "P1", q, explanationDetail);
      }
    }
    
    q = questionForCategory(config, "genetic");
    if (q) {
      if (q === config.anyOther) {
        return makeOutput(pedText, "FALLBACK", q, `*${pedText} is a congenital, genetic, or inborn metabolic disorder.* This plan has no dedicated category question for it. Proceed with the 'Others' section.`);
      }
      let explanationDetail = `👉 ${pedText} is classified as a congenital, genetic, or inborn metabolic disorder under this plan.`;
      if (/\b(rpi|ribose-5-phosphate)\b/i.test(text)) {
        explanationDetail = `👉 Ribose-5-phosphate isomerase (RPI) deficiency is a rare autosomal recessive metabolic disorder, which classifies it as a genetic disorder under this plan.`;
      }
      return makeOutput(pedText, "P1", q, explanationDetail);
    }
  }

  // 16c. FIBRODYSPLASIA OSSIFICANS PROGRESSIVA & PROGRESSIVE PHYSICAL DEFORMITY
  if (/\b(fibrodysplasia|fop|progressive ossification|heterotopic ossification|progressive osseous heteroplasia)\b/i.test(text)) {
    const targetQ = findQuestion(config, /disability|deformity/i) || findQuestion(config, /congenital/i) || questionForCategory(config, "genetic") || questionForCategory(config, "musculoskeletal");
    if (targetQ) {
      return makeOutput(
        pedText,
        "P1",
        targetQ,
        `👉 Fibrodysplasia Ossificans Progressiva (FOP) is a rare genetic disorder characterized by the progressive transformation of muscle and connective tissue into bone (heterotopic ossification), leading to severe physical deformity and disability.`
      );
    }
  }

  // 17. AUTOIMMUNE
  // 17a. Joint & Spine-focused Autoimmune
  if (/\b(rheumatoid arthritis|ankylosing|ankylosing spondylitis)\b/i.test(text)) {
    const qIm = questionForCategory(config, "autoimmune") || questionForCategory(config, "musculoskeletal");
    if (qIm) return makeOutput(pedText, "P1", qIm, `${pedText} is an autoimmune joint/spine disorder.`);
  }

  // 17b. Systemic Autoimmune & Connective Tissue
  if (/\b(lupus|sle|scleroderma|sjogren|sjogren's|vasculitis|autoimmune)\b/i.test(text)) {
    let qIm = questionForCategory(config, "autoimmune");
    if (!qIm) {
      qIm = config.anyOther;
      if (qIm) {
        return makeOutput(
          pedText,
          "P1",
          qIm,
          `${pedText} is a systemic autoimmune condition. Since this plan lacks a specific immunity question, it is safely routed to 'Any other disease/condition'.`
        );
      }
    }
    if (qIm) {
      return makeOutput(pedText, "P1", qIm, `${pedText} is a systemic autoimmune or immunity disorder.`);
    }
  }

  // 17.5 SARCOIDOSOS — PLAN-AWARE ROUTING
  if (/\bsarcoidosis\b/i.test(text)) {
    const autoQ = questionForCategory(config, "autoimmune");
    if (autoQ && /sarcoidosis/i.test(autoQ)) {
      return makeOutput(pedText, "P1", autoQ,
        `${pedText} is explicitly named in this plan's immunity/blood disorder question and maps there directly.`);
    }
    q = questionForCategory(config, "respiratory");
    if (q) return makeOutput(pedText, "P1", q,
      `${pedText} is a systemic granulomatous disease with predominant pulmonary manifestation. It maps to the respiratory/lung disease category in this plan.`);
    return makeOutput(pedText, "FALLBACK", config.anyOther,
      `${pedText} is a systemic granulomatous disease with no direct category match in this plan. Declare under the 'Others' section.`);
  }

  // 18. MUSCULOSKELETAL
  if (/\b(osteoarthritis|osteoarthrosis|arthritis|spondylitis|spondylosis|cervical spondylosis|lumbar spondylosis|slipped disc|disc bulge|fractur(e|es|ed)|joint replacement|acl|pcl|mcl|lcl|meniscus|rotator cuff|ligaments?|ligament tear|cartilage damage|sprain|strain|dislocation|orthopedic|orthopaedic|spinal disorder|disc prolapse|disc herniation|cervical radiculopathy|sciatica|avascular necrosis|fibromyalgia|plantar fasciitis|torn meniscus|frozen shoulder|tennis elbow|gout|scoliosis|kyphosis|polio|osteoporosis|osteopenia|osteomyelitis|bone disease)\b/i.test(text)) {
    q = questionForCategory(config, "musculoskeletal");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a musculoskeletal or orthopedic condition.`);
  }

  // 19. SKIN
  // "lipoma" and "papilloma" were listed here too, ahead of the generic
  // benign-growth regex (section 22A below) — a lipoma is a fatty tumour and
  // a papilloma is a wart-like growth, both explicitly categorized
  // "benign_growth" in TOP_PED_DICTIONARY, not primary dermatological
  // disease. Since this section runs first, any non-exact phrasing of
  // either term ("lipoma on back", "multiple lipomas") was always routed to
  // the plain Skin question instead of the neoplasm/benign-growth question
  // the dictionary assigns to the exact term. Removed here so both terms
  // fall through to section 22A, which already lists them.
  if (/\b(psoriasis|eczema|dermatitis|skin|fungal infection|cellulitis|boils|abscess|melasma|rosacea|herpes zoster|shingles|scabies|vitiligo|pilonidal|urticaria|alopecia|sebaceous cyst|corn|keloid|ringworm|wart|hives|rash|skin tag)\b/i.test(text)) {
    if (/\bpsoriasis\b/i.test(text)) {
      const qSkin = questionForCategory(config, "autoimmune") || questionForCategory(config, "skin");
      if (qSkin) return makeOutput(pedText, "P1", qSkin, `${pedText} is a skin condition with autoimmune classification.`);
    }
    q = questionForCategory(config, "skin");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a dermatological condition and falls under this plan's Skin category question.`);
  }

  // 20. EYE
  if (/\b(cataract|glaucoma|retinopathy|macular degeneration|myopia|hypermetropia|astigmatism|lasik|presbyopia|dry eye|conjunctivitis|pterygium|chalazion|stye|retinal detachment|strabismus|squint|keratoconus|optic nerve|eye disease|eye disorder|vision disorder)\b/i.test(text)) {
    q = questionForCategory(config, "eye") || questionForCategory(config, "eyeEnt");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is an eye or ocular condition.`);
  }

  // 21. ENT
  if (/\b(meniere|vertigo|tinnitus|ear disease|ear disorder|tympanic membrane|ear drum|sinusitis|dns|deviated septum|deviated nasal septum|allergic rhinitis|tonsillitis|adenoid\w*|rhinitis|laryngitis|pharyngitis|nasal polyp|vocal cord|hearing loss|otitis|throat disorder|nose disorder)\b/i.test(text)) {
    q = questionForCategory(config, "eyeEnt");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is an ear, nose, or throat condition.`);
  }

  // 22. GENERIC SHIELDS
  // 22A. GENERIC BENIGN GROWTHS
  if (/\b(tumou?r|neoplasm|polyp|cyst|lump|growth|lipoma|adenoma|benign|papilloma)\b/i.test(text)) {
    if (config.overrides && config.overrides.bypassBenignTumors) {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a benign condition.* This plan's primary question strictly targets malignant cancers. Benign growths map to the 'Others' section.`);
    }
    q = questionForCategory(config, "neoplasm");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a generic tumour, cyst, polyp, or growth explicitly covered under this plan's primary question.`);
  }

  // 22B. GENERIC ALLERGY SHIELD
  if (/\b(food allergy|dust allergy|drug allergy|allergic to|allergy to|penicillin allergy|peanut allergy|latex allergy|pollen allergy|hay fever|allergy|allergic)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther, `*Allergies are hypersensitivity responses, not immune system disorders or respiratory diseases.*\n\nIf the allergy has led to a diagnosed condition, declare that condition in its relevant section (e.g., Dust allergy → Allergic Asthma).`);
  }

  // 22C. GYNECOMASTIA
  if (/\b(gynae?comastia|gynocomastia|gyneacomastia)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a condition of breast tissue enlargement in males. It's not an endocrine or thyroid disorder by itself.*\n\nIf the gynaecomastia is a diagnosed result of a hormonal disorder, declare the underlying disorder under Endocrine/Thyroid.`);
  }

  // 22D. AMBIGUOUS SYMPTOMS SHIELD
  if (/\b(chest pain|obesity|morbid obesity|overweight|body pain|weakness|dizziness|fatigue|back pain|lumbago|nausea|vomiting|acidity|heartburn|dysmenorrhea|amenorrhea|menorrhagia|palpitation(s)?|epistaxis|nosebleed|dyspepsia|indigestion|fever|chills|malaise|swelling|loss of appetite|wheezing|shortness of breath|sob|breathlessness|dyspnea)\b/i.test(text)) {
    return makeOutput(
      pedText,
      "FALLBACK",
      config.anyOther,
      `*${pedText} is a clinical symptom or general finding, not a definitive medical diagnosis.*\n\nBecause this can result from minor, acute, or transient issues, it does not automatically map to a disease category. If an underlying condition has been diagnosed, please declare that specific diagnosis. Otherwise, proceed with the 'Others' section.`
    );
  }

  // 22E. LAB FINDINGS
  if (/\b(sgpt|sgot|hba1c|alt\b|ast\b|liver enzyme(s)?|bilirubin|tsh|t3|t4|proteinuria|microalbuminuria|albuminuria|hematuria|creatinine|uric acid|esr|crp)\b/i.test(text)) {
    return makeOutput(
      pedText,
      "FALLBACK",
      config.anyOther,
      `*${pedText} is a laboratory test parameter or clinical finding, not a definitive medical diagnosis.*\n\nAbnormal lab results can fluctuate due to transient issues, minor infections, or medications. If this specific finding led to a formal structural diagnosis (e.g., High TSH resulting in a diagnosis of Hypothyroidism), please declare that specific diagnosis. Otherwise, proceed with the *'medical tests and investigations section'* section.`
    );
  }

  // 23. DIAGNOSTICS
  if (/\b(scan|ct scan|pet scan|dexa scan|mammogram|pap smear|x-?ray|mri|magnetic resonance|ultrasound|usg|biopsy|angiography|trt|tmt|treadmill|stress test|ecg|echo|echocardiogram|holter|eeg|emg|endoscopy|colonoscopy|bronchoscopy|cystoscopy|sigmoidoscopy|annual health checkup|full body checkup|blood test|lab test|kft|lft|lipid profile|cbg|pft|spirometry|investigation|diagnostic)\b/i.test(text)) {
    let explanation = `"${pedText}" is a diagnostic or investigative test. Please declare this under the *medical tests and investigations* section.`;
    if (/\b(angiography|trt|tmt|treadmill|stress test|ecg|echo|echocardiogram|mri|magnetic resonance|endoscopy|colonoscopy|usg|ultrasound)\b/i.test(text)) {
      explanation = `"${pedText}" is a specialized investigative test. *It is mandatory to specify the exact test name* under the *tests and investigations* section.`;
    }
    return makeOutput(pedText, "FALLBACK", config.anyOther, explanation);
  }

  // 24. ISOLATED PROCEDURES & ACUTE TRAUMA
  //
  // Was a single giant regex lumping surgical procedures (surgery,
  // amputation, any *-ectomy) in with pure acute injuries (cuts, burns,
  // bites) under one generic message. That's wrong for two reasons a real
  // procedure name (e.g. "Appendectomy") deserves better than an injury: a
  // surgical procedure has a specific umbrella question it maps to (see
  // detectSupportingFlags/getApplicableUmbrellaQuestions above, which now
  // also recognizes procedure-suffix words), and it was very likely
  // performed FOR a diagnosed condition (e.g. Appendicitis) that itself may
  // map to a specific plan question — worth checking separately from the
  // procedure itself. Common named procedures with an unambiguous single
  // underlying diagnosis (appendectomy, cholecystectomy, tonsillectomy,
  // hysterectomy, thyroidectomy, cataract surgery, knee/hip replacement,
  // etc.) are now caught earlier via TOP_PED_DICTIONARY and never reach this
  // rule at all — this is the catch-all for procedures/surgeries that
  // aren't in that dictionary (generic "surgery", "operation", less common
  // named procedures) and for genuine acute injuries/trauma, which still
  // need two different messages.
  if (/\b(surger(y|ies)|surgical|operation|amputation|\w*ectomy|\w*ostomy|\w*otomy|\w*plasty|\w*pexy|replacement|transplant|angioplasty)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther,
      `*"${pedText}" is a surgical procedure*, not a specific illness category by itself. Declare it under this plan's hospitalisation/surgery umbrella question.\n\nAlso identify the underlying diagnosed condition this procedure was performed for (e.g. the illness or injury it treated) and check separately whether *that* diagnosis maps to one of this plan's specific medical questions — the procedure itself is usually secondary to the diagnosis driving it.`);
  }
  if (/\b(heat stroke|sun stroke|stitch(es)?|suture(s)?|wound(s|\s*cleaning)?|cut(s)?|burn(s)?|laceration(s)?|abrasion(s)?|bruise(s)?|contusion(s)?|bite(s)?|sting(s)?|cast|plaster|splint|sling|bandaged?|procedure|treatment|hospitali[sz]ation|hospitali[sz]ed|admitted|admission|accident|trauma|injur(y|ies)|first aid|er visit|emergency room|injection|iv(\s*drip)?|physiotherapy)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther, `"${pedText}" indicates an acute injury or physical trauma rather than a specific illness category. Declare it under this plan's hospitalisation/surgery umbrella question if applicable, otherwise under the 'Others Section'.`);
  }

  return null;
}

export function getSmokeTestCases(selectedPlans?: string[]): { plan: string; ped: string }[] {
  const customPeds = [
    // 1. AMBIGUOUS SYMPTOMS & LIFESTYLE
    "chest pain", "body pain", "weakness", "fever", "heavy bleeding", "palpitations", "shortness of breath",
    "loss of appetite", "dizziness", "fatigue", "nausea", "vomiting", "chills", "malaise", "swelling",
    "smoking", "alcholic", "tobacco chewing", "drinking", "obesity", "headache",

    // 2. SPECIFIC TB VS GENERIC TB
    "spine tb", "bone tb", "skeletal tb", "pott's disease", "spinal tuberculosis",
    "brain tb", "meningeal tb", "tb meningitis", "neurological tb",
    "intestinal tb", "abdominal tb", "gastrointestinal tb",
    "renal tb", "kidney tb", "urinary tb", "genitourinary tb",
    "lymph node tb", "lymph gland tb", "tb lymphadenitis",
    "tuberculosis", "pulmonary tuberculosis", "lung tb",

    // 3. CYST/POLYP SHADOWING
    "ovarian cyst", "sebaceous cyst", "breast cyst", "kidney cyst", "liver cyst",
    "gastric polyp", "stomach polyp", "colon polyp", "rectal polyp", "vocal cord polyp",
    "nasal polyp", "endometrial polyp", "cervical polyp",

    // 4. BENIGN VS MALIGNANT
    "carcinoma", "melanoma", "sarcoma", "lymphoma", "leukemia", "leukaemia",
    "malignancy", "metastasis", "oncology", "adenocarcinoma", "squamous cell carcinoma",
    "lipoma", "adenoma", "papilloma", "fibroid", "fibroadenoma", "myoma", "fibromyoma",
    "hemangioma", "leiomyoma", "meningioma", "neuroma", "schwannoma",

    // 5. P0 EXACT MATCH & ABBREVIATION DICTIONARY
    "htn", "diabeties", "cabg", "pcos", "sugar", "bp high", "ptca", "lscs", "t2dm",
    "hyper cholesterol", "pre diabeties", "esrd", "ckd", "cva", "tia", "bph", "gerd",
    "tkr", "thr", "ms", "hba1c 6.5", "tmt positive", "h pylori", "dm",

    // 6. AUTOIMMUNE & SYSTEMIC
    "rheumatoid arthritis", "sle", "lupus", "scleroderma", "sjogren syndrome",
    "ankylosing spondylitis", "vasculitis", "psoriatic arthritis", "myasthenia gravis",
    "sarcoidosis", "raynaud's phenomenon", "pilonidal sinus", "varicose veins",

    // 7. NATURAL LIFE STAGES & PROCEDURES
    "c-section", "routine master health checkup", "pregnant", "lactating mother",
    "post-menopausal", "n/a", "nil", "healthy", "vaccination", "immunization",
    "dog bite", "cat scratch", "food allergy", "gynecomastia", "appendectomy",
    "cholecystectomy", "hysterectomy", "tonsillectomy", "tympanoplasty",
    "stitches on forehead", "laceration on leg", "burns", "cast on arm", "splint",

    // 8. NEUROLOGICAL & PSYCHIATRIC
    "alzheimer", "dementia", "parkinson", "epilepsy", "fits", "seizures", "migraine",
    "depression", "anxiety", "ocd", "adhd", "autism", "bipolar disorder",
    "schizophrenia", "ptsd", "panic attack", "bulimia", "anorexia", "insomnia",
    "obstructive sleep apnea", "head injury", "brain haemorrhage", "cerebral palsy",

    // 9. RARE & COMPLEX
    "guillain barre syndrome", "huntington's", "avascular necrosis", "crohn's disease",
    "ulcerative colitis", "puj obstruction", "thalassemia", "hemochromatosis",
    "sickle cell anemia", "von willebrand disease", "bone marrow failure",
    "hirayama disease", "trigeminal neuralgia", "carpal tunnel", "plantar fasciitis",

    // 10. TYPO & OCR ADVERSARIAL
    "hipertension", "hypetension", "diabtes", "dialisis", "cholecystitis",
    "apendicitis", "gullian barre", "hemorrhoids", "fistula", "fissure",
    "psorasis", "eczem", "vitiligo", "alopeci", "thyriod", "hypothyrodism",
    "endometriosis", "infertillity", "prostatitis", "varicocele", "hydrocele"
  ];

  // Merge with TOP_PED_DICTIONARY keys dynamically and deduplicate
  const dictKeys = Object.keys(TOP_PED_DICTIONARY || {});
  const deduplicatedPeds = Array.from(new Set([
    ...customPeds.map(p => p.toLowerCase().trim()),
    ...dictKeys.map(k => k.toLowerCase().trim())
  ])).filter(Boolean);

  const plans = selectedPlans && selectedPlans.length > 0 
    ? selectedPlans 
    : ["Optima Secure", "Care Supreme", "Activ One Max", "Activ Fit Preferred"];
  const cases: { plan: string; ped: string }[] = [];

  plans.forEach(plan => {
    deduplicatedPeds.forEach(ped => {
      cases.push({ plan, ped });
    });
  });

  return cases;
}

export function getUniquePedsCount(): number {
  const customPeds = [
    "chest pain", "body pain", "weakness", "fever", "heavy bleeding", "palpitations", "shortness of breath",
    "loss of appetite", "dizziness", "fatigue", "nausea", "vomiting", "chills", "malaise", "swelling",
    "smoking", "alcholic", "tobacco chewing", "drinking", "obesity", "headache",
    "spine tb", "bone tb", "skeletal tb", "pott's disease", "spinal tuberculosis",
    "brain tb", "meningeal tb", "tb meningitis", "neurological tb",
    "intestinal tb", "abdominal tb", "gastrointestinal tb",
    "renal tb", "kidney tb", "urinary tb", "genitourinary tb",
    "lymph node tb", "lymph gland tb", "tb lymphadenitis",
    "tuberculosis", "pulmonary tuberculosis", "lung tb",
    "ovarian cyst", "sebaceous cyst", "breast cyst", "kidney cyst", "liver cyst",
    "gastric polyp", "stomach polyp", "colon polyp", "rectal polyp", "vocal cord polyp",
    "nasal polyp", "endometrial polyp", "cervical polyp",
    "carcinoma", "melanoma", "sarcoma", "lymphoma", "leukemia", "leukaemia",
    "malignancy", "metastasis", "oncology", "adenocarcinoma", "squamous cell carcinoma",
    "lipoma", "adenoma", "papilloma", "fibroid", "fibroadenoma", "myoma", "fibromyoma",
    "hemangioma", "leiomyoma", "meningioma", "neuroma", "schwannoma",
    "htn", "diabeties", "cabg", "pcos", "sugar", "bp high", "ptca", "lscs", "t2dm",
    "hyper cholesterol", "pre diabeties", "esrd", "ckd", "cva", "tia", "bph", "gerd",
    "tkr", "thr", "ms", "hba1c 6.5", "tmt positive", "h pylori", "dm",
    "rheumatoid arthritis", "sle", "lupus", "scleroderma", "sjogren syndrome",
    "ankylosing spondylitis", "vasculitis", "psoriatic arthritis", "myasthenia gravis",
    "sarcoidosis", "raynaud's phenomenon", "pilonidal sinus", "varicose veins",
    "c-section", "routine master health checkup", "pregnant", "lactating mother",
    "post-menopausal", "n/a", "nil", "healthy", "vaccination", "immunization",
    "dog bite", "cat scratch", "food allergy", "gynecomastia", "appendectomy",
    "cholecystectomy", "hysterectomy", "tonsillectomy", "tympanoplasty",
    "stitches on forehead", "laceration on leg", "burns", "cast on arm", "splint",
    "alzheimer", "dementia", "parkinson", "epilepsy", "fits", "seizures", "migraine",
    "depression", "anxiety", "ocd", "adhd", "autism", "bipolar disorder",
    "schizophrenia", "ptsd", "panic attack", "bulimia", "anorexia", "insomnia",
    "obstructive sleep apnea", "head injury", "brain haemorrhage", "cerebral palsy",
    "guillain barre syndrome", "huntington's", "avascular necrosis", "crohn's disease",
    "ulcerative colitis", "puj obstruction", "thalassemia", "hemochromatosis",
    "sickle cell anemia", "von willebrand disease", "bone marrow failure",
    "hirayama disease", "trigeminal neuralgia", "carpal tunnel", "plantar fasciitis",
    "hipertension", "hypetension", "diabtes", "dialisis", "cholecystitis",
    "apendicitis", "gullian barre", "hemorrhoids", "fistula", "fissure",
    "psorasis", "eczem", "vitiligo", "alopeci", "thyriod", "hypothyrodism",
    "endometriosis", "infertillity", "prostatitis", "varicocele", "hydrocele"
  ];
  const dictKeys = Object.keys(TOP_PED_DICTIONARY || {});
  return Array.from(new Set([
    ...customPeds.map(p => p.toLowerCase().trim()),
    ...dictKeys.map(k => k.toLowerCase().trim())
  ])).filter(Boolean).length;
}
