/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { qaDashboardRoles, type QaDashboardRoleRow } from "../schema.js";

export type QaDashboardRoleType = "admin" | "guide" | "mentor";

export interface UpsertQaDashboardRoleEntry {
  email: string;
  role: QaDashboardRoleType;
  /** Must match the "Guide"/"Mentor Name" column text in the QA team's
   * Google Sheet exactly — only meaningful for guide/mentor. Null for admin. */
  displayName: string | null;
  assignedBy: string;
}

/**
 * Data Access Layer for `qa_dashboard_roles` — the sole source of truth for
 * QA Dashboard Admin/Guide/Mentor access (see src/server/qaDashboard/qaRoles.ts),
 * managed via the "QA Dashboard Access" tab in User Directory & Management.
 */
export class QaDashboardRoleRepository {
  constructor(private readonly db: AnyDb) {}

  async listAll(): Promise<QaDashboardRoleRow[]> {
    return this.db.select().from(qaDashboardRoles).orderBy(asc(qaDashboardRoles.role), asc(qaDashboardRoles.email));
  }

  async getByEmail(email: string): Promise<QaDashboardRoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(qaDashboardRoles)
      .where(eq(qaDashboardRoles.email, email.trim().toLowerCase()));
    return row;
  }

  async upsert(data: UpsertQaDashboardRoleEntry): Promise<QaDashboardRoleRow> {
    const email = data.email.trim().toLowerCase();
    const [row] = await this.db
      .insert(qaDashboardRoles)
      .values({ email, role: data.role, displayName: data.displayName, assignedBy: data.assignedBy, assignedAt: new Date() })
      .onConflictDoUpdate({
        target: qaDashboardRoles.email,
        set: { role: data.role, displayName: data.displayName, assignedBy: data.assignedBy, assignedAt: new Date() },
      })
      .returning();
    return row;
  }

  async remove(email: string): Promise<void> {
    await this.db.delete(qaDashboardRoles).where(eq(qaDashboardRoles.email, email.trim().toLowerCase()));
  }
}
