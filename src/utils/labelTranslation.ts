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

export function translateSourceToLayman(source: string): string {
  if (!source) return "Plan Mapping";
  const lower = source.toLowerCase();
  if (lower.includes("deterministic") || lower.includes("standard") || lower.includes("registry")) {
    return "Official Plan Rule";
  }
  return "Clinical Assessment Match";
}
