/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { playbookFeatures, playbookPlans, playbookSnapshots } from "../schema.js";

type Domain = "Health" | "Term";

export interface AcceptPlanInput {
  planKey: string;
  insurer: string;
  displayName: string;
  expectedHeader: string;
  status: "active" | "discontinued_fresh_porting" | "brochure_only" | "hidden";
  sortOrder: number;
}
export interface AcceptFeatureInput {
  featureKey: string;
  subKey: string;
  expectedLabel: string;
  expectedSubLabel: string | null;
  sortOrder: number;
}

/**
 * Accepted structure for the Playbook mirror (playbook_plans / playbook_features)
 * and structure-check results on snapshots. Plans are always stored with
 * show_to_advisors = false and NO status confirmation: statuses stay
 * provisional until a named person confirms them (D4; the database enforces
 * that a plan can't be shown before that).
 */
export class PlaybookMirrorStructureRepository {
  constructor(private readonly db: AnyDb) {}

  async accepted(domain: Domain = "Health") {
    const [plans, features] = await Promise.all([
      this.db.select().from(playbookPlans).where(eq(playbookPlans.domain, domain)).orderBy(playbookPlans.sortOrder),
      this.db.select().from(playbookFeatures).where(eq(playbookFeatures.domain, domain)).orderBy(playbookFeatures.sortOrder),
    ]);
    return { plans, features };
  }

  /** First acceptance only: refuses if a structure has already been accepted for this domain. */
  async acceptInitial(domain: Domain, plans: AcceptPlanInput[], features: AcceptFeatureInput[], acceptedBy: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await tx.select({ n: sql<number>`count(*)::int` }).from(playbookPlans).where(eq(playbookPlans.domain, domain));
      const existingF = await tx.select({ n: sql<number>`count(*)::int` }).from(playbookFeatures).where(eq(playbookFeatures.domain, domain));
      if ((existing[0]?.n ?? 0) > 0 || (existingF[0]?.n ?? 0) > 0) {
        throw new Error("A structure has already been accepted. Changing it is a separate, reviewed action.");
      }
      const now = new Date();
      if (plans.length) {
        await tx.insert(playbookPlans).values(plans.map((p) => ({ ...p, domain, showToAdvisors: false, statusConfirmedBy: null, statusConfirmedAt: null, kbPlanName: null, updatedBy: acceptedBy, updatedAt: now })));
      }
      if (features.length) {
        await tx.insert(playbookFeatures).values(features.map((f) => ({ ...f, domain, updatedBy: acceptedBy, updatedAt: now })));
      }
    });
  }

  /** Records a structure-check result. A failed check rejects a snapshot that is still only 'fetched'. */
  async recordCheck(snapshotId: number, report: unknown, rejectReason: string | null): Promise<void> {
    await this.db
      .update(playbookSnapshots)
      .set(rejectReason ? { structureReport: report, status: "rejected", rejectedReason: rejectReason } : { structureReport: report })
      .where(rejectReason ? and(eq(playbookSnapshots.id, snapshotId), eq(playbookSnapshots.status, "fetched")) : eq(playbookSnapshots.id, snapshotId));
  }

  /** Hidden flags recorded by the most recent OTHER snapshot whose structure check passed. */
  async previousPassedHidden(domain: Domain, excludeSnapshotId: number): Promise<{ mainCols: string[]; tab2Rows: number[] } | undefined> {
    const rows = await this.db
      .select({ report: playbookSnapshots.structureReport })
      .from(playbookSnapshots)
      .where(and(eq(playbookSnapshots.domain, domain), ne(playbookSnapshots.id, excludeSnapshotId), sql`${playbookSnapshots.structureReport}->>'state' = 'passed'`))
      .orderBy(desc(playbookSnapshots.fetchedAt))
      .limit(1);
    return (rows[0]?.report as { hidden?: { mainCols: string[]; tab2Rows: number[] } } | undefined)?.hidden;
  }
}
