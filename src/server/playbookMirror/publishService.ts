/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT PLAYBOOK MIRROR — publish / reject / roll back.
 *
 * publishSnapshot is called automatically by the sync when a snapshot VERIFIES
 * (decision 2026-10-30), and is otherwise only reachable from Platform Admin
 * control routes. Reject and roll back are Platform Admin actions.
 * The database guards (migration 0090) independently refuse publishing an
 * unverified snapshot, deleting a published one, or changing published_at.
 */

import { and, eq, sql } from "drizzle-orm";
import type { AnyDb } from "../db/client.js";
import { playbookPublished, playbookSnapshots, playbookSourceIssues } from "../db/schema.js";

type Domain = "Health";

export interface PublishResult {
  ok: boolean;
  snapshotId: number;
  previousSnapshotId: number | null;
  warnings: string[];
  error?: string;
}

async function openWarnings(tx: AnyDb, domain: Domain): Promise<string[]> {
  const issues = await tx
    .select({ key: playbookSourceIssues.issueKey, a1: playbookSourceIssues.a1, description: playbookSourceIssues.description })
    .from(playbookSourceIssues)
    .where(and(eq(playbookSourceIssues.domain, domain), eq(playbookSourceIssues.showWarning, true)));
  return issues.map((i) => `Open source issue ${i.key} (${i.a1}): ${i.description}`);
}

async function lock(tx: AnyDb) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('playbook_mirror_publish'))`);
}

/** Publishes a VERIFIED snapshot. The previously published snapshot (if any) becomes 'superseded' (kept for rollback). */
export async function publishSnapshot(db: AnyDb, snapshotId: number, publishedBy: string, domain: Domain = "Health"): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    await lock(tx);
    const [snap] = await tx.select({ status: playbookSnapshots.status, domain: playbookSnapshots.domain }).from(playbookSnapshots).where(eq(playbookSnapshots.id, snapshotId));
    if (!snap) return { ok: false, snapshotId, previousSnapshotId: null, warnings: [], error: "Snapshot not found." };
    if (snap.domain !== domain) return { ok: false, snapshotId, previousSnapshotId: null, warnings: [], error: "Snapshot belongs to another domain." };
    if (snap.status !== "verified") {
      return { ok: false, snapshotId, previousSnapshotId: null, warnings: [], error: `Only a verified snapshot can be published (this one is '${snap.status}'). Use roll back for a previously published snapshot.` };
    }
    const [current] = await tx.select({ id: playbookPublished.snapshotId }).from(playbookPublished).where(eq(playbookPublished.domain, domain));
    const now = new Date();
    await tx.update(playbookSnapshots).set({ status: "published", publishedAt: now, publishedBy }).where(eq(playbookSnapshots.id, snapshotId));
    await tx
      .insert(playbookPublished)
      .values({ domain, snapshotId, updatedBy: publishedBy, updatedAt: now })
      .onConflictDoUpdate({ target: playbookPublished.domain, set: { snapshotId, updatedBy: publishedBy, updatedAt: now } });
    if (current && current.id !== snapshotId) {
      await tx.update(playbookSnapshots).set({ status: "superseded" }).where(eq(playbookSnapshots.id, current.id));
    }
    return { ok: true, snapshotId, previousSnapshotId: current?.id ?? null, warnings: await openWarnings(tx, domain) };
  });
}

/** Re-publishes a snapshot that was published before ('superseded'). Its original published_at is kept. */
export async function rollBackTo(db: AnyDb, snapshotId: number, by: string, domain: Domain = "Health"): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    await lock(tx);
    const [snap] = await tx.select({ status: playbookSnapshots.status, domain: playbookSnapshots.domain }).from(playbookSnapshots).where(eq(playbookSnapshots.id, snapshotId));
    if (!snap) return { ok: false, snapshotId, previousSnapshotId: null, warnings: [], error: "Snapshot not found." };
    if (snap.domain !== domain || snap.status !== "superseded") {
      return { ok: false, snapshotId, previousSnapshotId: null, warnings: [], error: `Only a previously published ('superseded') snapshot can be rolled back to (this one is '${snap.status}').` };
    }
    const [current] = await tx.select({ id: playbookPublished.snapshotId }).from(playbookPublished).where(eq(playbookPublished.domain, domain));
    await tx.update(playbookSnapshots).set({ status: "published" }).where(eq(playbookSnapshots.id, snapshotId));
    const now = new Date();
    await tx
      .insert(playbookPublished)
      .values({ domain, snapshotId, updatedBy: by, updatedAt: now })
      .onConflictDoUpdate({ target: playbookPublished.domain, set: { snapshotId, updatedBy: by, updatedAt: now } });
    if (current && current.id !== snapshotId) await tx.update(playbookSnapshots).set({ status: "superseded" }).where(eq(playbookSnapshots.id, current.id));
    return { ok: true, snapshotId, previousSnapshotId: current?.id ?? null, warnings: await openWarnings(tx, domain) };
  });
}

/** Manually rejects a fetched or verified snapshot (never a published one). */
export async function rejectSnapshot(db: AnyDb, snapshotId: number, by: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const text = reason.trim();
  if (text.length < 5) return { ok: false, error: "Please give a reason (at least 5 characters)." };
  const updated = await db
    .update(playbookSnapshots)
    .set({ status: "rejected", rejectedReason: `Rejected by ${by}: ${text}` })
    .where(and(eq(playbookSnapshots.id, snapshotId), sql`${playbookSnapshots.status} in ('fetched', 'verified')`))
    .returning({ id: playbookSnapshots.id });
  return updated.length === 1 ? { ok: true } : { ok: false, error: "Only a fetched or verified snapshot can be rejected." };
}
