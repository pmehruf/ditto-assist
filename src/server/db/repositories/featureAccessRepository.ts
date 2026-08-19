/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { featureAccessOverrides, type FeatureAccessOverrideRow } from "../schema.js";

export type FeatureAccessLevel = "None" | "Viewer" | "Editor";

export interface SetFeatureAccessEntry {
  featureId: string;
  /** null clears that tier's override (falls back to the shipped default). */
  generalAccess: FeatureAccessLevel | null;
  adminAccess: FeatureAccessLevel | null;
  updatedBy: string;
}

/**
 * Data Access Layer for `feature_access_overrides` — the Developer-editable
 * override of DEFAULT_FEATURE_PERMISSIONS (see schema.ts's doc comment on
 * the table for the full reasoning). Read by every signed-in user (the
 * client needs the full override set to resolve hasAccess() for its own
 * tier); writes gated to Developer in the API route layer.
 */
export class FeatureAccessRepository {
  constructor(private readonly db: AnyDb) {}

  async list(): Promise<FeatureAccessOverrideRow[]> {
    return this.db.select().from(featureAccessOverrides);
  }

  /** Upsert by feature id. Passing both levels as null effectively clears
   * the row's meaningful content but still leaves a row behind — callers
   * that want a full "reset to default" should use `clear` instead so the
   * feature disappears from the override list entirely. */
  async set(entry: SetFeatureAccessEntry): Promise<FeatureAccessOverrideRow> {
    const [row] = await this.db
      .insert(featureAccessOverrides)
      .values({
        featureId: entry.featureId,
        generalAccess: entry.generalAccess,
        adminAccess: entry.adminAccess,
        updatedBy: entry.updatedBy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: featureAccessOverrides.featureId,
        set: {
          generalAccess: entry.generalAccess,
          adminAccess: entry.adminAccess,
          updatedBy: entry.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  /** Removes the override row entirely — "reset to default" for a feature. */
  async clear(featureId: string): Promise<void> {
    await this.db.delete(featureAccessOverrides).where(eq(featureAccessOverrides.featureId, featureId));
  }
}
