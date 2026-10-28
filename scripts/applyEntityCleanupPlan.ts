/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PED REPOSITORY GOVERNANCE — action-phrase & misspelling cleanup APPLY
 * script (Checkpoint B follow-up, 2026-07-28).
 *
 * Executes the plan produced by scripts/generateEntityCleanupPlan.ts
 * (migration-reports/entity-cleanup-plan.json by default). Review that plan
 * — and its .md summary — before running this with --apply; dry-run is the
 * default and only prints what would happen.
 *
 * Treatments (see generateEntityCleanupPlan.ts's header for how each is
 * decided):
 *   - "rename": canonical_name -> proposedTarget; the old name becomes a
 *     hidden (isVisible=false) normalization alias.
 *   - "merge_into": every alias on the losing PED is re-pointed to the
 *     winning PED (the action-phrase/misspelling text itself hidden there;
 *     any other genuine alias keeps its current visibility). The losing PED
 *     is marked status=deprecated + merged_into_id, never deleted, so
 *     mapping_history/plan_overrides referencing its old id stay valid.
 *   - "hide_alias_only": just flips isVisible=false on an alias that
 *     already points at a correctly-named PED.
 *   - "needs_review": ALWAYS skipped, no matter what — these are the items
 *     the plan generator explicitly couldn't confidently resolve.
 *
 * SAFETY: every alias reassignment is wrapped in try/catch — a genuine
 * normalized-text collision between the losing and winning PED's own alias
 * sets throws from the DB's unique constraint, and that one alias is
 * skipped (logged) rather than aborting the whole run, matching this
 * project's established collision-tolerant seeding pattern.
 *
 * USAGE
 *   npx tsx scripts/applyEntityCleanupPlan.ts                    (dry-run)
 *   npx tsx scripts/applyEntityCleanupPlan.ts --apply
 *   npx tsx scripts/applyEntityCleanupPlan.ts --apply --plan <path>
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
const planPath = (() => {
  const idx = process.argv.indexOf("--plan");
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : path.join(process.cwd(), "migration-reports", "entity-cleanup-plan.json");
})();

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
  additionalVisibleAliasText?: string;
  note: string;
}

/**
 * Ensures `text` exists as a VISIBLE alias on `pedId` with exactly this
 * display text, creating it if missing. Used for genuine clinical synonyms
 * (e.g. "Weil's disease") that must stay user-facing, unlike the hidden
 * hitText this script otherwise deals with.
 *
 * IMPORTANT: `normalizeDictionaryKey` strips punctuation, so a punctuation
 * fix like "Weils disease" -> "Weil's disease" normalizes to the exact same
 * lookup key as the misspelling it's replacing — they cannot coexist as two
 * separate rows (the DB's normalized_alias unique constraint forbids it).
 * When that's the case, this function finds the alias row the earlier
 * hide-hitText step already touched and UPDATES it in place (new display
 * text + visible again) rather than trying to insert a second, colliding
 * row. This must run after that hide step, not before, so it wins.
 */
async function ensureVisibleAlias(
  repos: ReturnType<typeof createRepositories>,
  pedId: number,
  text: string,
  summary: { errors: string[] }
): Promise<void> {
  const existing = (await repos.pedAliases.listByPed(pedId)).find((a) => a.normalizedAlias === normalizeDictionaryKey(text));
  if (existing) {
    if (existing.aliasText !== text) await repos.pedAliases.updateAliasText(existing.id, text);
    if (!existing.isVisible) await repos.pedAliases.setVisibility(existing.id, true);
    return;
  }
  try {
    await repos.pedAliases.create({ pedId, aliasText: text, isPrimary: false, isVisible: true, addedBy: "entity-cleanup-script" });
  } catch (err) {
    summary.errors.push(`Could not add visible synonym alias "${text}" to PED ${pedId} (${(err as Error).message})`);
  }
}

interface Plan {
  actionPhraseCleanup: { items: PlanItem[] };
  misspellingCleanup: { items: PlanItem[] };
}

async function main() {
  if (!fs.existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}. Run scripts/generateEntityCleanupPlan.ts first.`);
    process.exit(1);
  }
  const plan: Plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const allItems = [...plan.actionPhraseCleanup.items, ...plan.misspellingCleanup.items];

  const db = getDb();
  const repos = createRepositories(db);

  const summary = { renamed: 0, merged: 0, hidden: 0, skippedNeedsReview: 0, aliasCollisions: 0, errors: [] as string[] };

  for (const item of allItems) {
    if (item.treatment === "needs_review") {
      summary.skippedNeedsReview++;
      continue;
    }

    const ped = await repos.pedRepository.get(item.pedId);
    if (!ped) {
      summary.errors.push(`${item.pedCode}: PED not found (id ${item.pedId}) — skipped`);
      continue;
    }

    if (item.treatment === "hide_alias_only") {
      const alias = (await repos.pedAliases.listByPed(item.pedId)).find((a) => a.normalizedAlias === normalizeDictionaryKey(item.hitText));
      if (!alias) {
        summary.errors.push(`${item.pedCode}: alias "${item.hitText}" not found — skipped`);
        continue;
      }
      console.log(`[hide_alias_only] ${item.pedCode} "${item.hitText}"`);
      if (APPLY && alias.isVisible) await repos.pedAliases.setVisibility(alias.id, false);
      summary.hidden++;
      continue;
    }

    if (item.treatment === "rename" && item.proposedTarget) {
      console.log(`[rename] ${item.pedCode} "${item.currentCanonicalName}" -> "${item.proposedTarget}"`);
      if (APPLY) {
        const prevName = ped.canonicalName;
        const prevCategory = ped.categoryKey;
        if (ped.canonicalName !== item.proposedTarget) {
          await repos.pedRepository.update(item.pedId, { canonicalName: item.proposedTarget });
        }
        const pedAliasRows = await repos.pedAliases.listByPed(item.pedId);
        const oldAlias = pedAliasRows.find((a) => a.normalizedAlias === normalizeDictionaryKey(item.hitText));
        const newAlias = pedAliasRows.find((a) => a.normalizedAlias === normalizeDictionaryKey(item.proposedTarget!));
        if (oldAlias) {
          if (oldAlias.isVisible) await repos.pedAliases.setVisibility(oldAlias.id, false);
          if (oldAlias.isPrimary) await repos.pedAliases.setPrimary(oldAlias.id, false);
        }
        if (newAlias) {
          if (!newAlias.isVisible) await repos.pedAliases.setVisibility(newAlias.id, true);
          if (!newAlias.isPrimary) await repos.pedAliases.setPrimary(newAlias.id, true);
        } else {
          await repos.pedAliases.create({ pedId: item.pedId, aliasText: item.proposedTarget, isPrimary: true, isVisible: true, addedBy: "entity-cleanup-script" });
        }
        if (item.additionalVisibleAliasText) {
          await ensureVisibleAlias(repos, item.pedId, item.additionalVisibleAliasText, summary);
        }
        if (prevName !== item.proposedTarget) {
          await repos.mappingHistory.record({
            pedId: item.pedId,
            entityType: "ped",
            action: "updated",
            previousValue: { canonicalName: prevName, categoryKey: prevCategory },
            newValue: { canonicalName: item.proposedTarget, categoryKey: prevCategory },
            reason: `Governance rule 1/2 cleanup (2026-07-28): ${item.note}`,
            performedBy: "entity-cleanup-script",
          });
        }
      }
      summary.renamed++;
      continue;
    }

    if (item.treatment === "merge_into" && item.mergeIntoPedId) {
      console.log(`[merge_into] ${item.pedCode} "${item.currentCanonicalName}" -> ${item.mergeIntoPedCode} "${item.mergeIntoCanonicalName}"`);
      if (APPLY) {
        const losingAliases = await repos.pedAliases.listByPed(item.pedId);
        for (const alias of losingAliases) {
          try {
            await repos.pedAliases.reassignPed(alias.id, item.mergeIntoPedId);
            // The action-phrase/misspelling text itself becomes hidden on
            // the winning PED; any other alias that came along keeps its
            // existing visibility (it was presumably already fine).
            if (alias.normalizedAlias === normalizeDictionaryKey(item.hitText) && alias.isVisible) {
              await repos.pedAliases.setVisibility(alias.id, false);
            }
            if (alias.isPrimary) await repos.pedAliases.setPrimary(alias.id, false);
          } catch (err) {
            summary.aliasCollisions++;
            summary.errors.push(`${item.pedCode}: alias "${alias.aliasText}" collided while merging into ${item.mergeIntoPedCode} — left pointing at the old PED (${(err as Error).message})`);
          }
        }
        if (item.additionalVisibleAliasText) {
          await ensureVisibleAlias(repos, item.mergeIntoPedId, item.additionalVisibleAliasText, summary);
        }
        await repos.pedRepository.update(item.pedId, { status: "deprecated", mergedIntoId: item.mergeIntoPedId });
        await repos.mappingHistory.record({
          pedId: item.pedId,
          entityType: "ped",
          action: "merged",
          previousValue: { canonicalName: item.currentCanonicalName, status: ped.status },
          newValue: { mergedIntoId: item.mergeIntoPedId, status: "deprecated" },
          reason: `Governance rule 1/2 cleanup (2026-07-28): ${item.note}`,
          performedBy: "entity-cleanup-script",
        });
        await repos.mappingHistory.record({
          pedId: item.mergeIntoPedId,
          entityType: "ped",
          action: "alias_added",
          previousValue: null,
          newValue: { mergedFromPedId: item.pedId, mergedFromCode: item.pedCode },
          reason: `Absorbed aliases from ${item.pedCode} ("${item.currentCanonicalName}") during governance rule 1/2 cleanup.`,
          performedBy: "entity-cleanup-script",
        });
      }
      summary.merged++;
      continue;
    }

    summary.errors.push(`${item.pedCode}: unrecognized or incomplete treatment "${item.treatment}" — skipped`);
  }

  if (APPLY) await bumpMappingVersionAfterApply(repos);
  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} entity cleanup plan.`);
  console.log(`Renamed: ${summary.renamed}, Merged: ${summary.merged}, Hidden-only: ${summary.hidden}, Skipped (needs_review): ${summary.skippedNeedsReview}, Alias collisions: ${summary.aliasCollisions}`);
  if (summary.errors.length) {
    console.log("Errors/skips:");
    for (const e of summary.errors) console.log(`  - ${e}`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error("Entity cleanup apply failed:", err);
  process.exit(1);
});
