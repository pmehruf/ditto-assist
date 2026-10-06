/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RESULT_LABEL } from "./resultKind";

/**
 * Plain-language names for Mapping Control. Display only: every key here is the stored / internal value (the server
 * validates and saves these exact strings), and only the text an admin reads is different.
 */

/** "What kind of change is this?" — stored value (Part XIV change category) -> what the admin sees. */
export const CHANGE_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: "New synonym", label: "Add another name for a condition", hint: "A new spelling, abbreviation or wording for a condition that already exists." },
  { value: "New canonical condition", label: "Add a new condition", hint: "A condition the system does not know yet, with its category." },
  { value: "Dictionary update", label: "Change a condition or its category", hint: "Edit an existing condition, one of its names, or which category it is filed under." },
  { value: "Regex update", label: "Change a disease-group rule", hint: "Edit one of the wider rules that recognise a whole group of related diseases." },
  { value: "Shield update", label: "Change a safety check", hint: "Edit a built-in check that stops a risky condition being filed under the wrong question." },
  { value: "New category", label: "Add a new category", hint: "Create a new group that conditions can be filed under." },
  { value: "Plan override", label: "Change something for one plan only", hint: "A plan-specific mapping, restriction or question wording." },
  { value: "Fallback update", label: "Change a second-choice or Others setting", hint: "A condition's fallback categories, or what happens when nothing else applies." },
  { value: "Regression fix", label: "Correct a wrong answer", hint: "A lookup is giving the wrong question and you are fixing it on purpose." },
];

export const changeTypeLabel = (stored: string | null | undefined): string => CHANGE_TYPES.find((c) => c.value === stored)?.label ?? stored ?? "";
export const changeTypeHint = (stored: string): string => CHANGE_TYPES.find((c) => c.value === stored)?.hint ?? "";

/** Gate tier code -> name (only used for older previews that carry no `kind`). Direct match and Category match are the primary results; Fallback is the secondary one. */
export const OUTCOME_PLAIN: Record<string, string> = {
  P0: RESULT_LABEL.direct,
  P1: RESULT_LABEL.category,
  P3: RESULT_LABEL.fallback,
  NON_AILMENT: RESULT_LABEL.notCondition,
  UNRESOLVED: RESULT_LABEL.ai,
};

/** History: change status -> text. */
export const CHANGE_STATUS_PLAIN: Record<string, string> = {
  applied: "In effect",
  undone: "Undone",
  failed: "Did not save",
  previewed: "Preview only",
};
export const changeStatusLabel = (s: string): string => CHANGE_STATUS_PLAIN[s] ?? s.replace(/_/g, " ");

/** Decision-step groups ("stages"), in the order a lookup goes through them. */
export const STAGE_PLAIN: Record<string, { label: string; help: string }> = {
  plan_override: { label: "Plan-specific condition mappings", help: "Conditions you pinned to an exact question on one plan." },
  firewall: { label: "Not-a-disease check", help: "Recognises things that are not diseases (pregnancy, menopause, “healthy”, “none”, routine check-ups)." },
  plan_rule: { label: "Plan-specific rules", help: "Rules that apply to one plan only." },
  shield: { label: "Safety checks", help: "Checks that stop a risky condition from being filed under the wrong question." },
  wording: { label: "Exact wording in the plan's question", help: "If the condition itself appears in one of the plan's questions, that question is used (a Direct match)." },
  dictionary: { label: "PED Library lookup", help: "Finds the condition (or one of its other names) in the PED Library and its category." },
  plan_decision: { label: "Choose the plan's question for the category", help: "Turns the category into the question this plan asks for it (a Category match), or the Others question if the plan has none (Fallback)." },
  family: { label: "Disease-group rules", help: "Wider rules that recognise a whole group of related diseases that are not in the list." },
  generic: { label: "Last safety checks", help: "Final checks for symptoms, test findings and one-off events. The answer is usually the Others question." },
  post_guard: { label: "Final adjustments", help: "Applied after an answer is chosen, for example a plan that only covers insulin-dependent diabetes." },
};
export const stageLabel = (stage: string, fallback: string): string => STAGE_PLAIN[stage]?.label ?? fallback;

/** Plan question tags (stored values) -> what the admin reads. */
export const QUESTION_TAG_PLAIN: Record<string, string> = {
  Specific: "Specific",
  Umbrella: "Umbrella",
  "Catch-all": "Others",
};
export const questionTagLabel = (tag: string): string => QUESTION_TAG_PLAIN[tag] ?? tag;

/**
 * Plain wording for built-in steps whose stored description uses internal terms. Display only: it is used when the stored
 * description is still exactly the original (`from`), so a description an admin edited, and every added step, is shown as saved.
 */
const RULE_PLAIN: Record<string, { from: string; to: string }> = {
  "primitive.plan_override": { from: "Admin plan-specific PED mapping (plan_overrides): exact alias, then longest word-span up to 15 words. Result skips the post-guards.", to: "Conditions pinned to an exact question on one plan. A pinned condition is found by its name, or by its words inside a longer phrase, and the final adjustments do not change it." },
  "guard.diabetes_restriction": { from: "Diabetes restriction post-guard: a diabetes-question match that a plan restriction (or the legacy flag) excludes is diverted to Others.", to: "A diabetes answer that a plan restriction excludes is sent to the plan's Others question." },
  "firewall.life_stage": { from: "Natural life-stage firewall → NON_AILMENT (ectopic and gestational/pregnancy-induced hypertension bypass it).", to: "Normal life stages such as pregnancy and menopause are recognised as not a condition. Ectopic pregnancy and pregnancy-related high blood pressure are checked normally." },
  "guard.systemic_autoimmune_containment": { from: "SLE / lupus / scleroderma / Sjögren routed by organ association is contained to the autoimmune question (or Others).", to: "Lupus, scleroderma and similar conditions that were sent to an organ question are moved to the autoimmune question, or to Others." },
  "shield.A_tests": { from: "Global diagnostics & test firewall → Others.", to: "Tests and investigations are sent to the Others question." },
  "shield.B_acute_infection": { from: "Acute infectious firewall → Others.", to: "Short-lived infections (dengue, typhoid, flu and similar) are sent to the Others question." },
  "shield.C_hypoglycaemia": { from: "Hypoglycaemia shield (passes through when diabetes context or two curated phrases).", to: "Low blood sugar is treated as a diabetes condition only when diabetes is mentioned, or in two known phrases." },
  "shield.D_dvt_pe": { from: "DVT / pulmonary embolism shield → Others.", to: "Blood clots in the leg or lung (DVT, pulmonary embolism) are sent to the Others question." },
  "shield.E_gangrene": { from: "Gangrene shield (passes through with diabetes/foot/arterial context).", to: "Gangrene is treated as a diabetes or circulation condition only when diabetes, foot or artery wording is present." },
  "shield.F_hypotension": { from: "Hypotension / low BP shield: the plan's low-BP question when it has one, else Others.", to: "Low blood pressure goes to the plan's low-blood-pressure question if it has one, otherwise to Others." },
  "shield.G_gestational_type2": { from: "Gestational / Type-2 diabetes without insulin → Others, on plans whose diabetes question needs the insulin/Type-1 qualifier.", to: "Gestational or Type-2 diabetes without insulin goes to Others on plans whose diabetes question needs insulin or Type 1." },
  "shield.I_hpv": { from: "HPV on plans whose STD question is HIV/AIDS-restricted → Others.", to: "HPV goes to Others on plans whose STD question covers only HIV/AIDS." },
  "primitive.p0_wording": { from: "Exact plan-wording chunk match → P0 (a condition equal to a '/'-separated fragment of a plan question).", to: "If the condition is exactly one of the items listed in a plan question, that question is used (Direct match)." },
  "primitive.dictionary_lookup": { from: "Alias lookup (PED category, alias override, routing_enabled) → category for the stages below.", to: "Finds the condition (or one of its other names) in the PED Library and takes its category." },
  "primitive.plan_decision": { from: "Plan Decision: the plan's category map decides direct question / explicit catch-all / no mapping. Wording and templates live in params.", to: "Turns the category into the question this plan asks for it (Category match), or the Others question if the plan has none (Fallback)." },
  "dict.natural_life_stage": { from: "Natural life stage: delegates to the life-stage firewall (unresolved when it does not match).", to: "Normal life stages are passed to the not-a-disease check." },
  "family.digestive": { from: "Digestive (Activ Fit Preferred: ulcer → exact tumour/ulcer listing, P0).", to: "Digestive conditions. On Activ Fit Preferred, ulcer goes straight to the tumour/ulcer question." },
  "generic.allergy": { from: "Generic allergy shield.", to: "Allergy check." },
  "generic.ambiguous_symptoms": { from: "Ambiguous symptoms shield.", to: "Vague symptoms check." },
};
export const plainRuleDescription = (ruleKey: string, stored: string): string => (RULE_PLAIN[ruleKey]?.from === stored ? RULE_PLAIN[ruleKey].to : stored);
export const hasPlainRuleDescription = (ruleKey: string, stored: string): boolean => RULE_PLAIN[ruleKey]?.from === stored;
