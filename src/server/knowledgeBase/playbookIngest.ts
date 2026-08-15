/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import type { CreateKbPlaybookPlanFactEntry } from "../db/repositories/kbPlaybookPlanFactsRepository.js";
import type { KbResourceRow } from "../db/schema.js";
import { chunkText } from "./chunking.js";
import { embedDocumentChunks } from "./embeddings.js";
import { contentHash } from "./pdfIngest.js";
import { fetchPlaybookSheetValues, PLAYBOOK_SPREADSHEET_ID } from "./playbookSheetsClient.js";

/**
 * Per-tab column layout for the Playbook's feature x plan comparison tabs
 * (0-indexed columns: A=0, B=1, ...). Deliberately limited to "Ditto's
 * Recommended Policies" only — the per-insurer tabs (ICICI Lombard, Bajaj
 * General, IndusInd General, Manipal Cigna, Star) are skipped entirely per
 * explicit product decision: questions about those insurers are rare
 * enough that the sync-time/processing cost of also parsing their (each
 * slightly differently laid out) tabs isn't worth it. "Ditto's Recommended
 * Policies" is the multi-insurer master tab (a leading QA-rubric column to
 * discard, feature label, sub-feature label, then one column per plan
 * spanning several insurers — insurerName is left undefined so
 * splitInsurerAndPlan derives it per plan column from
 * KNOWN_INSURER_PREFIXES). The type keeps rubricCol/extraLabelCol as
 * optional fields (unused today) so a per-insurer tab could be added back
 * later without a shape change.
 */
const MATRIX_TABS: Record<
  string,
  { rubricCol?: number; featureCol: number; subFeatureCol: number; extraLabelCol?: number; planStartCol: number; insurerName?: string }
> = {
  "Ditto's Recommended Policies": { rubricCol: 0, featureCol: 1, subFeatureCol: 2, planStartCol: 3 },
};

/** Narrative-shaped tabs — reshaped into readable text and embedded into
 * kb_chunks like a normal document (see parseNarrativeTab), rather than
 * treated as always-injected authoritative facts. */
const NARRATIVE_TABS = ["Recommendation specifics", "Feature Description", "FAQs & Narratives"];

export const ALL_PLAYBOOK_TABS = [...Object.keys(MATRIX_TABS), ...NARRATIVE_TABS];

// Known insurer brand prefixes a plan column header might start with, used
// only for "Ditto's Recommended Policies" (the tab whose columns span
// several insurers) — longest-first so e.g. "IndusInd General" is tried
// before the shorter "IndusInd".
const KNOWN_INSURER_PREFIXES = [
  "HDFC Ergo",
  "Aditya Birla",
  "Care",
  "ICICI Lombard",
  "Bajaj Allianz",
  "IndusInd General",
  "IndusInd",
  "Manipal Cigna",
  "Star Health",
  "Star",
  "Niva Bupa",
  "Tata AIG",
].sort((a, b) => b.length - a.length);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits a plan column's full header text (e.g. "HDFC Ergo Optima
 * Secure+") into an insurer name and a bare plan name (e.g. "HDFC Ergo" /
 * "Optima Secure+") — the bare plan name is what's stored, so it matches
 * the advisor's Plans selector, which doesn't repeat the insurer already
 * chosen separately via the Insurer selector. When fallbackInsurer is
 * given (the per-insurer tabs), that insurer's own name is stripped
 * case-insensitively instead of guessing from KNOWN_INSURER_PREFIXES.
 */
export function splitInsurerAndPlan(fullHeader: string, fallbackInsurer?: string): { insurer: string; plan: string } {
  const clean = fullHeader.replace(/\s+/g, " ").trim();
  if (fallbackInsurer) {
    const re = new RegExp(`^${escapeRegex(fallbackInsurer)}\\s*`, "i");
    const stripped = clean.replace(re, "").trim();
    return { insurer: fallbackInsurer, plan: stripped || clean };
  }
  for (const prefix of KNOWN_INSURER_PREFIXES) {
    const re = new RegExp(`^${escapeRegex(prefix)}\\b\\s*`, "i");
    if (re.test(clean)) {
      const stripped = clean.replace(re, "").trim();
      return { insurer: prefix, plan: stripped || clean };
    }
  }
  return { insurer: clean, plan: clean };
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\r\n/g, "\n").trim();
}

/**
 * Reshapes one feature x plan comparison tab into one fact-sheet per plan
 * column. Feature/sub-feature labels only appear on the row where they
 * change (a merged-cell look) — forward-filled down so every data row
 * knows which feature/sub-feature it belongs to, then one "Feature — Sub-
 * feature: value" line is emitted per (row, plan-column) pair that has a
 * value. Returns entries with resourceId left at 0 — the caller
 * (syncPlaybook) fills in the real id.
 */
export function parseMatrixTab(rows: unknown[][], tabName: string): CreateKbPlaybookPlanFactEntry[] {
  const config = MATRIX_TABS[tabName];
  if (!config || rows.length === 0) return [];

  const headerRow = rows[0] ?? [];
  const planCols: { col: number; header: string }[] = [];
  for (let c = config.planStartCol; c < headerRow.length; c++) {
    const header = cellText(headerRow[c]);
    if (header) planCols.push({ col: c, header });
  }
  if (planCols.length === 0) return [];

  const planLines = new Map<number, string[]>();
  for (const p of planCols) planLines.set(p.col, []);

  let currentFeature = "";
  let currentSubFeature = "";
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const featureCell = cellText(row[config.featureCol]);
    const subFeatureCell = cellText(row[config.subFeatureCol]);
    const extraCell = config.extraLabelCol !== undefined ? cellText(row[config.extraLabelCol]) : "";
    // A new top-level feature resets the sub-feature label even when this
    // row's own sub-feature cell is blank — otherwise a stale sub-feature
    // from the previous feature's last row (e.g. "Air" from "Ambulance —
    // Air") would incorrectly keep tagging along into the next feature's
    // lines that never actually had one of their own.
    if (featureCell) {
      currentFeature = featureCell;
      currentSubFeature = subFeatureCell;
    } else if (subFeatureCell) {
      currentSubFeature = subFeatureCell;
    }

    let label = currentFeature;
    if (currentSubFeature) label += ` — ${currentSubFeature}`;
    if (extraCell) label += ` (${extraCell})`;
    if (!label) continue;

    for (const p of planCols) {
      const value = cellText(row[p.col]);
      if (!value) continue;
      planLines.get(p.col)!.push(`${label}: ${value}`);
    }
  }

  const entries: CreateKbPlaybookPlanFactEntry[] = [];
  for (const p of planCols) {
    const lines = planLines.get(p.col)!;
    if (lines.length === 0) continue;
    const { insurer, plan } = splitInsurerAndPlan(p.header, config.insurerName);
    entries.push({
      resourceId: 0,
      insurerName: insurer,
      planName: plan,
      sourceTab: tabName,
      content: `### ${p.header}\n\n${lines.join("\n\n")}`,
    });
  }
  return entries;
}

/**
 * Flattens a narrative-shaped tab (Q&A, scenario recommendations, glossary)
 * into readable text, grouped by its leftmost forward-filled label column
 * (column B, falling back to column A) — a generic reshaping that covers
 * all three narrative tabs' slightly different shapes without bespoke
 * per-tab logic. This feeds the normal chunkText()/embedding pipeline, so
 * an imperfect group heading costs nothing — the actual searchable content
 * (every other column's value, each on its own labeled line) is captured
 * either way.
 */
export function parseNarrativeTab(rows: unknown[][], _tabName: string): string {
  if (rows.length === 0) return "";
  const headerRow = rows[0] ?? [];
  const headers: string[] = [];
  let lastHeader = "";
  for (let c = 0; c < headerRow.length; c++) {
    const h = cellText(headerRow[c]);
    if (h) lastHeader = h;
    headers.push(lastHeader);
  }

  interface Group {
    label: string;
    lines: string[];
  }
  const groups: Group[] = [];
  let currentA = "";
  let currentB = "";
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every(v => cellText(v) === "")) continue;
    const aCell = cellText(row[0]);
    const bCell = cellText(row[1]);
    if (aCell) currentA = aCell;
    if (bCell) currentB = bCell;
    const groupLabel = currentB || currentA;
    if (!groupLabel) continue;

    let group = groups[groups.length - 1]?.label === groupLabel ? groups[groups.length - 1] : undefined;
    if (!group) {
      group = { label: groupLabel, lines: [] };
      groups.push(group);
    }
    for (let c = 2; c < row.length; c++) {
      const value = cellText(row[c]);
      if (!value) continue;
      const header = headers[c] || `Column ${c + 1}`;
      group.lines.push(`${header}: ${value}`);
    }
  }

  return groups
    .filter(g => g.lines.length > 0)
    .map(g => `### ${g.label}\n\n${g.lines.join("\n\n")}`)
    .join("\n\n---\n\n");
}

export interface SyncPlaybookResult {
  resource: KbResourceRow;
  planFactCount: number;
  narrativeChunkCount: number;
  skipped: boolean;
}

/**
 * Fetches every Playbook tab live, reshapes and stores it, and marks the
 * resource active — idempotent the same way ingestPdfResource is: if the
 * combined raw tab data hashes the same as last time, storage is left
 * untouched (no wasted embedding calls) unless the resource was previously
 * left in an "error" state.
 */
export async function syncPlaybook(repos: Repositories, triggeredBy: string): Promise<SyncPlaybookResult> {
  const categories = await repos.kbCategories.list();
  const generalCategory = categories.find(c => c.type === "general");
  if (!generalCategory) {
    throw new Error(
      'No "General" Knowledge Base category exists yet — create one first in Knowledge Base Management, then resync the Playbook.'
    );
  }

  const existing = (await repos.kbResources.list({})).find(r => r.type === "sheet");
  const wasErrored = existing?.status === "error";
  let resource = existing;
  if (!resource) {
    resource = await repos.kbResources.create({
      categoryId: generalCategory.id,
      type: "sheet",
      title: "Product Playbook - Health",
      sourceUrl: `https://docs.google.com/spreadsheets/d/${PLAYBOOK_SPREADSHEET_ID}/edit`,
      status: "processing",
      contentHash: null,
      lastFetchedAt: null,
      chunkCount: 0,
      errorMessage: null,
      planTags: [],
      addedBy: triggeredBy,
    });
  } else {
    resource = (await repos.kbResources.update(resource.id, { status: "processing", errorMessage: null }))!;
  }
  const resourceId = resource!.id;
  const previousHash = existing?.contentHash ?? null;

  try {
    const tabData: Record<string, unknown[][]> = {};
    for (const tabName of ALL_PLAYBOOK_TABS) {
      tabData[tabName] = await fetchPlaybookSheetValues(tabName);
    }

    const hash = contentHash(JSON.stringify(tabData));
    if (!wasErrored && previousHash === hash) {
      const unchanged = await repos.kbResources.update(resourceId, { status: "active", lastFetchedAt: new Date() });
      const existingFacts = await repos.kbPlaybookPlanFacts.listByResource(resourceId);
      return {
        resource: unchanged!,
        planFactCount: existingFacts.length,
        narrativeChunkCount: unchanged!.chunkCount,
        skipped: true,
      };
    }

    const planFacts: CreateKbPlaybookPlanFactEntry[] = [];
    for (const tabName of Object.keys(MATRIX_TABS)) {
      planFacts.push(...parseMatrixTab(tabData[tabName] ?? [], tabName).map(e => ({ ...e, resourceId })));
    }
    await repos.kbPlaybookPlanFacts.replaceForResource(resourceId, planFacts);

    const narrativeText = NARRATIVE_TABS.map(tabName => parseNarrativeTab(tabData[tabName] ?? [], tabName))
      .filter(Boolean)
      .join("\n\n---\n\n");
    const chunks = narrativeText ? chunkText(narrativeText) : [];
    await repos.kbChunks.deleteByResource(resourceId);
    if (chunks.length > 0) {
      const vectors = await embedDocumentChunks(chunks);
      await repos.kbChunks.bulkInsert(
        chunks.map((content, index) => ({ resourceId, chunkIndex: index, content, embedding: vectors[index] }))
      );
    }

    const updated = await repos.kbResources.update(resourceId, {
      status: "active",
      contentHash: hash,
      lastFetchedAt: new Date(),
      chunkCount: chunks.length,
      errorMessage: null,
    });

    return { resource: updated!, planFactCount: planFacts.length, narrativeChunkCount: chunks.length, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errored = await repos.kbResources.update(resourceId, { status: "error", errorMessage: message });
    return { resource: errored!, planFactCount: 0, narrativeChunkCount: 0, skipped: false };
  }
}

// How long a sync is trusted before the next Query Assist request kicks off
// a background refresh — a lazy "stale-while-revalidate" check rather than
// a live Sheets read on every message (the workbook is too large for
// that), and rather than an in-process setInterval (unreliable across Cloud
// Run's scale-to-zero and multi-instance behavior).
const STALE_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Best-effort, fire-and-forget staleness check — call (without awaiting)
 * from the Query Assist request path. Only actually re-fetches the sheet
 * when the last successful sync is older than STALE_REFRESH_MS or none has
 * ever run; a no-op otherwise. Never throws — callers should not await
 * this in the request's critical path, so a failed background refresh
 * never affects the answer being generated; the next stale check retries.
 */
export async function maybeRefreshPlaybookIfStale(repos: Repositories): Promise<void> {
  try {
    const connection = await repos.kbPlaybookConnection.get();
    if (!connection) return;
    const resource = (await repos.kbResources.list({})).find(r => r.type === "sheet");
    const lastFetchedMs = resource?.lastFetchedAt ? new Date(resource.lastFetchedAt).getTime() : null;
    const staleSinceMs = lastFetchedMs === null ? Infinity : Date.now() - lastFetchedMs;
    if (staleSinceMs < STALE_REFRESH_MS) return;
    await syncPlaybook(repos, "auto-refresh");
  } catch (err) {
    console.warn("Product Playbook background refresh failed (will retry on next stale check):", err);
  }
}
