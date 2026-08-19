/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, arrayOverlaps, asc, count, desc, eq, gte, ilike, lte, ne, or, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { users, type UserRow, type NewUserRow } from "../schema.js";
import { containsPattern, type PaginatedResult, buildPaginatedResult, clampPage } from "../../pagination.js";

export type CreateUserEntry = NewUserRow;

export type UpdateUserEntry = Partial<Pick<NewUserRow, "name" | "tactId" | "tier" | "status" | "tags" | "departmentId" | "orgTeamId" | "roleId">>;

export interface UserListOptions {
  page?: number;
  pageSize?: number;
  tier?: NewUserRow["tier"];
  status?: NewUserRow["status"];
  /** A single skill-domain tag ("Health" | "Term"), or the sentinel
   * "Unassigned" for users with an empty tags array (see server.ts's
   * ADVISOR_TAG_VALUES). Matches any user whose tags include this value —
   * a user tagged both Health and Term matches either filter. */
  tag?: string;
  /** Inclusive createdAt ("Joined") range — "YYYY-MM-DD" date strings. */
  dateFrom?: string;
  dateTo?: string;
  /** Matches against name, email, or tactId (case-insensitive substring). */
  search?: string;
  /** Whitelisted to "name" | "email" | "tactId" | "tier" | "status" | "createdAt" | "lastLogin"; defaults to "createdAt". */
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

const SORTABLE_COLUMNS = {
  name: users.name,
  email: users.email,
  tactId: users.tactId,
  tier: users.tier,
  status: users.status,
  createdAt: users.createdAt,
  lastLogin: users.lastLogin,
  // No `tags` entry — sorting by a multi-value array column isn't
  // well-defined, so that column's header simply isn't sortable client-side.
} as const;

/**
 * Data Access Layer for the org's user directory (users table). Replaces
 * the old data/users.json file — see schema.ts for why that was a
 * production-durability gap. Emails are always normalized to lowercase on
 * write and lookup, since Google's OAuth response casing isn't guaranteed
 * and the rest of the app already compares emails case-insensitively.
 */
export class UsersRepository {
  constructor(private readonly db: AnyDb) {}

  /** Full directory listing — powers GET /api/users (Admin/Developer only). */
  async list(): Promise<UserRow[]> {
    return this.db.select().from(users);
  }

  /** Looks up a single user by email. Used for tier resolution (getCallerTier) and GET /api/me. */
  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return row;
  }

  /** Self-provisions a brand-new user (first-time-setup), always at "General" tier. */
  async create(entry: CreateUserEntry): Promise<UserRow> {
    const [row] = await this.db
      .insert(users)
      .values({ ...entry, email: entry.email.toLowerCase() })
      .returning();
    return row;
  }

  private buildListConditions(options: UserListOptions) {
    const conditions = [];
    if (options.tier) conditions.push(eq(users.tier, options.tier));
    if (options.status) conditions.push(eq(users.status, options.status));
    if (options.tag) {
      conditions.push(
        options.tag === "Unassigned"
          ? sql`cardinality(${users.tags}) = 0`
          : arrayOverlaps(users.tags, [options.tag])
      );
    }
    if (options.dateFrom) conditions.push(gte(users.createdAt, new Date(options.dateFrom)));
    if (options.dateTo) {
      // Inclusive of the whole "to" day — a bare "YYYY-MM-DD" parses to
      // 00:00:00 UTC, which would otherwise exclude every user who joined
      // later that same day.
      const end = new Date(options.dateTo);
      end.setUTCHours(23, 59, 59, 999);
      conditions.push(lte(users.createdAt, end));
    }
    if (options.search) {
      const pattern = containsPattern(options.search);
      conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern), ilike(users.tactId, pattern)));
    }
    return conditions;
  }

  /**
   * Server-side paginated/searched/filtered/sorted list for the User
   * Management admin UI. `total` comes from a COUNT(*) scoped by the same
   * WHERE clause as the page query. Defaults to newest-joined-first
   * (createdAt desc), matching the admin table's old default sort.
   */
  async listPaginated(options: UserListOptions = {}): Promise<PaginatedResult<UserRow>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 25);
    const conditions = this.buildListConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? users.createdAt;
    const orderFn = options.sortDir === "asc" ? asc : desc;

    const [{ value: total }] = await this.db.select({ value: count() }).from(users).where(where);
    const { page: clampedPage } = clampPage(page, total, pageSize);
    const data = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(orderFn(sortColumn))
      .limit(pageSize)
      .offset((clampedPage - 1) * pageSize);

    return buildPaginatedResult(data, total, clampedPage, pageSize);
  }

  /** Same filter/search/sort as `listPaginated` but WITHOUT limit/offset —
   * kept for parity with the other repositories' export path. */
  async listMatching(options: Pick<UserListOptions, "tier" | "status" | "tag" | "dateFrom" | "dateTo" | "search" | "sortBy" | "sortDir"> = {}): Promise<UserRow[]> {
    const conditions = this.buildListConditions(options);
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = SORTABLE_COLUMNS[options.sortBy as keyof typeof SORTABLE_COLUMNS] ?? users.createdAt;
    const orderFn = options.sortDir === "asc" ? asc : desc;
    return this.db.select().from(users).where(where).orderBy(orderFn(sortColumn));
  }

  /**
   * Single-row update, keyed by email (the primary key). Added alongside
   * pagination: once the admin UI only ever holds ONE PAGE of the directory
   * in memory, the old `replaceAll` full-array PUT becomes unsafe for
   * editing — a save from any page but the first would silently overwrite
   * every user NOT on that page with whatever the client happened to be
   * holding. This is the safe replacement for a single row's name/tactId/
   * tier/status. Deliberately does not accept `email` — the primary key is
   * immutable via this method; deleting and re-adding is the only way to
   * change it.
   */
  async updateUser(email: string, patch: UpdateUserEntry): Promise<UserRow | undefined> {
    const [row] = await this.db
      .update(users)
      .set(patch)
      .where(eq(users.email, email.toLowerCase()))
      .returning();
    return row;
  }

  /** Single-row delete, keyed by email — the safe counterpart to
   * `updateUser` above, for the same reason (a full-array PUT with one row
   * missing would delete every OTHER user not on the current page). */
  async deleteUser(email: string): Promise<void> {
    await this.db.delete(users).where(eq(users.email, email.toLowerCase()));
  }

  /**
   * Counts Developer-tier users OTHER than `excludeEmail` — used to enforce
   * "at least one Developer must remain in the directory" when a single-row
   * PATCH/DELETE would otherwise change or remove the last one. Mirrors the
   * same guard the old full-array PUT route used to check across the whole
   * submitted array.
   */
  async countOtherDevelopers(excludeEmail: string): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.tier, "Developer"), ne(users.email, excludeEmail.toLowerCase())));
    return value;
  }

  /**
   * Wholesale-replaces the directory with `newUsers`. Mirrors the old
   * writeUsersFile(users) semantics: the User Management screen always PUTs
   * the complete, edited array (add/remove/promote all happen client-side
   * first, then the whole array is saved at once). Runs in a transaction so
   * a failed insert can't leave the directory empty.
   */
  async replaceAll(newUsers: CreateUserEntry[]): Promise<UserRow[]> {
    return this.db.transaction(async (tx) => {
      // Snapshot each existing user's createdAt (keyed by email, the primary
      // key) BEFORE deleting. The delete+reinsert below is a fresh INSERT for
      // every row, and Postgres has no way to know a "new" row is actually
      // the same person — so createdAt's defaultNow() fired for EVERY user
      // in the directory on every single save, resetting everyone's join
      // date the moment a Developer edited even one person's tier. Carrying the
      // old createdAt forward for emails that already existed fixes that;
      // genuinely new users (not in this snapshot) still get defaultNow().
      const existing = await tx.select({ email: users.email, createdAt: users.createdAt }).from(users);
      const createdAtByEmail = new Map(existing.map((u) => [u.email, u.createdAt]));

      await tx.delete(users);
      if (newUsers.length === 0) return [];
      return tx
        .insert(users)
        .values(
          newUsers.map((u) => {
            const email = u.email.toLowerCase();
            const preservedCreatedAt = createdAtByEmail.get(email);
            return {
              ...u,
              email,
              ...(preservedCreatedAt ? { createdAt: preservedCreatedAt } : {}),
            };
          })
        )
        .returning();
    });
  }
}
