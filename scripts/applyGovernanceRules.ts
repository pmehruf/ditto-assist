/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY GOVERNANCE RULES — Checkpoint B decisions (2026-07-28).
 *
 * Applies the user's 9 governance decisions made after reviewing the Phase 4
 * cutover validation report:
 *   1. Repository should contain only medical entities (no action verbs).
 *   2. No visible misspellings — hidden normalization only.
 *   3/4. Visible aliases are genuine synonyms/abbreviations/language variants.
 *   5. Search normalization (hidden) vs. repository/UI presentation (visible).
 *   6. Bell's palsy: preserve legacy's mild/peripheral-neuro routing as
 *      governed data (plan override / categoryKey), not regex.
 *   7. Peptic ulcer / Activ Fit Preferred: preserve as an explicit
 *      plan_override, not embedded regex.
 *   8. CVA: approve as a genuine bug fix — no code/data change needed
 *      (ped_repository already categorizes it correctly); documented here.
 *   9. Cystoscopy: rename to the bare procedure name, route via the new
 *      "investigation_procedure" governed category instead of a disease
 *      category.
 *
 * SCOPE — deliberately conservative. This script:
 *   (a) ALWAYS runs a read-only audit for rule 1/2 violations across the
 *       *entire* repository (not just the 12 flagged differences) and
 *       reports counts + samples for human review. It does NOT bulk-apply
 *       fixes to that broader corpus — renaming/hiding ~1,351 aliases
 *       automatically risks misjudging edge cases (abbreviations, non-English
 *       terms) worse than leaving them for now. Review the report, then
 *       extend this script (or a follow-up) once specific items are agreed.
 *   (b) With --apply, writes ONLY the 4 specific, already-validated
 *       Checkpoint B fixes: the "neuro_mild" and "investigation_procedure"
 *       categories, Bell's palsy's recategorization, the ulcer-family
 *       plan_override(s) on Activ Fit Preferred, and the Cystoscopy
 *       rename/recategorize/hide-alias.
 *
 * Why Bell's palsy is scoped to just that one PED, not every stage-8b term
 * (migraine, carpal tunnel, essential tremor, trigeminal neuralgia, nerve
 * pain): those terms are NOT confirmed to have the same "unreachable via the
 * dictionary" quirk that made Bell's palsy special (its TOP_PED_DICTIONARY
 * key "bell's palsy" is unreachable at the O(1) dictionary stage because
 * normalizeDictionaryKey strips the apostrophe, so the literal object key
 * never matches the normalized lookup key — see the routing engine (src/mapping)'s dictionary
 * routing comment). "Migraine", by contrast, IS directly reachable via the
 * dictionary today and already resolves to "neuro" (severe) under BOTH
 * legacy and the DB path — recategorizing it to neuro_mild would introduce a
 * brand-new behavior change nobody has reviewed, not preserve an existing
 * one. Re-run scripts/validatePedMigration.ts after any further
 * recategorization to confirm it doesn't introduce new differences.
 *
 * USAGE
 *   npx tsx scripts/applyGovernanceRules.ts               (dry-run / audit only)
 *   npx tsx scripts/applyGovernanceRules.ts --apply        (write the 4 fixes)
 *   npx tsx scripts/applyGovernanceRules.ts --out <dir>    (report output dir)
 *
 * Requires migration 0018 (ped_aliases.is_visible) to have been run first —
 * `npm run db:migrate`.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { bumpMappingVersionAfterApply } from "./_mappingVersion.js";
import { normalizeDictionaryKey } from "../src/mapping/helpers.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const outDir = (() => {
  const idx = process.argv.indexOf("--out");
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : path.join(process.cwd(), "migration-reports");
})();

// Rule 1: action-verb / status suffixes that should never appear in a
// canonical PED name. Deliberately conservative — matches the user's own
// examples (done/underwent/taken/received/performed/history of) plus close
// synonyms (advised, patient, status). Does NOT include words like
// "surgery"/"removal"/"transplant" that are frequently part of the actual
// clinical procedure name (e.g. "Appendectomy" vs. colloquial "Appendix
// surgery" is a synonym question, not a verb-suffix question) — those need
// human judgment, not a blanket regex, so they're left for manual review.
const ACTION_SUFFIX_RE = /\b(done|undergone|underwent|taken|received|performed|advised|patient|status)\b|\bhistory\b/i;

// False positives the regex above catches but that are actually legitimate
// professional medical terminology in their own right — "status" here is
// the clinical Latin term (a prolonged/repeated episode), not an
// action/status suffix on some other entity. Excluded from the audit
// entirely so they never show up asking to be "fixed".
const AUDIT_FALSE_POSITIVES = new Set(["status epilepticus", "status asthmaticus"].map(normalizeDictionaryKey));

// Rule 2: curated known-misspellings, sourced from TOP_PED_DICTIONARY's own
// dual "typo key" + "correct key" pairs (both map to the same category,
// confirming these are recognized-but-misspelled variants already live in
// production today) — a starting list, not exhaustive.
const KNOWN_MISSPELLINGS = new Set(
  [
    "cholestrerol", "hyperlipidimia", "hyperlipidmia", "dyslipidimia", "dyslipidmia",
    "apendicitis", "foos poisoning", "weils disease", "pilodinal sinus", "thalaseemia",
    "headcahe", "infertillity", "hemmoroids", "tonsilitis", "gullian barre syndrome",
    "abscence seizure", "hipertension", "hypetension", "diabtes", "dialisis",
    "gynocomastia", "gyneacomastia", "tymnoplasty",
  ].map(normalizeDictionaryKey)
);

interface AuditHit {
  pedId: number;
  pedCode: string;
  canonicalName: string;
  hitField: "canonicalName" | "alias";
  hitText: string;
  reason: string;
}

async function main() {
  const db = getDb();
  const repos = createRepositories(db);

  const [peds, aliases] = await Promise.all([repos.pedRepository.list(), repos.pedAliases.listAll()]);
  const aliasesByPed = new Map<number, typeof aliases>();
  for (const a of aliases) {
    if (!aliasesByPed.has(a.pedId)) aliasesByPed.set(a.pedId, []);
    aliasesByPed.get(a.pedId)!.push(a);
  }
  const pedById = new Map(peds.map((p) => [p.id, p]));

  // ── AUDIT: rule 1 (action-verb / status suffixes) ───────────────────────
  const verbHits: AuditHit[] = [];
  for (const p of peds) {
    if (ACTION_SUFFIX_RE.test(p.canonicalName) && !AUDIT_FALSE_POSITIVES.has(normalizeDictionaryKey(p.canonicalName))) {
      verbHits.push({ pedId: p.id, pedCode: p.pedCode, canonicalName: p.canonicalName, hitField: "canonicalName", hitText: p.canonicalName, reason: "action-verb/status suffix in canonical name" });
    }
  }
  for (const a of aliases) {
    if (ACTION_SUFFIX_RE.test(a.aliasText) && !AUDIT_FALSE_POSITIVES.has(normalizeDictionaryKey(a.aliasText))) {
      const p = pedById.get(a.pedId);
      verbHits.push({ pedId: a.pedId, pedCode: p?.pedCode ?? "?", canonicalName: p?.canonicalName ?? "?", hitField: "alias", hitText: a.aliasText, reason: "action-verb/status suffix in alias" });
    }
  }

  // ── AUDIT: rule 2 (curated known misspellings) ──────────────────────────
  const misspellingHits: AuditHit[] = [];
  for (const p of peds) {
    if (KNOWN_MISSPELLINGS.has(normalizeDictionaryKey(p.canonicalName))) {
      misspellingHits.push({ pedId: p.id, pedCode: p.pedCode, canonicalName: p.canonicalName, hitField: "canonicalName", hitText: p.canonicalName, reason: "curated known misspelling used as canonical name" });
    }
  }
  for (const a of aliases) {
    if (KNOWN_MISSPELLINGS.has(normalizeDictionaryKey(a.aliasText))) {
      const p = pedById.get(a.pedId);
      misspellingHits.push({ pedId: a.pedId, pedCode: p?.pedCode ?? "?", canonicalName: p?.canonicalName ?? "?", hitField: "alias", hitText: a.aliasText, reason: "curated known misspelling — should be hidden (isVisible=false), not shown" });
    }
  }

  // ── Every PED whose canonical name or an alias contains "ulcer" ─────────
  // Refined per Checkpoint B follow-up (2026-07-28): the first pass swept in
  // EVERY ulcer-containing PED, which incorrectly caught "Diabetic foot
  // ulcer" — legacy never routes that through the AFP ulcer rule at all (the
  // diabetes-complication stage runs earlier in the pipeline and claims it
  // first), so sweeping it in was a real, unintended behavior change, not a
  // preservation of one. The AFP proposal wording's own rule is about
  // ulcers as a standalone GI/tumour-adjacent condition (gastric, duodenal,
  // peptic, stomach, or an unqualified "ulcer") — not ulcers named as a
  // complication of a different primary disease. Excluding by a general
  // "named as a complication of X" pattern (currently just "diabetic ...")
  // rather than a one-off pedId list, so this stays correct if new
  // complication-named ulcer PEDs are added later.
  const ULCER_COMPLICATION_EXCLUSION_RE = /\bdiabetic\b/i;
  const ulcerPedIds = new Set<number>();
  const ulcerExcludedPedIds = new Set<number>();
  for (const p of peds) {
    if (!/\bulcer\b/i.test(p.canonicalName)) continue;
    if (ULCER_COMPLICATION_EXCLUSION_RE.test(p.canonicalName)) ulcerExcludedPedIds.add(p.id);
    else ulcerPedIds.add(p.id);
  }
  for (const a of aliases) {
    if (!/\bulcer\b/i.test(a.aliasText)) continue;
    if (ULCER_COMPLICATION_EXCLUSION_RE.test(a.aliasText)) ulcerExcludedPedIds.add(a.pedId);
    else if (!ulcerExcludedPedIds.has(a.pedId)) ulcerPedIds.add(a.pedId);
  }
  // A PED excluded via any alias/canonical-name match should never be
  // included via a different alias — complication status is a property of
  // the PED, not of one particular alias spelling.
  for (const id of ulcerExcludedPedIds) ulcerPedIds.delete(id);

  // ── Locate the specific Checkpoint-B-approved fixes (idempotent — safe to
  // re-run after a previous --apply already renamed Cystoscopy) ───────────
  const cystoscopyPed = peds.find((p) => p.pedCode === "PED-000037" || normalizeDictionaryKey(p.canonicalName) === normalizeDictionaryKey("Cystoscopy done") || normalizeDictionaryKey(p.canonicalName) === "cystoscopy");
  const bellsPalsyPed = peds.find((p) => normalizeDictionaryKey(p.canonicalName) === normalizeDictionaryKey("Bell's palsy"));

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    ruleAudit: {
      actionVerbSuffixHits: verbHits.length,
      actionVerbSuffixSample: verbHits.slice(0, 200),
      knownMisspellingHits: misspellingHits.length,
      knownMisspellingSample: misspellingHits.slice(0, 200),
      note:
        "Conservative, curated audit — not exhaustive (especially rule 2, the misspelling list). " +
        "Not auto-applied: review each hit, since bulk-renaming/hiding risks misjudging abbreviations " +
        "or legitimate short forms. Extend this script's KNOWN_MISSPELLINGS / ACTION_SUFFIX_RE and re-run " +
        "with --apply once specific items are confirmed.",
    },
    checkpointBFixes: {
      cva: {
        action: "documented only — no code/data change",
        reason:
          "ped_repository already correctly categorizes Cerebrovascular Accident as neurological. " +
          "Legacy's TOP_PED_DICTIONARY 'acute_trauma' mapping was the bug; this migration's cutover " +
          "itself is the fix. Approved as an intentional behavioral improvement (Checkpoint B, 2026-07-28).",
      },
      bellsPalsy: bellsPalsyPed
        ? { pedId: bellsPalsyPed.id, pedCode: bellsPalsyPed.pedCode, action: APPLY ? "recategorized to neuro_mild" : "would recategorize to neuro_mild" }
        : { action: "NOT FOUND — could not locate 'Bell's palsy' in ped_repository; nothing changed" },
      ulcerActivFitPreferred: {
        pedIds: Array.from(ulcerPedIds),
        pedNames: Array.from(ulcerPedIds).map((id) => pedById.get(id)?.canonicalName ?? "?"),
        excludedAsComplications: Array.from(ulcerExcludedPedIds).map((id) => ({ pedId: id, canonicalName: pedById.get(id)?.canonicalName ?? "?" })),
        action: APPLY ? "plan_override upserted (categoryKey=neoplasm) for each; excluded PEDs' override removed if a prior run added one" : "would upsert plan_override (categoryKey=neoplasm) for each; excluded PEDs left alone",
        note:
          "Refined 2026-07-28 after user review: 'Diabetic foot ulcer' (and any future 'diabetic ...ulcer' " +
          "PED) is excluded — legacy routes it as a diabetes complication, never reaching the AFP ulcer " +
          "rule, so including it would have broadened the rule rather than preserved it.",
      },
      cystoscopy: cystoscopyPed
        ? {
            pedId: cystoscopyPed.id,
            pedCode: cystoscopyPed.pedCode,
            action: APPLY ? "renamed to 'Cystoscopy' + recategorized to investigation_procedure + 'Cystoscopy done' alias hidden" : "would rename + recategorize + hide alias",
            approvedAsIntentionalBugFix: true,
            note:
              "Approved 2026-07-28: legacy retains a separate, now-stale TOP_PED_DICTIONARY entry " +
              "('cystoscopy done' -> kidney) that only the exact hidden alias text reaches — this is expected " +
              "to surface as a category_mismatch in scripts/validatePedMigration.ts until Phase 5 cutover " +
              "retires the legacy dictionary; the DB-backed investigation_procedure routing is correct.",
          }
        : { action: "NOT FOUND — could not locate 'Cystoscopy done'/'Cystoscopy' in ped_repository; nothing changed" },
    },
  };

  if (APPLY) {
    await repos.categories.upsert({
      categoryKey: "neuro_mild",
      label: "Mild / Peripheral Nervous System Disorder",
      description:
        "Mild or peripheral nerve conditions (e.g. Bell's palsy) routed to a plan's general nervous/" +
        "psychiatric question instead of its severe stroke/paralysis question, to avoid over-flagging a " +
        "generally mild, often self-resolving condition as high-severity. See classifyDeterministic in " +
        "engine.ts for the exact plan-aware fallback rule this category triggers.",
      sortOrder: 0,
    });
    await repos.categories.upsert({
      categoryKey: "investigation_procedure",
      label: "Diagnostic / Investigative Procedure",
      description:
        "A medical test or procedure name (e.g. Cystoscopy) — not itself a disease diagnosis. Routed to " +
        "the plan's medical tests/investigations umbrella question rather than being forced into a disease " +
        "category question.",
      sortOrder: 0,
    });

    if (bellsPalsyPed && bellsPalsyPed.categoryKey !== "neuro_mild") {
      const prevCategory = bellsPalsyPed.categoryKey;
      await repos.pedRepository.update(bellsPalsyPed.id, { categoryKey: "neuro_mild" });
      await repos.mappingHistory.record({
        pedId: bellsPalsyPed.id,
        entityType: "ped",
        action: "category_changed",
        previousValue: { categoryKey: prevCategory },
        newValue: { categoryKey: "neuro_mild" },
        reason:
          "Checkpoint B (2026-07-28): preserve legacy's mild/peripheral-neuro routing (avoid over-flagging " +
          "as high-severity stroke) as governed data instead of regex.",
        performedBy: "governance-migration-script",
      });
      await repos.collisions.record({
        collisionType: "regression",
        pedId: bellsPalsyPed.id,
        rejectedCategoryKey: "neuro",
        approvedCategoryKey: "neuro_mild",
        description:
          "Bell's palsy must never be routed to the severe Stroke/Paralysis/Epilepsy question — it is a " +
          "generally mild, often self-resolving facial nerve condition. Guardrail added after Phase 4 " +
          "cutover validation caught the DB-backed path defaulting to 'neuro' (severe) where legacy's regex " +
          "fallback correctly used the milder nervous/psychiatric question.",
        severity: "guardrail",
        active: true,
        addedBy: "governance-migration-script",
      });
    }

    for (const pedId of ulcerPedIds) {
      await repos.planOverrides.upsert({
        planName: "Activ Fit Preferred",
        pedId,
        categoryKey: "neoplasm",
        reason:
          "Plan-specific conservative disclosure rule: this plan's proposal wording explicitly groups " +
          "ulcer-related conditions under its tumor/cancer/cyst/ulcer question rather than the general " +
          "digestive question. Excludes ulcers named as a complication of another disease (e.g. diabetic " +
          "foot ulcer), which keep their normal (non-override) routing.",
        addedBy: "governance-migration-script",
      });
    }

    // Cleanup: remove any plan_override this exact script previously added
    // for a PED that's now correctly excluded (the first Checkpoint B pass,
    // before the ulcer rule was refined, wrote one for "Diabetic foot
    // ulcer"). Only removes overrides on this plan/category combination that
    // this script owns — never touches a hand-authored override.
    for (const pedId of ulcerExcludedPedIds) {
      const existing = await repos.planOverrides.get("Activ Fit Preferred", pedId);
      if (existing && existing.categoryKey === "neoplasm" && existing.addedBy === "governance-migration-script") {
        await repos.planOverrides.delete("Activ Fit Preferred", pedId);
        await repos.mappingHistory.record({
          pedId,
          entityType: "plan_override",
          action: "removed",
          previousValue: { planName: "Activ Fit Preferred", categoryKey: "neoplasm" },
          newValue: null,
          reason:
            "Checkpoint B refinement (2026-07-28): this PED is named as a complication of another disease " +
            "(matches the diabetic-complication exclusion) — the blanket ulcer sweep incorrectly included it " +
            "in an earlier pass. Legacy never routes it through the AFP ulcer rule, so removing preserves " +
            "the original underwriting intent instead of broadening it.",
          performedBy: "governance-migration-script",
        });
      }
    }

    if (cystoscopyPed) {
      const prevName = cystoscopyPed.canonicalName;
      const prevCategory = cystoscopyPed.categoryKey;
      const alreadyDone = prevName === "Cystoscopy" && prevCategory === "investigation_procedure";
      if (!alreadyDone) {
        await repos.pedRepository.update(cystoscopyPed.id, { canonicalName: "Cystoscopy", categoryKey: "investigation_procedure" });
      }

      const pedAliasRows = aliasesByPed.get(cystoscopyPed.id) ?? [];
      const doneAlias = pedAliasRows.find((a) => normalizeDictionaryKey(a.aliasText) === normalizeDictionaryKey("Cystoscopy done"));
      const bareAlias = pedAliasRows.find((a) => normalizeDictionaryKey(a.aliasText) === normalizeDictionaryKey("Cystoscopy"));

      if (doneAlias) {
        if (doneAlias.isVisible) await repos.pedAliases.setVisibility(doneAlias.id, false);
        if (doneAlias.isPrimary) await repos.pedAliases.setPrimary(doneAlias.id, false);
      }
      if (bareAlias) {
        if (!bareAlias.isVisible) await repos.pedAliases.setVisibility(bareAlias.id, true);
        if (!bareAlias.isPrimary) await repos.pedAliases.setPrimary(bareAlias.id, true);
      } else {
        await repos.pedAliases.create({ pedId: cystoscopyPed.id, aliasText: "Cystoscopy", isPrimary: true, isVisible: true, addedBy: "governance-migration-script" });
      }

      if (!alreadyDone) {
        await repos.mappingHistory.record({
          pedId: cystoscopyPed.id,
          entityType: "ped",
          action: "updated",
          previousValue: { canonicalName: prevName, categoryKey: prevCategory },
          newValue: { canonicalName: "Cystoscopy", categoryKey: "investigation_procedure" },
          reason:
            "Governance rules 1 & 9 (2026-07-28): repository stores medical entities only, not action " +
            "phrases; procedure routes via investigation_procedure category, not a disease category. " +
            "'Cystoscopy done' kept as a hidden normalization alias so search still finds it. Approved as " +
            "an intentional bug fix — legacy's own stale 'cystoscopy done' -> kidney dictionary entry is " +
            "expected to keep showing as a category_mismatch in Phase 4 validation until Phase 5 cutover.",
          performedBy: "governance-migration-script",
        });
      }
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "governance-rules-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(APPLY ? "Applied Checkpoint B governance fixes." : "Dry-run complete — no writes made. Re-run with --apply to write.");
  console.log(`Action-verb-suffix audit hits: ${verbHits.length}`);
  console.log(`Known-misspelling audit hits: ${misspellingHits.length}`);
  console.log(`Ulcer-family PEDs found: ${ulcerPedIds.size} (pedIds: ${Array.from(ulcerPedIds).join(", ") || "none"})`);
  console.log(`Ulcer-family PEDs excluded as complications: ${ulcerExcludedPedIds.size} (pedIds: ${Array.from(ulcerExcludedPedIds).join(", ") || "none"})`);
  console.log(`Bell's palsy: ${bellsPalsyPed ? `found (PED ${bellsPalsyPed.pedCode})` : "NOT FOUND"}`);
  console.log(`Cystoscopy: ${cystoscopyPed ? `found (PED ${cystoscopyPed.pedCode})` : "NOT FOUND"}`);
  console.log(`Report written to ${reportPath}`);

  if (APPLY) await bumpMappingVersionAfterApply(repos);
  await closeDb();
}

main().catch((err) => {
  console.error("Governance rules script failed:", err);
  process.exit(1);
});
