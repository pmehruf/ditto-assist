/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { departments, type DepartmentRow } from "../schema.js";

export interface CreateDepartmentEntry {
  name: string;
  description: string | null;
  createdBy: string;
}

export type UpdateDepartmentEntry = Partial<Pick<DepartmentRow, "name" | "description" | "active">>;

/**
 * Data Access Layer for `departments` — purely organizational metadata (see
 * schema.ts's doc comment on the table for why this deliberately has zero
 * effect on access). Read by Admin+Developer (directory assignment needs
 * the list); writes gated to Developer in the API route layer.
 */
export class DepartmentsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<DepartmentRow[]> {
    return this.db.select().from(departments).orderBy(asc(departments.name));
  }

  async get(id: number): Promise<DepartmentRow | undefined> {
    const [row] = await this.db.select().from(departments).where(eq(departments.id, id));
    return row;
  }

  async create(entry: CreateDepartmentEntry): Promise<DepartmentRow> {
    const [row] = await this.db
      .insert(departments)
      .values({ name: entry.name, description: entry.description, createdBy: entry.createdBy })
      .returning();
    return row;
  }

  async update(id: number, patch: UpdateDepartmentEntry): Promise<DepartmentRow | undefined> {
    const [row] = await this.db.update(departments).set(patch).where(eq(departments.id, id)).returning();
    return row;
  }

  /** Hard delete — Access Control Center Phase 4
   * (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). Callers must run
   * countCatalogDependencies() (src/server/accessControl/catalogDependencies.ts)
   * first and honor its block/confirm decision — this method performs no
   * dependency check of its own, matching every other repository's
   * single-table scope. Every referencing FK is `ON DELETE SET NULL`, so
   * this can never fail with a foreign-key violation; it can, however,
   * silently null out a live reference if the caller skipped the check. */
  async delete(id: number): Promise<void> {
    await this.db.delete(departments).where(eq(departments.id, id));
  }
}
