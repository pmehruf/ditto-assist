/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared server-side pagination/search/sort contract, used by every
 * paginated list route + repository (PED Directory, PED Repository,
 * Activity Log [Modification History + User Activity], My Activity,
 * AI Mapping Review, Announcement History, User Management).
 *
 * Every paginated GET route accepts:
 *   page      (1-based, default 1)
 *   pageSize  (default varies per table, capped at MAX_PAGE_SIZE)
 *   search    (free-text, matched server-side against that table's search
 *              column(s) via ILIKE — never client-filtered)
 *   sortBy    (whitelisted per table; falls back to that table's default)
 *   sortDir   ("asc" | "desc")
 * plus whatever filter params that table already supported (status,
 * category, planName, actionType, tier, ...) — those are parsed by each
 * route individually since their names/types differ per table.
 *
 * And returns { data, total, page, pageSize, totalPages } — `total` comes
 * from a COUNT(*) query scoped by the same WHERE clause as the page query,
 * never from loading the full table, so summary counts stay cheap even as
 * the underlying table grows.
 */

export const MAX_PAGE_SIZE = 200;

export interface ListQueryParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortDir: "asc" | "desc";
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parses page/pageSize/search/sortBy/sortDir off an Express `req.query`
 * object. `defaultPageSize` and `defaultSortDir` are per-table since the
 * spec calls for different default page sizes (50 vs 25) and different
 * tables default to different natural orders.
 */
export function parseListQuery(
  query: Record<string, unknown>,
  defaultPageSize: number,
  defaultSortDir: "asc" | "desc" = "desc"
): ListQueryParams {
  const page = parsePositiveInt(query.page, 1);
  const pageSize = Math.min(parsePositiveInt(query.pageSize, defaultPageSize), MAX_PAGE_SIZE);
  const search = typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined;
  const sortBy = typeof query.sortBy === "string" && query.sortBy.trim() ? query.sortBy.trim() : undefined;
  const sortDir = query.sortDir === "asc" ? "asc" : query.sortDir === "desc" ? "desc" : defaultSortDir;
  return { page, pageSize, search, sortBy, sortDir };
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Computes total page count and clamps a requested page into [1,
 * totalPages]. Every repository's `listPaginated` MUST call this (using the
 * `total` from its COUNT(*) query) and use the RETURNED `page` — not the
 * caller's original request — to compute the data query's offset. Clamping
 * only the page NUMBER after the data has already been fetched at the
 * original (possibly out-of-range) offset returns an empty page paired with
 * a page number that claims otherwise — e.g. requesting page 99 of a 3-page
 * result would report `page: 3` but `data: []`, instead of page 3's actual
 * rows. This bit every repository once (caught by "clamps an out-of-range
 * page into bounds" tests) before this helper existed.
 */
export function clampPage(page: number, total: number, pageSize: number): { page: number; totalPages: number } {
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return { page: Math.min(Math.max(1, page), totalPages), totalPages };
}

/**
 * Builds the standard paginated-response envelope. Assumes `page` has
 * ALREADY been clamped (via `clampPage`, above) and used to compute the
 * offset for `data` — this just re-derives `totalPages` for the envelope
 * and clamps `page` again defensively (a no-op if the caller already did).
 */
export function buildPaginatedResult<T>(data: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return { data, total, page: Math.min(Math.max(1, page), totalPages), pageSize, totalPages };
}

/**
 * Escapes Postgres ILIKE wildcard characters (`%`, `_`, and the escape
 * character itself) in user input before wrapping it in `%...%`, so a
 * search term containing those characters is treated as a literal
 * substring match instead of an unintended wildcard.
 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Same escaping as `containsPattern`, but anchored to the start of the
 * value (`term%`) instead of a substring match — used where the old
 * client-side filter was `.startsWith(...)` rather than `.includes(...)`. */
export function startsWithPattern(term: string): string {
  return `${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Narrows an `unknown` value (typically a raw `req.query.foo`) down to one
 * of a fixed set of allowed string literals, or `undefined` if it isn't one
 * of them. Exists because the obvious inline version —
 * `req.query.tier === "A" || req.query.tier === "B" ? req.query.tier :
 * undefined` — does NOT reliably keep its literal-union type in this
 * codebase's TS setup; it comes back widened to plain `string`, which then
 * fails to satisfy a field typed as a real literal union (e.g.
 * `UserListOptions.tier`). Routing through a generic function with an
 * explicit `T | undefined` return type sidesteps that: `T` is inferred from
 * the `allowed` tuple at the call site, and the return type is fixed by the
 * function signature rather than by control-flow narrowing on the caller's
 * expression.
 */
export function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
