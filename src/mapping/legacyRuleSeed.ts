/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MatchOutput } from "../types.js";
import type { Action, ChainItem, Clause, Cond, Msg, RoutingRuleRow, RuleDefinition, StepStage } from "./ruleTypes.js";

/**
 * Phase 2 (equality migration) seed: every hard-coded routing rule of the
 * legacy engine (src/engine.ts classifyDeterministic / checkNaturalLifeStages
 * / applyPostGuards) expressed as routing_rules data.
 *
 * RULES FOR THIS FILE
 *  - Regex sources and message strings are copied verbatim from engine.ts.
 *    legacyRuleSeed.test.ts asserts every seeded regex literal still exists,
 *    byte-for-byte, in engine.ts. Nothing here is a redesign.
 *  - Order (`position`) is the legacy evaluation order.
 *  - The four plan-specific blocks use FIXED categories (approved
 *    2026-10-01); the legacy "follow the live dictionary category" behaviour
 *    depended on a compile-time snapshot constant and is intentionally gone.
 *  - Message tokens: {ped} trimmed input, {rawPed} untrimmed input (post-guards),
 *    {plan} plan name, {anyOther} the plan's catch-all question.
 */

// ── builders ────────────────────────────────────────────────────────────

const rx = (r: RegExp) => ({ re: r.source, flags: r.flags });
const T = (r: RegExp, on?: "text" | "raw"): Cond => ({ t: "text", ...rx(r), ...(on ? { on } : {}) });
const NOT = (c: Cond): Cond => ({ t: "not", c });
const ALL = (...of: Cond[]): Cond => ({ t: "all", of });
const ANY = (...of: Cond[]): Cond => ({ t: "any", of });
const PLAN = (is: string): Cond => ({ t: "plan", is });
const FLAG = (name: "insulinQualifier" | "excludesPrediabetes" | "benignBypassed"): Cond => ({ t: "flag", name });
const CAT = (is: string): Cond => ({ t: "category", is });
const Q_MISSING = (cat: string): Cond => ({ t: "qCat", cat, exists: false });
const Q_WORDING = (cat: string, r: RegExp): Cond => ({ t: "qWording", cat, ...rx(r) });
const Q_WORDING_NOT = (cat: string, r: RegExp): Cond => ({ t: "qWording", cat, not: true, ...rx(r) });

const FIND = (r: RegExp): ChainItem => ({ findQ: r.source, flags: r.flags });
const emit = (type: MatchOutput["match_type"], msg: Msg, question: "anyOther" | { literal: string } = "anyOther"): Action =>
  ({ a: "emit", type, question, msg });
const route = (type: "P0" | "P1" | "FALLBACK", chain: ChainItem[], msg: Msg, allowEmpty?: boolean): Action =>
  ({ a: "route", type, chain, msg, ...(allowEmpty ? { allowEmpty: true } : {}) });
const clause = (then: Action, ...when: Cond[]): Clause => (when.length ? { when, then } : { then });

interface SeedStep {
  ruleKey: string;
  stage: StepStage;
  position: number;
  description: string;
  planScope?: string;
  definition: RuleDefinition;
  primitive?: RoutingRuleRow["primitive"];
}

const steps: SeedStep[] = [];
const rule = (ruleKey: string, stage: StepStage, position: number, description: string, definition: RuleDefinition, planScope?: string) =>
  steps.push({ ruleKey, stage, position, description, definition, planScope });
const prim = (ruleKey: string, stage: StepStage, position: number, primitive: NonNullable<RoutingRuleRow["primitive"]>, description: string, params: Record<string, unknown>) =>
  steps.push({ ruleKey, stage, position, description, definition: { params }, primitive });

// ── 1. admin plan-specific PED override (plan_overrides) ───────────────
prim("primitive.plan_override", "plan_override", 10, "plan_override", "Admin plan-specific PED mapping (plan_overrides): exact alias, then longest word-span up to 15 words. Result skips the post-guards.", {});

// ── 2. life-stage firewall ─────────────────────────────────────────────
const LIFE_STAGE_MSG =
  `⚠️ "{ped}" is not a medical ailment, progressive chronic disease, or injury; it is classified as {short} and hence no specific questionnaire match applies.\n\nIf there are underlying chronic comorbidities or specific long-term secondary medical conditions, please clear the field and search again using that explicit diagnosis.`;
rule("firewall.life_stage", "firewall", 20, "Natural life-stage firewall → NON_AILMENT (ectopic and gestational/pregnancy-induced hypertension bypass it).", {
  when: [
    NOT(T(/\bectopic\b/i)),
    NOT(T(/\b(pregnancy[\s-]induced hypertension|gestational hypertension)\b/i)),
    T(/\b(menstruat(e|ion|ing)|my period(s)?|regular period(s)?|menopaus(e|al)|peri-?menopaus(e|al)|post-?menopaus(e|al)|puberty|healthy|none|normal|fit|perfect|nil|n\/?a|not\s*applicable|no\s+pre-?existing|routine\s*checkup|general\s*checkup|master\s*health|executive\s*checkup|vaccin(ation|e|ed)|immuniz(ation|ed)|pregnan(cy|t)|childbirth|c\s*-?\s*section|caesarean|cesarean|lscs|post-?partum|post-?natal|lactat(ion|ing)|breastfeed(ing)?)\b/i),
  ],
  clauses: [
    {
      then: {
        a: "emit",
        type: "NON_AILMENT",
        question: { literal: "No questions applicable" },
        msg: LIFE_STAGE_MSG,
        vars: [
          {
            name: "short",
            variants: [
              { ...rx(/menopaus|puberty|lactat|breastfeed/i), value: "a natural biological life stage or physiological transition" },
              { ...rx(/healthy|none|normal|fit|perfect|nil|n\/?a|applicable|no\s+pre-?existing/i), value: "an explicit declaration of normal health status or empty field placeholder" },
              { ...rx(/checkup|vaccin|immuniz/i), value: "a routine preventative wellness check or standard immunization event" },
              { ...rx(/pregnan|childbirth|c\s*-?\s*section|caesarean|cesarean|lscs|post-?partum|post-?natal/i), value: "a natural physiological life event" },
            ],
            default: "a natural physiological state or routine event",
          },
        ],
      },
    },
  ],
});

// ── 3. plan-specific rules (legacy "0.4"; FIXED categories) ────────────
rule("plan_rule.afp_osa", "plan_rule", 30, "Activ Fit Preferred: sleep apnea / OSA → congenital/genetic question (that plan's genetic question names OSA).", {
  when: [PLAN("Activ Fit Preferred"), T(/\b(obstructive sleep apnea|sleep apnea|osa)\b/i)],
  clauses: [clause(route("P1", ["genetic"], `👉 *{ped}* maps to the congenital/genetic/disability question in this plan (which explicitly names Obstructive Sleep Apnea).`))],
}, "Activ Fit Preferred");
rule("plan_rule.afp_vascular", "plan_rule", 31, "Activ Fit Preferred: DVT / PE / varicose veins / lymphedema / Raynaud → heart question (peripheral vascular disease).", {
  when: [PLAN("Activ Fit Preferred"), T(/\b(deep vein thrombosis|dvt|pulmonary embolism|pulmonary thromboembolism|venous thromboembolism|vte|varicose veins?|lymphedema|raynaud disease|raynaud phenomenon)\b/i)],
  clauses: [clause(route("P1", ["heart"], `👉 *{ped}* maps to the heart/peripheral vascular disease question in this plan (which explicitly lists peripheral vascular disease).`))],
}, "Activ Fit Preferred");
rule("plan_rule.cs_ibd", "plan_rule", 32, "Care Supreme: Crohn's / colitis / IBD → Blood and/or Immunity question.", {
  when: [PLAN("Care Supreme"), T(/\b(crohn|colitis|ulcerative colitis|ibd)\b/i)],
  clauses: [clause(route("P1", ["blood"], `👉 *{ped}* maps to the Blood and / or Immunity question in this plan (which explicitly names Crohn's disease and Ulcerative Colitis).`))],
}, "Care Supreme");
rule("plan_rule.optima_ra", "plan_rule", 33, "Optima Secure: autoimmune joint diseases → musculoskeletal question.", {
  when: [PLAN("Optima Secure"), T(/\b(rheumatoid arthritis|ra\b|ankylosing spondylitis|psoriatic arthritis|reactive arthritis|reiter syndrome)\b/i)],
  clauses: [clause(route("P1", ["musculoskeletal"], `👉 *{ped}* maps to the musculoskeletal/arthritis question in this plan.`))],
}, "Optima Secure");

// ── 4. fast-path shields A–I (legacy "0.5") ────────────────────────────
const ACUTE_INFECTION_MSG = `{ped} is typically an acute/transient infection and should be declared under 'Any other disease' or 'Hospitalization/medication' sections if applicable.`;
const PREDIABETES_RE = /\b(pre[- ]?diabet\w*|borderline diabetes|impaired fasting glucose|impaired glucose tolerance)\b/i;
const PREDIABETES_MSG =
  `*{ped} is an elevated blood sugar finding.*\n\n*However, this plan's diabetes question applies only to confirmed diagnoses or specified severe conditions:* *Type 1 Diabetes, diabetes on insulin, or connected with blindness/ulcers.* Prediabetes does not qualify for the primary diabetes question and should be declared under the 'Others' section.`;
const HPV_RE = /\b(hpv|human papillomavirus)\b/i;
const HPV_MSG = `{ped} is a sexually transmitted infection, but this plan's specific question is restricted to HIV/AIDS. Therefore, it is correctly routed to 'Any other disease/condition'.`;
const STD_WORDING_RE = /\b(std|sexually transmitted)\b/i;

rule("shield.A_tests", "shield", 100, "Global diagnostics & test firewall → Others.", {
  when: [
    NOT(T(/\b(stress test|treadmill test|tmt|tolerance test|positive hiv test|std profile|lipid profile high)\b/i)),
    T(/\b(test|scan|profile|usg|ultrasound|mri|x-?ray|checkup|report)\b/i),
  ],
  clauses: [clause(emit("FALLBACK", `"{ped}" indicates a medical test, scan, or report rather than a formal diagnosis. Please declare the specific structural diagnosis this test revealed. If none, declare the test itself under the 'medical tests and investigations' section.`))],
});
rule("shield.B_acute_infection", "shield", 101, "Acute infectious firewall → Others.", {
  when: [T(/\b(malaria|dengue|typhoid|viral fever|flu|influenza|chikungunya|hepatitis a|cholera|food poisoning|gastroenteritis|pneumonia|measles|mumps|rubella|chickenpox|varicella|rotavirus|common cold)\b/i)],
  clauses: [clause(emit("FALLBACK", ACUTE_INFECTION_MSG))],
});
rule("shield.C_hypoglycaemia", "shield", 102, "Hypoglycaemia shield (passes through when diabetes context or two curated phrases).", {
  when: [
    T(/\bhypoglyc\w*/i),
    NOT(ANY(T(/\b(hypoglycemia episode|reactive hypoglycemia)\b/i), T(/\b(diabet\w*|insulin|dm\b|t1d|t2d|hba1c)\b/i))),
  ],
  clauses: [clause(emit("FALLBACK", `*{ped} is a low blood sugar episode, not a diabetes diagnosis.* If this occurred in the context of diagnosed diabetes or insulin use, declare diabetes under its relevant category instead.`))],
});
rule("shield.D_dvt_pe", "shield", 103, "DVT / pulmonary embolism shield → Others.", {
  when: [T(/\b(deep vein thrombosis|dvt|pulmonary embolism|pulmonary thromboembolism|venous thromboembolism|vte|thromboembolism)\b/i)],
  clauses: [clause(emit("FALLBACK", `*{ped} is a thromboembolic or venous vascular condition, not a primary heart disease.* DVT and pulmonary embolism are managed under vascular/coagulation medicine. Cardiac involvement, when it occurs, is a downstream complication — not the condition's identity. Declare under the 'Others' section.`))],
});
rule("shield.E_gangrene", "shield", 104, "Gangrene shield (passes through with diabetes/foot/arterial context).", {
  when: [T(/\bgangrene\b/i), NOT(T(/\b(diabet\w*|foot|toe|peripheral artery|pad|arterial|vascular)\b/i))],
  clauses: [clause(emit("FALLBACK", `*{ped} is tissue death that can result from multiple causes* (diabetes, arterial disease, or infection). The underlying diagnosed condition should be declared in its relevant category.`))],
});
rule("shield.F_hypotension", "shield", 105, "Hypotension / low BP shield: the plan's low-BP question when it has one, else Others.", {
  when: [T(/\b(hypotension|low bp|low blood pressure|bp low|decreased bp)\b/i)],
  clauses: [
    clause(route("P1", ["hypotension"], `{ped} is a direct category match for this plan's low blood pressure question.`)),
    clause(emit("FALLBACK", `*{ped} refers to low blood pressure.* The policy questions strictly target Hypertension (High Blood Pressure). Therefore, this condition must be declared under the 'Others' section.`)),
  ],
});
rule("shield.G_gestational_type2", "shield", 106, "Gestational / Type-2 diabetes without insulin → Others, on plans whose diabetes question needs the insulin/Type-1 qualifier.", {
  when: [
    FLAG("insulinQualifier"),
    T(/\b(gestational|gdm|pregnancy[- ]diabetes|pregnancy induced|maternal|type 2|type-2|typeii|type ii|t2dm|t2d)\b/i),
    NOT(T(/\b(type\s*1|type-1|typei|type i|t1dm|t1d|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i)),
    NOT(ALL(T(/\bhypertension\b/i), NOT(T(/\b(diabet\w*|blood sugar|dm\b)\b/i)))),
  ],
  clauses: [clause(emit("FALLBACK", `*{ped} is a specific non-severe lineage category (Gestational or Type-2 Diabetes without insulin requirement).* This plan ("{plan}") has a specific, strict question that covers ONLY Type 1 Diabetes, diabetes on insulin, or connected with blindness/ulcers. Therefore, this condition does not map to the primary diabetes question and must be declared under the general section: "{anyOther}".`))],
});
rule("shield.H_prediabetes", "shield", 107, "Prediabetes intercept on plans whose diabetes question requires a confirmed diagnosis.", {
  when: [T(PREDIABETES_RE), ANY(FLAG("excludesPrediabetes"), FLAG("insulinQualifier"))],
  clauses: [clause(emit("FALLBACK", PREDIABETES_MSG))],
});
rule("shield.I_hpv", "shield", 108, "HPV on plans whose STD question is HIV/AIDS-restricted → Others.", {
  when: [T(HPV_RE), Q_WORDING_NOT("hiv", STD_WORDING_RE)],
  clauses: [clause(emit("P1", HPV_MSG))],
});

// ── 5. exact plan wording (P0) ──────────────────────────────────────────
prim("primitive.p0_wording", "wording", 200, "p0_wording", "Exact plan-wording chunk match → P0 (a condition equal to a '/'-separated fragment of a plan question).", {});

// ── 6. dictionary stage ─────────────────────────────────────────────────
prim("primitive.dictionary_lookup", "dictionary", 300, "dictionary_lookup", "Alias lookup (PED category, alias override, routing_enabled) → category for the stages below.", {});
rule("dict.benign_cns_override", "dictionary", 310, "Benign CNS tumours (meningioma, acoustic neuroma, craniopharyngioma) are reassigned to benign_growth.", {
  when: [T(/\b(meningioma|acoustic\s*neuroma|craniopharyngioma|benign\s*brain\s*tu?mou?r)\b/i)],
  clauses: [clause({ a: "setCategory", to: "benign_growth" })],
});
const dictRule = (key: string, position: number, category: string, description: string, clauses: Clause[], extraWhen: Cond[] = []) =>
  rule(`dict.${key}`, "dictionary", position, description, { when: [CAT(category), ...extraWhen], clauses });
dictRule("vascular_fallback", 320, "vascular_fallback", "Vascular/venous conditions → Others.",
  [clause(emit("FALLBACK", `*{ped} is a vascular/venous condition.* It does not map to the severe cardiovascular/heart disease questions and should be declared under the 'Others Section'.`))]);
dictRule("autoimmune_optima", 321, "autoimmune", "Optima Secure has no autoimmune question: systemic autoimmune → Others.",
  [clause(emit("FALLBACK", `*{ped}* is a systemic autoimmune condition. Since this plan has no dedicated immunity or autoimmune category question, it is routed to the general section: "{anyOther}".`))], [PLAN("Optima Secure")]);
dictRule("acute_infection", 322, "acute_infection", "Acute/transient infection → Others.", [clause(emit("FALLBACK", ACUTE_INFECTION_MSG))]);
dictRule("allergy", 323, "allergy", "Allergy → Others.",
  [clause(emit("FALLBACK", `*Allergies are hypersensitivity responses, not immune system disorders or respiratory diseases.*\n\nIf the allergy has led to a diagnosed condition, declare that condition in its relevant section.`))]);
dictRule("gynecomastia", 324, "gynecomastia", "Gynaecomastia → Others.",
  [clause(emit("FALLBACK", `*{ped} is a condition of breast tissue enlargement in males. It's not an endocrine or thyroid disorder by itself.*\n\nIf the gynaecomastia is a diagnosed result of a hormonal disorder, declare the underlying disorder under Endocrine/Thyroid.`))]);
dictRule("ambiguous_symptom", 325, "ambiguous_symptom", "General symptom / ambiguous finding → Others.",
  [clause(emit("FALLBACK", `*{ped} is a general or ambiguous symptom/deficiency.* Because it can be caused by numerous minor issues, it does not automatically map to a disease category.`))]);
dictRule("eosinophilia_finding", 326, "eosinophilia_finding", "Eosinophilia (blood test finding) → Others.",
  [clause(emit("FALLBACK", `*{ped} is a blood test finding, not a primary blood disorder.*\n\nElevated eosinophil count is typically a secondary finding caused by allergies, parasitic infections, or drug reactions — not a structural blood disease like anaemia, haemophilia, or thalassaemia.\n\nIf eosinophilia is caused by a diagnosed underlying condition, declare that condition under its relevant category instead.`))]);
dictRule("lifestyle", 327, "lifestyle", "Lifestyle habit → Others.",
  [clause(emit("FALLBACK", `*{ped} is a lifestyle habit.* Declare this in the others section if specific lifestyle/habits section is not present in the proposal form`))]);
dictRule("natural_life_stage", 328, "natural_life_stage", "Natural life stage: delegates to the life-stage firewall (unresolved when it does not match).",
  [clause({ a: "ref", rule: "firewall.life_stage" })]);
dictRule("acute_trauma", 329, "acute_trauma", "Acute injury / procedure → Others.",
  [clause(emit("FALLBACK", `"{ped}" indicates an acute injury or physical trauma rather than a specific illness category. Declare it under this plan's hospitalisation/surgery umbrella question if applicable, otherwise under the 'Others Section'.`))]);
const NEURO_MILD_DICT_MSG = `{ped} is a mild or peripheral nerve condition routed to the general nervous system question to avoid high-severity stroke flags (PED Repository governed category).`;
dictRule("neuro_mild", 330, "neuro_mild", "Mild/peripheral nerve conditions → the plan's general nervous question (psychiatric question if it covers 'nervous', else neuro).", [
  clause(route("P1", ["psychiatric"], NEURO_MILD_DICT_MSG), Q_WORDING("psychiatric", /nervous/i)),
  clause(route("P1", ["neuro"], NEURO_MILD_DICT_MSG)),
]);
dictRule("investigation_procedure", 331, "investigation_procedure", "Diagnostic / investigative procedure → Others (tests umbrella).",
  [clause(emit("FALLBACK", `"{ped}" is a diagnostic or investigative procedure, not a formal disease diagnosis. Please declare the specific structural diagnosis this procedure revealed, if any. If none, check if this plan's umbrella medical tests/investigations question applies first; otherwise declare it under the 'Others' section (PED Repository governed category).`))]);
dictRule("benign_growth", 332, "benign_growth", "Benign growth: Others on plans whose neoplasm question targets malignancy only, else the neoplasm question.", [
  clause(emit("FALLBACK", `*{ped} is a benign condition.* This plan's primary question strictly targets malignant cancers. Benign growths map to the 'Others' section.`), FLAG("benignBypassed")),
  clause(route("P1", ["neoplasm"], `{ped} is a generic tumour, cyst, polyp, or growth explicitly covered under this plan's primary question.`)),
]);

prim("primitive.plan_decision", "plan_decision", 400, "plan_decision", "Plan Decision: the plan's category map decides direct question / explicit catch-all / no mapping. Wording and templates live in params.", {
  rootRescue: {
    "diabetic retinopathy": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
    "diabetic retinopathy eye": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
    "diabetic neuropathy nerve": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
    "diabetic nephropathy kidney": { rootCategoryKey: "diabetes", rootLabel: "Diabetes / High Blood Sugar" },
  },
  rootRescueMsg: `"{ped}" is a complication of the condition covered by this plan's **{rootLabel}** question. This plan has no dedicated **{label}** question, so it is declared there instead.`,
  explicitCatchAllMsg: `"{ped}" falls under the **{label}** category, but this plan has no dedicated declaration question for it. Proceed with the 'Others' section.`,
  directMsg: `"{ped}" falls under the **{label}** category and is a category-level match to this plan's declaration question above.`,
  defaultLabel: "a condition covered under this plan's declaration framework",
  insulinQualifier: {
    category: "diabetes",
    allow: rx(/\b(type\s*1|type1|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i),
    msg: `{ped} does not meet the specific Type 1/Insulin-dependent qualifier for this plan's primary question.`,
  },
});

// ── 7. disease-family rules (legacy 1.5 … 21) ───────────────────────────
let familyPos = 500;
const family = (key: string, description: string, def: RuleDefinition) => { rule(`family.${key}`, "family", familyPos, description, def); familyPos += 10; };

family("covid", "COVID-19.", { when: [T(/\b(covid[\s-]?19?|post[\s-]covid|long[\s-]covid|covid complications|coronavirus)\b/i)],
  clauses: [clause(route("P1", ["covid"], `*{ped}* is a Covid-19 related condition.`))] });
family("cancer", "Malignant cancers.", { when: [T(/\b(cancer|carcinoma|sarcoma|lymphoma|leukemia|leukaemia|malignancy|malignant|melanoma|oncology|metastasis)\b/i)],
  clauses: [clause(route("P1", ["neoplasm"], `{ped} is a malignant neoplasm or cancer requiring primary disclosure.`))] });
family("std_hpv", "STD / HPV (HPV on HIV-only-question plans → Others).", { when: [T(/\b(hpv|human papillomavirus|std|sexually transmitted disease|syphilis|gonorrhea|chlamydia|herpes)\b/i)],
  clauses: [
    clause(emit("P1", HPV_MSG), T(HPV_RE), Q_WORDING_NOT("hiv", STD_WORDING_RE)),
    clause(route("P1", ["hiv"], `{ped} is classified as a sexually transmitted disease/infection.`)),
  ] });
family("lipids", "Lipid disorders (plan question found by wording, else Others).", { when: [T(/\b(cholesterol\w*|cholestrol\w*|hypercholest\w*|lipid disorder|triglycerid\w*|dyslipid\w*|hyperlipid\w*|ldl|hdl|high cholesterol)\b/i)],
  clauses: [
    clause(route("P1", [FIND(/lipid|cholesterol/i)], `{ped} is a cardiovascular risk factor explicitly covered by the plan.`)),
    clause(emit("FALLBACK", `{ped} is a lipid disorder with no primary category question in this plan.`)),
  ] });
family("prediabetes", "Prediabetes: Others on confirmed-diagnosis plans, else the diabetes question.", { when: [T(PREDIABETES_RE)],
  clauses: [
    clause(emit("FALLBACK", PREDIABETES_MSG), ANY(FLAG("excludesPrediabetes"), FLAG("insulinQualifier"))),
    clause(route("P1", ["diabetes"], `{ped} indicates elevated blood sugar levels that fall under this plan's diabetes or high blood sugar category.`)),
  ] });
steps.push({
  ruleKey: "family.diabetes_confirmed", stage: "family", position: (familyPos), primitive: "diabetes_confirmed",
  description: "Confirmed diabetes, with complication wording and the insulin/Type-1 qualifier on plans that require it.",
  definition: {
    params: {
      pattern: rx(/\b(diabet\w*|dm\s*1|dm\s*2|t1dm|t2dm|t1d|t2d|type\s*1\s*dm|type\s*2\s*dm|high blood sugar|dm\b|high sugar|insulin dependent|diabetic foot|diabetic gangrene|diabetic neuropathy|diabetic retinopathy|hyperglycemia)\b/i),
      complicationOrgans: [["diabetic retinopathy", "an eye"], ["diabetic neuropathy", "a nerve"], ["diabetic foot", "a foot/limb"], ["diabetic gangrene", "a tissue/vascular"]],
      complicationMsg: `{ped} is {organ} complication caused by diabetes — not an independent {organBare} condition`,
      plainMsg: `{ped} is a diabetes or high blood sugar condition`,
      qualifier: rx(/\b(type\s*1|type1|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i),
      qualifiedMsg: `{description} and meets the high-severity diabetes qualifiers for this plan.`,
      unqualifiedMsg: `{ped} does not meet the specific Type 1/Insulin-dependent qualifier for this plan's primary question.`,
      routedMsg: `{description}.`,
    },
  },
});
familyPos += 10;
family("heart", "Heart / cardiac / vascular.", { when: [ANY(
    T(/\b(coronary|cad|ihd|ischemic heart|ischaemic heart|heart attack|myocardial|angina|atrial fibrillation|afib|arrhythmia|cardiomyopathy|tachycardia|bradycardia|heart failure|chf|congestive heart|bypass|cabg|angioplasty|ptca|valve disease|pacemaker|murmur|rheumatic heart|aortic aneurysm|peripheral vascular|pad|pvd|vascular disease|circulatory disorder|aortic stenosis|heart block|endocarditis|myocarditis)\b/i),
    ALL(T(/\bstent\b/i), T(/\b(coronary|cardiac|heart|artery|arteries)\b/i)),
  )],
  clauses: [clause(route("P1", ["heart"], `{ped} is a cardiac or circulatory system condition.`))] });
steps.push({
  ruleKey: "family.hypertension", stage: "family", position: familyPos, primitive: "hypertension_family",
  description: "Hypertension, with organ-complication routing (organ question when the plan has one, else Hypertension).",
  definition: {
    params: {
      pattern: rx(/\b(hyperten\w*|htn|high bp|high blood pressure|essential hypertension|bp high|elevated bp)\b/i),
      complications: [
        ["retinopathy", { organCategoryKey: "eye", organLabel: "an eye", organQuestionName: "eye disease" }],
        ["nephropathy", { organCategoryKey: "kidney", organLabel: "a kidney", organQuestionName: "kidney disease" }],
        ["encephalopathy", { organCategoryKey: "neuro", organLabel: "a brain/neurological", organQuestionName: "neurological" }],
        ["cardiomyopathy", { organCategoryKey: "heart", organLabel: "a cardiac", organQuestionName: "heart disease" }],
        ["heart disease", { organCategoryKey: "heart", organLabel: "a cardiac", organQuestionName: "heart disease" }],
      ],
      eyeChain: ["eye", "eyeEnt"],
      organMsg: `{ped} is {organLabel} complication of hypertension. This plan's {organQuestionName} question explicitly covers it, so it is declared there rather than under Hypertension / High Blood Pressure.`,
      rootMsg: `{ped} is {organLabel} complication caused by hypertension. This plan has no dedicated {organQuestionName} question, so it is declared under the Hypertension / High Blood Pressure question instead.`,
      plainMsg: `{ped} is classified under Hypertension/High Blood Pressure.`,
    },
  },
});
familyPos += 10;
family("neuro_severe", "Severe neurological.", { when: [T(/\b(stroke|paralysis|epilepsy|seizure|seizures?|fits|multiple sclerosis|parkinson|parkinson's|brain haemorrhage|tia|transient ischemic attack|alzheimer|alzheimer's|dementia|motor neuron|mnd)\b/i)],
  clauses: [clause(route("P1", ["neuro"], `{ped} is a severe neurological condition.`))] });
const NEURO_MILD_MSG = `{ped} is a mild or peripheral nerve condition routed to the general nervous system question to avoid high-severity stroke flags.`;
family("neuro_mild", "Mild / peripheral neurological (spine-qualified radiculopathy and sciatica excluded).", {
  when: [
    NOT(T(/\b(cervical|lumbar|thoracic|spinal)\s+radiculopathy\b/i)),
    NOT(T(/\bsciatica\b/i)),
    T(/\b(migraine|carpal tunnel|radiculopathy|essential tremor|neuropathy|bell's palsy|trigeminal neuralgia|nerve pain)\b/i),
  ],
  clauses: [
    clause(route("P1", ["psychiatric"], NEURO_MILD_MSG), Q_WORDING("psychiatric", /nervous/i)),
    clause(route("P1", ["neuro"], NEURO_MILD_MSG)),
  ] });
family("psychiatric", "Psychiatric / mental health / sleep.", { when: [T(/\b(bipolar|depression|depressive disorder|anxiety|schizophrenia|ptsd|post.?traumatic stress|ocd|obsessive.?compulsive|insomnia|obstructive sleep apnea|sleep apnea|osa\b|sleep disorder|psychosis|mental illness|psychiatric condition|psychological disorder|adhd|autism|panic disorder|panic attack|anorexia|bulimia|eating disorder)\b/i)],
  clauses: [clause(route("P1", ["psychiatric", FIND(/mental|psychiatric|sleep/i)], `{ped} is a psychiatric, mental health, or sleep disorder condition.`))] });
family("tb_bone", "Extrapulmonary TB — bone/spine.", { when: [T(/\b(spine tb|bone tb|skeletal tb|pott'?s disease|spinal tuberculosis)\b/i)],
  clauses: [clause(route("P1", ["musculoskeletal"], `{ped} is a form of extrapulmonary tuberculosis affecting the bones/spine.`))] });
family("tb_brain", "Extrapulmonary TB — nervous system.", { when: [T(/\b(brain tb|meningeal tb|tb meningitis|neurological tb)\b/i)],
  clauses: [clause(route("P1", ["neuro", FIND(/stroke|paralysis|epilepsy|fits/i)], `{ped} is a form of extrapulmonary tuberculosis affecting the nervous system/brain.`))] });
family("tb_gi", "Extrapulmonary TB — digestive tract.", { when: [T(/\b(intestinal tb|abdominal tb|gastrointestinal tb)\b/i)],
  clauses: [clause(route("P1", ["digestive"], `{ped} is a form of extrapulmonary tuberculosis affecting the digestive tract.`))] });
family("tb_renal", "Extrapulmonary TB — kidneys/urinary tract.", { when: [T(/\b(renal tb|kidney tb|urinary tb|genitourinary tb)\b/i)],
  clauses: [clause(route("P1", ["kidney"], `{ped} is a form of extrapulmonary tuberculosis affecting the kidneys/urinary tract.`))] });
family("tb_lymph", "Extrapulmonary TB — lymph nodes → Others.", { when: [T(/\b(lymph node tb|lymph gland tb|tb lymphadenitis)\b/i)],
  clauses: [clause(emit("FALLBACK", `{ped} is a form of extrapulmonary tuberculosis affecting the lymph nodes. It should be declared under the 'Others Section' to trigger general Umbrella questions.`))] });
family("respiratory", "Respiratory / pulmonary.", { when: [T(/\b(asthma|copd|chronic obstructive|bronchitis|emphysema|tuberculosis|tb|ipf|pulmonary fibrosis|ild|lung disease|lung infection|pneumonia|sarcoidosis of lung|pleural effusion|cystic fibrosis|bronchiectasis|pneumothorax|respiratory failure)\b/i)],
  clauses: [clause(route("P1", ["respiratory"], `{ped} is a respiratory or pulmonary condition.`))] });
family("kidney", "Kidney / renal / urinary.", { when: [T(/\b(chronic kidney disease|ckd|aki|esrd|end.?stage renal|kidney stone|renal calculus|renal calculi|nephrolithiasis|ureteric stone|bladder stone|renal failure|kidney transplant|renal transplant|dialysis|nephritis|pyelonephritis|nephrotic syndrome|nephro|urinary tract infection|uti|cystitis|urinary incontinence|urinary obstruction|puj obstruction|pelviureteric|ureteric stent|ureteral stent|urethral stent|dj stent|double.?j stent)\b/i)],
  clauses: [clause(route("P1", ["kidney"], `{ped} is a kidney, renal, or urinary tract condition.`))] });
family("reproductive", "Reproductive.", { when: [T(/\b(prostate disease|prostatitis|bph|benign prostatic hyperplasia|prostatomegaly|ectopic pregnancy|endometriosis|adenomyosis|infertility|ivf|pcos|pmos|p-?cos|pcod|p-?cod|polycystic|ovarian cyst|ovarian disorder|uterine disorder|menstrual disorder|cervical disorder|vaginal disorder|pid|testicular disorder|varicocele|hydrocele|phimosis|epididymitis|erectile dysfunction|reproductive disorder|fibroid|fibroadenoma|myoma|fibromyoma|breast lump|breast cyst|breast lesion|fibrocystic)\b/i)],
  clauses: [clause(route("P1", ["reproductive", "kidney"], `{ped} is a reproductive organ or hormonal disorder.`))] });
family("digestive", "Digestive (Activ Fit Preferred: ulcer → exact tumour/ulcer listing, P0).", { when: [T(/\b(gerd|acid reflux|gastroesophageal|gord|irritable bowel|ibs|ibd|achalasia|peptic ulcer|gastric ulcer|stomach ulcer|gastritis|gastric issue|stomach disease|intestinal disorder|bowel obstruction|duodenal ulcer|crohn|colitis|ulcerative colitis|piles|ha?emorrhoid\w*|anal fissure|anal fistula|appendicitis|appendix|diverticulitis|diverticular disease|celiac|coeliac|pancreatitis|pancreatic disease|esophageal stent|oesophageal stent|pancreatic duct stent|hernia|inguinal hernia|hiatal hernia|hiatus hernia|umbilical hernia|colon polyp|rectal polyp|gastric polyp|stomach polyp|intestinal polyp)\b/i)],
  clauses: [
    clause(route("P0", ["neoplasm"], `Exact condition match🎯: "{ped}" is explicitly listed in this plan's tumor/ulcer questionnaire.`, true), PLAN("Activ Fit Preferred"), T(/\bulcer\b/i)),
    clause(route("P1", ["digestive"], `{ped} is a digestive or gastrointestinal condition.`)),
  ] });
family("liver", "Liver / hepatic / gallbladder.", { when: [T(/\b(liver disease|liver disorder|liver infection|liver abscess|jaundice|cirrhosis|hepatomegaly|fatty liver|hepatic steatosis|alcoholic liver|nash|nafld|hepatitis|portal hypertension|ascites|liver failure|liver transplant|wilson.?disease|gall bladder disease|gallbladder disease|gall.?stone|cholelithiasis|cholecystitis|cholecystectomy|biliary stent|biliary stone|bile duct stent|cbd stent|common bile duct stent)\b/i)],
  clauses: [clause(route("P1", ["liver", "digestive", FIND(/liver|jaundice|gall/i)], `{ped} is a liver or gallbladder condition.`))] });
family("endocrine", "Endocrine.", { when: [T(/\b(thyroid|hyperthyroid|hypothyroid|thyrotoxicosis|goitr?e?|goite?r|graves|hashimoto|endocrine|pituitary|adrenal|cushing|addison|parathyroid|prolactinoma|hormonal imbalance)\b/i)],
  clauses: [clause(route("P1", ["endocrine"], `{ped} is an endocrine or hormonal system disorder.`))] });
family("blood", "Blood disorders.", { when: [T(/\b(thalassemia|thalassaemia|haemophilia|hemophilia|anaemia|anemia|polycythemia|hemochromatosis|neutropenia|hypereosinophilic syndrome|blood disorder|bleeding disorder|clotting disorder|thrombocytopenia|purpura|sickle cell|von willebrand|bone marrow failure|aplastic anaemia)\b/i)],
  clauses: [clause(route("P1", ["blood"], `{ped} is a blood disorder condition.`))] });
family("genetic", "Genetic, congenital and inborn metabolic disorders (inherited blood disorders → blood question).", {
  when: [ANY(
    T(/\b(down syndrome|chromosomal abnormality|cystic fibrosis|turner syndrome|klinefelter|marfan|noonan|prader-willi|edwards syndrome|patau syndrome|rett syndrome|neurofibromatosis|huntington|albinism|gaucher|pompe|tay-sachs|neimann-pick)\b/i),
    T(/\b(congenital|hereditary|familial|inherited|autosomal|recessive|dominant|chromosomal|trisomy|inborn error|metabolic disorder|genetic disease|genetic disorder|birth defect)\b/i),
    T(/\b(cleft lip|cleft palate|congenital heart|atrial septal defect|ventricular septal defect|tetralogy of fallot|spina bifida|clubfoot|anencephaly|microcephaly|hydrocephalus)\b/i),
    T(/\b(rpi deficiency|ribose-5-phosphate|g6pd deficiency|glucose-6-phosphate dehydrogenase|pyruvate kinase deficiency|alpha-1 antitrypsin deficiency|enzyme deficiency|pompe disease|gaucher disease|tay-sachs|neimann-pick|maple syrup urine|phenylketonuria|pku|homocystinuria|galactosemia|glycogen storage disease|mucopolysaccharidosis)\b/i),
  )],
  clauses: [
    clause(route("P1", ["blood"], {
      variants: [{ when: [T(/\b(g6pd|glucose-6-phosphate dehydrogenase)\b/i)], msg: `👉 Glucose-6-phosphate dehydrogenase (G6PD) deficiency is an inherited metabolic blood disorder structure and maps to this plan's primary blood/genetic question.` }],
      default: `👉 {ped} is an inherited metabolic blood disorder and maps to this plan's primary blood/genetic disorder question.`,
    }), T(/\b(g6pd|glucose-6-phosphate dehydrogenase|pyruvate kinase|thalassemia|thalassaemia|haemophilia|hemophilia|sickle cell|von willebrand)\b/i)),
    clause(emit("FALLBACK", `*{ped} is a congenital, genetic, or inborn metabolic disorder.* This plan has no dedicated category question for it. Proceed with the 'Others' section.`), { t: "qIsCatchAll", cat: "genetic" }),
    clause(route("P1", ["genetic"], {
      variants: [{ when: [T(/\b(rpi|ribose-5-phosphate)\b/i)], msg: `👉 Ribose-5-phosphate isomerase (RPI) deficiency is a rare autosomal recessive metabolic disorder, which classifies it as a genetic disorder under this plan.` }],
      default: `👉 {ped} is classified as a congenital, genetic, or inborn metabolic disorder under this plan.`,
    })),
  ] });
family("fop", "Fibrodysplasia ossificans progressiva & progressive physical deformity.", { when: [T(/\b(fibrodysplasia|fop|progressive ossification|heterotopic ossification|progressive osseous heteroplasia)\b/i)],
  clauses: [clause(route("P1", [FIND(/disability|deformity/i), FIND(/congenital/i), "genetic", "musculoskeletal"], `👉 Fibrodysplasia Ossificans Progressiva (FOP) is a rare genetic disorder characterized by the progressive transformation of muscle and connective tissue into bone (heterotopic ossification), leading to severe physical deformity and disability.`))] });
family("autoimmune_joint", "Joint & spine-focused autoimmune.", { when: [T(/\b(rheumatoid arthritis|ankylosing|ankylosing spondylitis)\b/i)],
  clauses: [clause(route("P1", ["autoimmune", "musculoskeletal"], `{ped} is an autoimmune joint/spine disorder.`))] });
family("autoimmune_systemic", "Systemic autoimmune & connective tissue.", { when: [T(/\b(lupus|sle|scleroderma|sjogren|sjogren's|vasculitis|autoimmune)\b/i)],
  clauses: [
    clause(emit("P1", `{ped} is a systemic autoimmune condition. Since this plan lacks a specific immunity question, it is safely routed to 'Any other disease/condition'.`), Q_MISSING("autoimmune")),
    clause(route("P1", ["autoimmune"], `{ped} is a systemic autoimmune or immunity disorder.`)),
  ] });
family("sarcoidosis", "Sarcoidosis — plan-aware routing.", { when: [T(/\bsarcoidosis\b/i)],
  clauses: [
    clause(route("P1", ["autoimmune"], `{ped} is explicitly named in this plan's immunity/blood disorder question and maps there directly.`), Q_WORDING("autoimmune", /sarcoidosis/i)),
    clause(route("P1", ["respiratory"], `{ped} is a systemic granulomatous disease with predominant pulmonary manifestation. It maps to the respiratory/lung disease category in this plan.`)),
    clause(emit("FALLBACK", `{ped} is a systemic granulomatous disease with no direct category match in this plan. Declare under the 'Others' section.`)),
  ] });
family("musculoskeletal", "Musculoskeletal / orthopaedic.", { when: [T(/\b(osteoarthritis|osteoarthrosis|arthritis|spondylitis|spondylosis|cervical spondylosis|lumbar spondylosis|slipped disc|disc bulge|fractur(e|es|ed)|joint replacement|acl|pcl|mcl|lcl|meniscus|rotator cuff|ligaments?|ligament tear|cartilage damage|sprain|strain|dislocation|orthopedic|orthopaedic|spinal disorder|disc prolapse|disc herniation|cervical radiculopathy|sciatica|avascular necrosis|fibromyalgia|plantar fasciitis|torn meniscus|frozen shoulder|tennis elbow|gout|scoliosis|kyphosis|polio|osteoporosis|osteopenia|osteomyelitis|bone disease)\b/i)],
  clauses: [clause(route("P1", ["musculoskeletal"], `{ped} is a musculoskeletal or orthopedic condition.`))] });
family("skin", "Skin (psoriasis prefers the autoimmune question).", { when: [T(/\b(psoriasis|eczema|dermatitis|skin|fungal infection|cellulitis|boils|abscess|melasma|rosacea|herpes zoster|shingles|scabies|vitiligo|pilonidal|urticaria|alopecia|sebaceous cyst|corn|keloid|ringworm|wart|hives|rash|skin tag)\b/i)],
  clauses: [
    clause(route("P1", ["autoimmune", "skin"], `{ped} is a skin condition with autoimmune classification.`), T(/\bpsoriasis\b/i)),
    clause(route("P1", ["skin"], `{ped} is a dermatological condition and falls under this plan's Skin category question.`)),
  ] });
family("eye", "Eye.", { when: [T(/\b(cataract|glaucoma|retinopathy|macular degeneration|myopia|hypermetropia|astigmatism|lasik|presbyopia|dry eye|conjunctivitis|pterygium|chalazion|stye|retinal detachment|strabismus|squint|keratoconus|optic nerve|eye disease|eye disorder|vision disorder)\b/i)],
  clauses: [clause(route("P1", ["eye", "eyeEnt"], `{ped} is an eye or ocular condition.`))] });
family("ent", "ENT.", { when: [T(/\b(meniere|vertigo|tinnitus|ear disease|ear disorder|tympanic membrane|ear drum|sinusitis|dns|deviated septum|deviated nasal septum|allergic rhinitis|tonsillitis|adenoid\w*|rhinitis|laryngitis|pharyngitis|nasal polyp|vocal cord|hearing loss|otitis|throat disorder|nose disorder)\b/i)],
  clauses: [clause(route("P1", ["eyeEnt"], `{ped} is an ear, nose, or throat condition.`))] });

// ── 8. generic shields (legacy 22 – 24) ─────────────────────────────────
let genericPos = 1000;
const generic = (key: string, description: string, def: RuleDefinition) => { rule(`generic.${key}`, "generic", genericPos, description, def); genericPos += 10; };
generic("benign_growth", "Generic benign growths.", { when: [T(/\b(tumou?r|neoplasm|polyp|cyst|lump|growth|lipoma|adenoma|benign|papilloma)\b/i)],
  clauses: [
    clause(emit("FALLBACK", `*{ped} is a benign condition.* This plan's primary question strictly targets malignant cancers. Benign growths map to the 'Others' section.`), FLAG("benignBypassed")),
    clause(route("P1", ["neoplasm"], `{ped} is a generic tumour, cyst, polyp, or growth explicitly covered under this plan's primary question.`)),
  ] });
generic("allergy", "Generic allergy shield.", { when: [T(/\b(food allergy|dust allergy|drug allergy|allergic to|allergy to|penicillin allergy|peanut allergy|latex allergy|pollen allergy|hay fever|allergy|allergic)\b/i)],
  clauses: [clause(emit("FALLBACK", `*Allergies are hypersensitivity responses, not immune system disorders or respiratory diseases.*\n\nIf the allergy has led to a diagnosed condition, declare that condition in its relevant section (e.g., Dust allergy → Allergic Asthma).`))] });
generic("gynecomastia", "Gynaecomastia.", { when: [T(/\b(gynae?comastia|gynocomastia|gyneacomastia)\b/i)],
  clauses: [clause(emit("FALLBACK", `*{ped} is a condition of breast tissue enlargement in males. It's not an endocrine or thyroid disorder by itself.*\n\nIf the gynaecomastia is a diagnosed result of a hormonal disorder, declare the underlying disorder under Endocrine/Thyroid.`))] });
generic("ambiguous_symptoms", "Ambiguous symptoms shield.", { when: [T(/\b(chest pain|obesity|morbid obesity|overweight|body pain|weakness|dizziness|fatigue|back pain|lumbago|nausea|vomiting|acidity|heartburn|dysmenorrhea|amenorrhea|menorrhagia|palpitation(s)?|epistaxis|nosebleed|dyspepsia|indigestion|fever|chills|malaise|swelling|loss of appetite|wheezing|shortness of breath|sob|breathlessness|dyspnea)\b/i)],
  clauses: [clause(emit("FALLBACK", `*{ped} is a clinical symptom or general finding, not a definitive medical diagnosis.*\n\nBecause this can result from minor, acute, or transient issues, it does not automatically map to a disease category. If an underlying condition has been diagnosed, please declare that specific diagnosis. Otherwise, proceed with the 'Others' section.`))] });
generic("lab_findings", "Lab findings.", { when: [T(/\b(sgpt|sgot|hba1c|alt\b|ast\b|liver enzyme(s)?|bilirubin|tsh|t3|t4|proteinuria|microalbuminuria|albuminuria|hematuria|creatinine|uric acid|esr|crp)\b/i)],
  clauses: [clause(emit("FALLBACK", `*{ped} is a laboratory test parameter or clinical finding, not a definitive medical diagnosis.*\n\nAbnormal lab results can fluctuate due to transient issues, minor infections, or medications. If this specific finding led to a formal structural diagnosis (e.g., High TSH resulting in a diagnosis of Hypothyroidism), please declare that specific diagnosis. Otherwise, proceed with the *'medical tests and investigations section'* section.`))] });
generic("diagnostics", "Diagnostics / investigations.", { when: [T(/\b(scan|ct scan|pet scan|dexa scan|mammogram|pap smear|x-?ray|mri|magnetic resonance|ultrasound|usg|biopsy|angiography|trt|tmt|treadmill|stress test|ecg|echo|echocardiogram|holter|eeg|emg|endoscopy|colonoscopy|bronchoscopy|cystoscopy|sigmoidoscopy|annual health checkup|full body checkup|blood test|lab test|kft|lft|lipid profile|cbg|pft|spirometry|investigation|diagnostic)\b/i)],
  clauses: [clause(emit("FALLBACK", {
    variants: [{ when: [T(/\b(angiography|trt|tmt|treadmill|stress test|ecg|echo|echocardiogram|mri|magnetic resonance|endoscopy|colonoscopy|usg|ultrasound)\b/i)], msg: `"{ped}" is a specialized investigative test. *It is mandatory to specify the exact test name* under the *tests and investigations* section.` }],
    default: `"{ped}" is a diagnostic or investigative test. Please declare this under the *medical tests and investigations* section.`,
  }))] });
generic("procedures", "Isolated surgical procedures → Others (surgery umbrella).", { when: [T(/\b(surger(y|ies)|surgical|operation|amputation|\w*ectomy|\w*ostomy|\w*otomy|\w*plasty|\w*pexy|replacement|transplant|angioplasty)\b/i)],
  clauses: [clause(emit("FALLBACK", `*"{ped}" is a surgical procedure*, not a specific illness category by itself. Declare it under this plan's hospitalisation/surgery umbrella question.\n\nAlso identify the underlying diagnosed condition this procedure was performed for (e.g. the illness or injury it treated) and check separately whether *that* diagnosis maps to one of this plan's specific medical questions — the procedure itself is usually secondary to the diagnosis driving it.`))] });
generic("acute_trauma", "Acute injury / trauma → Others.", { when: [T(/\b(heat stroke|sun stroke|stitch(es)?|suture(s)?|wound(s|\s*cleaning)?|cut(s)?|burn(s)?|laceration(s)?|abrasion(s)?|bruise(s)?|contusion(s)?|bite(s)?|sting(s)?|cast|plaster|splint|sling|bandaged?|procedure|treatment|hospitali[sz]ation|hospitali[sz]ed|admitted|admission|accident|trauma|injur(y|ies)|first aid|er visit|emergency room|injection|iv(\s*drip)?|physiotherapy)\b/i)],
  clauses: [clause(emit("FALLBACK", `"{ped}" indicates an acute injury or physical trauma rather than a specific illness category. Declare it under this plan's hospitalisation/surgery umbrella question if applicable, otherwise under the 'Others Section'.`))] });

// ── post-guards (legacy applyPostGuards) ────────────────────────────────
prim("guard.diabetes_restriction", "post_guard", 10, "diabetes_restriction_guard", "Diabetes restriction post-guard: a diabetes-question match that a plan restriction (or the legacy flag) excludes is diverted to Others.", {
  legacyGestationalOrType2: rx(/\b(gestational|gdm|pregnancy[- ]diabetes|pregnancy induced|maternal|type 2|type-2|typeii|type ii|t2dm|t2d)\b/i),
  legacyHasInsulinOrType1: rx(/\b(type\s*1|type-1|typei|type i|t1dm|t1d|insulin|blindness|blind|foot ulcer|chronic foot ulcer)\b/i),
  legacyMsg: `*{rawPed}* is a non-severe diabetes lineage (Gestational or Type-2 Diabetes without insulin requirement).\n\nBecause this plan ("{plan}") strictly restricts its primary diabetes question to confirmed Type 1, insulin-dependent, or severe diabetes complications, this condition is routed under the general section: "{anyOther}".`,
});
rule("guard.rheumatoid_reroute", "post_guard", 20, "Rheumatoid arthritis routed to a nervous/psychiatric/sleep question is moved to musculoskeletal (or autoimmune).", {
  when: [T(/\brheumatoid arthritis\b/i), { t: "matchedQ", ...rx(/nervous|psychiatric|sleep/i) }],
  clauses: [clause({ a: "rewrite", type: "P1", chain: ["musculoskeletal", "autoimmune"] })],
});
rule("guard.systemic_autoimmune_containment", "post_guard", 30, "SLE / lupus / scleroderma / Sjögren routed by organ association is contained to the autoimmune question (or Others).", {
  when: [T(/\b(sjogren|sle|lupus|scleroderma)\b/i), { t: "matchedQ", ...rx(/eye|vision|ear|nose|throat|lung|respiratory|stomach/i) }],
  clauses: [
    clause({ a: "rewrite", type: "P1", chain: ["autoimmune"] }),
    clause({ a: "rewrite", type: "FALLBACK", question: "anyOther", setExplanation: `{rawPed} is a systemic autoimmune condition and should not be routed by organ association alone in this plan.` }),
  ],
});

export const LEGACY_RULE_SEED: RoutingRuleRow[] = steps.map((s) => ({
  ruleKey: s.ruleKey,
  kind: s.primitive ? "primitive" : "rule",
  stage: s.stage,
  primitive: s.primitive ?? null,
  position: s.position,
  planScope: s.planScope ?? null,
  enabled: true,
  description: s.description,
  definition: s.definition,
}));
