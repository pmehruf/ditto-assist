/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The four result names an admin or advisor reads, and what each one means. DISPLAY ONLY: the engine still returns
 * the same match types (P0, P1, P2, FALLBACK, NON_AILMENT, ESCALATE, INVALID) and nothing here changes a result.
 *
 * How a name is chosen, from what the engine already returns:
 *  - P0  -> Direct match. Every P0 the engine returns says the condition is explicitly listed in the plan's question
 *           (the exact-wording step, or the one Activ Fit Preferred ulcer rule that uses the same wording).
 *  - P1 / P2 -> Category match. The question was reached through the condition's category, a plan-specific mapping or a
 *           plan-specific rule. The engine does not record whether such a question also names the condition (a few
 *           plan-specific results do: Activ Fit Preferred "Ulcer" and "Obstructive sleep apnea"). They are shown as
 *           Category match, the safe choice, because the engine's own type is P1 for them.
 *  - FALLBACK -> Fallback. The result is the plan's Others question. Umbrella questions are a separate "also consider" list.
 *  - AI generated -> the defined rules did not decide the condition and the AI (or a saved AI answer) did.
 * Direct match and Category match are the primary results; Fallback is the secondary one.
 */

export type ResultKind = "direct" | "category" | "fallback" | "ai" | "notCondition" | "clarify";

export const RESULT_LABEL: Record<ResultKind, string> = {
  direct: "Direct match",
  category: "Category match",
  fallback: "Fallback",
  ai: "AI generated",
  notCondition: "Not a condition",
  clarify: "Needs clarification",
};

export const RESULT_ROLE: Record<ResultKind, "Primary result" | "Secondary result" | null> = {
  direct: "Primary result",
  category: "Primary result",
  fallback: "Secondary result",
  ai: null,
  notCondition: null,
  clarify: null,
};

export const RESULT_MEANING: Record<ResultKind, string> = {
  direct: "The condition itself appears in one of the plan's questions.",
  category: "No question names the condition, but one question covers the condition's category and the condition falls under it.",
  fallback: "No direct match and no category match, so the answer is the plan's Others question. Umbrella questions are listed separately as questions to also check.",
  ai: "The defined mapping rules did not decide this condition, so the AI chose the answer. It is not a direct or category match, and it needs a person's review.",
  notCondition: "This is not a condition (for example a normal life stage or a habit), so no declaration question applies.",
  clarify: "The input is unclear, so it needs checking before a question can be chosen.",
};

/** Name for a result. `aiGenerated`: the answer came from the AI step (or a saved AI answer) rather than the defined rules. */
export function resultKind(matchType: string | null | undefined, opts: { aiGenerated?: boolean } = {}): ResultKind {
  const t = (matchType || "").toUpperCase().trim();
  if (t === "NON_AILMENT") return "notCondition";
  if (t === "ESCALATE" || t === "INVALID") return "clarify";
  if (opts.aiGenerated || !t) return "ai";
  if (t === "P0" || t === "EXACT") return "direct";
  if (t === "P1" || t === "P2" || t === "LIVE_MATCH" || t === "LIVE MATCH") return "category";
  return "fallback";
}

export const resultLabel = (matchType: string | null | undefined, opts: { aiGenerated?: boolean } = {}): string => RESULT_LABEL[resultKind(matchType, opts)];
