/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { pedRepository, pedAliases, type PedRepositoryRow, type NewPedRepositoryRow } from "../schema.js";
import { containsPattern, type PaginatedResult, buildPaginatedResult, clampPage } from "../../pagination.js";

export type CreatePedEntry = Omit<NewPedRepositoryRow, "id" | "pedCode" | "createdAt" | "updatedAt">;
export type UpdatePedEntry = Partial<
  Omit<NewPedRepositoryRow, "id" | "pedCode" | "createdAt" | "updatedAt" | "addedBy">
>;

export interface PedRepositoryListOptions {
  page?: number;
  pageSize?: number;
  /** Matches against `canonicalName` or `pedCode` (case-insensitive substring). */
  search?: string;
  categoryKey?: string;
  status?: "draft" | "approved" | "deprecated";
  /** Whitelisted to "canonicalName" | "pedCode" | "status" | "createdAt" | "updatedAt"; defaults to "canonicalName". */
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

const SORTABLE_COLUMNS = {
  canonicalName: pedRepository.canonicalName,
  pedCode: pedRepository.pedCode,
  categoryKey: pedRepository.categoryKey,
  status: pedRepository.status,
  createdAt: pedRepository.createdAt,
  updatedAt: pedRepository.updatedAt,
} as const;

/**
 * Data Access Layer for `ped_repository` — the master disease registry
 * (PED_REPOSITORY_DB_MIGRATION_DESIGN.md §1.2). Stable internal `id`/
 * `pedCode` identity, independent of `canonicalName`, so renames/spelling
 * corrections never break `ped_aliases`, `plan_overrides`,
 * `mapping_history`, or `collision_repository` rows that reference this PED
 * by id.
 */
export class PedRepositoryRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<PedRepositoryRow[]> {
    return this.db.select().from(pedRepository).orderBy(asc(pedRepository.canonicalName));
  }

  /**
   * Server-side paginated/searched/filtered/sorted list. Not wired to any
   * admin UI route yet (this table has no UI surface today — see
   * PED_REPOSITORY_DB_MIGRATION_DESIGN.md), added ahead of that so a future
   * admin page can page through the registry without loading it whole, the
   * same contract every other table in this app now follows.
   */
  async listPaginated(options: PedRepositoryListOptions = {}): Promise<PaginatedResult<PedRepositoryRow>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 50);

    const conditions = [];
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(pedRepository.canonicalName, pattern), ilike(pedRepository.pedCode, pattern)));
    }
    if (options.categoryKey) conditions.push(eq(pedRepository.categoryKey, options.categoryKey));
    if (options.status) conditions.push(eq(pedRepository.status, options.status));
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? pedRepository.canonicalName;
    const orderFn = options.sortDir === "desc" ? desc : asc;

    const [{ value: total }] = await this.db.select({ value: count() }).from(pedRepository).where(where);
    const { page: clampedPage } = clampPage(page, total, pageSize);
    const data = await this.db
      .select()
      .from(pedRepository)
      .where(where)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset((clampedPage - 1) * pageSize);

    return buildPaginatedResult(data, total, clampedPage, pageSize);
  }

  /** Same filter/search/sort as `listPaginated` but WITHOUT limit/offset —
   * powers the admin UI's CSV export, which downloads the whole matching
   * set rather than just the visible page. */
  async listMatching(options: Pick<PedRepositoryListOptions, "search" | "categoryKey" | "status" | "sortBy" | "sortDir"> = {}): Promise<PedRepositoryRow[]> {
    const conditions = [];
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(pedRepository.canonicalName, pattern), ilike(pedRepository.pedCode, pattern)));
    }
    if (options.categoryKey) conditions.push(eq(pedRepository.categoryKey, options.categoryKey));
    if (options.status) conditions.push(eq(pedRepository.status, options.status));
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? pedRepository.canonicalName;
    const orderFn = options.sortDir === "desc" ? desc : asc;
    return this.db.select().from(pedRepository).where(where).orderBy(orderFn(sortColumn));
  }

  /** Case-insensitive substring search over canonical name, PED code AND
   * every alias (incl. abbreviations like "OSA"), deduplicated to distinct
   * PEDs — the picker for Plan Management's Plan-Specific PED Mappings. */
  async searchByNameOrAlias(search: string, limit = 15): Promise<PedRepositoryRow[]> {
    const pattern = containsPattern(search);
    const aliasHits = await this.db
      .selectDistinct({ pedId: pedAliases.pedId })
      .from(pedAliases)
      .where(ilike(pedAliases.aliasText, pattern))
      .limit(200);
    const aliasPedIds = aliasHits.map((a) => a.pedId);
    return this.db
      .select()
      .from(pedRepository)
      .where(
        or(
          ilike(pedRepository.canonicalName, pattern),
          ilike(pedRepository.pedCode, pattern),
          ...(aliasPedIds.length ? [inArray(pedRepository.id, aliasPedIds)] : [])
        )
      )
      .orderBy(asc(pedRepository.canonicalName))
      .limit(limit);
  }

  async get(id: number): Promise<PedRepositoryRow | undefined> {
    const [row] = await this.db.select().from(pedRepository).where(eq(pedRepository.id, id));
    return row;
  }

  async getByCode(pedCode: string): Promise<PedRepositoryRow | undefined> {
    const [row] = await this.db.select().from(pedRepository).where(eq(pedRepository.pedCode, pedCode));
    return row;
  }

  async listByCategory(categoryKey: string): Promise<PedRepositoryRow[]> {
    return this.db.select().from(pedRepository).where(eq(pedRepository.categoryKey, categoryKey));
  }

  /**
   * Inserts the row, then formats and stamps `pedCode` ("PED-000421") from
   * the id Postgres just assigned — two statements, not one, since the code
   * is derived from an id that doesn't exist until after the insert.
   * `pedCode` is NOT NULL + unique, so the interim placeholder before the
   * id is known must itself be collision-proof under concurrent inserts —
   * a random UUID, not a shared blank string, guarantees that.
   */
  async create(entry: CreatePedEntry): Promise<PedRepositoryRow> {
    const placeholder = `PENDING-${crypto.randomUUID()}`;
    const [inserted] = await this.db
      .insert(pedRepository)
      .values({ ...entry, pedCode: placeholder } as NewPedRepositoryRow)
      .returning();
    const pedCode = `PED-${String(inserted.id).padStart(6, "0")}`;
    const [row] = await this.db
      .update(pedRepository)
      .set({ pedCode })
      .where(eq(pedRepository.id, inserted.id))
      .returning();
    return row;
  }

  async update(id: number, entry: UpdatePedEntry): Promise<PedRepositoryRow | undefined> {
    const [row] = await this.db
      .update(pedRepository)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(pedRepository.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(pedRepository).where(eq(pedRepository.id, id));
  }
}
