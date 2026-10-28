/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * READ-ONLY spot-check: confirms whether the PED Repository admin search
 * box's blind spot (canonicalName/pedCode only, no ped_aliases) is the
 * actual explanation for a "0 matching PEDs" result on a condition that's
 * really in the database. Makes ZERO writes.
 *
 * USAGE
 *   npx tsx scripts/checkPedSearchGap.ts "laringitis" "laryngitis"
 *   (pass any number of terms; defaults to laringitis/laryngitis if none given)
 */

import dotenv from "dotenv";
import { getDb, closeDb } from "../src/server/db/client.js";
import { createRepositories } from "../src/server/db/repositories/index.js";
import { normalizeDictionaryKey } from "../src/mapping/helpers.js";

dotenv.config();

async function main() {
  const terms = process.argv.slice(2).length ? process.argv.slice(2) : ["laringitis", "laryngitis"];
  const db = getDb();
  const { pedRepository, pedAliases } = createRepositories(db);

  const allPeds = await pedRepository.list();
  const allAliases = await pedAliases.listAll();
  const pedById = new Map(allPeds.map((p) => [p.id, p]));

  for (const term of terms) {
    const nk = normalizeDictionaryKey(term);
    console.log(`\n=== "${term}" (normalized: "${nk}") ===`);

    // What the ADMIN SEARCH BOX actually does today: ilike substring on
    // canonicalName/pedCode only.
    const lowerTerm = term.toLowerCase();
    const canonicalSubstringHits = allPeds.filter((p) => p.canonicalName.toLowerCase().includes(lowerTerm));
    console.log(`Admin search box would find (canonicalName/pedCode substring match): ${canonicalSubstringHits.length}`);
    for (const h of canonicalSubstringHits) console.log(`  -> "${h.canonicalName}" (${h.pedCode}, status: ${h.status})`);

    // What the REAL matching engine does at classification time: exact
    // normalized-key lookup against ped_aliases (all aliases, visible or not).
    const exactAliasHit = allAliases.find((a) => a.normalizedAlias === nk);
    if (exactAliasHit) {
      const owner = pedById.get(exactAliasHit.pedId);
      console.log(
        `Real matching engine WOULD resolve this via ped_aliases: alias "${exactAliasHit.aliasText}" ` +
          `(isVisible: ${exactAliasHit.isVisible}) -> canonical PED "${owner?.canonicalName ?? "?"}" (${owner?.pedCode ?? "?"}, status: ${owner?.status ?? "?"})`
      );
    } else {
      console.log(`Real matching engine: NO exact alias match for "${nk}" either. Genuinely absent, not just a search-box blind spot.`);
    }

    // Also show any alias whose text loosely contains the term, in case the
    // exact normalized form differs from what was typed.
    const looseAliasHits = allAliases.filter((a) => a.aliasText.toLowerCase().includes(lowerTerm));
    if (looseAliasHits.length && !exactAliasHit) {
      console.log(`Loose substring matches in ped_aliases.aliasText (not exact, informational only):`);
      for (const a of looseAliasHits.slice(0, 10)) {
        const owner = pedById.get(a.pedId);
        console.log(`  -> "${a.aliasText}" -> canonical "${owner?.canonicalName ?? "?"}" (isVisible: ${a.isVisible})`);
      }
    }
  }

  console.log("\nNo writes were made to any table. This script is strictly read-only.");
  await closeDb();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
  });
