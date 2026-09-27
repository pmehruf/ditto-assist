/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Repositories } from "../db/repositories/index.js";
import type { CreateKbPlaybookPlanFactEntry } from "../db/repositories/kbPlaybookPlanFactsRepository.js";
import type { KbResourceRow, KbPlaybookPlanFactRow } from "../db/schema.js";
import { chunkText } from "./chunking.js";
import { embedDocumentChunks } from "./embeddings.js";
import { contentHash } from "./pdfIngest.js";
import { fetchPlaybookSheetValues, fetchPlaybookSheetNotes, PLAYBOOK_SPREADSHEET_ID } from "./playbookSheetsClient.js";

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

// 2026-09 — bump this whenever splitInsurerAndPlan/parseMatrixTab/
// parseNarrativeTab's OUTPUT changes for the same raw Sheet input (a new
// KNOWN_INSURER_PREFIXES entry, a new PREFIX_IS_PART_OF_PLAN_NAME/
// PLAN_HEADER_INSURER_OVERRIDE exception, a reshaping of `content`, etc.).
// Root-caused 2026-09: syncPlaybook's hash (below) was computed purely from
// the fetched Sheet content, so a parser bugfix deployed to production never
// actually took effect against already-ingested plans — every resync kept
// hitting `previousHash === hash` (the Sheet itself hadn't changed) and
// returning early without ever re-running the fixed parser, leaving stale,
// wrongly-parsed rows (e.g. Care Health's "Care Supreme" stored as
// insurerName="Care"/planName="Supreme" instead of planName="Care Supreme")
// in kb_playbook_plan_facts indefinitely, no matter how many times an admin
// clicked Resync or how many times the app was redeployed. Folding this
// version into the hash means a parser change forces a real re-parse even
// when the Sheet is byte-identical to last time.
const PLAYBOOK_PARSER_VERSION = "2026-09-24.1";

// Extracted from syncPlaybook's inline literal so other call sites (the
// Product Assist Library's Core Resources section — see server.ts's
// /api/product-assist/library) can identify this exact resource row by title
// rather than duplicating the string, or relying on type==="sheet" alone
// (ambiguous now that faqIngest.ts's Health FAQ resource is also
// type==="sheet" — see FAQ_DITTO_RESOURCE_TITLE there).
export const PLAYBOOK_RESOURCE_TITLE = "Product Playbook - Health";

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

// Entries in KNOWN_INSURER_PREFIXES above whose brand name is also
// genuinely part of the PLAN's own marketed name for at least some of that
// insurer's plans — e.g. Care Health markets its retail plans as "Care
// Supreme", "Care Freedom", "Care Heart", with "Care" itself as part of the
// product name, not a redundant insurer label the advisor's Plans selector
// expects stripped off (unlike "HDFC Ergo Optima Secure+", where "Optima
// Secure+" is the standalone product name and "HDFC Ergo" genuinely is
// redundant once the advisor has already picked that insurer separately).
// Discovered 2026-09 via a live wrong-answer report: every Care Health plan
// fact was being stored as "Supreme"/"Freedom"/"Heart"/etc. — silently
// unmatchable against kb_categories.planNames's actual roster ("Care
// Supreme", "Care Freedom", "Care Heart"), so findMatching() always
// returned zero rows for Care Health and Product Assist silently fell back
// to DOCUMENT EXCERPTS with no Playbook backing, and with the "not Playbook-
// confirmed" caveat also not printing (a separate prompt-side gap). For a
// prefix in this set, the insurer is still identified from it, but it is
// NOT stripped from the stored plan name.
const PREFIX_IS_PART_OF_PLAN_NAME = new Set(["Care"]);

// Full plan-column headers (in the master multi-insurer tab) whose insurer
// can't be inferred by prefix-matching at all, because — unlike every other
// case KNOWN_INSURER_PREFIXES/PREFIX_IS_PART_OF_PLAN_NAME handles — the
// header doesn't literally start with the insurer's own brand word.
// "Ultimate Care" is a real, named Care Health plan, but its header is just
// "Ultimate Care" with no leading "Care" for the KNOWN_INSURER_PREFIXES loop
// below to catch, so it used to fall through to the final
// `{ insurer: clean, plan: clean }` fallback and get stored with
// insurerName="Ultimate Care" — which then never loosely matched the "Care
// Health" category name in findMatching's insurer check
// (kbPlaybookPlanFactsRepository.ts), so this one plan's facts silently
// never surfaced (found 2026-09, same investigation as
// PREFIX_IS_PART_OF_PLAN_NAME above). Keyed lowercase, matched against the
// full cleaned header — deliberately a small, explicit table of known
// exceptions rather than a broader "does this header contain some insurer's
// brand word anywhere" heuristic, which would risk misassigning an
// unrelated plan whose name happens to contain another insurer's word.
const PLAN_HEADER_INSURER_OVERRIDE: Record<string, string> = {
  "ultimate care": "Care",
};

/**
 * Splits a plan column's full header text (e.g. "HDFC Ergo Optima
 * Secure+") into an insurer name and a bare plan name (e.g. "HDFC Ergo" /
 * "Optima Secure+") — the bare plan name is what's stored, so it matches
 * the advisor's Plans selector, which doesn't repeat the insurer already
 * chosen separately via the Insurer selector (except where
 * PREFIX_IS_PART_OF_PLAN_NAME says the selector's own plan names DO repeat
 * it — see that set's comment). When fallbackInsurer is given (the
 * per-insurer tabs), that insurer's own name is stripped case-insensitively
 * instead of guessing from KNOWN_INSURER_PREFIXES.
 */
export function splitInsurerAndPlan(fullHeader: string, fallbackInsurer?: string): { insurer: string; plan: string } {
  const clean = fullHeader.replace(/\s+/g, " ").trim();
  if (fallbackInsurer) {
    const re = new RegExp(`^${escapeRegex(fallbackInsurer)}\\s*`, "i");
    const stripped = clean.replace(re, "").trim();
    return { insurer: fallbackInsurer, plan: stripped || clean };
  }
  const overrideInsurer = PLAN_HEADER_INSURER_OVERRIDE[clean.toLowerCase()];
  if (overrideInsurer) return { insurer: overrideInsurer, plan: clean };
  for (const prefix of KNOWN_INSURER_PREFIXES) {
    const re = new RegExp(`^${escapeRegex(prefix)}\\b\\s*`, "i");
    if (re.test(clean)) {
      if (PREFIX_IS_PART_OF_PLAN_NAME.has(prefix)) return { insurer: prefix, plan: clean };
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
 *
 * `notesGrid` (2026-09, Product Playbook advisor UI) is an optional sparse
 * grid of cell notes, same row/column indices as `rows` — see
 * playbookSheetsClient.ts's fetchPlaybookSheetNotes. When given, a note on
 * a plan's header cell is captured as {label: "Plan", note}, and a note on
 * a specific (row, plan-column) value cell is captured as {label, note}
 * using that row's own feature/sub-feature label — attached to the emitted
 * entry's `notes` array, entirely separate from `content` (which stays
 * exactly as before regardless of whether notes are present).
 */
export function parseMatrixTab(rows: unknown[][], tabName: string, notesGrid?: (string | undefined)[][]): CreateKbPlaybookPlanFactEntry[] {
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
  const planNotes = new Map<number, { label: string; note: string }[]>();
  for (const p of planCols) {
    planLines.set(p.col, []);
    const headerNote = notesGrid?.[0]?.[p.col];
    planNotes.set(p.col, headerNote ? [{ label: "Plan", note: headerNote }] : []);
  }

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
      const note = notesGrid?.[r]?.[p.col];
      if (note) planNotes.get(p.col)!.push({ label, note });
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
      notes: planNotes.get(p.col)!,
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
  // Resync visibility (2026-09, by advisor/admin request — the resync
  // button used to report only the new totals, giving no way to tell
  // whether a resync actually changed anything or just re-confirmed the
  // same data). Counts are computed by diffPlanFacts() below, comparing
  // this run's plan facts against whatever was stored for this resource
  // immediately before this sync (an empty set on a brand-new resource, so
  // a first-ever sync simply reports everything as "added"). Left at 0 in
  // the `skipped` (unchanged) and error-caught paths, where nothing was
  // actually compared/written.
  previousPlanFactCount: number;
  previousNarrativeChunkCount: number;
  plansAdded: number;
  plansRemoved: number;
  plansChanged: number;
  plansUnchanged: number;
}

/**
 * Compares this sync's freshly-parsed plan facts against whatever was
 * stored for this resource going into this sync, keyed by (insurer, plan) —
 * the same case-insensitive key used to identify "the same plan" elsewhere.
 * A plan present in both with identical `content` is unchanged; different
 * `content` (a feature/sub-feature value, a note, anything the sheet
 * reshapes into that string) counts as changed. Deliberately content-only
 * (not notes) — notes are supplementary annotations, not the facts
 * Product Assist actually reads, so a notes-only edit isn't surfaced here as
 * a plan "change" the advisor needs to know about.
 */
export function diffPlanFacts(
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
 * Fetches every Playbook tab live, reshapes and stores it, and marks the
 * resource active — idempotent the same way ingestPdfResource is: if the
 * combined raw tab data hashes the same as last time, storage is left
 * untouched (no wasted embedding calls) unless the resource was previously
 * left in an "error" state.
 */
export async function syncPlaybook(repos: Repositories, triggeredBy: string): Promise<SyncPlaybookResult> {
  // Explicitly scoped to Health — see faqIngest.ts's syncFaq for why an
  // unscoped kbCategories.list() here is a latent version of the exact bug
  // termFaqIngest.ts's syncTermFaq had (2026-09 fix): it "works" today only
  // because Health's Org Constitution happens to be the first "general"
  // category created, not because it's actually guaranteed to be Health's.
  const categories = await repos.kbCategories.list({ domain: "Health" });
  const generalCategory = categories.find(c => c.type === "general");
  if (!generalCategory) {
    throw new Error(
      'No "General" Knowledge Base category exists yet for Health — create one first in Knowledge Base Management, then resync the Playbook.'
    );
  }

  // Matched by title, not merely type==="sheet" — faqIngest.ts's Health FAQ
  // resource is also type==="sheet", so an unqualified match here could grab
  // the FAQ's row instead and overwrite it with Playbook data. (No legacy-
  // title concern here, unlike faqIngest.ts's rename — this title has never
  // changed.)
  //
  // Defense-in-depth (2026-09): if more than one kb_resources row ever
  // matches (title/type) — which shouldn't happen given the guard above,
  // but did once historically before the guard existed, see
  // deleteOrphanedForDomain's comment for the full story — the highest id
  // (most recently created) is treated as canonical, and any other exact
  // title/type match is cleaned up so it can never silently linger.
  const matches = (await repos.kbResources.list({})).filter(r => r.type === "sheet" && r.title === PLAYBOOK_RESOURCE_TITLE);
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
      title: PLAYBOOK_RESOURCE_TITLE,
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
    // Re-pins categoryId to Health's own general category every sync too —
    // belt-and-suspenders against the same wrong-domain-category bug
    // termFaqIngest.ts's syncTermFaq had (2026-09 fix); a no-op once
    // already correct.
    resource = (await repos.kbResources.update(resource.id, { status: "processing", errorMessage: null, categoryId: generalCategory.id }))!;
  }
  const resourceId = resource!.id;

  // 2026-09 data-integrity fix, found via a live production DB query: 8
  // Health rows (Care Health's plan facts, stored with the OLD, un-fixed
  // plan names — e.g. "Advantage" instead of "Care Advantage") were sitting
  // under a resourceId that turned out to belong to the ACTIVE, legitimate
  // Health FAQ resource, not a duplicate Playbook resource. Likely history:
  // before the title-matching guard above existed, an earlier sync matched
  // by type==="sheet" alone and could grab any sheet-type resource it found
  // first, then wrote Playbook facts under ITS resourceId — here, the FAQ's.
  // Once the guard was added, every later sync correctly reused the real
  // Playbook resource, but those old mistagged rows were never touched by
  // anything since (findMatching/findAllForInsurer scan the whole table
  // with no resourceId filter), so they kept competing with the correct
  // rows for the same plan forever. Deliberately NOT "delete that other
  // resource" — it may be a real, unrelated, actively-used resource (as the
  // FAQ is here) — only rows that don't belong under THIS domain's
  // canonical Playbook resourceId are removed. Runs unconditionally, before
  // the hash check below, so it self-heals on every sync regardless of
  // whether this run turns out to skip re-parsing.
  await repos.kbPlaybookPlanFacts.deleteOrphanedForDomain("Health", resourceId);

  const previousHash = existing?.contentHash ?? null;
  // Snapshotted before any write below — see diffPlanFacts and
  // SyncPlaybookResult's own comments. [] on a brand-new resource, exactly
  // like the "skipped" branch already relied on listByResource returning.
  const previousFacts = await repos.kbPlaybookPlanFacts.listByResource(resourceId);
  const previousNarrativeChunkCount = resource!.chunkCount;

  try {
    const tabData: Record<string, unknown[][]> = {};
    for (const tabName of ALL_PLAYBOOK_TABS) {
      tabData[tabName] = await fetchPlaybookSheetValues(tabName);
    }
    // Cell notes (2026-09, Product Playbook advisor UI) — only fetched for
    // the matrix tabs, since only those feed kb_playbook_plan_facts.notes;
    // narrative tabs are chunked/embedded as prose and have no per-cell
    // note concept here. Folded into the hash below alongside tabData so a
    // sheet edit that changes ONLY a note (no value) still triggers a
    // resync — otherwise a stale note could linger forever undetected.
    const notesData: Record<string, (string | undefined)[][]> = {};
    for (const tabName of Object.keys(MATRIX_TABS)) {
      notesData[tabName] = await fetchPlaybookSheetNotes(tabName);
    }

    const hash = contentHash(JSON.stringify({ tabData, notesData, parserVersion: PLAYBOOK_PARSER_VERSION }));
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
      planFacts.push(...parseMatrixTab(tabData[tabName] ?? [], tabName, notesData[tabName]).map(e => ({ ...e, resourceId })));
    }
    const planDiff = diffPlanFacts(previousFacts, planFacts);
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

// How long a sync is trusted before the next Product Assist request kicks off
// a background refresh — a lazy "stale-while-revalidate" check rather than
// a live Sheets read on every message (the workbook is too large for
// that), and rather than an in-process setInterval (unreliable across Cloud
// Run's scale-to-zero and multi-instance behavior).
const STALE_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Best-effort, fire-and-forget staleness check — call (without awaiting)
 * from the Product Assist request path. Only actually re-fetches the sheet
 * when the last successful sync is older than STALE_REFRESH_MS or none has
 * ever run; a no-op otherwise. Never throws — callers should not await
 * this in the request's critical path, so a failed background refresh
 * never affects the answer being generated; the next stale check retries.
 */
export async function maybeRefreshPlaybookIfStale(repos: Repositories): Promise<void> {
  try {
    const connection = await repos.kbPlaybookConnection.get();
    if (!connection) return;
    const resource = (await repos.kbResources.list({})).find(r => r.type === "sheet" && r.title === PLAYBOOK_RESOURCE_TITLE);
    const lastFetchedMs = resource?.lastFetchedAt ? new Date(resource.lastFetchedAt).getTime() : null;
    const staleSinceMs = lastFetchedMs === null ? Infinity : Date.now() - lastFetchedMs;
    if (staleSinceMs < STALE_REFRESH_MS) return;
    await syncPlaybook(repos, "auto-refresh");
  } catch (err) {
    console.warn("Product Playbook background refresh failed (will retry on next stale check):", err);
  }
}
