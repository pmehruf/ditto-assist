/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { AnyDb } from "../client.js";
import { playbookCells, playbookPublished, playbookSnapshots, playbookSnapshotTabs, playbookSyncState } from "../schema.js";
import type { CellRow, TabRow } from "../../playbookMirror/transform.js";

type Domain = "Health" | "Term";

export interface NewSnapshot {
  domain: Domain;
  spreadsheetId: string;
  fetchedVia: string;
  trigger: string;
  requestRanges: string[];
  requestFields: string;
  rawResponseGzip: Buffer;
  rawResponseBytes: number;
  rawSha256: string;
  parserVersion: string;
  status: "fetched" | "rejected";
  rejectedReason: string | null;
}

export interface SnapshotSummary {
  id: number;
  domain: string;
  fetchedAt: Date;
  fetchedVia: string;
  trigger: string;
  rawSha256: string;
  rawResponseBytes: number;
  parserVersion: string;
  status: string;
  rejectedReason: string | null;
  publishedAt: Date | null;
}

const CELL_BATCH = 500;

/**
 * Data Access Layer for the Playbook mirror's snapshots (migration 0090).
 * Snapshots, tabs and cells are write-once (database triggers enforce it);
 * this repository only ever inserts them. It never touches the published
 * pointer — publishing is a later step with its own approval.
 */
export class PlaybookMirrorSnapshotsRepository {
  constructor(private readonly db: AnyDb) {}

  async latest(domain: Domain = "Health"): Promise<SnapshotSummary | undefined> {
    const [row] = await this.list(domain, 1);
    return row;
  }

  async list(domain: Domain = "Health", limit = 30): Promise<SnapshotSummary[]> {
    return this.db
      .select({
        id: playbookSnapshots.id,
        domain: playbookSnapshots.domain,
        fetchedAt: playbookSnapshots.fetchedAt,
        fetchedVia: playbookSnapshots.fetchedVia,
        trigger: playbookSnapshots.trigger,
        rawSha256: playbookSnapshots.rawSha256,
        rawResponseBytes: playbookSnapshots.rawResponseBytes,
        parserVersion: playbookSnapshots.parserVersion,
        status: playbookSnapshots.status,
        rejectedReason: playbookSnapshots.rejectedReason,
        publishedAt: playbookSnapshots.publishedAt,
      })
      .from(playbookSnapshots)
      .where(eq(playbookSnapshots.domain, domain))
      .orderBy(desc(playbookSnapshots.fetchedAt), desc(playbookSnapshots.id))
      .limit(limit);
  }

  /** Inserts a snapshot with its tabs and cells atomically. Returns null if another sync holds the lock. */
  async insertSnapshot(snapshot: NewSnapshot, tabs: TabRow[], cells: CellRow[]): Promise<{ id: number } | null> {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('playbook_mirror_sync')) as locked`);
      const locked = (lock as unknown as { rows?: { locked: boolean }[] }).rows?.[0]?.locked ?? (lock as unknown as { locked: boolean }[])[0]?.locked;
      if (!locked) return null;
      const [row] = await tx.insert(playbookSnapshots).values(snapshot).returning({ id: playbookSnapshots.id });
      if (tabs.length > 0) {
        await tx.insert(playbookSnapshotTabs).values(tabs.map((t) => ({ ...t, snapshotId: row.id })));
      }
      for (let i = 0; i < cells.length; i += CELL_BATCH) {
        await tx.insert(playbookCells).values(cells.slice(i, i + CELL_BATCH).map((c) => ({ ...c, snapshotId: row.id })));
      }
      return { id: row.id };
    });
  }

  async cells(snapshotId: number, sheetGid?: number) {
    const where = sheetGid === undefined ? eq(playbookCells.snapshotId, snapshotId) : and(eq(playbookCells.snapshotId, snapshotId), eq(playbookCells.sheetGid, sheetGid));
    return this.db.select().from(playbookCells).where(where).orderBy(playbookCells.sheetGid, playbookCells.rowNum, playbookCells.colNum);
  }

  async tabs(snapshotId: number) {
    return this.db.select().from(playbookSnapshotTabs).where(eq(playbookSnapshotTabs.snapshotId, snapshotId));
  }

  /** Full snapshot row, including the raw response (for reconciliation). */
  async get(snapshotId: number) {
    const [row] = await this.db.select().from(playbookSnapshots).where(eq(playbookSnapshots.id, snapshotId));
    return row;
  }

  /** The snapshot advisors would currently see (none until publishing exists). */
  async publishedSnapshotId(domain: Domain = "Health"): Promise<number | null> {
    const [row] = await this.db.select({ id: playbookPublished.snapshotId }).from(playbookPublished).where(eq(playbookPublished.domain, domain));
    return row?.id ?? null;
  }

  /** Records reconciliation + difference report. Moves a 'fetched' snapshot to 'verified' or 'rejected' only. */
  async recordVerification(snapshotId: number, reconciliation: unknown, diff: unknown, outcome: "verified" | "rejected", reason: string | null): Promise<boolean> {
    const updated = await this.db
      .update(playbookSnapshots)
      .set(outcome === "verified" ? { reconciliationReport: reconciliation, diffVsPublished: diff, status: "verified" } : { reconciliationReport: reconciliation, diffVsPublished: diff, status: "rejected", rejectedReason: reason })
      .where(and(eq(playbookSnapshots.id, snapshotId), eq(playbookSnapshots.status, "fetched")))
      .returning({ id: playbookSnapshots.id });
    return updated.length === 1;
  }

  async getSyncState(domain: Domain = "Health") {
    const [row] = await this.db.select().from(playbookSyncState).where(eq(playbookSyncState.domain, domain));
    return row;
  }

  async recordSyncState(
    domain: Domain,
    update: { lastAttemptAt?: Date; lastSuccessAt?: Date; lastTrigger?: string; lastError?: string | null; lastSnapshotId?: number }
  ): Promise<void> {
    await this.db
      .insert(playbookSyncState)
      .values({ domain, ...update })
      .onConflictDoUpdate({ target: playbookSyncState.domain, set: update });
  }
}
