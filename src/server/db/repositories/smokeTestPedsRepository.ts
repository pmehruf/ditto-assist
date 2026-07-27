/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { smokeTestPeds, type SmokeTestPedRow, type NewSmokeTestPedRow } from "../schema.js";

export type CreateSmokeTestPedEntry = Omit<NewSmokeTestPedRow, "id" | "createdAt">;

/**
 * Data Access Layer for the Smoke Test page's Admin/Owner-added custom PED
 * entries (the `smoke_test_peds` table). These are ADDITIONAL to the
 * hardcoded 50+ baseline list (COMMON_SMOKE_TEST_PEDS in
 * src/constants/commonSmokeTestPeds.ts) — this repository never touches
 * that baseline. Read by everyone (the Smoke Test page itself is visible to
 * every tier); writes are gated to Admin/Owner in the API route layer, same
 * pattern as PedSuggestionsRepository.
 */
export class SmokeTestPedsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<SmokeTestPedRow[]> {
    return this.db.select().from(smokeTestPeds).orderBy(asc(smokeTestPeds.term));
  }

  async create(entry: CreateSmokeTestPedEntry): Promise<SmokeTestPedRow> {
    const [row] = await this.db.insert(smokeTestPeds).values(entry).returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(smokeTestPeds).where(eq(smokeTestPeds.id, id));
  }
}
