/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  { value: "Fallback update", label: "Change a second-choice or catch-all setting", hint: "A condition's fallback categories, or what happens when nothing else applies." },
  { value: "Regression fix", label: "Correct a wrong answer", hint: "A lookup is giving the wrong question and you are fixing it on purpose." },
];

export const changeTypeLabel = (stored: string | null | undefined): string => CHANGE_TYPES.find((c) => c.value === stored)?.label ?? stored ?? "";
export const changeTypeHint = (stored: string): string => CHANGE_TYPES.find((c) => c.value === stored)?.hint ?? "";

/** How a lookup result is described in the impact preview (stored tier code -> text). */
export const OUTCOME_PLAIN: Record<string, string> = {
  P0: "Exact wording match",
  P1: "Matched by category",
  P3: "Other-conditions question",
  NON_AILMENT: "Not a condition",
  UNRESOLVED: "Passed to the AI assistant",
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
  plan_override: { label: "Plan-specific condition mappings", help: "Conditions you pinned to an exact question on one plan. Set them in Plans & Questions → Plan-Specific PED Mappings." },
  firewall: { label: "Not-a-disease check", help: "Recognises things that are not diseases (pregnancy, menopause, “healthy”, “none”, routine check-ups)." },
  plan_rule: { label: "Plan-specific rules", help: "Rules that apply to one plan only." },
  shield: { label: "Safety checks", help: "Checks that stop a risky condition from being filed under the wrong question." },
  wording: { label: "Exact wording in the plan's question", help: "If the condition's words appear in one of the plan's questions, that question is used." },
  dictionary: { label: "Condition list lookup", help: "Finds the condition (or one of its other names) in the Conditions list and its category." },
  plan_decision: { label: "Choose the plan's question for the category", help: "Turns the category into the question this plan asks for it, including plan restrictions." },
  family: { label: "Disease-group rules", help: "Wider rules that recognise a whole group of related diseases that are not in the list." },
  generic: { label: "Last safety checks", help: "Final checks for symptoms, test findings and one-off events." },
  post_guard: { label: "Final adjustments", help: "Applied after an answer is chosen, for example a plan that only covers insulin-dependent diabetes." },
};
export const stageLabel = (stage: string, fallback: string): string => STAGE_PLAIN[stage]?.label ?? fallback;

/** Plan question tags (stored values) -> what the admin reads. */
export const QUESTION_TAG_PLAIN: Record<string, string> = {
  Specific: "Specific question",
  Umbrella: "Group question",
  "Catch-all": "Any other condition",
};
export const questionTagLabel = (tag: string): string => QUESTION_TAG_PLAIN[tag] ?? tag;
