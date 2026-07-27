/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { users, type UserRow, type NewUserRow } from "../schema.js";

export type CreateUserEntry = NewUserRow;

/**
 * Data Access Layer for the org's user directory (users table). Replaces
 * the old data/users.json file — see schema.ts for why that was a
 * production-durability gap. Emails are always normalized to lowercase on
 * write and lookup, since Google's OAuth response casing isn't guaranteed
 * and the rest of the app already compares emails case-insensitively.
 */
export class UsersRepository {
  constructor(private readonly db: AnyDb) {}

  /** Full directory listing — powers GET /api/users (Admin/Owner only). */
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
      // date the moment an Owner edited even one person's tier. Carrying the
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
