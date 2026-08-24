/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * HEALTH FAQ — INGESTION (sync from the Health FAQ Google Sheet into
 * faq_records). Modeled on playbookIngest.ts's syncPlaybook, but a much
 * narrower parse: only two tabs, only columns A (question) and B (answer)
 * are ever read — everything else in the sheet (extra columns, formatting,
 * other tabs) is ignored per spec.
 *
 * Answers are never rewritten/summarized/"improved" here — see cellText,
 * which only trims and normalizes line endings, never touches wording.
 */

import type { Repositories } from "../db/repositories/index.js";
import type { CreateFaqRecordEntry } from "../db/repositories/faqRecordsRepository.js";
import type { KbResourceRow } from "../db/schema.js";
import { embedDocumentChunks } from "./embeddings.js";
import { contentHash } from "./pdfIngest.js";
import { fetchFaqSheetValues, FAQ_SPREADSHEET_ID } from "./faqSheetsClient.js";

export const FAQ_DITTO_RESOURCE_TITLE = "Health FAQ";
// Pre-rename title (2026-08: "Ditto FAQ" -> "Health FAQ"). Kept only so the
// lookups below still find an already-existing resource row instead of
// creating a duplicate — see syncFaq's `existing` lookup, which self-heals
// the row's title to FAQ_DITTO_RESOURCE_TITLE on the very next sync.
const FAQ_DITTO_RESOURCE_TITLE_LEGACY = "Ditto FAQ";

// Only these two tabs, per spec §1 — every other tab in the workbook is
// ignored entirely, not even fetched.
const FAQ_TABS: { sheetName: string; category: "health_product" | "operations_health" }[] = [
  { sheetName: "Sheet1", category: "health_product" },
  { sheetName: "Operations Health FAQs", category: "operations_health" },
];

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\r\n/g, "\n").trim();
}

/** trim + collapse internal whitespace + casefold — the actual duplicate-
 * detection key. Deliberately NOT a fuzzy/semantic match (spec §18 is about
 * catching the *same* question typed twice, not merging genuinely different
 * questions) — semantic near-duplicates that read differently in the sheet
 * are left as distinct records; only a near-identical typed match collides. */
function normalizeForDedup(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

interface RawFaqRow {
  category: "health_product" | "operations_health";
  question: string;
  answer: string;
  sourceRowNumber: number;
}

/** Parses one tab's raw cell grid into RawFaqRow entries — row 1 is always
 * the header and is skipped; any row with no question (Column A blank) is
 * dropped entirely (nothing to index, not even as "incomplete" — an
 * incomplete FAQ per spec §17 has a real question and a missing answer, not
 * a missing question). */
function parseFaqTab(rows: unknown[][], category: "health_product" | "operations_health"): RawFaqRow[] {
  const out: RawFaqRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const question = cellText(row[0]);
    const answer = cellText(row[1]);
    if (!question) continue;
    out.push({ category, question, answer, sourceRowNumber: r + 1 });
  }
  return out;
}

export interface FaqDedupResult {
  entries: CreateFaqRecordEntry[];
  totalParsed: number;
  answerable: number;
  incomplete: number;
  conflicting: number;
  duplicatesCollapsed: number;
}

/**
 * Groups rows by (category, normalized question) and resolves each group
 * per spec §18:
 *   - one row in the group -> kept as-is (isAnswerable = has a real answer).
 *   - every row's normalized answer identical (including all-blank) -> one
 *     canonical record (the first occurrence's ORIGINAL, unnormalized text —
 *     never rewritten), the rest silently collapsed (they carried no extra
 *     information, so this isn't "silently choosing" between different
 *     answers, just deduplicating identical ones).
 *   - answers differ in any way (including a blank next to a real answer,
 *     deliberately conservative — spec §18 rule 5: "never silently choose
 *     one answer over another") -> EVERY row in the group is kept, flagged
 *     hasConflict=true/isAnswerable=false, sharing a conflictGroupKey so the
 *     admin review UI can group them. None of these get embedded/retrieved.
 * `resourceId` is filled in by the caller (syncFaq) since it isn't known
 * until the kb_resources row exists.
 */
export function dedupeAndDetectConflicts(rows: RawFaqRow[]): FaqDedupResult {
  const groups = new Map<string, RawFaqRow[]>();
  for (const row of rows) {
    const key = `${row.category}::${normalizeForDedup(row.question)}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const entries: CreateFaqRecordEntry[] = [];
  let answerable = 0;
  let incomplete = 0;
  let conflicting = 0;
  let duplicatesCollapsed = 0;

  for (const [key, group] of groups) {
    if (group.length === 1) {
      const row = group[0];
      const isAnswerable = row.answer.trim() !== "";
      entries.push({
        resourceId: 0,
        category: row.category,
        question: row.question,
        answer: row.answer,
        isAnswerable,
        hasConflict: false,
        conflictGroupKey: null,
        questionEmbedding: null, // filled in after batch-embedding below
        sourceRowNumber: row.sourceRowNumber,
        isActive: true,
      });
      if (isAnswerable) answerable++;
      else incomplete++;
      continue;
    }

    const distinctAnswers = new Set(group.map(r => normalizeForDedup(r.answer)));
    if (distinctAnswers.size === 1) {
      // Materially identical (or identically blank) across every duplicate —
      // collapse to one canonical record using the FIRST occurrence's exact
      // original text (never a rewritten/merged version).
      const canonical = group[0];
      const isAnswerable = canonical.answer.trim() !== "";
      entries.push({
        resourceId: 0,
        category: canonical.category,
        question: canonical.question,
        answer: canonical.answer,
        isAnswerable,
        hasConflict: false,
        conflictGroupKey: null,
        questionEmbedding: null,
        sourceRowNumber: canonical.sourceRowNumber,
        isActive: true,
      });
      if (isAnswerable) answerable++;
      else incomplete++;
      duplicatesCollapsed += group.length - 1;
    } else {
      // Genuinely conflicting duplicate answers — flag every row, resolve
      // none of them automatically (spec §18).
      for (const row of group) {
        entries.push({
          resourceId: 0,
          category: row.category,
          question: row.question,
          answer: row.answer,
          isAnswerable: false,
          hasConflict: true,
          conflictGroupKey: key,
          questionEmbedding: null,
          sourceRowNumber: row.sourceRowNumber,
          isActive: true,
        });
      }
      conflicting += group.length;
    }
  }

  return { entries, totalParsed: rows.length, answerable, incomplete, conflicting, duplicatesCollapsed };
}

export interface SyncFaqResult {
  resource: KbResourceRow;
  totalRecords: number;
  answerableCount: number;
  incompleteCount: number;
  conflictingCount: number;
  duplicatesCollapsed: number;
  skipped: boolean;
}

/**
 * Fetches both FAQ tabs live, dedupes/flags conflicts, embeds only the
 * clean answerable questions, and stores everything — idempotent the same
 * way syncPlaybook is: if the combined raw tab data hashes the same as last
 * time, storage is left untouched (no wasted embedding calls) unless the
 * resource was previously left in an "error" state.
 *
 * The Health FAQ resource is created inside the SAME "general" category the
 * Product Playbook already lives in (the "Org Constitution" section — see
 * 0041_ditto_faq.sql's data-only rename, later renamed again by
 * 0044_org_constitution_rename.sql) rather than a new category, so
 * it appears as a peer resource in the existing accordion/card UI with zero
 * new UI components.
 */
export async function syncFaq(repos: Repositories, triggeredBy: string): Promise<SyncFaqResult> {
  const categories = await repos.kbCategories.list();
  const generalCategory = categories.find(c => c.type === "general");
  if (!generalCategory) {
    throw new Error(
      'No "General" Knowledge Base category exists yet — create one first in Knowledge Base Management, then resync the Health FAQ.'
    );
  }

  const existing = (await repos.kbResources.list({})).find(
    r => r.type === "sheet" && (r.title === FAQ_DITTO_RESOURCE_TITLE || r.title === FAQ_DITTO_RESOURCE_TITLE_LEGACY)
  );
  const wasErrored = existing?.status === "error";
  let resource = existing;
  if (!resource) {
    resource = await repos.kbResources.create({
      categoryId: generalCategory.id,
      type: "sheet",
      title: FAQ_DITTO_RESOURCE_TITLE,
      documentType: "other",
      sourceUrl: `https://docs.google.com/spreadsheets/d/${FAQ_SPREADSHEET_ID}/edit`,
      status: "processing",
      contentHash: null,
      lastFetchedAt: null,
      chunkCount: 0,
      errorMessage: null,
      planTags: [],
      addedBy: triggeredBy,
    });
  } else {
    // Also carries the title rename through for a row still on the legacy
    // "Ditto FAQ" name — self-heals on this very sync, no separate
    // migration/backfill needed.
    resource = (await repos.kbResources.update(resource.id, {
      status: "processing",
      errorMessage: null,
      title: FAQ_DITTO_RESOURCE_TITLE,
    }))!;
  }
  const resourceId = resource!.id;
  const previousHash = existing?.contentHash ?? null;

  try {
    const tabData: Record<string, unknown[][]> = {};
    for (const tab of FAQ_TABS) {
      tabData[tab.sheetName] = await fetchFaqSheetValues(tab.sheetName);
    }

    const hash = contentHash(JSON.stringify(tabData));
    if (!wasErrored && previousHash === hash) {
      const unchanged = await repos.kbResources.update(resourceId, { status: "active", lastFetchedAt: new Date() });
      const existingRecords = await repos.faqRecords.list({ resourceId });
      return {
        resource: unchanged!,
        totalRecords: existingRecords.length,
        answerableCount: existingRecords.filter(r => r.isAnswerable && !r.hasConflict).length,
        incompleteCount: existingRecords.filter(r => !r.isAnswerable && !r.hasConflict).length,
        conflictingCount: existingRecords.filter(r => r.hasConflict).length,
        duplicatesCollapsed: 0,
        skipped: true,
      };
    }

    const rawRows: RawFaqRow[] = [];
    for (const tab of FAQ_TABS) {
      rawRows.push(...parseFaqTab(tabData[tab.sheetName] ?? [], tab.category));
    }
    const { entries, answerable, incomplete, conflicting, duplicatesCollapsed } = dedupeAndDetectConflicts(rawRows);

    // Embed only the clean, answerable, non-conflicting entries' QUESTION
    // text (never the answer — see schema.ts's questionEmbedding comment
    // for why that alone satisfies "question receives the strongest
    // retrieval weight", spec §9).
    const embeddableIndexes = entries
      .map((e, i) => (e.isAnswerable && !e.hasConflict ? i : -1))
      .filter(i => i >= 0);
    if (embeddableIndexes.length > 0) {
      const vectors = await embedDocumentChunks(embeddableIndexes.map(i => entries[i].question));
      embeddableIndexes.forEach((entryIndex, vecIndex) => {
        entries[entryIndex].questionEmbedding = vectors[vecIndex];
      });
    }

    await repos.faqRecords.replaceForResource(resourceId, entries.map(e => ({ ...e, resourceId })));

    const updated = await repos.kbResources.update(resourceId, {
      status: "active",
      contentHash: hash,
      lastFetchedAt: new Date(),
      chunkCount: entries.length,
      errorMessage: null,
    });

    return {
      resource: updated!,
      totalRecords: entries.length,
      answerableCount: answerable,
      incompleteCount: incomplete,
      conflictingCount: conflicting,
      duplicatesCollapsed,
      skipped: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errored = await repos.kbResources.update(resourceId, { status: "error", errorMessage: message });
    return {
      resource: errored!,
      totalRecords: 0,
      answerableCount: 0,
      incompleteCount: 0,
      conflictingCount: 0,
      duplicatesCollapsed: 0,
      skipped: false,
    };
  }
}

// Same lazy "stale-while-revalidate" cadence as maybeRefreshPlaybookIfStale —
// see that function's comment in playbookIngest.ts for the full reasoning.
const STALE_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Best-effort, fire-and-forget staleness check — call (without awaiting)
 * from the Product Assist request path. Never throws — a failed background
 * refresh never affects the answer being generated. */
export async function maybeRefreshFaqIfStale(repos: Repositories): Promise<void> {
  try {
    const connection = await repos.kbFaqConnection.get();
    if (!connection) return;
    const resource = (await repos.kbResources.list({})).find(
      r => r.type === "sheet" && (r.title === FAQ_DITTO_RESOURCE_TITLE || r.title === FAQ_DITTO_RESOURCE_TITLE_LEGACY)
    );
    const lastFetchedMs = resource?.lastFetchedAt ? new Date(resource.lastFetchedAt).getTime() : null;
    const staleSinceMs = lastFetchedMs === null ? Infinity : Date.now() - lastFetchedMs;
    if (staleSinceMs < STALE_REFRESH_MS) return;
    await syncFaq(repos, "auto-refresh");
  } catch (err) {
    console.warn("Health FAQ background refresh failed (will retry on next stale check):", err);
  }
}
