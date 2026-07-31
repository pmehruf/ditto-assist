/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { qaDashboardGoogleConnection, type QaDashboardGoogleConnectionRow } from "../schema.js";

const CONNECTION_ID = "default";

/**
 * Data Access Layer for `qa_dashboard_google_connection` — the QA
 * Dashboard's single stored Google OAuth grant (see
 * src/server/qaDashboard/*). Always exactly zero or one row.
 */
export class QaDashboardConnectionRepository {
  constructor(private readonly db: AnyDb) {}

  async get(): Promise<QaDashboardGoogleConnectionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(qaDashboardGoogleConnection)
      .where(eq(qaDashboardGoogleConnection.id, CONNECTION_ID));
    return row;
  }

  async upsert(data: {
    connectedEmail: string;
    encryptedRefreshToken: string;
    connectedBy: string;
  }): Promise<QaDashboardGoogleConnectionRow> {
    const [row] = await this.db
      .insert(qaDashboardGoogleConnection)
      .values({ id: CONNECTION_ID, ...data, connectedAt: new Date() })
      .onConflictDoUpdate({
        target: qaDashboardGoogleConnection.id,
        set: { ...data, connectedAt: new Date() },
      })
      .returning();
    return row;
  }

  async clear(): Promise<void> {
    await this.db.delete(qaDashboardGoogleConnection).where(eq(qaDashboardGoogleConnection.id, CONNECTION_ID));
  }
}
