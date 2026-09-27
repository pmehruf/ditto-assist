/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { orgTeams, type OrgTeamRow } from "../schema.js";

export interface CreateOrgTeamEntry {
  name: string;
  description: string | null;
  createdBy: string;
}

export type UpdateOrgTeamEntry = Partial<Pick<OrgTeamRow, "name" | "description" | "active">>;

/**
 * Data Access Layer for `org_teams` (Bliss / Falcon / Central) — see
 * schema.ts's doc comment on the table for why this is a separate, freely
 * managed catalog (not a hardcoded enum) and why it's named org_teams, not
 * teams. Read by Admin+Platform Admin+Developer; writes gated to
 * Developer+Platform Admin in the API route layer.
 */
export class OrgTeamsRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<OrgTeamRow[]> {
    return this.db.select().from(orgTeams).orderBy(asc(orgTeams.name));
  }

  async get(id: number): Promise<OrgTeamRow | undefined> {
    const [row] = await this.db.select().from(orgTeams).where(eq(orgTeams.id, id));
    return row;
  }

  async create(entry: CreateOrgTeamEntry): Promise<OrgTeamRow> {
    const [row] = await this.db
      .insert(orgTeams)
      .values({ name: entry.name, description: entry.description, createdBy: entry.createdBy })
      .returning();
    return row;
  }

  async update(id: number, patch: UpdateOrgTeamEntry): Promise<OrgTeamRow | undefined> {
    const [row] = await this.db.update(orgTeams).set(patch).where(eq(orgTeams.id, id)).returning();
    return row;
  }

  /** Hard delete — see departmentsRepository.ts's `delete()` doc comment;
   * same reasoning and the same caller obligation to run
   * countCatalogDependencies() first. */
  async delete(id: number): Promise<void> {
    await this.db.delete(orgTeams).where(eq(orgTeams.id, id));
  }
}
