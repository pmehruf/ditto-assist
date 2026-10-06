/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PED Library cleanup: READ-ONLY usage report. Counts, per normalized name, how many advisor searches (search_history) typed
 * that name in the last 90 days, plus how often the PED Library tables are referenced by plan_overrides and ai_memory.
 * Only SELECTs are issued (the session is set read-only). DATABASE_URL selects the database, as for mapping:snapshot.
 *
 *   npx tsx scripts/pedUsageReport.ts --out <usage.json>
 *
 * The output holds counts only (no user emails, no free text beyond the searched condition names already in the library).
 * Feed it to scripts/pedLibraryAudit.ts with --usage.
 */

import dotenv from "dotenv";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { normalizeDictionaryKey } from "../src/mapping/helpers.js";

dotenv.config();
const outIdx = process.argv.indexOf("--out");
const out = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;
if (!out) {
  console.error("Usage: --out <usage.json>   (DATABASE_URL selects the database)");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
try {
  await sql`SET default_transaction_read_only = on`;
  const rows = await sql`select ped_input as t, count(*)::int as n from search_history where timestamp > now() - interval '90 days' group by ped_input`;
  const usage: Record<string, number> = {};
  for (const r of rows) {
    const key = normalizeDictionaryKey(String(r.t));
    usage[key] = (usage[key] ?? 0) + Number(r.n);
  }
  writeFileSync(out, JSON.stringify(usage));
  const refs = await sql`select (select count(*)::int from plan_overrides) as plan_overrides, (select count(*)::int from ai_memory) as ai_memory, (select count(*)::int from ped_repository) as peds, (select count(*)::int from ped_aliases) as aliases`;
  console.log(`Wrote ${Object.keys(usage).length} searched names to ${out}`);
  console.log(JSON.stringify(refs[0]));
} finally {
  await sql.end();
}
