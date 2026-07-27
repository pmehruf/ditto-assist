/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function translateMatchTypeToLayman(matchType: string): string {
  if (!matchType) return "Suggested Match";
  const upper = matchType.toUpperCase();
  if (upper === "P0" || upper === "EXACT") {
    return "Level 1: Exact Match";
  }
  if (upper === "P1" || upper === "LIVE_MATCH" || upper === "LIVE MATCH") {
    return "Level 2: Related Category Match";
  }
  if (upper === "P2") {
    return "Level 3: Generic Screen Match";
  }
  if (upper === "FALLBACK") {
    return "No Policy Exclusions Mapped";
  }
  if (upper === "ESCALATE") {
    return "Manual Underwriting Review";
  }
  if (upper === "NON_AILMENT") {
    return "Exempt Physiological State";
  }
  // Strip underscores and return clean Title Case
  return matchType.replace(/_/g, " ").replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

export function translateFallbackToLayman(fallback: string): string {
  if (!fallback) return "Direct Code Match";
  const upper = fallback.toUpperCase();
  if (upper === "INTENTIONAL SHIELD" || upper === "SHIELD") {
    return "Policy Protected Benefit";
  }
  if (upper === "GENERIC FALLBACK") {
    return "Suggested Assessment";
  }
  if (upper === "ROUTING ESCALATION" || upper === "ESCALATION") {
    return "Requires Officer Escalation";
  }
  if (upper === "N/A" || upper === "") {
    return "Direct Match";
  }
  return fallback;
}

/**
 * Single source of truth for classifying a raw `search_history.source`
 * string (e.g. "Deterministic Engine", "Live Gemini API", "Match API Error
 * Fallback", "Disaster Recovery Local Rules") into the two things that
 * actually matter to an adviser: was this mapped by a system/rule engine,
 * or was it AI-generated?
 *
 * Previously this check (formerly inlined separately in AuditPage.tsx as
 * `isSystemRuleMatch` and in translateSourceToLayman below) only looked for
 * the substring "deterministic" (or "standard"/"registry"). That missed two
 * real source values that are also rule/system-based, not AI: "Match API
 * Error Fallback" and "Disaster Recovery Local Rules" — both are local
 * fallback logic that runs when the AI call itself fails, so they were
 * being mislabeled as AI ("Clinical Assessment Match") in both the SOURCE
 * column and the audit page's source filter. Only sources that explicitly
 * name Gemini or "AI" are actually AI-generated; everything else is a
 * system/rule decision of one kind or another.
 */
export interface SourceInfo {
  isSystemRule: boolean;
  label: string;
}

export function getSourceInfo(source: string | null | undefined): SourceInfo {
  const lower = (source || "").toLowerCase();
  const isAiGenerated = /gemini/.test(lower) || /\bai\b/.test(lower);
  return isAiGenerated
    ? { isSystemRule: false, label: "AI Generated" }
    : { isSystemRule: true, label: "System Rule" };
}

export function translateSourceToLayman(source: string): string {
  if (!source) return "Plan Mapping";
  return getSourceInfo(source).label;
}
