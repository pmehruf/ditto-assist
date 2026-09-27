/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TERM FAQ — INGESTION (sync from the Term FAQ Google Sheet into
 * term_faq_records). Modeled on faqIngest.ts's syncFaq, including its
 * embedding step (added 2026-09, alongside term_faq_records.question_
 * embedding) now that Term Product Assist retrieves this table the same way
 * faq_records already works for Health — see that column's schema.ts
 * comment. Term FAQ is still also rotated into the Did You Know card by
 * didYouKnow.ts, a second, independent consumer of the same table.
 *
 * 7 tabs (per the product request). UNLIKE Health's fixed A=question/
 * B=answer layout, this sheet's real structure (confirmed against the
 * actual workbook) is: column A = Sub Topic/Category (ignored — not the
 * same thing as this file's per-tab `category`, which is the tab name),
 * column B = Question, column C = Answer date (ignored), and column D
 * onward = one or more ANSWER columns, each headed by an insurer name
 * (e.g. "IPru", "HDFC", "Axis MLI", "BALIC", "TATA AIA SRP/MRSS" — the
 * exact set varies per tab, and CLAIMS has just one plain "Answer" column
 * instead). parseTermFaqTab reads whatever header labels a tab's own row 1
 * actually has for D+ rather than hardcoding insurer names, so this adapts
 * automatically if a tab gains/loses/renames an insurer column. Multiple
 * non-blank answer columns are combined into one answer, each prefixed with
 * its own column header so an advisor can tell which insurer's answer
 * they're reading; a single answer column (CLAIMS) needs no prefix.
 * Answers are never rewritten/summarized/"improved" here — see cellText,
 * which only trims and normalizes line endings.
 */

import type { Repositories } from "../db/repositories/index.js";
import type { CreateTermFaqRecordEntry } from "../db/repositories/termFaqRecordsRepository.js";
import type { KbResourceRow } from "../db/schema.js";
import { contentHash } from "./pdfIngest.js";
import { fetchTermFaqSheetValues, TERM_FAQ_SPREADSHEET_ID } from "./termFaqSheetsClient.js";
import { embedDocumentChunks } from "./embeddings.js";

export const TERM_FAQ_RESOURCE_TITLE = "Term FAQ";

// Every tab is its own category — the tab name itself, verbatim, is used as
// the category value (term_faq_records.category is plain text, unlike
// Health's fixed 2-value enum) so a future tab rename/addition needs no
// schema migration, only a config change here.
const TERM_FAQ_TABS: string[] = [
  "ADD-ONS/ RIDERS",
  "ISSUANCE- COVID",
  "ISSUANCE- OTHERS",
  "ISSUANCE- PED / MEDICALS",
  "POLICY- GENERAL",
  "PREMIUMS",
  "CLAIMS",
];

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\r\n/g, "\n").trim();
}

/** trim + collapse internal whitespace + casefold — the actual duplicate-
 * detection key. Deliberately NOT a fuzzy/semantic match — only a near-
 * identical typed match collides, same convention faqIngest.ts uses. */
function normalizeForDedup(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

interface RawTermFaqRow {
  category: string;
  question: string;
  answer: string;
  sourceRowNumber: number;
}

/** Parses one tab's raw cell grid into RawTermFaqRow entries — row 1 is
 * always the header and is used to discover this tab's answer columns (see
 * this file's header comment); every row after it is data, and any row with
 * no question (Column B blank) is dropped entirely. Column A (Sub Topic/
 * Category) and Column C (Answer date) are read nowhere — the product
 * decision was to ignore both. */
function parseTermFaqTab(rows: unknown[][], category: string): RawTermFaqRow[] {
  const out: RawTermFaqRow[] = [];
  if (rows.length === 0) return out;

  const headerRow = rows[0] ?? [];
  const answerColumns: { index: number; label: string }[] = [];
  for (let c = 3; c < headerRow.length; c++) {
    const label = cellText(headerRow[c]);
    if (label) answerColumns.push({ index: c, label });
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const question = cellText(row[1]);
    if (!question) continue;

    const parts: { label: string; text: string }[] = [];
    for (const { index, label } of answerColumns) {
      const text = cellText(row[index]);
      if (text) parts.push({ label, text });
    }
    // A single answer column (CLAIMS' plain "Answer") needs no label
    // prefix. Two or more (the usual per-insurer case) get their own
    // column header prefixed onto each part, joined with a blank line.
    const answer =
      parts.length === 0 ? "" :
      parts.length === 1 ? parts[0].text :
      parts.map(p => `${p.label}:\n${p.text}`).join("\n\n");

    out.push({ category, question, answer, sourceRowNumber: r + 1 });
  }
  return out;
}

export interface TermFaqDedupResult {
  entries: CreateTermFaqRecordEntry[];
  totalParsed: number;
  answerable: number;
  incomplete: number;
  conflicting: number;
  duplicatesCollapsed: number;
}

/**
 * Groups rows by (category, normalized question) and resolves each group —
 * same rules as faqIngest.ts's dedupeAndDetectConflicts (see that function's
 * doc comment for the full reasoning): a single row is kept as-is; rows
 * sharing an identical normalized answer collapse to one canonical record;
 * rows whose answers genuinely differ are ALL kept, flagged
 * hasConflict=true/isAnswerable=false, so the Did You Know card's
 * `listAnswerableActive()` filter never surfaces an unresolved conflict.
 */
export function dedupeAndDetectTermFaqConflicts(rows: RawTermFaqRow[]): TermFaqDedupResult {
  const groups = new Map<string, RawTermFaqRow[]>();
  for (const row of rows) {
    const key = `${row.category}::${normalizeForDedup(row.question)}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const entries: CreateTermFaqRecordEntry[] = [];
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
        questionEmbedding: null, // filled in after batch-embedding below
        sourceRowNumber: canonical.sourceRowNumber,
        isActive: true,
      });
      if (isAnswerable) answerable++;
      else incomplete++;
      duplicatesCollapsed += group.length - 1;
    } else {
      for (const row of group) {
        entries.push({
          resourceId: 0,
          category: row.category,
          question: row.question,
          answer: row.answer,
          isAnswerable: false,
          hasConflict: true,
          conflictGroupKey: key,
          questionEmbedding: null, // never embedded — a conflicting row is never answerable
          sourceRowNumber: row.sourceRowNumber,
          isActive: true,
        });
      }
      conflicting += group.length;
    }
  }

  return { entries, totalParsed: rows.length, answerable, incomplete, conflicting, duplicatesCollapsed };
}

export interface SyncTermFaqResult {
  resource: KbResourceRow;
  totalRecords: number;
  answerableCount: number;
  incompleteCount: number;
  conflictingCount: number;
  duplicatesCollapsed: number;
  skipped: boolean;
}

/**
 * Fetches all 7 Term FAQ tabs live, dedupes/flags conflicts, and stores
 * everything — idempotent the same way syncFaq is: if the combined raw tab
 * data hashes the same as last time, storage is left untouched unless the
 * resource was previously left in an "error" state.
 *
 * Created in Term's own "general" Knowledge Base category (Term's Org
 * Constitution) — the Term-domain peer of where the Health FAQ resource
 * lives in Health's Org Constitution, just not one Product Assist's RAG
 * reads from (see this file's header).
 */
export async function syncTermFaq(repos: Repositories, triggeredBy: string): Promise<SyncTermFaqResult> {
  // 2026-09 bug fix: this used to list categories across BOTH domains and
  // take the first "general" match — since Health's Org Constitution
  // category was created first, .find() always returned IT, not Term's, so
  // every Term FAQ sync (including the background auto-refresh — see this
  // file's header) silently re-created/re-attached the resource under
  // Health's Org Constitution. That's why deleting it from Term never
  // stuck: the next sync just recreated it in the wrong place again. Must
  // stay scoped to Term here, matching termPlaybookIngest.ts's identical
  // category lookup.
  const categories = await repos.kbCategories.list({ domain: "Term" });
  const generalCategory = categories.find(c => c.type === "general");
  if (!generalCategory) {
    throw new Error(
      'No "General" Knowledge Base category exists yet for Term — create one first in Knowledge Base Management, then resync the Term FAQ.'
    );
  }

  const existing = (await repos.kbResources.list({})).find(r => r.type === "sheet" && r.title === TERM_FAQ_RESOURCE_TITLE);
  const wasErrored = existing?.status === "error";
  let resource = existing;
  if (!resource) {
    resource = await repos.kbResources.create({
      categoryId: generalCategory.id,
      type: "sheet",
      title: TERM_FAQ_RESOURCE_TITLE,
      documentType: "other",
      sourceUrl: `https://docs.google.com/spreadsheets/d/${TERM_FAQ_SPREADSHEET_ID}/edit`,
      status: "processing",
      contentHash: null,
      lastFetchedAt: null,
      chunkCount: 0,
      errorMessage: null,
      planTags: [],
      addedBy: triggeredBy,
    });
  } else {
    // Self-healing: also re-pin categoryId every sync, not just status —
    // an existing resource created before the fix above (or by any future
    // regression of it) would otherwise sit under the wrong domain's
    // category forever, since a plain Resync only ever hit this branch and
    // never touched categoryId. A no-op once it's already correct.
    resource = (await repos.kbResources.update(resource.id, { status: "processing", errorMessage: null, categoryId: generalCategory.id }))!;
  }
  const resourceId = resource!.id;
  const previousHash = existing?.contentHash ?? null;

  try {
    const tabData: Record<string, unknown[][]> = {};
    for (const sheetName of TERM_FAQ_TABS) {
      tabData[sheetName] = await fetchTermFaqSheetValues(sheetName);
    }

    const hash = contentHash(JSON.stringify(tabData));
    if (!wasErrored && previousHash === hash) {
      const unchanged = await repos.kbResources.update(resourceId, { status: "active", lastFetchedAt: new Date() });
      const existingRecords = await repos.termFaqRecords.list({ resourceId });
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

    const rawRows: RawTermFaqRow[] = [];
    for (const sheetName of TERM_FAQ_TABS) {
      rawRows.push(...parseTermFaqTab(tabData[sheetName] ?? [], sheetName));
    }
    const { entries, answerable, incomplete, conflicting, duplicatesCollapsed } = dedupeAndDetectTermFaqConflicts(rawRows);

    // Embed only the clean, answerable, non-conflicting entries' QUESTION
    // text — same convention (and same reasoning) as faqIngest.ts's
    // identical step: never the answer, since that alone is what gives
    // "question receives the strongest retrieval weight".
    const embeddableIndexes = entries
      .map((e, i) => (e.isAnswerable && !e.hasConflict ? i : -1))
      .filter(i => i >= 0);
    if (embeddableIndexes.length > 0) {
      const vectors = await embedDocumentChunks(embeddableIndexes.map(i => entries[i].question));
      embeddableIndexes.forEach((entryIndex, vecIndex) => {
        entries[entryIndex].questionEmbedding = vectors[vecIndex];
      });
    }

    await repos.termFaqRecords.replaceForResource(resourceId, entries.map(e => ({ ...e, resourceId })));

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

// Same lazy "stale-while-revalidate" cadence as maybeRefreshFaqIfStale — see
// that function's comment in faqIngest.ts for the full reasoning.
const STALE_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Best-effort, fire-and-forget staleness check — call (without awaiting)
 * from the Did You Know card's request path. Never throws — a failed
 * background refresh never affects the response being served. */
export async function maybeRefreshTermFaqIfStale(repos: Repositories): Promise<void> {
  try {
    const connection = await repos.termFaqConnection.get();
    if (!connection) return;
    const resource = (await repos.kbResources.list({})).find(r => r.type === "sheet" && r.title === TERM_FAQ_RESOURCE_TITLE);
    const lastFetchedMs = resource?.lastFetchedAt ? new Date(resource.lastFetchedAt).getTime() : null;
    const staleSinceMs = lastFetchedMs === null ? Infinity : Date.now() - lastFetchedMs;
    if (staleSinceMs < STALE_REFRESH_MS) return;
    await syncTermFaq(repos, "auto-refresh");
  } catch (err) {
    console.warn("Term FAQ background refresh failed (will retry on next stale check):", err);
  }
}
