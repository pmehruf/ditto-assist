/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MatchOutput } from "../types.js";

/**
 * Mapping-control rule model (Phase 2 — equality migration).
 *
 * Every routing decision the legacy engine (src/engine.ts, kept untouched as
 * the migration oracle until Phase 6) made from regexes, plan names and
 * message strings is expressed here as JSON-serialisable DATA, stored in the
 * `routing_rules` table and interpreted by routingEngine.ts. The shapes are
 * deliberately small: conditions, actions, clauses, and a short list of
 * named primitives (algorithms that need no editable mapping data).
 */

export interface RegexSpec {
  /** RegExp source, copied verbatim from the legacy engine. */
  re: string;
  flags?: string;
}

export type Cond =
  /** planName === is */
  | { t: "plan"; is: string }
  /** regex test against normalizeText(ped) ("text", default) or the trimmed raw input ("raw"). */
  | ({ t: "text"; on?: "text" | "raw" } & RegexSpec)
  /** Plan-level switch, resolved from plan_restrictions rows or the legacy plan flags. */
  | { t: "flag"; name: "insulinQualifier" | "excludesPrediabetes" | "benignBypassed" }
  /** questionForCategory(config, cat) is non-empty (exists=true) / empty (exists=false). */
  | { t: "qCat"; cat: string; exists: boolean }
  /** The plan's question for cat exists AND its wording matches (not=false) / does not match (not=true) the regex. */
  | ({ t: "qWording"; cat: string; not?: boolean } & RegexSpec)
  /** The plan's question for cat exists and is the plan's catch-all question. */
  | { t: "qIsCatchAll"; cat: string }
  /** The category resolved by the dictionary stage equals `is`. */
  | { t: "category"; is: string }
  /** Post-guards only: regex test against normalizeText(output.matched_question). */
  | ({ t: "matchedQ" } & RegexSpec)
  | { t: "not"; c: Cond }
  | { t: "all"; of: Cond[] }
  | { t: "any"; of: Cond[] };

/** One element of a route chain: a category key, or a regex over the plan's question wording. */
export type ChainItem = string | { findQ: string; flags?: string };

export type Msg =
  | string
  | {
      variants: Array<{ when: Cond[]; msg: string }>;
      default: string;
    };

export interface VarDef {
  name: string;
  variants: Array<{ re: string; flags?: string; value: string }>;
  default: string;
}

export type Action =
  /** Return `type` with a fixed question (the plan's catch-all, or a literal). */
  | { a: "emit"; type: MatchOutput["match_type"]; question: "anyOther" | { literal: string }; msg: Msg; vars?: VarDef[] }
  /**
   * Resolve the first non-empty question in `chain` and return it. When none
   * resolves, the action yields nothing and evaluation continues (unless
   * allowEmpty, which returns the empty question exactly as the legacy code did).
   */
  | { a: "route"; type: MatchOutput["match_type"]; chain: ChainItem[]; msg: Msg; allowEmpty?: boolean }
  /** Reassign the dictionary-resolved category and continue. */
  | { a: "setCategory"; to: string }
  /** Delegate to another rule; its (possibly null) result is returned as-is. */
  | { a: "ref"; rule: string }
  /** Post-guards: rewrite the already-chosen output. Yields nothing (no change) when chain resolves to no question. */
  | { a: "rewrite"; type: MatchOutput["match_type"]; chain?: ChainItem[]; question?: "anyOther"; setExplanation?: string };

export interface Clause {
  when?: Cond[];
  then: Action;
}

export type StepKind = "rule" | "primitive";

export type StepStage =
  | "plan_override"
  | "firewall"
  | "plan_rule"
  | "shield"
  | "wording"
  | "dictionary"
  | "plan_decision"
  | "family"
  | "generic"
  | "post_guard";

export type PrimitiveName =
  | "plan_override"
  | "p0_wording"
  | "dictionary_lookup"
  | "plan_decision"
  | "diabetes_confirmed"
  | "hypertension_family"
  | "diabetes_restriction_guard";

export interface RuleDefinition {
  /** Gate: every condition must hold for the clauses to be tried. */
  when?: Cond[];
  clauses?: Clause[];
  /** Primitive steps carry their editable data here instead of clauses. */
  params?: Record<string, unknown>;
}

/** A routing_rules row, as seeded and as held in the runtime snapshot. */
export interface RoutingRuleRow {
  ruleKey: string;
  kind: StepKind;
  stage: StepStage;
  /** Primitive name when kind === "primitive". */
  primitive: PrimitiveName | null;
  /** Evaluation order within the whole pipeline (ascending). */
  position: number;
  /** Plan this rule is limited to (null = every plan). Informational + used by plan_rule stage conditions. */
  planScope: string | null;
  enabled: boolean;
  description: string;
  definition: RuleDefinition;
}

export interface AliasEntry {
  pedId: number;
  /** The PED's own category (ped_repository.category_key). */
  pedCategory: string | null;
  /** When false the alias is treated as having no dictionary entry (compat control). */
  routingEnabled: boolean;
  /** Alias-level category that replaces the PED's category (compat control). */
  categoryOverride: string | null;
  /**
   * Last-resort category (compat control, PENDING APPROVAL): used only when
   * the whole pipeline resolves nothing with the primary category. Reproduces
   * production's browser-then-server two-pass behaviour.
   */
  fallbackCategory: string | null;
  /**
   * Phase 4 / R11: the PED's ordered fallback categories AFTER its primary (`pedCategory`). Absent (the default) = a
   * single-category PED, routed exactly as before. Only applied when the category comes from the PED itself (never from
   * an alias-level override or the last-resort category).
   */
  categoryChain?: string[];
}

export interface MappingSnapshot {
  /** mapping_state.version this snapshot was loaded at. */
  version: number;
  categoryLabels: Map<string, string>;
  /** normalizeDictionaryKey(alias) -> entry */
  aliases: Map<string, AliasEntry>;
  /** Enabled pipeline steps sorted by position. */
  steps: RoutingRuleRow[];
}

export interface TraceEntry {
  step: string;
  detail?: string;
}

/** Why the dictionary stage produced the category it did. */
export interface CategoryChainTrace {
  /** The configured order: primary first, then the fallbacks. */
  configured: string[];
  /** The category actually used; null when none had a real question (the existing fallback behaviour then applies). */
  selected: string | null;
  /** Earlier categories passed over, and why: no question on this plan, or the plan maps it to its Others question. */
  skipped: Array<{ category: string; reason: "no_question" | "catch_all" }>;
}

export interface DictionaryTrace {
  alias: string;
  source: "ped_category" | "category_chain" | "alias_override" | "fallback_category" | "not_routed" | "none";
  pedCategory: string | null;
  categoryOverride: string | null;
  effectiveCategory: string | null;
  /** Present only for PEDs that have an ordered category chain (R11). */
  chain?: CategoryChainTrace;
}
