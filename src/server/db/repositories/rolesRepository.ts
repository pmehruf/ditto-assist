/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { roles, type RoleRow } from "../schema.js";

export interface CreateRoleEntry {
  name: string;
  description: string | null;
  createdBy: string;
}

export type UpdateRoleEntry = Partial<Pick<RoleRow, "name" | "description" | "active">>;

/**
 * Data Access Layer for `roles` (Advisor / Mentor / Guide / ...) — see
 * schema.ts's doc comment on the table for why this is independent of both
 * `tier` and QA Dashboard's own admin/guide/mentor role. Read by
 * Admin+Platform Admin+Developer; writes gated to Developer+Platform Admin
 * in the API route layer.
 */
export class RolesRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<RoleRow[]> {
    return this.db.select().from(roles).orderBy(asc(roles.name));
  }

  async get(id: number): Promise<RoleRow | undefined> {
    const [row] = await this.db.select().from(roles).where(eq(roles.id, id));
    return row;
  }

  async create(entry: CreateRoleEntry): Promise<RoleRow> {
    const [row] = await this.db
      .insert(roles)
      .values({ name: entry.name, description: entry.description, createdBy: entry.createdBy })
      .returning();
    return row;
  }

  async update(id: number, patch: UpdateRoleEntry): Promise<RoleRow | undefined> {
    const [row] = await this.db.update(roles).set(patch).where(eq(roles.id, id)).returning();
    return row;
  }
}
