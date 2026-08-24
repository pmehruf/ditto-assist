/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * READ-ONLY AUDIT — "why did the PED Repository count stay at 1,184 after
 * the 600_conditions_corrected_database.json deletion?"
 *
 * Makes ZERO writes to any table. Compares the deleted JSON's 813 unique
 * normalized conditions (restored from git history into
 * scripts/data/600_conditions_corrected_database.snapshot.json — the
 * ORIGINAL file, not a re-derived summary) against the LIVE
 * ped_repository/ped_aliases tables, using the exact same
 * normalizeDictionaryKey logic engine.ts uses at match time. Also reports
 * the live status breakdown (approved/draft/deprecated) so the UI's
 * "1,184" figure can be checked against the actual unfiltered row count.
 *
 * USAGE
 *   npx tsx scripts/auditPedRepositoryVsJson.ts
 *
 * Writes <repo root>/ped-repository-audit-report.json (full machine-
 * readable detail) and prints the same summary this script's stdout shows.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { normalizeDictionaryKey } from "../src/engine.js";

dotenv.config();

async function main() {
  const db = getDb();
  const { pedRepository, pedAliases } = createRepositories(db);

  // ── 1. Live DB state — unconditional, exactly what GET /api/ped-repository
  // (no filters) returns as `total`. ──
  const allPeds = await pedRepository.list();
  const statusCounts: Record<string, number> = {};
  for (const p of allPeds) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;

  const allAliases = await pedAliases.listAll();
  const visibleAliasCount = allAliases.filter((a) => a.isVisible).length;
  const hiddenAliasCount = allAliases.length - visibleAliasCount;

  console.log("=== LIVE ped_repository STATE (unconditional COUNT, no filters) ===");
  console.log(`Total ped_repository rows: ${allPeds.length}`);
  console.log(`By status: ${JSON.stringify(statusCounts)}`);
  console.log(`Total ped_aliases rows: ${allAliases.length} (${visibleAliasCount} visible, ${hiddenAliasCount} hidden)`);
  console.log(
    `\nIf the PED Repository UI's "N PEDs synced" figure (no filters applied) does NOT equal ${allPeds.length} above, ` +
      `something client- or server-side IS filtering the display — re-check PedRepositoryManagement.tsx's default filter state and the GET /api/ped-repository handler.`
  );

  // ── 2. Build the live lookup set — every normalized alias AND every
  // normalized canonical name (the canonical name itself is always also
  // its own primary alias per governance, but checking both directly
  // avoids relying on that invariant holding for every row). ──
  const liveNormalizedSet = new Set<string>();
  for (const row of allPeds) liveNormalizedSet.add(normalizeDictionaryKey(row.canonicalName));
  for (const row of allAliases) liveNormalizedSet.add(row.normalizedAlias);

  const pedByCanonicalNorm = new Map(allPeds.map((p) => [normalizeDictionaryKey(p.canonicalName), p]));
  const pedIdByAliasNorm = new Map(allAliases.map((a) => [a.normalizedAlias, a.pedId]));
  const pedById = new Map(allPeds.map((p) => [p.id, p]));

  // ── 3. The JSON snapshot (restored from git history at the commit just
  // before deletion — see this script's header). ──
  const jsonPath = path.join(process.cwd(), "scripts/data/600_conditions_corrected_database.snapshot.json");
  const jsonRaw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const jsonEntries: Record<string, string> = jsonRaw.CORRECTED_DICTIONARY_ENTRIES;
  const rawKeyCount = Object.keys(jsonEntries).length;

  const jsonNormalized = new Map<string, { rawKey: string; category: string }>();
  for (const [rawKey, category] of Object.entries(jsonEntries)) {
    const nk = normalizeDictionaryKey(rawKey);
    if (!jsonNormalized.has(nk)) jsonNormalized.set(nk, { rawKey, category });
  }

  console.log("\n=== JSON SOURCE (600_conditions_corrected_database.json, restored from git history) ===");
  console.log(`Raw object keys: ${rawKeyCount}`);
  console.log(`Unique normalized conditions: ${jsonNormalized.size}`);

  // ── 4. The actual comparison — for every unique JSON condition, is it
  // reachable in the LIVE ped_repository/ped_aliases tables today? ──
  const present: { rawKey: string; matchedVia: "canonicalName" | "alias"; pedCode: string; canonicalName: string; status: string; liveCategoryKey: string | null; jsonCategory: string }[] = [];
  const missing: { rawKey: string; jsonCategory: string }[] = [];

  for (const [nk, { rawKey, category }] of jsonNormalized) {
    if (pedByCanonicalNorm.has(nk)) {
      const row = pedByCanonicalNorm.get(nk)!;
      present.push({ rawKey, matchedVia: "canonicalName", pedCode: row.pedCode, canonicalName: row.canonicalName, status: row.status, liveCategoryKey: row.categoryKey, jsonCategory: category });
    } else if (pedIdByAliasNorm.has(nk)) {
      const pedId = pedIdByAliasNorm.get(nk)!;
      const row = pedById.get(pedId);
      present.push({ rawKey, matchedVia: "alias", pedCode: row?.pedCode || "?", canonicalName: row?.canonicalName || "?", status: row?.status || "?", liveCategoryKey: row?.categoryKey ?? null, jsonCategory: category });
    } else {
      missing.push({ rawKey, jsonCategory: category });
    }
  }

  console.log("\n=== COMPARISON: JSON conditions vs LIVE ped_repository/ped_aliases ===");
  console.log(`Present in live DB (via canonicalName or alias): ${present.length}`);
  console.log(`GENUINELY MISSING from live DB: ${missing.length}`);
  if (missing.length > 0) {
    console.log("\nFirst 40 missing entries:");
    for (const m of missing.slice(0, 40)) console.log(`  "${m.rawKey}" (JSON category: ${m.jsonCategory})`);
  }

  // ── 5. Category-mismatch flag (informational, not a "missing" case) —
  // where the JSON's expected category differs from what's live today.
  // This does NOT mean the entry is missing, just that its classification
  // has since diverged (deliberately or not) from the JSON's snapshot. ──
  const categoryMismatches = present.filter((p) => p.liveCategoryKey && p.liveCategoryKey !== p.jsonCategory);
  console.log(`\nPresent but with a DIFFERENT live categoryKey than the JSON's: ${categoryMismatches.length}`);
  for (const m of categoryMismatches.slice(0, 20)) {
    console.log(`  "${m.rawKey}": JSON says "${m.jsonCategory}", live DB says "${m.liveCategoryKey}" (status: ${m.status})`);
  }

  // ── 6. Status breakdown of the matched entries — were any of the JSON's
  // conditions matched to a row that's draft/deprecated rather than
  // approved? (Still "present," per this script's definition — flagged
  // separately since deprecated/draft rows may render differently in the
  // UI depending on the active status filter.) ──
  const presentByStatus: Record<string, number> = {};
  for (const p of present) presentByStatus[p.status] = (presentByStatus[p.status] || 0) + 1;
  console.log(`\nMatched entries by live status: ${JSON.stringify(presentByStatus)}`);

  const report = {
    generatedAt: new Date().toISOString(),
    liveDb: {
      totalPedRepositoryRows: allPeds.length,
      statusCounts,
      totalAliasRows: allAliases.length,
      visibleAliasCount,
      hiddenAliasCount,
    },
    json: {
      rawKeyCount,
      uniqueNormalizedCount: jsonNormalized.size,
    },
    comparison: {
      presentCount: present.length,
      missingCount: missing.length,
      missing,
      categoryMismatchCount: categoryMismatches.length,
      categoryMismatches,
      presentByStatus,
    },
  };
  const outPath = path.join(process.cwd(), "ped-repository-audit-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull machine-readable report written to: ${outPath}`);
  console.log("\nNo writes were made to any table. This script is strictly read-only.");

  await closeDb();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
