/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { announcements, type AnnouncementRow, type NewAnnouncementRow } from "../schema.js";
import { containsPattern, type PaginatedResult, buildPaginatedResult, clampPage } from "../../pagination.js";

export interface AnnouncementListOptions {
  page?: number;
  pageSize?: number;
  category?: string;
  type?: NewAnnouncementRow["type"];
  /** Matches against announcement body, title, or fromTeam (case-insensitive substring). */
  search?: string;
  /** Whitelisted to "createdAt" | "announcementDate" | "effectiveDate" | "category" | "title"; defaults to "createdAt". */
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** Inclusive "YYYY-MM-DD" range filter over announcementDate — used by the
   * advisor-facing Announcements archive's date filter. Either bound may be
   * given alone. */
  dateFrom?: string;
  dateTo?: string;
  /** Inclusive "YYYY-MM-DD" range filter over effectiveDate — separate from
   * dateFrom/dateTo above (those filter announcementDate, the posted date).
   * Used by the Workspace's "Open Today's Announcements" CTA to jump
   * straight to whatever goes live on a specific day, regardless of when it
   * was posted. */
  effectiveDateFrom?: string;
  effectiveDateTo?: string;
  /** Restricts to a single advisor audience ("Health" | "Term"). Omit to
   * return both — used for the caller's own unrestricted team, and for the
   * Admin/Developer "includeAllTeams" bypass on the Announcement Manager. */
  team?: NewAnnouncementRow["team"];
}

const SORTABLE_COLUMNS = {
  createdAt: announcements.createdAt,
  announcementDate: announcements.announcementDate,
  effectiveDate: announcements.effectiveDate,
  category: announcements.category,
  title: announcements.title,
} as const;

/**
 * Retention ceiling per announcement type (QA vs General, tracked
 * independently — publishing one type never trims the other). No settings
 * UI exists for this yet, so it's a plain constant; raise/lower it here if
 * the org's needs change. Chosen generously so it only ever prunes genuine
 * long-tail backlog, never anything an advisor would still expect to see.
 */
export const ANNOUNCEMENT_RETENTION_LIMIT: Record<"QA Announcement" | "General Announcement", number> = {
  "QA Announcement": 100,
  "General Announcement": 100,
};

export interface AnnouncementFilter {
  category?: string;
  type?: NewAnnouncementRow["type"];
  /** Only announcements still valid on/after this ISO date (validTillDate >= this). */
  validAsOf?: string;
  /** Restricts to a single advisor audience ("Health" | "Term"). Omit to return both. */
  team?: NewAnnouncementRow["team"];
  limit?: number;
}

export type CreateAnnouncementEntry = Omit<NewAnnouncementRow, "id" | "createdAt">;
export type UpdateAnnouncementEntry = Partial<CreateAnnouncementEntry>;

/**
 * Data Access Layer for QA/general announcements (announcements table).
 */
export class AnnouncementsRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateAnnouncementEntry): Promise<AnnouncementRow> {
    const [row] = await this.db.insert(announcements).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdateAnnouncementEntry): Promise<AnnouncementRow | undefined> {
    const [row] = await this.db
      .update(announcements)
      .set(entry)
      .where(eq(announcements.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(announcements).where(eq(announcements.id, id));
  }

  async getById(id: number): Promise<AnnouncementRow | undefined> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id));
    return row;
  }

  async list(filter: AnnouncementFilter = {}): Promise<AnnouncementRow[]> {
    const conditions = [];
    if (filter.category) conditions.push(eq(announcements.category, filter.category));
    if (filter.type) conditions.push(eq(announcements.type, filter.type));
    if (filter.validAsOf) conditions.push(gte(announcements.validTillDate, filter.validAsOf));
    if (filter.team) conditions.push(eq(announcements.team, filter.team));

    const query = this.db
      .select()
      .from(announcements)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(announcements.createdAt));

    return filter.limit ? query.limit(filter.limit) : query;
  }

  private buildListConditions(options: AnnouncementListOptions) {
    const conditions = [];
    if (options.category) conditions.push(eq(announcements.category, options.category));
    if (options.type) conditions.push(eq(announcements.type, options.type));
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(announcements.announcement, pattern), ilike(announcements.title, pattern), ilike(announcements.fromTeam, pattern)));
    }
    if (options.dateFrom) conditions.push(gte(announcements.announcementDate, options.dateFrom));
    if (options.dateTo) conditions.push(lte(announcements.announcementDate, options.dateTo));
    if (options.effectiveDateFrom) conditions.push(gte(announcements.effectiveDate, options.effectiveDateFrom));
    if (options.effectiveDateTo) conditions.push(lte(announcements.effectiveDate, options.effectiveDateTo));
    if (options.team) conditions.push(eq(announcements.team, options.team));
    return conditions;
  }

  /**
   * Server-side paginated/searched/filtered/sorted list for the
   * Announcement History admin UI. `total` comes from a COUNT(*) scoped by
   * the same WHERE clause as the page query.
   */
  async listPaginated(options: AnnouncementListOptions = {}): Promise<PaginatedResult<AnnouncementRow>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 25);
    const conditions = this.buildListConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? announcements.createdAt;
    const orderFn = options.sortDir === "asc" ? asc : desc;

    const [{ value: total }] = await this.db.select({ value: count() }).from(announcements).where(where);
    const { page: clampedPage } = clampPage(page, total, pageSize);
    const data = await this.db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset((clampedPage - 1) * pageSize);

    return buildPaginatedResult(data, total, clampedPage, pageSize);
  }

  /** Same filter/search/sort as `listPaginated` but WITHOUT limit/offset —
   * kept for parity with the other repositories' export path, even though
   * this table is already retention-capped at 100 rows/type. */
  async listMatching(options: Pick<AnnouncementListOptions, "category" | "type" | "search" | "sortBy" | "sortDir" | "dateFrom" | "dateTo" | "effectiveDateFrom" | "effectiveDateTo" | "team"> = {}): Promise<AnnouncementRow[]> {
    const conditions = this.buildListConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? announcements.createdAt;
    const orderFn = options.sortDir === "asc" ? asc : desc;
    return this.db.select().from(announcements).where(where).orderBy(orderFn(sortColumn));
  }

  /**
   * Retention enforcement: deletes the oldest rows of `type` beyond
   * `ANNOUNCEMENT_RETENTION_LIMIT[type]`, keyed by createdAt (oldest-first),
   * so a burst of same-day announcements is trimmed by actual publish order
   * rather than by the (optional, user-editable) Announcement Date field.
   * QA and General are always counted and pruned independently — creating a
   * QA Announcement never trims General's backlog and vice versa, since
   * `type` is always part of the WHERE clause here.
   *
   * Called after every successful create (see POST /api/announcements) —
   * cheap for the normal case (one extra SELECT of just ids, no DELETE) and
   * self-correcting even if the limit is lowered later, since it always
   * checks the live count rather than assuming it only ever grows by one.
   *
   * Returns the ids of any rows deleted, so the caller can also drop them
   * from any client-side state that already optimistically holds them.
   *
   * `limitOverride` exists only so tests can exercise this against a small
   * number of rows instead of the real 100-row default — production call
   * sites should never pass it.
   */
  async enforceRetentionLimit(
    type: "QA Announcement" | "General Announcement",
    limitOverride?: number
  ): Promise<number[]> {
    const limit = limitOverride ?? ANNOUNCEMENT_RETENTION_LIMIT[type];
    const rows = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(eq(announcements.type, type))
      .orderBy(asc(announcements.createdAt));

    if (rows.length <= limit) return [];

    const excess = rows.slice(0, rows.length - limit).map((r) => r.id);
    await this.db.delete(announcements).where(inArray(announcements.id, excess));
    return excess;
  }
}
