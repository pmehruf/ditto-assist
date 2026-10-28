/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * QA announcement sheet sync.
 *
 * Reads the "QA-Feed" tab of the "Bot Alert - QA Announcements" Google Sheet
 * (published to the web as CSV — read-only, no Google login needed) and
 * mirrors it into the `announcements` table:
 *
 *   - Rows are matched by their QA ID (e.g. QAH261009), stored in
 *     announcements.qa_id, so running a sync twice never creates duplicates.
 *   - Announcements that were typed in by hand before this feature existed
 *     (qa_id = NULL) are matched by announcement date + title (and a body
 *     check when several share a date + title). A matched row only gets its
 *     QA ID attached — its content is NOT overwritten.
 *   - A sheet row that is already linked is updated only when its content
 *     fingerprint changed in the sheet.
 *   - Nothing is ever deleted by the sync.
 *   - The FIRST ever sync (the historical backfill), and any row announced
 *     more than HISTORIC_AFTER_DAYS ago, is imported as history: no
 *     read-and-acknowledge popup and created_at = the announcement date, so
 *     advisors are not asked to acknowledge old announcements.
 */

import { createHash } from "crypto";
import type { AnyDb } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import type { AnnouncementRow, NewAnnouncementRow } from "./db/schema.js";

/** Published CSV of the QA-Feed tab. Override with QA_FEED_CSV_URL. */
export const DEFAULT_QA_FEED_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS7NfutrzkJnBfDfgBT3jwmwIoabuCtxpFgPLiLyzG1_u5SHHj_xOQpJ60w4eJfXfbWklSQM3QcEC1L/pub?gid=1431782339&single=true&output=csv";

export const SYNC_ADDED_BY = "QA Sheet Sync";
/** A new sheet row announced longer ago than this is treated as history (no acknowledgement popup). */
export const HISTORIC_AFTER_DAYS = 14;
/** Minimum gap between two syncs (protects the sheet and the database from button mashing). */
export const SYNC_COOLDOWN_MS = 30_000;
/** The automatic check runs when the last successful sync is older than this. */
export const AUTO_SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

export interface FeedItem {
  qaId: string;
  team: "Health" | "Term" | "Both";
  title: string;
  announcementDate: string; // YYYY-MM-DD
  effectiveDate: string | null; // YYYY-MM-DD
  rating: number | null;
  html: string;
  reviewNote: string;
  alreadyInForce: boolean;
  effectiveImmediately: boolean;
  hash: string;
}

export interface SyncResult {
  ok: boolean;
  trigger: string;
  added: number;
  updated: number;
  linked: number;
  unchanged: number;
  skipped: number;
  /** Hand-typed QA announcements that no sheet row matched (left untouched). */
  unmatchedLegacy: Array<{ id: number; title: string; announcementDate: string | null }>;
  /** Linked legacy rows whose effective date differs from the sheet's. */
  effectiveDateDiffs: Array<{ qaId: string; title: string; app: string | null; sheet: string | null }>;
  newItems: Array<{ qaId: string; title: string; announcementDate: string }>;
  message: string;
  throttled?: boolean;
}

// ───────────────────────── CSV parsing ─────────────────────────

/** Minimal RFC-4180 parser (quoted fields, doubled quotes, CRLF/LF, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** "27/10/2026" or "2026-10-27" → "2026-10-27"; anything unreadable → null. */
export function toIsoDate(raw: string): string | null {
  const s = String(raw ?? "").trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const REQUIRED_HEADERS = ["ID", "Applies To", "Title", "Announcement Date", "Effective Date", "Severity", "Summary (HTML)"];

export function parseFeed(csvText: string): { items: FeedItem[]; skipped: number } {
  const rows = parseCsv(csvText);
  if (rows.length < 1) throw new Error("The QA feed is empty.");
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  for (const h of REQUIRED_HEADERS) {
    if (idx(h) < 0) throw new Error(`The QA feed is missing the "${h}" column — was the sheet layout changed?`);
  }
  const col = {
    id: idx("ID"), team: idx("Applies To"), title: idx("Title"), ann: idx("Announcement Date"), eff: idx("Effective Date"),
    sev: idx("Severity"), html: idx("Summary (HTML)"), note: idx("Review Note"), inForce: idx("Already In-Force"),
    immediate: idx("Effective Immediately"), hash: idx("Content Hash"),
  };
  const get = (r: string[], c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const qaId = get(r, col.id);
    const annDate = toIsoDate(get(r, col.ann));
    const html = (r[col.html] ?? "").trim();
    const title = get(r, col.title);
    if (!/^QA[HTBX]\d{6,}$/.test(qaId) || !annDate || !html || !title || seen.has(qaId)) { skipped++; continue; }
    seen.add(qaId);
    const teamRaw = get(r, col.team);
    const team: FeedItem["team"] = teamRaw === "Term" ? "Term" : teamRaw === "Both" ? "Both" : "Health";
    const sevNum = parseInt(get(r, col.sev), 10);
    const rating = sevNum >= 1 && sevNum <= 5 ? sevNum : null;
    const alreadyInForce = /^yes$/i.test(get(r, col.inForce));
    const effectiveImmediately = /^yes$/i.test(get(r, col.immediate));
    let effectiveDate = toIsoDate(get(r, col.eff));
    if (!effectiveDate && effectiveImmediately) effectiveDate = annDate;
    const hash = createHash("sha256")
      .update([qaId, team, title, annDate, effectiveDate ?? "", rating ?? "", html].join("\u0001"))
      .digest("hex")
      .slice(0, 16);
    items.push({
      qaId, team, title, announcementDate: annDate, effectiveDate: alreadyInForce && !effectiveDate ? null : effectiveDate,
      rating, html, reviewNote: get(r, col.note), alreadyInForce, effectiveImmediately, hash,
    });
  }
  return { items, skipped };
}

export async function fetchFeedCsv(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Could not read the QA feed (HTTP ${res.status}).`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("The QA feed link returned a web page instead of CSV — check that the sheet tab is still published.");
  return text;
}

// ───────────────────────── matching ─────────────────────────

export function plainText(html: string): string {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function normKey(s: string): string {
  return plainText(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(html: string): Set<string> {
  return new Set(normKey(html).split(" ").filter((w) => w.length > 3).slice(0, 80));
}
export function bodySimilarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / Math.min(A.size, B.size);
}

/**
 * Finds the hand-typed (qa_id NULL) QA announcement that corresponds to a feed row.
 * Same announcement date is required. Then: unique title match wins; otherwise the
 * best body match above 0.5; otherwise no match.
 */
export function findLegacyMatch(item: FeedItem, pool: AnnouncementRow[]): AnnouncementRow | undefined {
  const sameDay = pool.filter((r) => r.announcementDate === item.announcementDate);
  if (!sameDay.length) return undefined;
  const t = normKey(item.title);
  const titleHits = sameDay.filter((r) => normKey(r.title || r.category) === t || normKey(r.category) === t);
  if (titleHits.length === 1) return titleHits[0];
  const candidates = titleHits.length ? titleHits : sameDay;
  let best: AnnouncementRow | undefined;
  let bestScore = 0;
  for (const r of candidates) {
    const score = bodySimilarity(item.html, r.announcement);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : undefined;
}

// ───────────────────────── the sync ─────────────────────────

let running = false;

function daysBetween(isoDate: string, now: Date): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return (now.getTime() - Date.UTC(y, m - 1, d)) / 86_400_000;
}

export async function syncAnnouncementsFromSheet(
  db: AnyDb,
  opts: { trigger: string; force?: boolean; csvText?: string; now?: Date } = { trigger: "manual" }
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const { announcements } = createRepositories(db);
  const blank: SyncResult = {
    ok: false, trigger: opts.trigger, added: 0, updated: 0, linked: 0, unchanged: 0, skipped: 0,
    unmatchedLegacy: [], effectiveDateDiffs: [], newItems: [], message: "",
  };

  if (running) return { ...blank, throttled: true, message: "A sync is already running — try again in a moment." };
  const state = await announcements.getSyncState();
  if (!opts.force && state?.lastAttemptAt && now.getTime() - state.lastAttemptAt.getTime() < SYNC_COOLDOWN_MS) {
    return { ...blank, ok: true, throttled: true, message: "Synced a moment ago — nothing more to fetch yet." };
  }

  running = true;
  try {
    await announcements.saveSyncState({ lastAttemptAt: now, lastTrigger: opts.trigger });
    const csv = opts.csvText ?? (await fetchFeedCsv(process.env.QA_FEED_CSV_URL || DEFAULT_QA_FEED_CSV_URL));
    const { items, skipped } = parseFeed(csv);
    if (items.length === 0) throw new Error("The QA feed has no usable announcements — nothing was changed.");

    const isFirstEverSync = !state?.lastSuccessAt;
    const all = await announcements.listAllForSync();
    const byQaId = new Map<string, AnnouncementRow>();
    all.forEach((r) => { if (r.qaId) byQaId.set(r.qaId, r); });
    const legacyPool = all.filter((r) => !r.qaId && r.type === "QA Announcement");
    const claimed = new Set<number>();

    const result: SyncResult = { ...blank, ok: true, skipped };

    // Oldest first, so ids/created_at ordering follows the real announcement order.
    const ordered = [...items].sort((a, b) => a.announcementDate.localeCompare(b.announcementDate) || a.qaId.localeCompare(b.qaId));
    for (const item of ordered) {
      const existing = byQaId.get(item.qaId);
      if (existing) {
        if (existing.sourceHash === item.hash) { result.unchanged++; continue; }
        await announcements.update(existing.id, {
          announcement: item.html, category: item.title, title: item.title, rating: item.rating, team: item.team,
          announcementDate: item.announcementDate, effectiveDate: item.effectiveDate, sourceHash: item.hash,
        });
        result.updated++;
        continue;
      }

      const legacy = findLegacyMatch(item, legacyPool.filter((r) => !claimed.has(r.id)));
      if (legacy) {
        claimed.add(legacy.id);
        await announcements.update(legacy.id, { qaId: item.qaId, sourceHash: item.hash });
        result.linked++;
        if ((legacy.effectiveDate ?? null) !== (item.effectiveDate ?? null)) {
          result.effectiveDateDiffs.push({ qaId: item.qaId, title: item.title, app: legacy.effectiveDate ?? null, sheet: item.effectiveDate });
        }
        continue;
      }

      const historic = isFirstEverSync || daysBetween(item.announcementDate, now) > HISTORIC_AFTER_DAYS;
      const row: Omit<NewAnnouncementRow, "id"> = {
        announcement: item.html,
        category: item.title,
        title: item.title,
        addedBy: SYNC_ADDED_BY,
        rating: item.rating,
        type: "QA Announcement",
        team: item.team,
        announcementDate: item.announcementDate,
        effectiveDate: item.effectiveDate,
        requiresAck: !historic,
        qaId: item.qaId,
        sourceHash: item.hash,
        ...(historic ? { createdAt: new Date(`${item.announcementDate}T06:30:00.000Z`) } : {}),
      };
      await announcements.create(row as any);
      result.added++;
      result.newItems.push({ qaId: item.qaId, title: item.title, announcementDate: item.announcementDate });
    }

    const feedIds = new Set(items.map((i) => i.qaId));
    result.unmatchedLegacy = legacyPool
      .filter((r) => !claimed.has(r.id))
      .map((r) => ({ id: r.id, title: r.title || r.category, announcementDate: r.announcementDate }));
    void feedIds;

    result.message =
      `Sync complete: ${result.added} new, ${result.updated} updated, ${result.linked} existing matched to a QA ID, ` +
      `${result.unchanged} unchanged` + (skipped ? `, ${skipped} sheet rows skipped` : "") + ".";
    await announcements.saveSyncState({
      lastSuccessAt: now, lastSummary: result.message, lastError: null,
    });
    return result;
  } catch (err: any) {
    const message = err?.message ? String(err.message) : "Sync failed.";
    try { await announcements.saveSyncState({ lastError: message }); } catch { /* best effort */ }
    return { ...blank, ok: false, message };
  } finally {
    running = false;
  }
}

/** True when the daily automatic sync is due. */
export async function isAutoSyncDue(db: AnyDb, now = new Date()): Promise<boolean> {
  const { announcements } = createRepositories(db);
  const state = await announcements.getSyncState();
  // After a failed attempt, wait an hour before the automatic check tries again.
  if (state?.lastError && state.lastAttemptAt && now.getTime() - state.lastAttemptAt.getTime() < 60 * 60 * 1000) return false;
  if (!state?.lastSuccessAt) return true;
  return now.getTime() - state.lastSuccessAt.getTime() >= AUTO_SYNC_EVERY_MS;
}
