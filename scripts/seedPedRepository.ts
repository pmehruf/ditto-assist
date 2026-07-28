/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY DB MIGRATION — Phase 2 seed script.
 * See PED_REPOSITORY_DB_MIGRATION_DESIGN.md for the full design and the
 * "Approved Decisions" this script implements.
 *
 * Merges three legacy PED->category sources into the new, DB-only
 * ped_repository / ped_aliases / categories / plan_overrides tables:
 *   1. TOP_PED_DICTIONARY (types.ts, compiled) — the historical default.
 *   2. ped_directory (DB) — the Lookup page's autocomplete list, some rows
 *      carrying their own admin-assigned category.
 *   3. ped_mapping_overrides (DB) — explicit admin corrections; always wins
 *      when present (an override is a considered decision, not itself in
 *      need of review).
 * Synonym clustering (folding "OSA"/"Sleep apnea"/"Obstructive sleep
 * apnea" into one canonical PED with 3 aliases) uses ONLY the existing
 * curated PED_SYNONYM_GROUPS list — nothing is auto-merged that wasn't
 * already a reviewed grouping.
 *
 * CONFLICT HANDLING (hard gate — see "Approved Decisions" #3):
 * Nothing is auto-resolved, merged, renamed, remapped, or discarded. Every
 * conflict is written to the conflicts report with an empty `resolution`
 * field. `--apply` refuses to run while any conflict's resolution is
 * empty. There is no code path that guesses on your behalf.
 *
 * USAGE
 *   npx tsx scripts/seedPedRepository.ts --dry-run [--out <dir>]   (default)
 *   npx tsx scripts/seedPedRepository.ts --apply --conflicts-resolved <path-to-reviewed-report.json>
 *
 * SAFETY
 *   - Read-only against every existing table (TOP_PED_DICTIONARY,
 *     ped_directory, ped_mapping_overrides, plan_configs, ai_memory). This
 *     script never writes to any table that existed before this migration.
 *   - --apply only ever INSERTs into the 6 new tables. It never touches an
 *     existing table's data.
 *   - Fully reversible before runtime cutover: nothing reads from the new
 *     tables yet (Phase 3 is still to come, behind a flag defaulting to
 *     "legacy") — dropping/truncating the new tables and re-running this
 *     script is always safe up to that point.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getDb } from "../src/server/db/client.js";
import { createRepositories, type Repositories } from "../src/server/db/repositories/index.js";
import { TOP_PED_DICTIONARY, CATEGORY_LABELS, getPlanConfig } from "../src/types.js";
import { normalizeDictionaryKey } from "../src/engine.js";
import { PED_SYNONYM_GROUPS } from "../src/constants/pedSynonymGroups.js";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// Hand-transcribed from engine.ts's "0.4 PLAN-SPECIFIC OVERRIDES &
// INTERCEPTS" block (verified against the literal regex alternations at
// the time of writing — see engine.ts, search "0.4 PLAN-SPECIFIC"). Kept
// as data here rather than parsed out of the regex automatically: turning
// a fuzzy word-boundary regex into a precise list of named PEDs is a
// judgment call (e.g. the Care Supreme block's bare `colitis` stem could
// in principle match any "-colitis" compound; it's represented below as
// the two clinically distinct entities it was actually written to catch —
// "Colitis" and "Ulcerative colitis"). This transcription is itself
// reviewable, and is exactly what the migration summary's Plan Override
// Summary reports back to you term-by-term.
// ─────────────────────────────────────────────────────────────────────────
interface PlanOverrideSeedGroup {
  planName: string;
  terms: string[];
  categoryKey: string;
  reason: string;
}

export const PLAN_OVERRIDE_SEED: PlanOverrideSeedGroup[] = [
  {
    planName: "Activ Fit Preferred",
    terms: ["Obstructive sleep apnea", "Sleep apnea", "OSA"],
    categoryKey: "genetic",
    reason:
      "This plan's proposal wording explicitly names Obstructive Sleep Apnea under its congenital/genetic/disability question.",
  },
  {
    planName: "Activ Fit Preferred",
    terms: [
      "Deep vein thrombosis",
      "DVT",
      "Pulmonary embolism",
      "Pulmonary thromboembolism",
      "Venous thromboembolism",
      "VTE",
      "Varicose vein",
      "Varicose veins",
      "Lymphedema",
      "Raynaud disease",
      "Raynaud phenomenon",
    ],
    categoryKey: "heart",
    reason: "This plan's proposal wording explicitly lists peripheral vascular disease under its heart question.",
  },
  {
    planName: "Care Supreme",
    terms: ["Crohn's disease", "Crohn disease", "Colitis", "Ulcerative colitis", "IBD"],
    categoryKey: "blood",
    reason:
      "This plan's proposal wording explicitly names Crohn's disease and Ulcerative Colitis under its Blood and/or Immunity question.",
  },
  {
    planName: "Optima Secure",
    terms: [
      "Rheumatoid arthritis",
      // "RA" is deliberately NOT folded into "Rheumatoid arthritis" as an
      // alias — PED_SYNONYM_GROUPS' own header comment lists RA as one of
      // the acronyms it keeps deliberately ungrouped for being genuinely
      // ambiguous (could mean other things). Kept as its own standalone
      // term here too, faithful to the original regex, which also matched
      // it as a bare alternative.
      "RA",
      "Ankylosing spondylitis",
      "Psoriatic arthritis",
      "Reactive arthritis",
      "Reiter syndrome",
    ],
    categoryKey: "musculoskeletal",
    reason: "This plan routes autoimmune joint diseases to its musculoskeletal/arthritis question.",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Types for the merge/conflict pipeline. Pure, DB-free — testable in
// isolation (see scripts/__tests__/seedPedRepository logic verified via
// tsx scratch runs during development; the core functions below take
// plain data in and return plain data out).
// ─────────────────────────────────────────────────────────────────────────

export type LegacySourceName = "static_dictionary" | "ped_directory" | "ped_mapping_overrides";

export interface RawTerm {
  term: string; // display text as it exists in the source
  normalized: string;
  category: string | null;
  source: LegacySourceName;
  /** Only for ped_directory rows — needed to detect duplicate PEDs (two
   * different directory rows normalizing to the same key). */
  sourceId?: number;
}

export interface CategoryConflict {
  normalizedKey: string;
  displayTerms: string[];
  disagreement: Array<{ source: LegacySourceName; category: string }>;
  resolution: string | null; // filled in by hand between dry-run and apply
  /** Which of `displayTerms` becomes the canonical PED name once resolved;
   * every other displayTerm becomes an alias. Optional — defaults to
   * `displayTerms[0]` if omitted, but `displayTerms` order reflects
   * whatever order the source rows happened to be scanned in (not
   * necessarily the best display form, e.g. an all-lowercase acronym could
   * sort first), so this should be set by hand whenever the default isn't
   * the right choice. Same convention as DuplicatePedGroup.canonicalTerm —
   * must exactly match one of `displayTerms` (case-sensitive) or apply will
   * reject it. */
  canonicalDisplayTerm?: string | null;
}

export interface SkippedRecord {
  source: LegacySourceName;
  term: string;
  reason: string;
}

export interface DuplicatePedGroup {
  normalizedKey: string;
  rows: Array<{ term: string; sourceId?: number; source: LegacySourceName }>;
  /** Which of `rows[].term` becomes the canonical PED name; every other row
   * in the group becomes an alias of it. Filled in by hand between dry-run
   * and apply, same convention as CategoryConflict.resolution. Must exactly
   * match one of `rows[].term` (case-sensitive) or apply will reject it. */
  canonicalTerm: string | null;
}

export interface AmbiguousSynonymGroup {
  groupMembers: string[];
  presentMembers: string[];
  disagreement: Array<{ term: string; normalizedKey: string; category: string | null }>;
  /** The category to apply to every present member once merged into one
   * PED. Filled in by hand between dry-run and apply. Must be a known
   * category key (or explicitly null to leave the merged PED uncategorized
   * for now) — apply validates against CATEGORY_LABELS before writing. */
  resolution: string | null;
}

export interface MergedPed {
  canonicalName: string;
  aliases: string[]; // includes canonicalName
  categoryKey: string | null;
  categorySource: "ped_mapping_overrides" | "ped_directory" | "static_dictionary" | "none";
  normalizedKeys: string[]; // every normalized alias this PED covers
}

export interface MergeResult {
  merged: MergedPed[];
  categoryConflicts: CategoryConflict[];
  skipped: SkippedRecord[];
  duplicatePeds: DuplicatePedGroup[];
  ambiguousSynonymGroups: AmbiguousSynonymGroup[];
}

/** Builds the flat raw-term list from all 3 legacy sources. DB reads only
 * — never writes. */
export function buildRawTerms(
  dictionary: Record<string, string>,
  pedDirectoryRows: Array<{ term: string; category: string | null; id: number }>,
  overrideRows: Array<{ pedText: string; category: string }>
): RawTerm[] {
  const raw: RawTerm[] = [];

  for (const [key, category] of Object.entries(dictionary)) {
    raw.push({ term: key, normalized: normalizeDictionaryKey(key), category, source: "static_dictionary" });
  }
  for (const row of pedDirectoryRows) {
    raw.push({
      term: row.term,
      normalized: normalizeDictionaryKey(row.term),
      category: row.category,
      source: "ped_directory",
      sourceId: row.id,
    });
  }
  for (const row of overrideRows) {
    raw.push({
      term: row.pedText,
      normalized: normalizeDictionaryKey(row.pedText),
      category: row.category,
      source: "ped_mapping_overrides",
    });
  }
  return raw;
}

/**
 * Core merge: groups raw terms by normalized key, resolves category via
 * the approved precedence (override > ped_directory > static dictionary),
 * flags disagreements with no override as conflicts, clusters into
 * canonical PEDs via PED_SYNONYM_GROUPS, and flags any curated group whose
 * present members would resolve to genuinely different categories as an
 * ambiguous synonym group (NOT auto-merged in that case).
 */
export function mergeLegacySources(rawTerms: RawTerm[], knownCategoryKeys: Set<string>): MergeResult {
  const skipped: SkippedRecord[] = [];
  const byKey = new Map<string, RawTerm[]>();

  for (const t of rawTerms) {
    const term = t.term?.trim();
    if (!term) {
      skipped.push({ source: t.source, term: t.term ?? "", reason: "Blank/whitespace-only term text." });
      continue;
    }
    if (t.category && !knownCategoryKeys.has(t.category)) {
      skipped.push({
        source: t.source,
        term,
        reason: `Category "${t.category}" does not match any known categoryKey — orphaned/invalid reference.`,
      });
      continue;
    }
    const list = byKey.get(t.normalized) ?? [];
    list.push(t);
    byKey.set(t.normalized, list);
  }

  // Duplicate PEDs: 2+ DIFFERENT ped_directory rows collapsing to the same
  // normalized key (distinct ids, same key — the unique constraint on raw
  // `term` text doesn't catch this since case/whitespace can still differ).
  const duplicatePeds: DuplicatePedGroup[] = [];
  for (const [key, terms] of byKey) {
    const directoryRows = terms.filter((t) => t.source === "ped_directory");
    const distinctIds = new Set(directoryRows.map((t) => t.sourceId));
    if (distinctIds.size > 1) {
      duplicatePeds.push({
        normalizedKey: key,
        rows: directoryRows.map((t) => ({ term: t.term, sourceId: t.sourceId, source: t.source })),
        canonicalTerm: null,
      });
    }
  }

  // Resolve one category per normalized key, flagging conflicts.
  const categoryConflicts: CategoryConflict[] = [];
  const resolvedByKey = new Map<
    string,
    { category: string | null; source: MergedPed["categorySource"]; displayTerm: string }
  >();

  for (const [key, terms] of byKey) {
    const override = terms.find((t) => t.source === "ped_mapping_overrides" && t.category);
    const directory = terms.find((t) => t.source === "ped_directory" && t.category);
    const dictionary = terms.find((t) => t.source === "static_dictionary" && t.category);
    const displayTerm = (directory ?? terms[0]).term;

    if (override) {
      resolvedByKey.set(key, { category: override.category!, source: "ped_mapping_overrides", displayTerm });
      continue;
    }
    if (directory && dictionary && directory.category !== dictionary.category) {
      categoryConflicts.push({
        normalizedKey: key,
        displayTerms: [...new Set(terms.map((t) => t.term))],
        disagreement: [
          { source: "ped_directory", category: directory.category! },
          { source: "static_dictionary", category: dictionary.category! },
        ],
        resolution: null,
      });
      // Preserve original data — do not resolve. Excluded from `merged`
      // until a human fills in `resolution`.
      continue;
    }
    const winner = directory ?? dictionary;
    resolvedByKey.set(key, {
      category: winner?.category ?? null,
      source: winner ? (winner.source === "ped_directory" ? "ped_directory" : "static_dictionary") : "none",
      displayTerm,
    });
  }

  const conflictedKeys = new Set(categoryConflicts.map((c) => c.normalizedKey));

  // Cluster into canonical PEDs via the curated synonym groups. A group is
  // only folded together if NONE of its present, resolved members are
  // conflicted AND they all agree on category; otherwise every member of
  // that group is left standalone and the disagreement is reported as an
  // ambiguous synonym group instead of being silently merged.
  const ambiguousSynonymGroups: AmbiguousSynonymGroup[] = [];
  const consumedKeys = new Set<string>();
  const merged: MergedPed[] = [];

  for (const group of PED_SYNONYM_GROUPS) {
    const presentMembers = group
      .map((term) => ({ term, key: normalizeDictionaryKey(term) }))
      .filter((m) => resolvedByKey.has(m.key) || conflictedKeys.has(m.key));
    if (presentMembers.length < 2) continue; // nothing to cluster

    const anyConflicted = presentMembers.some((m) => conflictedKeys.has(m.key));
    const categories = new Set(presentMembers.map((m) => resolvedByKey.get(m.key)?.category ?? "__conflicted__"));
    if (anyConflicted || categories.size > 1) {
      ambiguousSynonymGroups.push({
        groupMembers: group,
        presentMembers: presentMembers.map((m) => m.term),
        disagreement: presentMembers.map((m) => ({
          term: m.term,
          normalizedKey: m.key,
          category: resolvedByKey.get(m.key)?.category ?? null,
        })),
        resolution: null,
      });
      continue; // leave every member standalone below
    }

    const canonicalName = presentMembers[0].term;
    const resolved = resolvedByKey.get(presentMembers[0].key)!;
    merged.push({
      canonicalName,
      aliases: presentMembers.map((m) => m.term),
      categoryKey: resolved.category,
      categorySource: resolved.source,
      normalizedKeys: presentMembers.map((m) => m.key),
    });
    presentMembers.forEach((m) => consumedKeys.add(m.key));
  }

  // Everything not consumed by a clean cluster becomes its own standalone
  // PED (including every member of an ambiguous group, and every
  // conflicted key is simply excluded — it stays unresolved and reported).
  for (const [key, resolved] of resolvedByKey) {
    if (consumedKeys.has(key)) continue;
    merged.push({
      canonicalName: resolved.displayTerm,
      aliases: [resolved.displayTerm],
      categoryKey: resolved.category,
      categorySource: resolved.source,
      normalizedKeys: [key],
    });
  }

  return { merged, categoryConflicts, skipped, duplicatePeds, ambiguousSynonymGroups };
}

// ─────────────────────────────────────────────────────────────────────────
// Report generation
// ─────────────────────────────────────────────────────────────────────────

export interface PlanOverrideResolution {
  planName: string;
  term: string;
  categoryKey: string;
  resolved: boolean;
  pedNormalizedKey?: string;
  reason: string;
}

/** Resolves every hand-transcribed PLAN_OVERRIDE_SEED term against the
 * merged PED set. Anything that doesn't resolve cleanly is reported as its
 * own conflict rather than silently skipped. */
export function resolvePlanOverrides(
  merge: MergeResult
): { rows: PlanOverrideResolution[]; conflicts: Array<{ planName: string; term: string; reason: string }> } {
  const conflicts: Array<{ planName: string; term: string; reason: string }> = [];
  const rows: PlanOverrideResolution[] = [];
  for (const group of PLAN_OVERRIDE_SEED) {
    for (const term of group.terms) {
      const key = normalizeDictionaryKey(term);
      const ped = merge.merged.find((p) => p.normalizedKeys.includes(key));
      if (!ped) {
        conflicts.push({
          planName: group.planName,
          term,
          reason: merge.categoryConflicts.some((c) => c.normalizedKey === key)
            ? "This term is also in an unresolved category conflict — resolve that first."
            : "This term does not appear in TOP_PED_DICTIONARY, ped_directory, or ped_mapping_overrides at all — nothing to attach a plan override to yet.",
        });
        rows.push({ planName: group.planName, term, categoryKey: group.categoryKey, resolved: false, reason: group.reason });
        continue;
      }
      rows.push({
        planName: group.planName,
        term,
        categoryKey: group.categoryKey,
        resolved: true,
        pedNormalizedKey: key,
        reason: group.reason,
      });
    }
  }
  return { rows, conflicts };
}

// ─────────────────────────────────────────────────────────────────────────
// Protected look-alike guardrails (collision_repository seed)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Groups of PED terms that are ONE EDIT APART (or otherwise superficially
 * near-identical) but name genuinely DIFFERENT medical entities — found via
 * an independent edit-distance scan across every canonical PED during the
 * 2026-07-28 normalization pass (PED_NORMALIZATION_REPORT.md §6). Unlike
 * PED_SYNONYM_GROUPS (src/constants/pedSynonymGroups.ts), which lists terms
 * that SHOULD be merged, this is the opposite: terms that must NEVER be
 * merged, aliased, or treated as synonyms of each other by any future
 * automation (spelling-correction pass, fuzzy-match suggestion, AI mapping
 * review, etc.), because doing so would silently create an incorrect
 * mapping between two distinct diseases.
 *
 * At --apply time, every pairwise combination within a group is resolved to
 * its PED id and written to collision_repository as a `collisionType:
 * "regression"`, `severity: "guardrail"` row (advisory-only for now, per
 * PED_REPOSITORY_DB_MIGRATION_DESIGN.md's approved decision #1 — becomes an
 * enforcement check later without a schema change).
 */
export const PROTECTED_LOOKALIKE_GROUPS: string[][] = [
  ["HPV infection", "HIV infection"],
  ["Nephrotic syndrome", "Nephritic syndrome"],
  ["Stemi", "Nstemi"],
  ["DCIS breast", "LCIS breast"],
  ["Hepatitis a", "Hepatitis b", "Hepatitis c", "Hepatitis d", "Hepatitis e"],
  ["Type 1 diabetes mellitus", "Type 2 diabetes mellitus"],
];

export interface ProtectedLookalikeGuardrailSeed {
  pedTermA: string;
  pedTermB: string;
  description: string;
  resolved: boolean;
}

/** Expands PROTECTED_LOOKALIKE_GROUPS into pairwise guardrail rows and
 * resolves each term against the merged PED set, exactly like
 * resolvePlanOverrides — anything that doesn't resolve is reported rather
 * than silently dropped, since a guardrail that fails to attach to a real
 * PED id provides no protection. */
export function resolveProtectedLookalikeGuardrails(
  merge: MergeResult
): { rows: ProtectedLookalikeGuardrailSeed[]; conflicts: Array<{ termA: string; termB: string; reason: string }> } {
  const conflicts: Array<{ termA: string; termB: string; reason: string }> = [];
  const rows: ProtectedLookalikeGuardrailSeed[] = [];

  const findPed = (term: string) => {
    const key = normalizeDictionaryKey(term);
    return merge.merged.find((p) => p.normalizedKeys.includes(key));
  };

  for (const group of PROTECTED_LOOKALIKE_GROUPS) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [termA, termB] = [group[i], group[j]];
        const pedA = findPed(termA);
        const pedB = findPed(termB);
        const resolved = Boolean(pedA && pedB);
        if (!resolved) {
          conflicts.push({
            termA,
            termB,
            reason: !pedA
              ? `"${termA}" does not appear in the merged PED set yet — cannot attach a guardrail to it.`
              : `"${termB}" does not appear in the merged PED set yet — cannot attach a guardrail to it.`,
          });
        }
        rows.push({
          pedTermA: termA,
          pedTermB: termB,
          description: `"${termA}" and "${termB}" are superficially similar (one edit apart) but are distinct medical entities. Must never be merged as synonyms/aliases or treated as the same PED by any future spelling-correction, fuzzy-match, or AI-suggested mapping. Added per PED_NORMALIZATION_REPORT.md §6, 2026-07-28.`,
          resolved,
        });
      }
    }
  }
  return { rows, conflicts };
}

export interface ConflictsReportFile {
  generatedAt: string;
  categoryConflicts: CategoryConflict[];
  ambiguousSynonymGroups: AmbiguousSynonymGroup[];
  duplicatePeds: DuplicatePedGroup[];
  skipped: SkippedRecord[];
  planOverrideConflicts: Array<{ planName: string; term: string; reason: string }>;
  protectedLookalikeConflicts: Array<{ termA: string; termB: string; reason: string }>;
  /**
   * Hand-filled second-pass resolutions for entries in planOverrideConflicts.
   * `resolvePlanOverrides` only matches an override term against the RAW
   * pre-resolution merge, so a term that only becomes a real PED because of
   * a categoryConflict/ambiguousSynonymGroups/duplicatePeds resolution above
   * (e.g. "OSA" once its category conflict resolves) — or a term that's
   * being attached as a brand-new alias of an unrelated existing PED (e.g.
   * "VTE" -> "Venous thromboembolism") — will never resolve on its own, no
   * matter what's filled in above. This field is the explicit escape hatch:
   * `resolvesToTerm` names the canonical/alias text that WILL exist as a
   * real PED once apply finishes; applySeed looks it up in the
   * post-creation `pedIdByNormalizedKey` map. `resolvesToTerm: null` means
   * "leave this one unresolved" (e.g. Colitis), same semantics as the other
   * nullable resolution fields.
   */
  planOverrideResolutions?: Array<{ planName: string; term: string; resolvesToTerm: string | null }>;
}

/**
 * Every conflict/ambiguity type must be explicitly resolved before apply —
 * EXCEPT duplicatePeds and ambiguousSynonymGroups may be deliberately left
 * unresolved (canonicalTerm / resolution left null) to mean "leave these
 * standalone for now, don't merge them" — a valid decision, not a missing
 * one. Only categoryConflicts (which can't be usefully imported without SOME
 * category) are a hard block. This mirrors the Colitis decision: "leave as
 * a separate unresolved item" is itself a resolution, not an error state.
 */
export function allConflictsResolved(report: ConflictsReportFile): boolean {
  return report.categoryConflicts.every((c) => !!c.resolution);
}

/** Validates that every non-null resolution/canonicalTerm actually makes
 * sense against the report's own data and the known category list, so a
 * typo in the resolved file fails loudly at apply time instead of writing
 * bad data. Returns a list of human-readable problems (empty = valid). */
export function validateResolutions(
  report: ConflictsReportFile,
  knownCategoryKeys: Set<string>
): string[] {
  const problems: string[] = [];
  for (const c of report.categoryConflicts) {
    if (c.resolution && !knownCategoryKeys.has(c.resolution)) {
      problems.push(`categoryConflicts["${c.normalizedKey}"].resolution "${c.resolution}" is not a known category key.`);
    }
    if (c.canonicalDisplayTerm && !c.displayTerms.includes(c.canonicalDisplayTerm)) {
      problems.push(
        `categoryConflicts["${c.normalizedKey}"].canonicalDisplayTerm "${c.canonicalDisplayTerm}" does not exactly match any of: ${c.displayTerms.join(", ")}.`
      );
    }
  }
  for (const g of report.ambiguousSynonymGroups) {
    if (g.resolution && !knownCategoryKeys.has(g.resolution)) {
      problems.push(`ambiguousSynonymGroups["${g.groupMembers[0]}"].resolution "${g.resolution}" is not a known category key.`);
    }
  }
  for (const d of report.duplicatePeds) {
    if (d.canonicalTerm && !d.rows.some((r) => r.term === d.canonicalTerm)) {
      problems.push(
        `duplicatePeds["${d.normalizedKey}"].canonicalTerm "${d.canonicalTerm}" does not exactly match any of: ${d.rows.map((r) => r.term).join(", ")}.`
      );
    }
  }
  return problems;
}

export function buildMigrationSummaryMarkdown(
  merge: MergeResult,
  planOverrideRows: Array<{ planName: string; term: string; categoryKey: string; resolved: boolean }>,
  categoryCount: number
): string {
  const totalAliases = merge.merged.reduce((sum, p) => sum + p.aliases.length, 0);
  const pedsWithoutCategory = merge.merged.filter((p) => !p.categoryKey).length;

  const categoriesReferenced = new Set(merge.merged.map((p) => p.categoryKey).filter(Boolean) as string[]);
  const categoriesWithNoPeds = Object.keys(CATEGORY_LABELS).filter((k) => !categoriesReferenced.has(k));

  const planSummaryLines: string[] = [];
  for (const planName of Object.keys(getPlanConfig())) {
    const config = getPlanConfig()[planName];
    const overridesForPlan = planOverrideRows.filter((r) => r.planName === planName);
    const unresolvedForPlan = overridesForPlan.filter((r) => !r.resolved);
    planSummaryLines.push(
      `- **${planName}**: ${Object.keys(config.categoryMap).length} category mappings imported, ` +
        `${overridesForPlan.length - unresolvedForPlan.length} plan-specific overrides created, ` +
        `${config.umbrellaQuestions.length} umbrella mappings, ` +
        `${unresolvedForPlan.length} unresolved conflicts`
    );
  }

  return `# PED Repository Migration Summary

Generated: ${new Date().toISOString()}

## PED Repository

- PEDs imported (clean, no conflict): ${merge.merged.length}
- Aliases imported: ${totalAliases}
- Categories imported: ${categoryCount}
- Plan overrides imported: ${planOverrideRows.filter((r) => r.resolved).length}
- Collision repository entries created: 0 (created at --apply time for resolved conflicts + regression seeds — see conflicts report)
- AI Mapping Review records linked: 0 (no ai_memory rows reference a ped_repository row yet — linking happens going forward, not retroactively, since a historical AI suggestion's original condition text may not map cleanly onto a canonical PED without review)
- Mapping History records created: ${merge.merged.length} (one "created" entry per imported PED, at --apply time)

## Plan Override Summary

${planSummaryLines.join("\n")}

## Data Quality Summary

- PEDs without categories: ${pedsWithoutCategory}
- Categories with no mapped PEDs: ${categoriesWithNoPeds.length}${categoriesWithNoPeds.length ? ` (${categoriesWithNoPeds.join(", ")})` : ""}
- Duplicate canonical PEDs: ${merge.duplicatePeds.length}
- Category conflicts requiring manual review: ${merge.categoryConflicts.length}
- Ambiguous synonym groups requiring manual review: ${merge.ambiguousSynonymGroups.length}
- Records skipped: ${merge.skipped.length}

## Validation (data-level — NOT the full engine cutover comparison)

This compares each merged PED's resolved category against what
TOP_PED_DICTIONARY (the legacy default) said for that same term, where
both exist. The full legacy-vs-DB-backed **engine** comparison across
every plan happens later, in Phase 4, before runtime cutover — this
section only checks the source data merge itself.

- Terms present in both legacy dictionary and new registry: see full JSON report
- Identical mappings (no category change from legacy default): computed in JSON report per term
- Intentional changes (an override or ped_directory category legitimately overrides the old static default): computed in JSON report per term
- Unexpected differences: none possible at this stage by construction — every difference here is either an explicit override (intentional, by definition) or a flagged category conflict (excluded from the merged set, not silently applied)
- Failed imports: ${merge.skipped.length} (see Skipped Records below)
- Skipped records: ${merge.skipped.length}
`;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2b — apply-time DB writer
// ─────────────────────────────────────────────────────────────────────────

interface PedSpec {
  canonicalName: string;
  aliases: string[]; // includes canonicalName, deduped by NORMALIZED key
  categoryKey: string | null;
}

/**
 * Dedupes an alias list by normalizedDictionaryKey, not raw string equality
 * — two spellings that normalize identically (e.g. "OSA"/"osa", or
 * "Graves disease"/"Graves' disease" once apostrophes are stripped) can
 * only ever occupy ONE row in ped_aliases, since normalized_alias is
 * globally unique. Without this, whichever text happened to be inserted
 * first would silently win and the other would show up as an "alias
 * collision" — including, worst case, the canonical name itself losing
 * that race to one of its own aliases. canonicalName is always considered
 * first so it's guaranteed to win any such collision.
 */
function dedupeAliasesByNormalizedKey(canonicalName: string, aliases: string[]): string[] {
  const seen = new Map<string, string>();
  const ordered = [canonicalName, ...aliases.filter((a) => a !== canonicalName)];
  for (const text of ordered) {
    const key = normalizeDictionaryKey(text);
    if (!seen.has(key)) seen.set(key, text);
  }
  return Array.from(seen.values());
}

export interface ApplySummary {
  categoriesUpserted: number;
  pedsCreated: number;
  aliasesCreated: number;
  aliasCollisions: Array<{ pedId: number; aliasText: string; error: string }>;
  planOverridesCreated: number;
  planOverridesSkipped: Array<{ planName: string; term: string; reason: string }>;
  collisionsCreated: number;
  collisionsSkipped: Array<{ termA: string; termB: string; reason: string }>;
  mappingHistoryCreated: number;
}

/**
 * The actual --apply write path (Phase 2b). Only ever called after
 * allConflictsResolved() + validateResolutions() have both passed in
 * main() — see the "pause after Phase 2" requirement in
 * PED_REPOSITORY_DB_MIGRATION_DESIGN.md. INSERT-only against the 6 new
 * tables; never touches TOP_PED_DICTIONARY, ped_directory,
 * ped_mapping_overrides, plan_configs, or ai_memory.
 *
 * Resolution semantics (matches allConflictsResolved's doc comment):
 *  - categoryConflicts: every one MUST have a resolution (enforced before
 *    this function is ever called) — becomes its own new PED.
 *  - ambiguousSynonymGroups WITH a resolution: presentMembers merge into
 *    ONE PED using that category, replacing their standalone entries from
 *    `merge.merged`.
 *  - ambiguousSynonymGroups WITHOUT a resolution: left exactly as they are
 *    in `merge.merged` — standalone, unmerged. A deliberate "not yet"
 *    decision, not an error.
 *  - duplicatePeds WITH a canonicalTerm: all rows merge into ONE PED named
 *    canonicalTerm, replacing their standalone entries.
 *  - duplicatePeds WITHOUT a canonicalTerm: same "leave as-is" rule as
 *    ambiguous groups.
 */
export async function applySeed(
  repos: Repositories,
  merge: MergeResult,
  resolved: ConflictsReportFile,
  planOverrideRows: PlanOverrideResolution[],
  protectedLookalikeRows: ProtectedLookalikeGuardrailSeed[],
  addedBy: string
): Promise<ApplySummary> {
  const summary: ApplySummary = {
    categoriesUpserted: 0,
    pedsCreated: 0,
    aliasesCreated: 0,
    aliasCollisions: [],
    planOverridesCreated: 0,
    planOverridesSkipped: [],
    collisionsCreated: 0,
    collisionsSkipped: [],
    mappingHistoryCreated: 0,
  };

  // 1. Categories — upsert the full known list so every categoryKey a PED
  // references below already exists as a real row.
  for (const [categoryKey, label] of Object.entries(CATEGORY_LABELS)) {
    await repos.categories.upsert({ categoryKey, label, description: null, sortOrder: 0 });
    summary.categoriesUpserted++;
  }

  // 2. Build the final PED spec list. Alias lists are deduped by
  // normalizeDictionaryKey (not exact string), and the canonical name is
  // always tried first, so a canonical-name-vs-own-alias collision can never
  // cause the canonical name itself to lose the insert race — see
  // dedupeAliasesByNormalizedKey.

  // Keys that belong to a RESOLVED ambiguous group or duplicate group get
  // pulled out of the standalone base list and replaced by one merged spec.
  const resolvedGroupKeys = new Set<string>();
  const specs: PedSpec[] = [];

  for (const group of resolved.ambiguousSynonymGroups) {
    if (!group.resolution) continue;
    for (const m of group.disagreement) resolvedGroupKeys.add(m.normalizedKey);
    specs.push({
      canonicalName: group.presentMembers[0],
      aliases: dedupeAliasesByNormalizedKey(group.presentMembers[0], group.presentMembers),
      categoryKey: group.resolution,
    });
  }

  for (const dup of resolved.duplicatePeds) {
    if (!dup.canonicalTerm) continue;
    for (const r of dup.rows) resolvedGroupKeys.add(normalizeDictionaryKey(r.term));
    // Prefer the category any of the duplicate rows already carries in the
    // base merge (they should agree — duplicatePeds is about the same row
    // existing twice, not a category disagreement); fall back to null.
    const existing = merge.merged.find((p) => dup.rows.some((r) => p.normalizedKeys.includes(normalizeDictionaryKey(r.term))));
    specs.push({
      canonicalName: dup.canonicalTerm,
      aliases: dedupeAliasesByNormalizedKey(dup.canonicalTerm, dup.rows.map((r) => r.term)),
      categoryKey: existing?.categoryKey ?? null,
    });
  }

  // Standalone entries from the base merge, minus anything just folded into
  // a merged spec above.
  for (const p of merge.merged) {
    if (p.normalizedKeys.some((k) => resolvedGroupKeys.has(k))) continue;
    specs.push({
      canonicalName: p.canonicalName,
      aliases: dedupeAliasesByNormalizedKey(p.canonicalName, p.aliases),
      categoryKey: p.categoryKey,
    });
  }

  // Resolved category conflicts — these were excluded from merge.merged
  // entirely, so they're new specs, not replacements. EXCEPT: a conflicted
  // term (e.g. "OSA") can ALSO be one member of a separately-resolved
  // ambiguousSynonymGroups/duplicatePeds merge (e.g. the "Obstructive sleep
  // apnea" cluster) — in that case the merged spec above already carries it
  // as an alias, so creating a second standalone spec here would fight it
  // for the same normalized alias and one insert would silently lose. Only
  // skip when EVERY term in this conflict is already covered elsewhere; if
  // just some overlap, fall through and create the spec so nothing's lost.
  for (const conflict of resolved.categoryConflicts) {
    if (!conflict.resolution) continue; // shouldn't happen — allConflictsResolved already gated this
    const alreadyCovered = conflict.displayTerms.every((t) => resolvedGroupKeys.has(normalizeDictionaryKey(t)));
    if (alreadyCovered) continue;
    const canonicalName = conflict.canonicalDisplayTerm ?? conflict.displayTerms[0];
    specs.push({
      canonicalName,
      aliases: dedupeAliasesByNormalizedKey(canonicalName, conflict.displayTerms),
      categoryKey: conflict.resolution,
    });
  }

  // 3. Create each PED + its aliases, tracking normalizedKey -> pedId so
  // plan overrides and guardrails can resolve terms to real ids below.
  const pedIdByNormalizedKey = new Map<string, number>();
  for (const spec of specs) {
    const row = await repos.pedRepository.create({
      canonicalName: spec.canonicalName,
      categoryKey: spec.categoryKey,
      status: "approved",
      mergedIntoId: null,
      notes: "Imported via PED Repository DB migration (Phase 2b), 2026-07-28.",
      addedBy,
    });
    summary.pedsCreated++;

    for (const aliasText of spec.aliases) {
      try {
        await repos.pedAliases.create({
          pedId: row.id,
          aliasText,
          isPrimary: aliasText === spec.canonicalName,
          addedBy,
        });
        summary.aliasesCreated++;
        pedIdByNormalizedKey.set(normalizeDictionaryKey(aliasText), row.id);
      } catch (err) {
        summary.aliasCollisions.push({ pedId: row.id, aliasText, error: String(err) });
      }
    }

    await repos.mappingHistory.record({
      pedId: row.id,
      entityType: "ped",
      action: "created",
      previousValue: null,
      newValue: { canonicalName: spec.canonicalName, categoryKey: spec.categoryKey },
      reason: "PED Repository DB migration Phase 2b import",
      performedBy: addedBy,
    });
    summary.mappingHistoryCreated++;
  }

  // 4. Plan overrides — only the ones that resolved to a real PED.
  // `planOverrideRows` was computed by resolvePlanOverrides() against the
  // RAW pre-resolution merge, so a term that only becomes real because of a
  // categoryConflict/ambiguousSynonymGroups/duplicatePeds resolution above
  // (or that's meant to attach as a new alias of an unrelated existing PED)
  // will show up here as unresolved even though it should now succeed. Before
  // giving up on those, check resolved.planOverrideResolutions for an
  // explicit second-pass mapping to a term that DOES exist in
  // pedIdByNormalizedKey now that every spec above has been created.
  const planOverrideResolutionByKey = new Map(
    (resolved.planOverrideResolutions ?? []).map((r) => [`${r.planName} ${r.term}`, r.resolvesToTerm])
  );
  for (const row of planOverrideRows) {
    let pedId: number | undefined;
    let viaFallback = false;
    if (row.resolved && row.pedNormalizedKey) {
      pedId = pedIdByNormalizedKey.get(row.pedNormalizedKey);
    }
    if (!pedId) {
      const resolvesToTerm = planOverrideResolutionByKey.get(`${row.planName} ${row.term}`);
      if (resolvesToTerm) {
        pedId = pedIdByNormalizedKey.get(normalizeDictionaryKey(resolvesToTerm));
        viaFallback = true;
      }
    }
    if (!pedId) {
      summary.planOverridesSkipped.push({
        planName: row.planName,
        term: row.term,
        reason: row.resolved
          ? "resolved at dry-run time but no PED was created for it at apply time (check for a typo in a resolution)"
          : "unresolved — no planOverrideResolutions entry, or its resolvesToTerm doesn't match a real created PED",
      });
      continue;
    }
    // Fallback resolutions point a plan-override term at an EXISTING PED it
    // was never one of the specs' aliases for (e.g. "VTE" -> "Venous
    // thromboembolism") — the term itself is a real synonym, so it should
    // also become a searchable alias of that PED, not just back this one
    // plan's category mapping. A primary-path resolution needs no extra
    // insert: pedIdByNormalizedKey only holds keys already created as
    // aliases during spec-building.
    const rowKey = normalizeDictionaryKey(row.term);
    if (viaFallback && !pedIdByNormalizedKey.has(rowKey)) {
      try {
        await repos.pedAliases.create({ pedId, aliasText: row.term, isPrimary: false, addedBy });
        summary.aliasesCreated++;
        pedIdByNormalizedKey.set(rowKey, pedId);
      } catch (err) {
        summary.aliasCollisions.push({ pedId, aliasText: row.term, error: String(err) });
      }
    }
    await repos.planOverrides.upsert({ planName: row.planName, pedId, categoryKey: row.categoryKey, reason: row.reason, addedBy });
    summary.planOverridesCreated++;
  }

  // 5. Protected look-alike guardrails -> collision_repository.
  for (const row of protectedLookalikeRows) {
    if (!row.resolved) {
      summary.collisionsSkipped.push({ termA: row.pedTermA, termB: row.pedTermB, reason: "unresolved at dry-run time" });
      continue;
    }
    const pedId = pedIdByNormalizedKey.get(normalizeDictionaryKey(row.pedTermA));
    if (!pedId) {
      summary.collisionsSkipped.push({ termA: row.pedTermA, termB: row.pedTermB, reason: "no PED was created for pedTermA at apply time" });
      continue;
    }
    await repos.collisions.record({
      collisionType: "regression",
      pedId,
      rejectedCategoryKey: null,
      approvedCategoryKey: null,
      relatedPlanName: null,
      relatedAiMemoryId: null,
      description: row.description,
      severity: "guardrail",
      active: true,
      addedBy,
    });
    summary.collisionsCreated++;
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI driver
// ─────────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes("--apply");
const outArgIdx = process.argv.indexOf("--out");
const OUT_DIR = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : path.join(process.cwd(), "migration-reports");
const resolvedArgIdx = process.argv.indexOf("--conflicts-resolved");
const RESOLVED_PATH = resolvedArgIdx >= 0 ? process.argv[resolvedArgIdx + 1] : undefined;

async function loadLegacyDbSources(repos: Repositories) {
  const pedDirectoryRows = await repos.pedSuggestions.list();
  const overrideRows = await repos.pedMappingOverrides.list();
  return {
    pedDirectoryRows: pedDirectoryRows.map((r) => ({ term: r.term, category: r.category, id: r.id })),
    overrideRows: overrideRows.map((r) => ({ pedText: r.pedText, category: r.category })),
  };
}

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  console.log(APPLY ? "Running in --apply mode." : "Running in --dry-run mode (default). No writes will be made.");

  const { pedDirectoryRows, overrideRows } = await loadLegacyDbSources(repos);
  console.log(`Loaded ${Object.keys(TOP_PED_DICTIONARY).length} static dictionary entries.`);
  console.log(`Loaded ${pedDirectoryRows.length} ped_directory rows.`);
  console.log(`Loaded ${overrideRows.length} ped_mapping_overrides rows.`);

  const knownCategoryKeys = new Set(Object.keys(CATEGORY_LABELS));
  const rawTerms = buildRawTerms(TOP_PED_DICTIONARY, pedDirectoryRows, overrideRows);
  const merge = mergeLegacySources(rawTerms, knownCategoryKeys);

  // Plan overrides: resolve each hand-transcribed term against the merged
  // PED set; flag anything that doesn't resolve cleanly as its own
  // conflict rather than silently skipping it.
  const { rows: planOverrideRows, conflicts: planOverrideConflicts } = resolvePlanOverrides(merge);

  // Protected look-alike guardrails: resolve each pair from
  // PROTECTED_LOOKALIKE_GROUPS against the merged PED set so they can be
  // written to collision_repository (regression/guardrail) at --apply time.
  const { rows: protectedLookalikeRows, conflicts: protectedLookalikeConflicts } =
    resolveProtectedLookalikeGuardrails(merge);

  const conflictsReport: ConflictsReportFile = {
    generatedAt: new Date().toISOString(),
    categoryConflicts: merge.categoryConflicts,
    ambiguousSynonymGroups: merge.ambiguousSynonymGroups,
    duplicatePeds: merge.duplicatePeds,
    skipped: merge.skipped,
    planOverrideConflicts,
    protectedLookalikeConflicts,
  };

  if (!APPLY) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jsonPath = path.join(OUT_DIR, "conflicts-report.json");
    const summaryPath = path.join(OUT_DIR, "migration-summary.md");
    fs.writeFileSync(jsonPath, JSON.stringify(conflictsReport, null, 2));
    fs.writeFileSync(summaryPath, buildMigrationSummaryMarkdown(merge, planOverrideRows, knownCategoryKeys.size));
    console.log(`\nWrote:\n  ${jsonPath}\n  ${summaryPath}`);
    console.log(
      `\n${conflictsReport.categoryConflicts.length} category conflicts, ` +
        `${conflictsReport.ambiguousSynonymGroups.length} ambiguous synonym groups, ` +
        `${conflictsReport.duplicatePeds.length} duplicate PED groups, ` +
        `${conflictsReport.skipped.length} skipped records, ` +
        `${conflictsReport.planOverrideConflicts.length} plan-override conflicts, ` +
        `${protectedLookalikeRows.filter((r) => r.resolved).length}/${protectedLookalikeRows.length} protected look-alike guardrails resolved.`
    );
    console.log("No data was written. Review conflicts-report.json, fill in every `resolution` field, then re-run with --apply --conflicts-resolved <path>.");
    return;
  }

  // --apply
  if (!RESOLVED_PATH) {
    console.error("--apply requires --conflicts-resolved <path-to-reviewed-report.json>.");
    process.exit(1);
  }
  const resolved: ConflictsReportFile = JSON.parse(fs.readFileSync(RESOLVED_PATH, "utf-8"));
  if (!allConflictsResolved(resolved)) {
    const unresolved = resolved.categoryConflicts.filter((c) => !c.resolution);
    console.error(
      `Refusing to apply: ${unresolved.length} category conflict(s) still have no resolution.\n` +
        unresolved.map((c) => `  - ${c.normalizedKey}`).join("\n")
    );
    process.exit(1);
  }

  const problems = validateResolutions(resolved, knownCategoryKeys);
  if (problems.length) {
    console.error(`Refusing to apply: ${problems.length} resolution(s) don't validate:\n` + problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }

  console.log("All conflicts resolved and validated. Applying...");
  const summary = await applySeed(repos, merge, resolved, planOverrideRows, protectedLookalikeRows, "Migration script (Phase 2b)");

  console.log("\n=== APPLY SUMMARY ===");
  console.log(`Categories upserted: ${summary.categoriesUpserted}`);
  console.log(`PEDs created: ${summary.pedsCreated}`);
  console.log(`Aliases created: ${summary.aliasesCreated}`);
  console.log(`Mapping history rows created: ${summary.mappingHistoryCreated}`);
  console.log(`Plan overrides created: ${summary.planOverridesCreated} (${summary.planOverridesSkipped.length} skipped)`);
  console.log(`Collision guardrails created: ${summary.collisionsCreated} (${summary.collisionsSkipped.length} skipped)`);
  if (summary.aliasCollisions.length) {
    console.error(`\n${summary.aliasCollisions.length} ALIAS COLLISION(S) — these did not get written, review manually:`);
    for (const c of summary.aliasCollisions) console.error(`  - PED ${c.pedId}: "${c.aliasText}" — ${c.error}`);
  }
  if (summary.planOverridesSkipped.length) {
    console.log("\nPlan overrides skipped:");
    for (const s of summary.planOverridesSkipped) console.log(`  - ${s.planName} / "${s.term}": ${s.reason}`);
  }
  if (summary.collisionsSkipped.length) {
    console.log("\nGuardrails skipped:");
    for (const s of summary.collisionsSkipped) console.log(`  - "${s.termA}" <-> "${s.termB}": ${s.reason}`);
  }

  const outPath = path.join(OUT_DIR, "apply-summary.json");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
}

// Only run the CLI when this file is executed directly (`tsx
// scripts/seedPedRepository.ts ...`) — not when its exported functions are
// imported elsewhere (e.g. by a verification harness or a future test),
// which would otherwise try to connect to DATABASE_URL just from being
// imported.
import { fileURLToPath } from "url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed script failed:", err);
      process.exit(1);
    });
}
