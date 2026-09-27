/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TERM PRODUCT PLAYBOOK — INGESTION (2026-09)
 * ---------------------------------------------------------------
 * Modeled on playbookIngest.ts's syncPlaybook, but the Term Playbook's own
 * tab layouts (confirmed against the actual workbook) differ from Health's
 * in a few ways this file accounts for:
 *
 *  - "Ditto's Recommended Policies" — the master feature x plan matrix, same
 *    shape as Health's own tab of the same name, just without a leading
 *    throwaway rubric column: A=Feature, B=Sub-feature, C+=one column per
 *    plan (header row is row 1). Reshaped into kbPlaybookPlanFacts exactly
 *    like Health's.
 *  - "NRI Eligibility & Recommendation" — a SECOND feature x plan matrix
 *    (single-level feature label, no sub-feature column), but its plan
 *    header row is row 2, not row 1 (row 1 is a decorative section title).
 *    Also reshaped into kbPlaybookPlanFacts, alongside the main matrix's
 *    facts for the same plan.
 *  - "Recommendation Specific" — a use-case → recommended-policy decision
 *    table (SN / Specific Use case / Policy or Add Ons / one column per
 *    ranked recommendation), reshaped into narrative text via its own
 *    bespoke reshaper (parseRecommendationSpecificTab) since its 3-level
 *    label shape doesn't fit the generic 1-label-column narrative reshaper
 *    below.
 *  - "Features Description" (Feature/Description) and "NRI vs OCI"
 *    (Criteria/NRI/OCI) — both simple single-label-column glossary tables,
 *    reshaped via the generic parseNarrativeTab below.
 *
 * The 5 per-insurer tabs (TATA AIA, Aditya Birla Sun Life Insurance, LIC,
 * SBI Life, Kotak Life Insurance) are deliberately skipped — same "rare
 * enough that the sync cost isn't worth it" product decision Health's
 * playbookIngest.ts already applies to its own per-insurer tabs (ICICI
 * Lombard, Bajaj General, IndusInd General, Manipal Cigna, Star), and
 * conveniently, none of those 5 insurers are among the 4 Term Knowledge
 * Base categories (Axis Max Life, ICICI Prudential, HDFC Life, Bajaj Life)
 * today anyway.
 */

import type { Repositories } from "../db/repositories/index.js";
import type { CreateKbPlaybookPlanFactEntry } from "../db/repositories/kbPlaybookPlanFactsRepository.js";
import type { KbResourceRow, KbPlaybookPlanFactRow } from "../db/schema.js";
import { chunkText } from "./chunking.js";
import { embedDocumentChunks } from "./embeddings.js";
import { contentHash } from "./pdfIngest.js";
import { fetchTermPlaybookSheetValues, fetchTermPlaybookSheetNotes, TERM_PLAYBOOK_SPREADSHEET_ID } from "./termPlaybookSheetsClient.js";

export const TERM_PLAYBOOK_RESOURCE_TITLE = "Product Playbook - Term";

interface MatrixConfig {
  featureCol: number;
  /** Omitted for tabs whose feature column is a single level (no
   * sub-feature breakdown) — see "NRI Eligibility & Recommendation" below. */
  subFeatureCol?: number;
  planStartCol: number;
  /** 0-indexed row containing the plan-name headers — Health's matrix tabs
   * always have this at row 0, but "NRI Eligibility & Recommendation" has a
   * decorative section-title row above its real header row. */
  headerRowIndex: number;
}

const MATRIX_TABS: Record<string, MatrixConfig> = {
  "Ditto's Recommended Policies": { featureCol: 0, subFeatureCol: 1, planStartCol: 2, headerRowIndex: 0 },
  "NRI Eligibility & Recommendation": { featureCol: 0, planStartCol: 1, headerRowIndex: 1 },
};

/** Simple single-label-column glossary tabs — reshaped via the generic
 * parseNarrativeTab. "Recommendation Specific" is handled separately (see
 * parseRecommendationSpecificTab) since its 3-level label shape doesn't fit
 * this generic pattern. */
const GLOSSARY_TABS = ["Features Description", "NRI vs OCI"];

export const ALL_TERM_PLAYBOOK_TABS = [...Object.keys(MATRIX_TABS), "Recommendation Specific", ...GLOSSARY_TABS];

// 2026-09 — mirrors playbookIngest.ts's PLAYBOOK_PARSER_VERSION (see that
// constant's own comment for the full root-cause story): syncTermPlaybook's
// hash below was computed purely from the fetched Sheet content, so a
// parser bugfix never actually re-ran against already-ingested plans once
// the Sheet itself stopped changing — every resync kept hitting
// `previousHash === hash` and returning early. Bump this whenever
// splitInsurerAndPlan/parseTermMatrixTab/parseRecommendationSpecificTab's
// OUTPUT changes for the same raw Sheet input, so the next resync is forced
// to actually re-parse instead of silently trusting stale rows.
const TERM_PLAYBOOK_PARSER_VERSION = "2026-09-24.1";

// Known Term insurer brand prefixes a plan column header might start with —
// longest-first so "Axis Max Life Insurance" is tried before any shorter
// prefix that might otherwise partially match. Chosen to match this app's 4
// Term Knowledge Base category names exactly (Axis Max Life / ICICI
// Prudential / HDFC Life / Bajaj Life) wherever the sheet's own header text
// allows a clean strip; KbPlaybookPlanFactsRepository.findMatching's
// substring-either-way match tolerates the minor "Axis Max Life Insurance"
// vs "Axis Max Life" wording difference regardless.
const TERM_KNOWN_INSURER_PREFIXES = ["Axis Max Life Insurance", "ICICI Prudential", "HDFC Life", "Bajaj Life"].sort(
  (a, b) => b.length - a.length
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTermInsurerAndPlan(fullHeader: string): { insurer: string; plan: string } {
  const clean = fullHeader.replace(/\s+/g, " ").trim();
  for (const prefix of TERM_KNOWN_INSURER_PREFIXES) {
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

/** Reshapes one feature x plan comparison tab into one fact-sheet per plan
 * column — see playbookIngest.ts's parseMatrixTab for the Health twin this
 * mirrors; the only real difference is headerRowIndex being configurable
 * per tab. Returns entries with resourceId left at 0 — the caller
 * (syncTermPlaybook) fills in the real id.
 *
 * `notesGrid` (2026-09, Product Playbook advisor UI) — see
 * playbookIngest.ts's parseMatrixTab for the full reasoning this mirrors;
 * the only difference is the header-note row being config.headerRowIndex
 * rather than always row 0, matching this tab type's own configurable
 * header row. */
export function parseTermMatrixTab(rows: unknown[][], tabName: string, notesGrid?: (string | undefined)[][]): CreateKbPlaybookPlanFactEntry[] {
  const config = MATRIX_TABS[tabName];
  if (!config || rows.length <= config.headerRowIndex) return [];

  const headerRow = rows[config.headerRowIndex] ?? [];
  const planCols: { col: number; header: string }[] = [];
  for (let c = config.planStartCol; c < headerRow.length; c++) {
    const header = cellText(headerRow[c]);
    if (header) planCols.push({ col: c, header });
  }
  if (planCols.length === 0) return [];

  const planLines = new Map<number, string[]>();
  const planNotes = new Map<number, { label: string; note: string }[]>();
  for (const p of planCols) {
    planLines.set(p.col, []);
    const headerNote = notesGrid?.[config.headerRowIndex]?.[p.col];
    planNotes.set(p.col, headerNote ? [{ label: "Plan", note: headerNote }] : []);
  }

  let currentFeature = "";
  let currentSubFeature = "";
  for (let r = config.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const featureCell = cellText(row[config.featureCol]);
    const subFeatureCell = config.subFeatureCol !== undefined ? cellText(row[config.subFeatureCol]) : "";
    if (featureCell) {
      currentFeature = featureCell;
      currentSubFeature = subFeatureCell;
    } else if (subFeatureCell) {
      currentSubFeature = subFeatureCell;
    }

    let label = currentFeature;
    if (currentSubFeature) label += ` — ${currentSubFeature}`;
    if (!label) continue;

    for (const p of planCols) {
      const value = cellText(row[p.col]);
      if (!value) continue;
      planLines.get(p.col)!.push(`${label}: ${value}`);
      const note = notesGrid?.[r]?.[p.col];
      if (note) planNotes.get(p.col)!.push({ label, note });
    }
  }

  const entries: CreateKbPlaybookPlanFactEntry[] = [];
  for (const p of planCols) {
    const lines = planLines.get(p.col)!;
    if (lines.length === 0) continue;
    const { insurer, plan } = splitTermInsurerAndPlan(p.header);
    entries.push({
      resourceId: 0,
      domain: "Term",
      insurerName: insurer,
      planName: plan,
      sourceTab: tabName,
      content: `### ${p.header}\n\n${lines.join("\n\n")}`,
      notes: planNotes.get(p.col)!,
    });
  }
  return entries;
}

/** Generic single-label-column glossary reshaper — column 0 is the group
 * label (e.g. a feature name or a comparison criterion), every column after
 * it is a value column whose row-1 header prefixes each emitted line. Covers
 * "Features Description" (Feature/Description) and "NRI vs OCI"
 * (Criteria/NRI/OCI) without bespoke per-tab logic — see
 * playbookIngest.ts's parseNarrativeTab for the (2-label-column) Health
 * sibling this is a simplified variant of. */
export function parseTermGlossaryTab(rows: unknown[][]): string {
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
  let currentLabel = "";
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every(v => cellText(v) === "")) continue;
    const labelCell = cellText(row[0]);
    if (labelCell) currentLabel = labelCell;
    if (!currentLabel) continue;

    let group = groups[groups.length - 1]?.label === currentLabel ? groups[groups.length - 1] : undefined;
    if (!group) {
      group = { label: currentLabel, lines: [] };
      groups.push(group);
    }
    for (let c = 1; c < row.length; c++) {
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

/**
 * Bespoke reshaper for "Recommendation Specific" — a use-case decision table
 * whose 3 leading columns are SN (a bare row index, ignored), Specific Use
 * case (the real group key, forward-filled across its "Policy"/"Add Ons"
 * row pair), and a Policy/Add Ons row-type label (folded into each emitted
 * line rather than treated as its own group, since only 2 row-types repeat
 * across every use case and grouping by them would collapse all 7 use cases
 * into just those 2 buckets). Columns from index 3 on are ranked
 * recommendation slots (e.g. "Primary Recommendations" / "Secondary
 * Recommendations", each spanning several columns in the sheet's own merged
 * header row) — row 1's forward-filled header text prefixes each line.
 */
export function parseRecommendationSpecificTab(rows: unknown[][]): string {
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
  let currentUseCase = "";
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every(v => cellText(v) === "")) continue;
    const useCaseCell = cellText(row[1]);
    if (useCaseCell) currentUseCase = useCaseCell;
    if (!currentUseCase) continue;
    const rowType = cellText(row[2]);

    let group = groups[groups.length - 1]?.label === currentUseCase ? groups[groups.length - 1] : undefined;
    if (!group) {
      group = { label: currentUseCase, lines: [] };
      groups.push(group);
    }
    for (let c = 3; c < row.length; c++) {
      const value = cellText(row[c]);
      if (!value) continue;
      const header = headers[c] || `Column ${c + 1}`;
      const label = rowType ? `${header} ${rowType}` : header;
      group.lines.push(`${label}: ${value}`);
    }
  }

  return groups
    .filter(g => g.lines.length > 0)
    .map(g => `### ${g.label}\n\n${g.lines.join("\n\n")}`)
    .join("\n\n---\n\n");
}

export interface SyncTermPlaybookResult {
  resource: KbResourceRow;
  planFactCount: number;
  narrativeChunkCount: number;
  skipped: boolean;
  // Resync visibility (2026-09) — see playbookIngest.ts's SyncPlaybookResult
  // for the full reasoning; this is the Term twin of those same fields,
  // computed by the same diffPlanFacts below.
  previousPlanFactCount: number;
  previousNarrativeChunkCount: number;
  plansAdded: number;
  plansRemoved: number;
  plansChanged: number;
  plansUnchanged: number;
}

// Same key/content-only diff as playbookIngest.ts's diffPlanFacts — see that
// function's comment for the full reasoning (content-only, not notes; a
// brand-new resource's empty previous-facts list reports everything added).
function diffPlanFacts(
  previous: KbPlaybookPlanFactRow[],
  next: CreateKbPlaybookPlanFactEntry[]
): { added: number; removed: number; changed: number; unchanged: number } {
  const keyOf = (insurerName: string, planName: string) => `${insurerName.trim().toLowerCase()}::${planName.trim().toLowerCase()}`;
  const previousByKey = new Map(previous.map(f => [keyOf(f.insurerName, f.planName), f]));
  const nextKeys = new Set<string>();
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  for (const entry of next) {
    const key = keyOf(entry.insurerName, entry.planName);
    nextKeys.add(key);
    const prior = previousByKey.get(key);
    if (!prior) added++;
    else if (prior.content !== entry.content) changed++;
    else unchanged++;
  }
  let removed = 0;
  for (const key of previousByKey.keys()) {
    if (!nextKeys.has(key)) removed++;
  }
  return { added, removed, changed, unchanged };
}

/**
 * Fetches every Term Playbook tab live, reshapes and stores it, and marks
 * the resource active — idempotent the same way syncPlaybook is: if the
 * combined raw tab data hashes the same as last time, storage is left
 * untouched (no wasted embedding calls) unless the resource was previously
 * left in an "error" state.
 *
 * Created under the Term Knowledge Base's "General"/Org Constitution
 * category — the Term-domain equivalent of where syncPlaybook files
 * Health's Playbook resource.
 */
export async function syncTermPlaybook(repos: Repositories, triggeredBy: string): Promise<SyncTermPlaybookResult> {
  const categories = await repos.kbCategories.list({ domain: "Term" });
  const generalCategory = categories.find(c => c.type === "general");
  if (!generalCategory) {
    throw new Error(
      'No Term "General"/Org Constitution Knowledge Base category exists yet — create one first in Knowledge Base Management (Term toggle), then resync the Term Playbook.'
    );
  }

  // Defense-in-depth (2026-09) — mirrors playbookIngest.ts's syncPlaybook:
  // if more than one kb_resources row ever matches title/type, the highest
  // id (most recent) wins and any other exact match is cleaned up. The
  // REAL 2026-09 data-integrity bug this domain's own facts could suffer
  // from (mistagged rows under an unrelated resource, e.g. the Term FAQ)
  // is handled below by deleteOrphanedForDomain, not here — see that call's
  // comment for the full story (playbookIngest.ts's syncPlaybook hit this
  // live in production).
  const matches = (await repos.kbResources.list({})).filter(r => r.type === "sheet" && r.title === TERM_PLAYBOOK_RESOURCE_TITLE);
  const existing = matches.length > 0 ? matches.reduce((newest, r) => (r.id > newest.id ? r : newest)) : undefined;
  for (const duplicate of matches) {
    if (duplicate.id === existing!.id) continue;
    await repos.kbPlaybookPlanFacts.deleteByResource(duplicate.id);
    await repos.kbResources.delete(duplicate.id);
  }
  const wasErrored = existing?.status === "error";
  let resource = existing;
  if (!resource) {
    resource = await repos.kbResources.create({
      categoryId: generalCategory.id,
      type: "sheet",
      title: TERM_PLAYBOOK_RESOURCE_TITLE,
      sourceUrl: `https://docs.google.com/spreadsheets/d/${TERM_PLAYBOOK_SPREADSHEET_ID}/edit`,
      status: "processing",
      contentHash: null,
      lastFetchedAt: null,
      chunkCount: 0,
      errorMessage: null,
      planTags: [],
      addedBy: triggeredBy,
    });
  } else {
    // Re-pins categoryId to Term's own general category every sync too —
    // belt-and-suspenders against the same wrong-domain-category bug
    // termFaqIngest.ts's syncTermFaq had (2026-09 fix); a no-op once
    // already correct.
    resource = (await repos.kbResources.update(resource.id, { status: "processing", errorMessage: null, categoryId: generalCategory.id }))!;
  }
  const resourceId = resource!.id;

  // 2026-09 data-integrity fix — see playbookIngest.ts's syncPlaybook for
  // the full root-cause story (found live in production for Health): rows
  // can end up mistagged under an unrelated, legitimate resource's
  // resourceId (e.g. the Term FAQ's) from a historical bug, and nothing
  // else ever cleans them up since findMatching/findAllForInsurer scan the
  // whole table with no resourceId filter. Deliberately NOT "delete that
  // other resource" — only rows that don't belong under this domain's
  // canonical Term Playbook resourceId are removed.
  await repos.kbPlaybookPlanFacts.deleteOrphanedForDomain("Term", resourceId);

  const previousHash = existing?.contentHash ?? null;
  // Snapshotted before any write below — see playbookIngest.ts's syncPlaybook
  // for the full reasoning this mirrors.
  const previousFacts = await repos.kbPlaybookPlanFacts.listByResource(resourceId);
  const previousNarrativeChunkCount = resource!.chunkCount;

  try {
    const tabData: Record<string, unknown[][]> = {};
    for (const tabName of ALL_TERM_PLAYBOOK_TABS) {
      tabData[tabName] = await fetchTermPlaybookSheetValues(tabName);
    }
    // Cell notes (2026-09, Product Playbook advisor UI) — see
    // playbookIngest.ts's syncPlaybook for the full reasoning this mirrors,
    // including why these are folded into the hash below.
    const notesData: Record<string, (string | undefined)[][]> = {};
    for (const tabName of Object.keys(MATRIX_TABS)) {
      notesData[tabName] = await fetchTermPlaybookSheetNotes(tabName);
    }

    const hash = contentHash(JSON.stringify({ tabData, notesData, parserVersion: TERM_PLAYBOOK_PARSER_VERSION }));
    if (!wasErrored && previousHash === hash) {
      const unchanged = await repos.kbResources.update(resourceId, { status: "active", lastFetchedAt: new Date() });
      return {
        resource: unchanged!,
        planFactCount: previousFacts.length,
        narrativeChunkCount: unchanged!.chunkCount,
        skipped: true,
        previousPlanFactCount: previousFacts.length,
        previousNarrativeChunkCount,
        plansAdded: 0,
        plansRemoved: 0,
        plansChanged: 0,
        plansUnchanged: previousFacts.length,
      };
    }

    const planFacts: CreateKbPlaybookPlanFactEntry[] = [];
    for (const tabName of Object.keys(MATRIX_TABS)) {
      planFacts.push(...parseTermMatrixTab(tabData[tabName] ?? [], tabName, notesData[tabName]).map(e => ({ ...e, resourceId })));
    }
    const planDiff = diffPlanFacts(previousFacts, planFacts);
    await repos.kbPlaybookPlanFacts.replaceForResource(resourceId, planFacts);

    const narrativeSections = [
      parseRecommendationSpecificTab(tabData["Recommendation Specific"] ?? []),
      ...GLOSSARY_TABS.map(tabName => parseTermGlossaryTab(tabData[tabName] ?? [])),
    ].filter(Boolean);
    const narrativeText = narrativeSections.join("\n\n---\n\n");
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

    return {
      resource: updated!,
      planFactCount: planFacts.length,
      narrativeChunkCount: chunks.length,
      skipped: false,
      previousPlanFactCount: previousFacts.length,
      previousNarrativeChunkCount,
      plansAdded: planDiff.added,
      plansRemoved: planDiff.removed,
      plansChanged: planDiff.changed,
      plansUnchanged: planDiff.unchanged,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errored = await repos.kbResources.update(resourceId, { status: "error", errorMessage: message });
    return {
      resource: errored!,
      planFactCount: 0,
      narrativeChunkCount: 0,
      skipped: false,
      previousPlanFactCount: previousFacts.length,
      previousNarrativeChunkCount,
      plansAdded: 0,
      plansRemoved: 0,
      plansChanged: 0,
      plansUnchanged: 0,
    };
  }
}

// Same lazy "stale-while-revalidate" cadence as maybeRefreshPlaybookIfStale —
// see that function's comment in playbookIngest.ts for the full reasoning.
const STALE_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Best-effort, fire-and-forget staleness check — call (without awaiting)
 * from the Term Product Assist request path. Never throws — a failed
 * background refresh never affects the answer being generated. */
export async function maybeRefreshTermPlaybookIfStale(repos: Repositories): Promise<void> {
  try {
    const connection = await repos.termPlaybookConnection.get();
    if (!connection) return;
    const resource = (await repos.kbResources.list({})).find(r => r.type === "sheet" && r.title === TERM_PLAYBOOK_RESOURCE_TITLE);
    const lastFetchedMs = resource?.lastFetchedAt ? new Date(resource.lastFetchedAt).getTime() : null;
    const staleSinceMs = lastFetchedMs === null ? Infinity : Date.now() - lastFetchedMs;
    if (staleSinceMs < STALE_REFRESH_MS) return;
    await syncTermPlaybook(repos, "auto-refresh");
  } catch (err) {
    console.warn("Term Playbook background refresh failed (will retry on next stale check):", err);
  }
}
