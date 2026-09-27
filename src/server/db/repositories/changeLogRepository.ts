/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, count, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { changeLogs, type ChangeLogRow, type NewChangeLogRow } from "../schema.js";
import { containsPattern, startsWithPattern, type PaginatedResult, buildPaginatedResult, clampPage } from "../../pagination.js";

export interface ChangeLogFilter {
  actionType?: string;
  planName?: string;
  userName?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface ChangeLogListOptions {
  page?: number;
  pageSize?: number;
  /** Matches against planName, description, or userName (case-insensitive substring) — mirrors the old client-side filter in AuditPage.tsx. */
  search?: string;
  /** Prefix match against actionType (e.g. "Draft" matches "Draft Approved", "Draft Created") — mirrors the old `.startsWith` filter. */
  actionType?: string;
  /**
   * OR-of-prefix match against actionType — e.g. ["Department", "Team",
   * "Role"] matches any actionType starting with any of those. Used by the
   * Access Control Center's "Change History" tab (server.ts's
   * `scope=access-control` handling on GET /api/change-logs), which needs
   * to match several unrelated actionType families in one query — something
   * the single-prefix `actionType` filter above can't express. Ignored if
   * `actionType` is also set (that single-prefix filter wins).
   */
  actionTypePrefixes?: string[];
  from?: string;
  to?: string;
  /** Whitelisted to "timestamp" | "userName" | "role" | "actionType" | "planName" | "description"; defaults to "timestamp". */
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

const SORTABLE_COLUMNS = {
  timestamp: changeLogs.timestamp,
  userName: changeLogs.userName,
  role: changeLogs.role,
  actionType: changeLogs.actionType,
  planName: changeLogs.planName,
  description: changeLogs.description,
} as const;

export type CreateChangeLogEntry = Omit<NewChangeLogRow, "id" | "timestamp"> & {
  timestamp?: string | Date;
};

/**
 * Data Access Layer for the administrative/workflow action trail
 * (change_logs table) — powers the "Modification History" sub-tab under
 * Audit and the workflow-approval trail (actionType values like
 * "Draft Approved" / "Draft Created" / "Insurer Edited" /
 * "Announcement Added" / "Announcement Edited").
 */
export class ChangeLogRepository {
  constructor(private readonly db: AnyDb) {}

  async create(entry: CreateChangeLogEntry): Promise<ChangeLogRow> {
    const [row] = await this.db
      .insert(changeLogs)
      .values({
        ...entry,
        timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
      })
      .returning();
    return row;
  }

  async list(filter: ChangeLogFilter = {}): Promise<ChangeLogRow[]> {
    const conditions = [];
    if (filter.actionType) conditions.push(eq(changeLogs.actionType, filter.actionType));
    if (filter.planName) conditions.push(eq(changeLogs.planName, filter.planName));
    if (filter.userName) conditions.push(eq(changeLogs.userName, filter.userName));
    if (filter.from) conditions.push(gte(changeLogs.timestamp, new Date(filter.from)));
    if (filter.to) conditions.push(lte(changeLogs.timestamp, new Date(filter.to)));

    const query = this.db
      .select()
      .from(changeLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(changeLogs.timestamp));

    return filter.limit ? query.limit(filter.limit) : query;
  }

  /**
   * Server-side paginated/searched/filtered/sorted list for the Activity
   * Log's "Modification History" sub-tab. `total` comes from a COUNT(*)
   * scoped by the same WHERE clause as the page query.
   */
  async listPaginated(options: ChangeLogListOptions = {}): Promise<PaginatedResult<ChangeLogRow>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 50);

    const conditions = [];
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(changeLogs.planName, pattern), ilike(changeLogs.description, pattern), ilike(changeLogs.userName, pattern)));
    }
    if (options.actionType) {
      conditions.push(ilike(changeLogs.actionType, startsWithPattern(options.actionType)));
    } else if (options.actionTypePrefixes?.length) {
      conditions.push(or(...options.actionTypePrefixes.map((p) => ilike(changeLogs.actionType, startsWithPattern(p)))));
    }
    if (options.from) conditions.push(gte(changeLogs.timestamp, new Date(options.from)));
    if (options.to) conditions.push(lte(changeLogs.timestamp, new Date(options.to)));
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? changeLogs.timestamp;
    const orderFn = options.sortDir === "asc" ? asc : desc;

    const [{ value: total }] = await this.db.select({ value: count() }).from(changeLogs).where(where);
    const { page: clampedPage } = clampPage(page, total, pageSize);
    const data = await this.db
      .select()
      .from(changeLogs)
      .where(where)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset((clampedPage - 1) * pageSize);

    return buildPaginatedResult(data, total, clampedPage, pageSize);
  }

  /** Same filter/search/sort as `listPaginated` but WITHOUT limit/offset —
   * used only by the Modification History "Export" button, which downloads
   * the whole matching set rather than just the visible page. */
  async listMatching(options: Pick<ChangeLogListOptions, "search" | "actionType" | "actionTypePrefixes" | "from" | "to" | "sortBy" | "sortDir"> = {}): Promise<ChangeLogRow[]> {
    const conditions = [];
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(changeLogs.planName, pattern), ilike(changeLogs.description, pattern), ilike(changeLogs.userName, pattern)));
    }
    if (options.actionType) {
      conditions.push(ilike(changeLogs.actionType, startsWithPattern(options.actionType)));
    } else if (options.actionTypePrefixes?.length) {
      conditions.push(or(...options.actionTypePrefixes.map((p) => ilike(changeLogs.actionType, startsWithPattern(p)))));
    }
    if (options.from) conditions.push(gte(changeLogs.timestamp, new Date(options.from)));
    if (options.to) conditions.push(lte(changeLogs.timestamp, new Date(options.to)));
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? changeLogs.timestamp;
    const orderFn = options.sortDir === "asc" ? asc : desc;
    return this.db.select().from(changeLogs).where(where).orderBy(orderFn(sortColumn));
  }

  async clearAll(): Promise<void> {
    await this.db.delete(changeLogs);
  }
}
