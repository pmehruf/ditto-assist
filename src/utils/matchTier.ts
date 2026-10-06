/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RESULT_LABEL, RESULT_MEANING, RESULT_ROLE, resultKind, type ResultKind } from "./resultKind";
import { getSourceInfo } from "./labelTranslation";

/**
 * Single source of truth for how a raw `match_type` (the deterministic
 * engine / Gemini AI classification code stored on search_history.matchType
 * and returned by /api/match) is presented to a human — label text, an
 * optional numbered "confidence level", an icon, and colors for both
 * themes.
 *
 * Before this module existed, three different UI surfaces each invented
 * their own scheme for the same underlying value:
 *   - DeclarationAssistantResults.tsx (live lookup results) — "Direct
 *     Match" / "Category Match" / "AI-Assisted Match" / etc.
 *   - AuditPage.tsx (admin audit log)                        — "Level 1:
 *     Exact Match" / "Level 2: Related Category Match" / "Level 3: Generic
 *     Screen Match" / "No Policy Exclusions Mapped" (via
 *     translateMatchTypeToLayman in labelTranslation.ts).
 *   - MyActivityPage.tsx (advisor's own search history)       — a broken
 *     lookup keyed on values ("perfect" / "approx" / "not matched") that
 *     never actually occur, so it silently fell back to printing the raw
 *     "P1" / "P2" code.
 * All three now import getMatchTierInfo from here so a given match_type
 * always reads identically everywhere.
 *
 * Priority ladder (per product decision — see conversation with Mehruf):
 * how a question was *found* (exact wording / deterministic dictionary /
 * AI) is a separate concern from the confidence *tier* shown to advisors.
 * There are only 3 real tiers:
 *   Level 1 — Direct Match:   the PED's exact name is explicitly listed in
 *                              the plan's own question wording (P0).
 *   Level 2 — Category Match: the PED falls under a broader declared
 *                              category, whether resolved by the
 *                              deterministic dictionary (P1) or by the AI
 *                              successfully finding a question (P2) — both
 *                              read identically to an advisor, since HOW it
 *                              was found doesn't change how much scrutiny
 *                              it needs.
 *   Level 3 — Fallback:       neither a direct nor a category match was
 *                              found; the umbrella/catch-all "Any other
 *                              disease/condition" question was used
 *                              (FALLBACK).
 * Two further outcomes aren't part of that confidence ladder at all — they
 * mean no match was attempted because the input itself needs attention:
 *   Needs Clarification      — ambiguous or unrecognized input (ESCALATE,
 *                              INVALID).
 *   Not a Medical Ailment     — the input isn't a diagnosable condition
 *                              (NON_AILMENT).
 */

export type MatchTierLevel = 1 | 2 | 3 | null;

export interface MatchTierInfo {
  /** Numbered confidence tier, or null for the two non-tiered outcomes. */
  level: MatchTierLevel;
  /** Short label, identical across every surface — "Direct Match", etc. */
  label: string;
  /** "Level N: <label>" when leveled, otherwise same as `label`. This is
   * the string every UI should actually render, so "Level N:" only ever
   * shows up where it's meaningful. */
  levelLabel: string;
  icon: string;
  colorDark: string;
  colorLight: string;
  bgDark: string;
  bgLight: string;
}

const TIERS = {
  direct: {
    level: 1 as MatchTierLevel,
    label: "Direct Match",
    levelLabel: "Level 1: Direct Match",
    icon: "🎯",
    colorDark: "#6EE7B7",
    colorLight: "#047857",
    bgDark: "rgba(16,185,129,0.14)",
    bgLight: "rgba(5,150,105,0.10)",
  },
  category: {
    level: 2 as MatchTierLevel,
    label: "Category Match",
    levelLabel: "Level 2: Category Match",
    icon: "📂",
    colorDark: "#93C5FD",
    colorLight: "#1D4ED8",
    bgDark: "rgba(59,130,246,0.14)",
    bgLight: "rgba(29,78,216,0.08)",
  },
  fallback: {
    level: 3 as MatchTierLevel,
    label: "Fallback",
    levelLabel: "Level 3: Fallback",
    icon: "⚠️",
    colorDark: "#FCD34D",
    colorLight: "#B45309",
    bgDark: "rgba(245,158,11,0.14)",
    bgLight: "rgba(180,83,9,0.08)",
  },
  needsClarification: {
    level: null as MatchTierLevel,
    label: "Needs Clarification",
    levelLabel: "Needs Clarification",
    icon: "❓",
    colorDark: "#94A3B8",
    colorLight: "#475569",
    bgDark: "rgba(148,163,184,0.14)",
    bgLight: "rgba(71,85,105,0.08)",
  },
  notMedicalAilment: {
    level: null as MatchTierLevel,
    label: "Not a Medical Ailment",
    levelLabel: "Not a Medical Ailment",
    icon: "ℹ️",
    colorDark: "#94A3B8",
    colorLight: "#475569",
    bgDark: "rgba(148,163,184,0.14)",
    bgLight: "rgba(71,85,105,0.08)",
  },
} as const satisfies Record<string, MatchTierInfo>;

export function getMatchTierInfo(matchType: string | null | undefined): MatchTierInfo {
  const upper = (matchType || "").toUpperCase().trim();
  switch (upper) {
    case "P0":
    case "EXACT":
      // "EXACT" is a legacy value from before the P0/P1/P2 scheme — some
      // historical search_history rows may still carry it.
      return TIERS.direct;
    case "P1":
    case "P2":
    case "LIVE_MATCH":
    case "LIVE MATCH":
      // "LIVE_MATCH"/"LIVE MATCH" are legacy values for the same reason as
      // "EXACT" above.
      return TIERS.category;
    case "FALLBACK":
      return TIERS.fallback;
    case "ESCALATE":
    case "INVALID":
      return TIERS.needsClarification;
    case "NON_AILMENT":
      return TIERS.notMedicalAilment;
    default:
      // Unrecognized/malformed value — treat conservatively as the lowest
      // confidence tier rather than crashing or showing a raw code.
      return TIERS.fallback;
  }
}

/**
 * How the Lookup screen names a result. Same colours as the tiers above, but the names are the plain ones: Direct match,
 * Category match, Fallback and AI generated, with no "Level 1/2/3" (Direct and Category are both primary results and
 * Fallback is the secondary one, so numbering them as three ranks would be misleading).
 * `source` is the string the server sends with the result; an AI source means the answer is AI generated.
 */
export interface LookupResultInfo {
  kind: ResultKind;
  label: string;
  role: "Primary result" | "Secondary result" | null;
  meaning: string;
  icon: string;
  colorDark: string;
  colorLight: string;
  bgDark: string;
  bgLight: string;
}

const AI_STYLE = { icon: "🤖", colorDark: "#C4B5FD", colorLight: "#6D28D9", bgDark: "rgba(139,92,246,0.14)", bgLight: "rgba(109,40,217,0.08)" };

export function getLookupResultInfo(matchType: string | null | undefined, source?: string | null): LookupResultInfo {
  const aiGenerated = source ? !getSourceInfo(source).isSystemRule : false;
  const kind = resultKind(matchType, { aiGenerated });
  const base =
    kind === "direct" ? TIERS.direct
    : kind === "category" ? TIERS.category
    : kind === "fallback" ? TIERS.fallback
    : kind === "clarify" ? TIERS.needsClarification
    : kind === "notCondition" ? TIERS.notMedicalAilment
    : AI_STYLE;
  return {
    kind,
    label: RESULT_LABEL[kind],
    role: RESULT_ROLE[kind],
    meaning: RESULT_MEANING[kind],
    icon: base.icon,
    colorDark: base.colorDark,
    colorLight: base.colorLight,
    bgDark: base.bgDark,
    bgLight: base.bgLight,
  };
}
