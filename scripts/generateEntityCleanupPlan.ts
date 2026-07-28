/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY GOVERNANCE — action-phrase & misspelling cleanup PLAN
 * generator (Checkpoint B follow-up, 2026-07-28).
 *
 * Strictly read-only — writes a review file, never touches the database.
 * Mirrors the Phase 2 seed script's dry-run / conflicts-report pattern:
 * generate a plan, get human sign-off, THEN a separate apply step
 * (scripts/applyEntityCleanupPlan.ts) executes it.
 *
 * WHY THIS ISN'T A SIMPLE "STRIP THE SUFFIX AND RENAME" SCRIPT
 * Several of the 28 action-phrase hits and 26 misspelling hits collide with
 * an ALREADY-EXISTING, separately-seeded PED for the same underlying
 * concept — e.g. TOP_PED_DICTIONARY has always had *both* "nephrectomy" and
 * "nephrectomy history" as distinct dictionary keys, both mapped to
 * "kidney", so Phase 2's seed created them as two separate ped_repository
 * rows for what is clinically one condition. Blindly renaming
 * "Nephrectomy history" -> "Nephrectomy" would either collide with the
 * ped_aliases.normalized_alias UNIQUE constraint (if a "Nephrectomy" alias
 * already exists on the other PED) or silently create a second PED with the
 * same display name. Every candidate below is checked against the live
 * repository for this before a treatment is proposed — a "merge_into" plan
 * item means "fold this PED's aliases into the pre-existing one and mark it
 * merged", not a plain rename.
 *
 * WHAT THIS SCRIPT DOES
 *   1. Re-runs the rule 1 (action-verb/status suffix) and rule 2 (curated
 *      misspelling) audits from applyGovernanceRules.ts, with 2 refinements
 *      agreed 2026-07-28:
 *        - "Status epilepticus" / "Status asthmaticus" excluded — "status"
 *          there is the clinical Latin term itself, not an action suffix.
 *        - PED-000037 (Cystoscopy) excluded — already fixed and documented
 *          as an approved bug fix in governance-rules-report.json.
 *   2. For each action-phrase PED, looks up a curated target canonical name
 *      (ACTION_PHRASE_TARGETS below — a one-off human judgment call per
 *      term, not a generic regex strip, precisely because generic stripping
 *      is what causes the collisions described above).
 *   3. For each misspelling PED/alias, looks up the curated correct
 *      spelling (MISSPELLING_TARGETS below).
 *   4. Checks the live repository for a collision: does the target name
 *      already exist as another PED's canonical name or alias? If yes,
 *      proposes "merge_into" (with the existing PED's id/code); if no,
 *      proposes "rename" (action-phrase entries) or "correct_spelling"
 *      (misspelling entries) in place.
 *   5. Flags anything it can't confidently classify as "needs_review"
 *      rather than guessing — e.g. "nil medical history" isn't really an
 *      entity-plus-action-suffix at all, it's already a status phrase in
 *      the same spirit as the existing "None"/"Not applicable"/"healthy
 *      normal" dictionary entries, so a blind "strip 'history'" would leave
 *      the meaningless "nil medical" as a canonical name.
 *
 * USAGE
 *   npx tsx scripts/generateEntityCleanupPlan.ts [--out <dir>]
 *
 * Writes <out>/entity-cleanup-plan.json (machine-readable, feed this into
 * scripts/applyEntityCleanupPlan.ts once reviewed) and
 * <out>/entity-cleanup-plan.md (human-readable summary).
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { normalizeDictionaryKey } from "../src/engine.js";

dotenv.config();

const outDir = (() => {
  const idx = process.argv.indexOf("--out");
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : path.join(process.cwd(), "migration-reports");
})();

const ACTION_SUFFIX_RE = /\b(done|undergone|underwent|taken|received|performed|advised|patient|status)\b|\bhistory\b/i;
const AUDIT_FALSE_POSITIVES = new Set(["status epilepticus", "status asthmaticus"].map(normalizeDictionaryKey));
const ALREADY_FIXED_PED_CODES = new Set(["PED-000037"]); // Cystoscopy — handled in applyGovernanceRules.ts

const KNOWN_MISSPELLINGS = new Set(
  [
    "cholestrerol", "hyperlipidimia", "hyperlipidmia", "dyslipidimia", "dyslipidmia",
    "apendicitis", "foos poisoning", "weils disease", "pilodinal sinus", "thalaseemia",
    "headcahe", "infertillity", "hemmoroids", "tonsilitis", "gullian barre syndrome",
    "abscence seizure", "hipertension", "hypetension", "diabtes", "dialisis",
    "gynocomastia", "gyneacomastia", "tymnoplasty",
  ].map(normalizeDictionaryKey)
);

// Curated target canonical name for each action-phrase PED. Deliberately
// per-PED, not a generic strip — see file header for why. "null" means
// "don't propose an automatic target — flag for human review instead".
const ACTION_PHRASE_TARGETS: Record<string, string | null> = {
  "c section history": "C-section",
  "childbirth history": "Childbirth",
  "dialysis patient": "Dialysis",
  "dka history": "DKA",
  "hysterectomy history": "Hysterectomy",
  "menopause status": "Menopause",
  "mi history": "MI",
  "nephrectomy history": "Nephrectomy",
  "nil medical history": null, // not really entity+suffix — see header
  "vaccination done": "Vaccination",
  "smoker status": "Smoker",
  "renal transplant history": "Renal transplant",
};

// Curated correct spelling for each misspelling. "null" means "this is a
// clinical-synonym question, not a pure spelling fix, needs human input"
// (e.g. "Weils disease" is a colloquial name for severe leptospirosis —
// fixing the apostrophe is easy, but whether it should instead be merged
// into an existing "Leptospirosis" PED is a medical-synonym call, not a
// spelling call).
const MISSPELLING_TARGETS: Record<string, string | null> = {
  "gullian barre syndrome": "Guillain-Barre syndrome",
  "headcahe": "Headache",
  "hemmoroids": "Hemorrhoids",
  "pilodinal sinus": "Pilonidal sinus",
  "thalaseemia": "Thalassemia",
  "tymnoplasty": "Tympanoplasty",
  "weils disease": null,
  "abscence seizure": "Absence seizure",
  "apendicitis": "Appendicitis",
  "foos poisoning": "Food poisoning",
  "gynocomastia": "Gynecomastia",
  "gyneacomastia": "Gynecomastia",
  "cholestrerol": "High cholesterol",
  "hyperlipidimia": "High cholesterol",
  "hyperlipidmia": "High cholesterol",
  "dyslipidimia": "High cholesterol",
  "dyslipidmia": "High cholesterol",
  "infertillity": "Infertility",
  "tonsilitis": "Tonsillitis",
};

interface PlanItem {
  pedId: number;
  pedCode: string;
  currentCanonicalName: string;
  hitText: string;
  hitField: "canonicalName" | "alias";
  proposedTarget: string | null;
  treatment: "rename" | "merge_into" | "hide_alias_only" | "needs_review";
  mergeIntoPedId?: number;
  mergeIntoPedCode?: string;
  mergeIntoCanonicalName?: string;
  // A genuine clinically-accepted synonym (e.g. "Weil's disease" for
  // Leptospirosis) to create/keep VISIBLE on the target PED — distinct from
  // `hitText`, which is always hidden (it's either an action phrase or the
  // misspelled form). Used by both "rename" and "merge_into" treatments.
  additionalVisibleAliasText?: string;
  note: string;
}

async function main() {
  const db = getDb();
  const repos = createRepositories(db);
  const [peds, aliases] = await Promise.all([repos.pedRepository.list(), repos.pedAliases.listAll()]);
  const pedById = new Map(peds.map((p) => [p.id, p]));

  // Live collision index: normalized text -> owning pedId, for every
  // canonical name AND every alias currently in the repository.
  const ownerByNormalizedText = new Map<string, number>();
  for (const p of peds) ownerByNormalizedText.set(normalizeDictionaryKey(p.canonicalName), p.id);
  for (const a of aliases) if (!ownerByNormalizedText.has(a.normalizedAlias)) ownerByNormalizedText.set(a.normalizedAlias, a.pedId);

  function findCollision(targetName: string, ownPedId: number): { pedId: number; pedCode: string; canonicalName: string } | null {
    const ownerId = ownerByNormalizedText.get(normalizeDictionaryKey(targetName));
    if (ownerId === undefined || ownerId === ownPedId) return null;
    const owner = pedById.get(ownerId);
    if (!owner) return null;
    return { pedId: owner.id, pedCode: owner.pedCode, canonicalName: owner.canonicalName };
  }

  // ── Action-phrase plan ───────────────────────────────────────────────
  const actionPlan: PlanItem[] = [];
  const seenActionPeds = new Set<number>();
  for (const p of peds) {
    if (ALREADY_FIXED_PED_CODES.has(p.pedCode)) continue;
    if (!ACTION_SUFFIX_RE.test(p.canonicalName)) continue;
    if (AUDIT_FALSE_POSITIVES.has(normalizeDictionaryKey(p.canonicalName))) continue;
    if (seenActionPeds.has(p.id)) continue;
    seenActionPeds.add(p.id);

    const key = normalizeDictionaryKey(p.canonicalName);
    const target = key in ACTION_PHRASE_TARGETS ? ACTION_PHRASE_TARGETS[key] : undefined;

    if (target === undefined) {
      actionPlan.push({
        pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
        proposedTarget: null, treatment: "needs_review",
        note: "No curated target for this term yet — add one to ACTION_PHRASE_TARGETS in this script and re-run.",
      });
      continue;
    }
    if (key === "nil medical history") {
      // Decided 2026-07-28: not a medical entity — a declaration status
      // value. Retire it from the repository by merging into whichever
      // existing "None / Not Applicable / No Pre-Existing Disease"
      // natural_life_stage PED the app already uses for this bucket
      // (checkNaturalLifeStages in engine.ts), rather than inventing a new
      // canonical PED. Priority order favors the most literal match first.
      const retirementCandidates = ["No Pre-Existing Disease", "Not Applicable", "None"];
      let target2: { pedId: number; pedCode: string; canonicalName: string } | null = null;
      for (const candidate of retirementCandidates) {
        const ownerId = ownerByNormalizedText.get(normalizeDictionaryKey(candidate));
        if (ownerId !== undefined && ownerId !== p.id) {
          const owner = pedById.get(ownerId);
          if (owner) { target2 = { pedId: owner.id, pedCode: owner.pedCode, canonicalName: owner.canonicalName }; break; }
        }
      }
      if (target2) {
        actionPlan.push({
          pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
          proposedTarget: target2.canonicalName, treatment: "merge_into",
          mergeIntoPedId: target2.pedId, mergeIntoPedCode: target2.pedCode, mergeIntoCanonicalName: target2.canonicalName,
          note: `Retired per governance decision (2026-07-28): "Nil medical history" is a declaration status, not a medical entity. Merged into ${target2.pedCode} ("${target2.canonicalName}") — the app's existing no-pre-existing-disease flow — as a hidden search-only phrase, not a canonical PED.`,
        });
      } else {
        actionPlan.push({
          pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
          proposedTarget: null, treatment: "needs_review",
          note: "Governance decision: retire this from the repository (not a medical entity). Could not find a live 'None'/'Not Applicable'/'No Pre-Existing Disease' PED to merge into — one of those needs to exist first, or this script's retirementCandidates list needs the actual term used in this repository.",
        });
      }
      continue;
    }
    if (target === null) {
      actionPlan.push({
        pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
        proposedTarget: null, treatment: "needs_review",
        note: "Flagged as a status/idiomatic phrase, not a disease-entity-plus-action-suffix — stripping the suffix would leave a meaningless name. Needs a human decision on whether this belongs in the repository at all, and if so, under what name.",
      });
      continue;
    }
    const collision = findCollision(target, p.id);
    if (collision) {
      actionPlan.push({
        pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
        proposedTarget: target, treatment: "merge_into",
        mergeIntoPedId: collision.pedId, mergeIntoPedCode: collision.pedCode, mergeIntoCanonicalName: collision.canonicalName,
        note: `"${target}" already exists as ${collision.pedCode} ("${collision.canonicalName}"). Proposal: fold this PED's aliases into that one (as hidden normalization aliases where they're action-phrase text), mark this PED merged_into_id, never leave two PEDs for the same concept.`,
      });
    } else {
      actionPlan.push({
        pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
        proposedTarget: target, treatment: "rename",
        note: `No collision found. Proposal: rename canonical_name to "${target}"; keep "${p.canonicalName}" as a hidden (isVisible=false) normalization alias.`,
      });
    }
  }

  // ── Misspelling plan ─────────────────────────────────────────────────
  const misspellingPlan: PlanItem[] = [];
  for (const p of peds) {
    const key = normalizeDictionaryKey(p.canonicalName);
    if (!KNOWN_MISSPELLINGS.has(key)) continue;
    const target = key in MISSPELLING_TARGETS ? MISSPELLING_TARGETS[key] : undefined;
    if (key === "weils disease") {
      // Decided 2026-07-28: "Weil's disease" is a clinically accepted
      // synonym for severe leptospirosis, not a different disease — merge
      // into an existing "Leptospirosis" PED if one exists (creating
      // Leptospirosis as the canonical name via a plain rename if it
      // doesn't). Either way, "Weil's disease" (correctly apostrophized) is
      // kept as a VISIBLE alias — a real synonym, not a misspelling to hide.
      // Only the actual misspelled/unapostrophized hit text is hidden.
      const leptoOwnerId = ownerByNormalizedText.get(normalizeDictionaryKey("Leptospirosis"));
      const leptoOwner = leptoOwnerId !== undefined && leptoOwnerId !== p.id ? pedById.get(leptoOwnerId) : undefined;
      if (leptoOwner) {
        misspellingPlan.push({
          pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
          proposedTarget: "Leptospirosis", treatment: "merge_into",
          mergeIntoPedId: leptoOwner.id, mergeIntoPedCode: leptoOwner.pedCode, mergeIntoCanonicalName: leptoOwner.canonicalName,
          additionalVisibleAliasText: "Weil's disease",
          note: `"Leptospirosis" already exists as ${leptoOwner.pedCode}. Merging per governance decision (2026-07-28): "${p.canonicalName}" hidden, "Weil's disease" added as a visible clinical synonym on ${leptoOwner.pedCode}.`,
        });
      } else {
        misspellingPlan.push({
          pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
          proposedTarget: "Leptospirosis", treatment: "rename",
          additionalVisibleAliasText: "Weil's disease",
          note: `No existing "Leptospirosis" PED found — this PED becomes it. Per governance decision (2026-07-28): canonical_name -> "Leptospirosis"; "${p.canonicalName}" hidden; "Weil's disease" added as a visible clinical synonym.`,
        });
      }
      continue;
    }
    if (!target) {
      misspellingPlan.push({
        pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
        proposedTarget: null, treatment: "needs_review",
        note: "No curated correct spelling yet — add one to MISSPELLING_TARGETS in this script and re-run.",
      });
      continue;
    }
    const collision = findCollision(target, p.id);
    if (collision) {
      misspellingPlan.push({
        pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
        proposedTarget: target, treatment: "merge_into",
        mergeIntoPedId: collision.pedId, mergeIntoPedCode: collision.pedCode, mergeIntoCanonicalName: collision.canonicalName,
        note: `Correctly-spelled "${target}" already exists as ${collision.pedCode}. Proposal: fold this PED's aliases into that one as hidden normalization aliases, mark this PED merged_into_id.`,
      });
    } else {
      misspellingPlan.push({
        pedId: p.id, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: p.canonicalName, hitField: "canonicalName",
        proposedTarget: target, treatment: "rename",
        note: `No collision found. Proposal: rename canonical_name to "${target}"; keep "${p.canonicalName}" as a hidden (isVisible=false) normalization alias.`,
      });
    }
  }
  for (const a of aliases) {
    if (!KNOWN_MISSPELLINGS.has(normalizeDictionaryKey(a.aliasText))) continue;
    const p = pedById.get(a.pedId);
    if (!p) continue;
    if (normalizeDictionaryKey(a.aliasText) === normalizeDictionaryKey(p.canonicalName)) continue; // already covered above as a canonical-name hit
    if (!a.isVisible) continue; // already hidden, nothing to do
    misspellingPlan.push({
      pedId: a.pedId, pedCode: p.pedCode, currentCanonicalName: p.canonicalName, hitText: a.aliasText, hitField: "alias",
      proposedTarget: null, treatment: "hide_alias_only",
      note: `Already an alias of the correctly-named ${p.pedCode} ("${p.canonicalName}") — no rename needed, just set isVisible=false so it stops appearing in dropdowns/search suggestions while still matching search.`,
    });
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    actionPhraseCleanup: {
      totalItems: actionPlan.length,
      byTreatment: countByTreatment(actionPlan),
      items: actionPlan,
    },
    misspellingCleanup: {
      totalItems: misspellingPlan.length,
      byTreatment: countByTreatment(misspellingPlan),
      items: misspellingPlan,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entity-cleanup-plan.json"), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(outDir, "entity-cleanup-plan.md"), renderMarkdown(plan));

  console.log(`Action-phrase plan: ${actionPlan.length} items — ${JSON.stringify(countByTreatment(actionPlan))}`);
  console.log(`Misspelling plan: ${misspellingPlan.length} items — ${JSON.stringify(countByTreatment(misspellingPlan))}`);
  console.log(`Written to ${path.join(outDir, "entity-cleanup-plan.json")} and .md`);

  await closeDb();
}

function countByTreatment(items: PlanItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.treatment] = (counts[i.treatment] ?? 0) + 1;
  return counts;
}

function renderMarkdown(plan: {
  actionPhraseCleanup: { totalItems: number; byTreatment: Record<string, number>; items: PlanItem[] };
  misspellingCleanup: { totalItems: number; byTreatment: Record<string, number>; items: PlanItem[] };
}): string {
  const section = (title: string, data: { totalItems: number; byTreatment: Record<string, number>; items: PlanItem[] }) => {
    const lines = [`## ${title}`, "", `${data.totalItems} items — ${JSON.stringify(data.byTreatment)}`, ""];
    for (const item of data.items) {
      lines.push(`### ${item.pedCode} — "${item.currentCanonicalName}"`);
      lines.push(`- hit: "${item.hitText}" (${item.hitField})`);
      lines.push(`- treatment: **${item.treatment}**${item.proposedTarget ? ` -> "${item.proposedTarget}"` : ""}`);
      if (item.mergeIntoPedCode) lines.push(`- merge target: ${item.mergeIntoPedCode} ("${item.mergeIntoCanonicalName}")`);
      lines.push(`- ${item.note}`);
      lines.push("");
    }
    return lines.join("\n");
  };
  return [
    "# PED Repository entity cleanup plan",
    "",
    "Review each item, then run `scripts/applyEntityCleanupPlan.ts --apply` once approved.",
    "",
    section("Action-phrase cleanup (rule 1)", plan.actionPhraseCleanup),
    section("Misspelling cleanup (rule 2)", plan.misspellingCleanup),
  ].join("\n");
}

main().catch((err) => {
  console.error("Entity cleanup plan generation failed:", err);
  process.exit(1);
});
