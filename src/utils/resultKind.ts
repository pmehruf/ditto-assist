/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The four result names an admin or advisor reads, and what each one means. DISPLAY ONLY: the engine still returns
 * the same match types (P0, P1, P2, FALLBACK, NON_AILMENT, ESCALATE, INVALID) and nothing here changes a result.
 *
 * How a name is chosen (display only; the engine's own type is not changed and can differ from the name shown):
 *  1. A result from the AI step (or a saved AI answer) is "AI generated"; NON_AILMENT, ESCALATE and INVALID keep their own names.
 *  2. The Others question, or the engine type FALLBACK, is "Fallback". Umbrella questions are a separate "also consider" list.
 *  3. If the question the engine chose itself names the condition (the condition is exactly one of the items listed in the
 *     question), or the engine says so with type P0, it is a "Direct match". The engine type can be P1 for this: it reports
 *     P1 for plan-specific mappings and plan-specific rules without checking the wording (for example Activ Fit Preferred
 *     "Ulcer" and "Obstructive sleep apnea"), so the name is decided from the wording, not from P0 or P1.
 *  4. Any other specific question is a "Category match": no question names the condition and the chosen question covers
 *     its category (or the plan-specific mapping or rule that sent it there).
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

/**
 * True when the question itself names the condition: the condition is exactly one of the items listed in the question
 * (items are separated by "/", ",", brackets or "or"). Same wording test the engine's exact-listing step uses, applied to the
 * result after the fact so a plan-specific result can be named from its wording.
 */
export function pedNamedInQuestion(ped: string | null | undefined, question: string | null | undefined, anyOther?: string | null): boolean {
  const clean = String(ped || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= 2 || !question) return false;
  if (anyOther && question === anyOther) return false;
  return question
    .toLowerCase()
    .split(/[/,()]|\bor\b/)
    .some((chunk) => chunk.replace(/^\s*\d+\.\s*/, "").replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim() === clean);
}

/** The name shown for a result, from its wording and source (see the rules above). */
export function classifyResult(r: { ped?: string | null; matchType: string | null | undefined; question?: string | null; source?: string | null; aiGenerated?: boolean; anyOther?: string | null }): ResultKind {
  const t = (r.matchType || "").toUpperCase().trim();
  if (t === "NON_AILMENT") return "notCondition";
  if (t === "ESCALATE" || t === "INVALID") return "clarify";
  if (r.aiGenerated || !t) return "ai";
  if (t === "FALLBACK" || (r.anyOther && r.question === r.anyOther)) return "fallback";
  if (t === "P0" || t === "EXACT" || pedNamedInQuestion(r.ped, r.question, r.anyOther)) return "direct";
  if (t === "P1" || t === "P2" || t === "LIVE_MATCH" || t === "LIVE MATCH") return "category";
  return "fallback";
}

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
