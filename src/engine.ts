/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TOP_PED_DICTIONARY,
  PED_BRIEFS,
  PlanConfig,
  MatchOutput,
  SupportingFlags
} from "./types.js";

export function normalizeText(text: string): string {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectSupportingFlags(ped: string): SupportingFlags {
  const text = normalizeText(ped);
  return {
    tests: /test|investigation|scan|biopsy|lab|xray/i.test(text),
    medication: /medication|medicine|tablet|insulin|drug|treatment/i.test(text),
    hospitalisation: /hospitali[sz]ation|admitted|admission|surgery|operation/i.test(text)
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

export function findQuestion(config: PlanConfig, pattern: RegExp): string {
  return config.questions.find(q => pattern.test(normalizeText(q))) || "";
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

  // 2. Optimized regex (Includes menstruation and periods)
  const nonAilmentRegex = /\b(menstruat(e|ion|ing)|my period(s)?|regular period(s)?|menopaus(e|al)|peri-?menopaus(e|al)|post-?menopaus(e|al)|puberty|healthy|none|normal|fit|perfect|nil|n\/?a|not\s*applicable|routine\s*checkup|general\s*checkup|master\s*health|executive\s*checkup|vaccin(ation|e|ed)|immuniz(ation|ed)|pregnan(cy|t)|childbirth|post-?partum|post-?natal|lactat(ion|ing)|breastfeed(ing)?)\b/i;

  if (nonAilmentRegex.test(text)) {
    let shortExplanation = "a natural physiological state or routine event";

    if (/menopaus|puberty|lactat|breastfeed/i.test(text)) {
      shortExplanation = "a natural biological life stage or physiological transition";
    } else if (/healthy|none|normal|fit|perfect|nil|n\/?a|applicable/i.test(text)) {
      shortExplanation = "an explicit declaration of normal health status or empty field placeholder";
    } else if (/checkup|vaccin|immuniz/i.test(text)) {
      shortExplanation = "a routine preventative wellness check or standard immunization event";
    } else if (/pregnan|childbirth|post-?partum|post-?natal/i.test(text)) {
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
  rawExp = rawExp.replace(/\bOthers\b/g, "Others Section");
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
  }
  output.explanation = `${rawExp.trim()}\n\n${explanationSuffix}`;

  return output;
}

export function classifyDeterministic(ped: string, planName: string, config: PlanConfig): MatchOutput | null {
  const text = normalizeText(ped);
  const pedText = String(ped || "").trim();
  let q = "";

  // 0. NATURAL LIFE STAGE FIREWALL
  const lifeStageCheck = checkNaturalLifeStages(pedText);
  if (lifeStageCheck) return lifeStageCheck;

  // 0.4 PLAN-SPECIFIC OVERRIDES & INTERCEPTS
  if (planName === "Activ Fit Preferred") {
    // 1. Sleep Apnea / OSA override to congenital/genetic question in AFP
    if (/\b(obstructive sleep apnea|sleep apnea|osa)\b/i.test(text)) {
      const qGenetic = questionForCategory(config, "genetic");
      if (qGenetic) {
        return makeOutput(
          pedText,
          "P1",
          qGenetic,
          `👉 *${pedText}* maps to the congenital/genetic/disability question in this plan (which explicitly names Obstructive Sleep Apnea).`
        );
      }
    }

    // 2. DVT, PE, and varicose veins override of the general vascular/venous condition shield to heart (peripheral vascular disease) question in AFP
    if (/\b(deep vein thrombosis|dvt|pulmonary embolism|pulmonary thromboembolism|venous thromboembolism|vte|varicose veins?|lymphedema|raynaud disease|raynaud phenomenon)\b/i.test(text)) {
      const qHeart = questionForCategory(config, "heart");
      if (qHeart) {
        return makeOutput(
          pedText,
          "P1",
          qHeart,
          `👉 *${pedText}* maps to the heart/peripheral vascular disease question in this plan (which explicitly lists peripheral vascular disease).`
        );
      }
    }
  }

  if (planName === "Care Supreme") {
    // Crohn's, Ulcerative Colitis, and IBD override to Blood and / or Immunity question in Care Supreme
    if (/\b(crohn|colitis|ulcerative colitis|ibd)\b/i.test(text)) {
      const qBlood = questionForCategory(config, "blood");
      if (qBlood) {
        return makeOutput(
          pedText,
          "P1",
          qBlood,
          `👉 *${pedText}* maps to the Blood and / or Immunity question in this plan (which explicitly names Crohn's disease and Ulcerative Colitis).`
        );
      }
    }
  }

  if (planName === "Optima Secure") {
    // Autoimmune joint diseases override to Musculoskeletal question in Optima Secure
    if (/\b(rheumatoid arthritis|ra\b|ankylosing spondylitis|psoriatic arthritis|reactive arthritis|reiter syndrome)\b/i.test(text)) {
      const qMusculo = questionForCategory(config, "musculoskeletal");
      if (qMusculo) {
        return makeOutput(
          pedText,
          "P1",
          qMusculo,
          `👉 *${pedText}* maps to the musculoskeletal/arthritis question in this plan.`
        );
      }
    }
  }

  // 0.5 FAST-PATH SAFETY FIREWALLS & SHIELDS (INTERCEPT BOTH DICTIONARY & REGEX FLOWS)
  
  // A. GLOBAL DIAGNOSTICS & TEST FIREWALL
  if (!(/\b(stress test|treadmill test|tmt|tolerance test)\b/i.test(text)) &&
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
    if (/\b(diabet\w*|insulin|dm\b|t1d|t2d|hba1c)\b/i.test(text)) {
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
    if (isGestationalOrType2 && !hasInsulinOrType1) {
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

  // 0.7 O(1) DICTIONARY ROUTING
  const cleanInput = text.replace(/[^\w\s]/g, "").trim();
  const cleanInputLower = cleanInput.toLowerCase();
  let categoryKey = TOP_PED_DICTIONARY[cleanInputLower];
  if (!categoryKey) {
    const matchedKey = Object.keys(TOP_PED_DICTIONARY).find(k => k.toLowerCase() === cleanInputLower);
    if (matchedKey) {
      categoryKey = TOP_PED_DICTIONARY[matchedKey];
    }
  }

  // Override: benign CNS tumors → benign_growth (not neoplasm)
  if (/\b(meningioma|acoustic\s*neuroma|craniopharyngioma|benign\s*brain\s*tu?mou?r)\b/i.test(text)) {
    categoryKey = "benign_growth";
  }
  if (categoryKey) {

    // Handle special dictionary cases (Firewalls & Ambiguous Symptoms)
    if (categoryKey === "vascular_fallback") {
      return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a vascular/venous condition.* It does not map to the severe cardiovascular/heart disease questions and should be declared under the 'Others' section.`);
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
      return makeOutput(pedText, "FALLBACK", config.anyOther, `"${pedText}" indicates an acute injury, physical treatment, or medical procedure rather than a specific illness category.`);
    }
    if (categoryKey === "benign_growth") {
      if (config.overrides && config.overrides.bypassBenignTumors) {
        return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} is a benign condition.* This plan's primary question strictly targets malignant cancers. Benign growths map to the 'Others' section.`);
      }
      const neoplasmQ = questionForCategory(config, "neoplasm");
      if (neoplasmQ) return makeOutput(pedText, "P1", neoplasmQ, `${pedText} is a generic tumour, cyst, polyp, or growth explicitly covered under this plan's primary question.`);
    }

    const targetQ = questionForCategory(config, categoryKey);
    if (targetQ) {
      if (targetQ === config.anyOther) {
        const brief = PED_BRIEFS[categoryKey] ? `a ${PED_BRIEFS[categoryKey]}` : "a condition";
        return makeOutput(pedText, "FALLBACK", config.anyOther,
          `*${pedText} is ${brief}.* This plan has no dedicated category question for it. Proceed with the 'Others' section.`);
      }
      if (categoryKey === "diabetes" && config.overrides && config.overrides.requiresInsulinForDiabetes) {
        if (!/\b(type\s*1|type1|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i.test(pedText)) {
          return makeOutput(pedText, "FALLBACK", config.anyOther,
            `${pedText} does not meet the specific Type 1/Insulin-dependent qualifier for this plan's primary question.`);
        }
      }
      const brief = PED_BRIEFS[categoryKey] ? `  ${PED_BRIEFS[categoryKey]}` : "";
      return makeOutput(pedText, "P1", targetQ,
        `${pedText} is a${brief} and it's a direct/category match in this plan`);
    }
  }

  // B. Check Explicit Policy Wording (Chunking)
  if (cleanInput.length > 2) {
    for (const question of config.questions) {
      if (question === config.anyOther) continue;

      const chunks = question.toLowerCase().split(/[/,()]|\bor\b/);
      for (let chunk of chunks) {
        chunk = chunk.replace(/^\s*\d+\.\s*/, "").replace(/[^\w\s]/g, "").trim();
        if (chunk === cleanInput) {
          return makeOutput(pedText, "P0", question,
            `Exact condition match🎯: "${pedText}" is explicitly listed in this plan's questionnaire.`);
        }
      }
    }
  }

  // 0.6 GLOBAL DIAGNOSTICS & TEST FIREWALL
  if (!(/\b(stress test|treadmill test|tmt|tolerance test)\b/i.test(text)) &&
    /\b(test|scan|profile|usg|ultrasound|mri|x-?ray|checkup|report)\b/i.test(text)) {
    return makeOutput(
      pedText,
      "FALLBACK",
      config.anyOther,
      `"${pedText}" indicates a medical test, scan, or report rather than a formal diagnosis. Please declare the specific structural diagnosis this test revealed. If none, declare the test itself under the 'medical tests and investigations' section.`
    );
  }

  // 1. ACUTE INFECTIOUS FIREWALL
  if (/\b(malaria|dengue|typhoid|viral fever|flu|influenza|chikungunya|hepatitis a|cholera|food poisoning|gastroenteritis|pneumonia|measles|mumps|rubella|chickenpox|varicella|rotavirus|common cold)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther,
      `${pedText} is typically an acute/transient infection and should be declared under 'Any other disease' or 'Hospitalization/medication' sections if applicable.`);
  }

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

  // 4.5 HYPOGLYCAEMIA SHIELD
  if (/\bhypoglyc\w*/i.test(text)) {
    if (/\b(diabet\w*|insulin|dm\b|t1d|t2d|hba1c)\b/i.test(text)) {
      // let it fall through to diabetes
    } else {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is a low blood sugar episode, not a diabetes diagnosis.* ` +
        `If this occurred in the context of diagnosed diabetes or insulin use, ` +
        `declare diabetes under its relevant category instead.`);
    }
  }

  // 5. DIABETES
  // 5.0 GESTATIONAL & TYPE 2 INSULIN-INDEPENDENT SHIELD
  if (config.overrides && config.overrides.requiresInsulinForDiabetes) {
    const isGestationalOrType2 = /\b(gestational|gdm|pregnancy[- ]diabetes|pregnancy induced|maternal|type 2|type-2|typeii|type ii|t2dm|t2d)\b/i.test(text);
    const hasInsulinOrType1 = /\b(type\s*1|type-1|typei|type i|t1dm|t1d|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i.test(text);
    if (isGestationalOrType2 && !hasInsulinOrType1) {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is a specific non-severe lineage category (Gestational or Type-2 Diabetes without insulin requirement).* This plan ("${planName}") has a specific, strict question that covers ONLY Type 1 Diabetes, diabetes on insulin, or connected with blindness/ulcers. Therefore, this condition does not map to the primary diabetes question and must be declared under the general section: "${config.anyOther}".`);
    }
  }

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
    if (config.overrides && config.overrides.requiresInsulinForDiabetes) {
      if (/\b(type\s*1|type1|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i.test(text)) {
        q = questionForCategory(config, "diabetes");
        if (q) return makeOutput(pedText, "P1", q, `${pedText} meets the high-severity diabetes qualifiers for this plan.`);
      }
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `${pedText} does not meet the specific Type 1/Insulin-dependent qualifier for this plan's primary question.`);
    }
    q = questionForCategory(config, "diabetes");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a diabetes or high blood sugar condition.`);
  }

  // 5.6 DVT / PULMONARY EMBOLISM SHIELD
  if (/\b(deep vein thrombosis|dvt|pulmonary embolism|pulmonary thromboembolism|venous thromboembolism|vte|thromboembolism)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther,
      `*${pedText} is a thromboembolic or venous vascular condition, not a primary heart disease.* ` +
      `DVT and pulmonary embolism are managed under vascular/coagulation medicine. ` +
      `Cardiac involvement, when it occurs, is a downstream complication — not the condition's identity. ` +
      `Declare under the 'Others' section.`);
  }

  // 5.7 GANGRENE SHIELD
  if (/\bgangrene\b/i.test(text)) {
    if (/\b(diabet\w*|foot|toe|peripheral artery|pad|arterial|vascular)\b/i.test(text)) {
      // allow flow through to relevant category
    } else {
      return makeOutput(pedText, "FALLBACK", config.anyOther,
        `*${pedText} is tissue death that can result from multiple causes* ` +
        `(diabetes, arterial disease, or infection). ` +
        `The underlying diagnosed condition should be declared in its relevant category.`);
    }
  }

  // 6. HEART / CARDIAC / VASCULAR
  if (/\b(coronary|cad|ihd|ischemic heart|ischaemic heart|heart attack|myocardial|angina|atrial fibrillation|afib|arrhythmia|cardiomyopathy|tachycardia|bradycardia|heart failure|chf|congestive heart|bypass|cabg|angioplasty|ptca|stent|valve disease|pacemaker|murmur|rheumatic heart|aortic aneurysm|peripheral vascular|pad|pvd|vascular disease|circulatory disorder|aortic stenosis|heart block|endocarditis|myocarditis)\b/i.test(text)) {
    q = questionForCategory(config, "heart");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a cardiac or circulatory system condition.`);
  }

  // 6.5 HYPOTENSION / LOW BP SHIELD
  if (/\b(hypotension|low bp|low blood pressure|bp low|decreased bp)\b/i.test(text)) {
    const lowBpQ = questionForCategory(config, "hypotension");
    if (lowBpQ) {
      return makeOutput(pedText, "P1", lowBpQ, `${pedText} is a direct category match for this plan's low blood pressure question.`);
    }
    return makeOutput(pedText, "FALLBACK", config.anyOther, `*${pedText} refers to low blood pressure.* The policy questions strictly target Hypertension (High Blood Pressure). Therefore, this condition must be declared under the 'Others' section.`);
  }

  // 7. HYPERTENSION
  if (/\b(hyperten\w*|htn|high bp|high blood pressure|essential hypertension|bp high|elevated bp)\b/i.test(text)) {
    q = questionForCategory(config, "hypertension");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is classified under Hypertension/High Blood Pressure.`);
  }

  // 8a. SEVERE NEUROLOGICAL
  if (/\b(stroke|paralysis|epilepsy|seizure|seizures?|fits|multiple sclerosis|parkinson|parkinson's|brain haemorrhage|tia|transient ischemic attack|alzheimer|alzheimer's|dementia|motor neuron|mnd)\b/i.test(text)) {
    q = questionForCategory(config, "neuro");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a severe neurological condition.`);
  }

  // 8b. MILD / PERIPHERAL NEUROLOGICAL
  if (/\b(migraine|carpal tunnel|sciatica|radiculopathy|essential tremor|neuropathy|bell's palsy|trigeminal neuralgia|nerve pain)\b/i.test(text)) {
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
  if (/\b(chronic kidney disease|ckd|aki|esrd|end.?stage renal|kidney stone|renal calculus|renal calculi|nephrolithiasis|ureteric stone|bladder stone|renal failure|kidney transplant|renal transplant|dialysis|nephritis|pyelonephritis|nephrotic syndrome|nephro|urinary tract infection|uti|cystitis|urinary incontinence|urinary obstruction|puj obstruction|pelviureteric)\b/i.test(text)) {
    q = questionForCategory(config, "kidney");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a kidney, renal, or urinary tract condition.`);
  }

  // 12. REPRODUCTIVE
  if (/\b(prostate disease|prostatitis|bph|benign prostatic hyperplasia|prostatomegaly|ectopic pregnancy|endometriosis|adenomyosis|infertility|ivf|pcos|pmos|p-?cos|pcod|p-?cod|polycystic|ovarian cyst|ovarian disorder|uterine disorder|menstrual disorder|cervical disorder|vaginal disorder|pid|testicular disorder|varicocele|hydrocele|phimosis|epididymitis|erectile dysfunction|reproductive disorder|fibroid|fibroadenoma|myoma|fibromyoma|breast lump|breast cyst|breast lesion|fibrocystic)\b/i.test(text)) {
    q = questionForCategory(config, "reproductive") || questionForCategory(config, "kidney");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a reproductive organ or hormonal disorder.`);
  }

  // 13. DIGESTIVE
  if (/\b(gerd|acid reflux|gastroesophageal|gord|irritable bowel|ibs|ibd|achalasia|peptic ulcer|gastric ulcer|stomach ulcer|gastritis|gastric issue|stomach disease|intestinal disorder|bowel obstruction|duodenal ulcer|crohn|colitis|ulcerative colitis|piles|ha?emorrhoid\w*|anal fissure|anal fistula|appendicitis|appendix|diverticulitis|diverticular disease|celiac|coeliac|pancreatitis|pancreatic disease|gall bladder disease|gallbladder disease|gall.?stone|cholelithiasis|cholecystitis|hernia|inguinal hernia|hiatal hernia|hiatus hernia|umbilical hernia|colon polyp|rectal polyp|gastric polyp|stomach polyp|intestinal polyp)\b/i.test(text)) {
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
  if (/\b(osteoarthritis|osteoarthrosis|arthritis|spondylitis|spondylosis|cervical spondylosis|lumbar spondylosis|slipped disc|disc bulge|fractur(e|es|ed)|joint replacement|acl|pcl|mcl|lcl|meniscus|rotator cuff|ligaments?|ligament tear|cartilage damage|sprain|strain|dislocation|orthopedic|orthopaedic|spinal disorder|disc prolapse|disc herniation|cervical radiculopathy|avascular necrosis|fibromyalgia|plantar fasciitis|torn meniscus|frozen shoulder|tennis elbow|gout|scoliosis|kyphosis|polio|osteoporosis|osteopenia|osteomyelitis|bone disease)\b/i.test(text)) {
    q = questionForCategory(config, "musculoskeletal");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a musculoskeletal or orthopedic condition.`);
  }

  // 19. SKIN
  if (/\b(psoriasis|eczema|dermatitis|skin|fungal infection|cellulitis|boils|abscess|melasma|rosacea|herpes zoster|shingles|scabies|vitiligo|pilonidal|urticaria|alopecia|sebaceous cyst|corn|keloid|ringworm|wart|hives|rash|lipoma|papilloma|skin tag)\b/i.test(text)) {
    if (/\bpsoriasis\b/i.test(text)) {
      const qSkin = questionForCategory(config, "autoimmune") || questionForCategory(config, "skin");
      if (qSkin) return makeOutput(pedText, "P1", qSkin, `${pedText} is a skin condition with autoimmune classification.`);
    }
    q = questionForCategory(config, "skin");
    if (q) return makeOutput(pedText, "P1", q, `${pedText} is a skin or dermatological condition.`);
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
  if (/\b(heat stroke|sun stroke|stitch(es)?|suture(s)?|wound(s|\s*cleaning)?|cut(s)?|burn(s)?|laceration(s)?|abrasion(s)?|bruise(s)?|contusion(s)?|bite(s)?|sting(s)?|cast|plaster|splint|sling|bandaged?|surgery|operation|procedure|treatment|hospitali[sz]ation|hospitali[sz]ed|admitted|admission|accident|trauma|injur(y|ies)|first aid|er visit|emergency room|amputation|injection|iv(\s*drip)?|physiotherapy|\w*ectomy)\b/i.test(text)) {
    return makeOutput(pedText, "FALLBACK", config.anyOther, `"${pedText}" indicates an acute injury, physical treatment, or medical procedure rather than a specific illness category.`);
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
