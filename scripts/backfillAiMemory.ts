/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE-TIME BACKFILL — search_history → ai_memory
 *
 * Between the AI Memory feature shipping and migration 0015 being applied,
 * `ai_memory` did not exist, so every Gemini answer was returned to the
 * advisor but never cached (the write threw and was caught). Those answers
 * are NOT lost: search_history persists the full payload of each lookup,
 * including `source`, so AI-resolved rows can be reconstructed.
 *
 * This script selects historical rows where source indicates the Gemini
 * fallback produced the answer, dedupes them by the AI Memory cache key
 * (normalized condition + plan + engine version), and inserts them as
 * `pending` so they land in AI Mapping Review for approval.
 *
 * SAFETY
 *  - Idempotent: uses the same unique index as the live write path, so
 *    re-running never duplicates rows.
 *  - Never overwrites: an existing entry (including one already approved or
 *    rejected) is left untouched.
 *  - Read-only against search_history; writes only to ai_memory.
 *  - Touches no mapping source — the deterministic engine, dictionary,
 *    regex, category maps and plan configs are not read or modified.
 *
 * KNOWN LIMITATION
 *  search_history does not store Gemini's raw JSON or which model answered,
 *  so backfilled rows carry a marker in place of those detail-panel fields.
 *  The routing data that matters for review and for cache hits — matched
 *  question, match type, explanation — is preserved exactly.
 *
 * USAGE
 *   npx tsx scripts/backfillAiMemory.ts           # dry run, prints a summary
 *   npx tsx scripts/backfillAiMemory.ts --commit  # actually writes
 */

import dotenv from "dotenv";
import { getDb } from "../src/server/db/client.js";
import { searchHistory, aiMemory } from "../src/server/db/schema.js";
import { normalizeCondition } from "../src/server/db/repositories/index.js";

// Same as migrate.ts — this runs standalone, outside the server process, so
// DATABASE_URL has to be loaded from .env here.
dotenv.config();

// Must match ENGINE_VERSION in server.ts, otherwise backfilled rows would sit
// under a cache key the live lookup never reads.
const ENGINE_VERSION = "2026-07-18.1";
const BACKFILL_MARKER = "backfilled-from-search-history";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const db = getDb();

  const rows = await db.select().from(searchHistory);

  // The AI fallback stamps source "Live Gemini API" (see /api/match). Match
  // loosely on "gemini" so any historical variant of that label is caught,
  // while excluding deterministic-engine and AI-Memory-served rows.
  const aiRows = rows.filter((r) => /gemini/i.test(r.source || ""));

  console.log(`search_history rows scanned : ${rows.length}`);
  console.log(`AI-generated rows found     : ${aiRows.length}`);

  // Dedupe by cache key, keeping the most recent answer per (PED, plan).
  const byKey = new Map<string, (typeof aiRows)[number]>();
  for (const r of aiRows) {
    const key = `${normalizeCondition(r.pedInput)}|${r.planName}`;
    const prev = byKey.get(key);
    if (!prev || new Date(r.timestamp) > new Date(prev.timestamp)) byKey.set(key, r);
  }

  console.log(`unique (condition, plan)    : ${byKey.size}`);

  if (!COMMIT) {
    console.log("\n--- DRY RUN (no writes). Sample of what would be inserted: ---");
    [...byKey.values()].slice(0, 10).forEach((r) => {
      console.log(`  • "${r.pedInput}" [${r.planName}] → ${r.matchType} :: ${String(r.matchedQuestion).slice(0, 70)}`);
    });
    console.log("\nRe-run with --commit to write these into ai_memory as 'pending'.");
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const r of byKey.values()) {
    const result = {
      ped_input: r.pedInput,
      match_type: r.matchType,
      matched_question: r.matchedQuestion,
      explanation: r.explanation,
      confused_questions: [] as string[],
    };

    const [row] = await db
      .insert(aiMemory)
      .values({
        condition: r.pedInput,
        normalizedCondition: normalizeCondition(r.pedInput),
        planName: r.planName,
        engineVersion: ENGINE_VERSION,
        promptVersion: BACKFILL_MARKER,
        geminiModel: BACKFILL_MARKER,
        aiResponse: { result, raw: { note: BACKFILL_MARKER, originalTimestamp: r.timestamp } },
        status: "pending",
      })
      // Same conflict target as the live write path — safe to re-run, and an
      // already-reviewed entry is never reset.
      .onConflictDoNothing({
        target: [aiMemory.normalizedCondition, aiMemory.planName, aiMemory.engineVersion],
      })
      .returning();

    if (row) inserted++;
    else skipped++;
  }

  console.log(`\ninserted as pending         : ${inserted}`);
  console.log(`skipped (already present)   : ${skipped}`);
  console.log("\nDone. Open PED Repository → AI Mapping Review to triage them.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
