/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import {
  flaggedIssues,
  type FlaggedIssueRow,
  type NewFlaggedIssueRow,
} from "../schema.js";

export interface FlaggedIssueFilter {
  status?: FlaggedIssueRow["status"];
  userEmail?: string;
  planName?: string;
  limit?: number;
}

export type CreateFlaggedIssueEntry = Omit<NewFlaggedIssueRow, "id" | "timestamp" | "status" | "resolvedAt"> & {
  timestamp?: string | Date;
};

export type UpdateFlaggedIssueEntry = Partial<
  Pick<NewFlaggedIssueRow, "status" | "ownerNotes">
> & {
  resolvedAt?: string | Date | null;
};

/**
 * Data Access Layer for reported/flagged mismatches (flagged_issues table),
 * i.e. the "Flagged Outputs" workflow: a user reports a bad match, a Developer
 * triages it through Pending -> Urgent/Resolved/Ignored.
 */
export class FlaggedIssuesRepository {
  constructor(private readonly db: AnyDb) {}

  /** Reports a new flagged output. Always starts life as "Pending". */
  async create(entry: CreateFlaggedIssueEntry): Promise<FlaggedIssueRow> {
    const [row] = await this.db
      .insert(flaggedIssues)
      .values({
        ...entry,
        timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
      })
      .returning();
    return row;
  }

  /** Developer-only triage action: change status and/or add owner notes. */
  async update(id: number, entry: UpdateFlaggedIssueEntry): Promise<FlaggedIssueRow | undefined> {
    const [row] = await this.db
      .update(flaggedIssues)
      .set({
        ...entry,
        resolvedAt:
          entry.resolvedAt === undefined
            ? undefined
            : entry.resolvedAt === null
              ? null
              : new Date(entry.resolvedAt),
      })
      .where(eq(flaggedIssues.id, id))
      .returning();
    return row;
  }

  /** Developer-only: permanently deletes a flagged issue report. */
  async delete(id: number): Promise<void> {
    await this.db.delete(flaggedIssues).where(eq(flaggedIssues.id, id));
  }

  async list(filter: FlaggedIssueFilter = {}): Promise<FlaggedIssueRow[]> {
    const conditions = [];
    if (filter.status) conditions.push(eq(flaggedIssues.status, filter.status));
    if (filter.userEmail) conditions.push(eq(flaggedIssues.userEmail, filter.userEmail));
    if (filter.planName) conditions.push(eq(flaggedIssues.planName, filter.planName));

    const query = this.db
      .select()
      .from(flaggedIssues)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(flaggedIssues.timestamp));

    return filter.limit ? query.limit(filter.limit) : query;
  }
}
