/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, count, desc, eq, ilike, isNull } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pedSuggestions, type PedSuggestionRow, type NewPedSuggestionRow } from "../schema.js";
import { containsPattern, type PaginatedResult, buildPaginatedResult, clampPage } from "../../pagination.js";

export type CreatePedSuggestionEntry = Omit<NewPedSuggestionRow, "id" | "createdAt">;
export type UpdatePedSuggestionEntry = Partial<Omit<NewPedSuggestionRow, "id" | "createdAt" | "addedBy">>;

export interface PedSuggestionsListOptions {
  page?: number;
  pageSize?: number;
  /** Matches against `term` only (case-insensitive substring). */
  search?: string;
  /** categoryKey, "uncategorized" for `category IS NULL`, or "all"/undefined for no filter. */
  category?: string;
  /** Whitelisted to "term" | "category" | "addedBy" | "createdAt" by the caller; defaults to "term". */
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

const SORTABLE_COLUMNS = {
  term: pedSuggestions.term,
  category: pedSuggestions.category,
  addedBy: pedSuggestions.addedBy,
  createdAt: pedSuggestions.createdAt,
} as const;

/**
 * Data Access Layer for the Lookup page's autocomplete dropdown source list
 * (the `ped_directory` table, renamed from `ped_suggestions` via migration
 * 0010 — this class/file kept its original name to avoid an app-wide rename
 * churn). Deliberately separate from PedMappingOverrides —
 * this only feeds the suggestion dropdown, not PED classification/matching
 * (see schema.ts's comment on the ped_suggestions table for why). Read by
 * everyone; writes are gated to Admin/Developer in the API route layer, same
 * pattern as ExternalResourcesRepository.
 */
export class PedSuggestionsRepository {
  constructor(private readonly db: AnyDb) {}

  /** Unpaginated full list — kept only for internal callers (e.g. dictionary
   * merge/seed logic) that genuinely need every row. The admin UI must use
   * `listPaginated` instead. */
  async list(): Promise<PedSuggestionRow[]> {
    return this.db.select().from(pedSuggestions).orderBy(asc(pedSuggestions.term));
  }

  /**
   * Server-side paginated/searched/filtered/sorted list for the PED
   * Repository admin UI. `total` comes from a COUNT(*) scoped by the same
   * WHERE clause as the page query — the full table is never loaded.
   */
  async listPaginated(options: PedSuggestionsListOptions = {}): Promise<PaginatedResult<PedSuggestionRow>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 50);

    const conditions = [];
    if (options.search) conditions.push(ilike(pedSuggestions.term, containsPattern(options.search)));
    if (options.category && options.category !== "all") {
      conditions.push(
        options.category === "uncategorized" ? isNull(pedSuggestions.category) : eq(pedSuggestions.category, options.category)
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? pedSuggestions.term;
    const orderFn = options.sortDir === "desc" ? desc : asc;

    const [{ value: total }] = await this.db.select({ value: count() }).from(pedSuggestions).where(where);
    const { page: clampedPage } = clampPage(page, total, pageSize);
    const data = await this.db
      .select()
      .from(pedSuggestions)
      .where(where)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset((clampedPage - 1) * pageSize);

    return buildPaginatedResult(data, total, clampedPage, pageSize);
  }

  /**
   * Same filter/search/sort as `listPaginated` but WITHOUT the limit/offset
   * — used only for the admin UI's "Export CSV" action, which intentionally
   * downloads the whole matching set (not just the visible page). Not used
   * for normal page rendering.
   */
  async listMatching(options: Pick<PedSuggestionsListOptions, "search" | "category" | "sortBy" | "sortDir"> = {}): Promise<PedSuggestionRow[]> {
    const conditions = [];
    if (options.search) conditions.push(ilike(pedSuggestions.term, containsPattern(options.search)));
    if (options.category && options.category !== "all") {
      conditions.push(
        options.category === "uncategorized" ? isNull(pedSuggestions.category) : eq(pedSuggestions.category, options.category)
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? pedSuggestions.term;
    const orderFn = options.sortDir === "desc" ? desc : asc;

    return this.db.select().from(pedSuggestions).where(where).orderBy(orderFn(sortColumn));
  }

  /**
   * Distinct categories actually present in the table (plus whether any row
   * is uncategorized) — a lightweight aggregate query used to populate the
   * admin UI's category filter dropdown, so it never offers a category with
   * zero matching entries without having to load the full table client-side.
   */
  async listCategoriesInUse(): Promise<{ category: string | null }[]> {
    return this.db.selectDistinct({ category: pedSuggestions.category }).from(pedSuggestions);
  }

  /**
   * Single row by id. Used by the API layer to capture the "before" state of
   * an edit or delete so the Modification History entry can describe what
   * actually changed rather than just naming the row id.
   */
  async get(id: number): Promise<PedSuggestionRow | undefined> {
    const [row] = await this.db.select().from(pedSuggestions).where(eq(pedSuggestions.id, id));
    return row;
  }

  async create(entry: CreatePedSuggestionEntry): Promise<PedSuggestionRow> {
    const [row] = await this.db.insert(pedSuggestions).values(entry).returning();
    return row;
  }

  async update(id: number, entry: UpdatePedSuggestionEntry): Promise<PedSuggestionRow | undefined> {
    const [row] = await this.db
      .update(pedSuggestions)
      .set(entry)
      .where(eq(pedSuggestions.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(pedSuggestions).where(eq(pedSuggestions.id, id));
  }
}
