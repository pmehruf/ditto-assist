/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { mappingState } from "../schema.js";

/**
 * The single-row mapping version counter (see schema.ts's mapping_state doc).
 * Every mapping write calls `bump()`; every lookup compares `getVersion()`
 * against its in-memory snapshot's version.
 */
export class MappingStateRepository {
  constructor(private readonly db: AnyDb) {}

  /** Current version (1 if the row is somehow missing). */
  async getVersion(): Promise<number> {
    const [row] = await this.db.select({ version: mappingState.version }).from(mappingState).where(eq(mappingState.id, 1));
    return row ? Number(row.version) : 1;
  }

  /** Atomically increments the version (creating the row if needed) and returns the new value. */
  async bump(): Promise<number> {
    const [row] = await this.db
      .insert(mappingState)
      .values({ id: 1, version: 2 })
      .onConflictDoUpdate({ target: mappingState.id, set: { version: sql`${mappingState.version} + 1`, updatedAt: sql`now()` } })
      .returning({ version: mappingState.version });
    return Number(row.version);
  }
}
