/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RETIRED (2026-09) — see the `describe.skip` below for the disposition.
 *
 * Originally: a regression test for migration 0081 (group_tool_access:
 * owner-keyed -> group-keyed).
 *
 * Every OTHER test in this repo runs against a database created by
 * testUtils.ts's createTestDb(), which applies every migration file to a
 * fresh, EMPTY database in one shot. Migration 0081's backfill SQL
 * (`INSERT ... SELECT DISTINCT ... FROM group_tool_access gta JOIN
 * user_relationships ur ON ur.owner_email = gta.group_owner_email ...`)
 * technically executes in that path, but there is never any pre-existing
 * owner-keyed row for it to act on, so the backfill is a no-op in every
 * existing test run. None of them actually prove the backfill is correct.
 *
 * This test closed that gap: it built a database up through migration
 * 0080 (group_tool_access still has its original group_owner_email
 * column), seeded rows in the exact OLD owner-keyed shape via raw SQL (the
 * typed `groupToolAccess` table in schema.ts no longer has
 * groupOwnerEmail, so the repository layer can't express this shape --
 * that's precisely why this needed raw SQL), applied migration 0081's real
 * SQL file, and then verified the result through the same production code
 * path real members and admins go through (getGroupAllowedFeatureIds).
 *
 * -----------------------------------------------------------------------
 * WHY THIS IS NOW RETIRED, NOT REWRITTEN (2026-09 migration-loss incident)
 * -----------------------------------------------------------------------
 * Migration files 0057-0081 -- including 0081_group_tool_access_per_group
 * itself -- were permanently deleted from this checkout by an accidental
 * `git clean -fd drizzle/` before they were ever committed. Production's
 * real database already has that entire history applied and is completely
 * unaffected; only this local working copy of the historical .sql files is
 * gone, irrecoverably (see drizzle.test.config.ts's header comment and
 * testUtils.ts's header comment for the full incident writeup, and
 * drizzle/meta/_journal.json, which now jumps straight from idx 56 to the
 * newly-appended 0082, with 0057-0081 entirely absent).
 *
 * This test's `applyMigration(db, TARGET_MIGRATION)` call reads
 * `drizzle/0081_group_tool_access_per_group.sql` directly off disk. That
 * file no longer exists, so the test can only ever fail -- with an ENOENT,
 * not a real assertion failure. There is no way to "fix" this test without
 * either (a) the real, lost 0081 SQL, which is unrecoverable, or (b)
 * hand-writing a *new* SQL script and asserting it does what we now
 * believe the old one did -- which wouldn't be a regression test at all,
 * just a test of an invention. Per instruction, that fabrication is
 * explicitly ruled out.
 *
 * The remaining question is whether the underlying BUSINESS invariant this
 * test cared about -- "a group's effective access is resolved correctly
 * via getGroupAllowedFeatureIds: per-flagged-group, no bleed across other
 * groups or owners, respecting used_for_group_access" -- can be tested
 * against current schema/app behavior instead, without the migration
 * replay. It can, but doing so would add no coverage: that exact invariant,
 * on the current group-keyed schema, is already exhaustively exercised by
 * evaluateAccess.test.ts's "getGroupAllowedFeatureIds / Group Access
 * Restriction" suite -- e.g. its "different feature sets" and "multiple
 * owners" cases cover precisely this test's groupA/groupB/groupOther
 * no-cross-bleed scenario, and its usedForGroupAccess-toggle case covers
 * this test's unflagged-groupC control. What THIS test uniquely proved --
 * and the only thing retiring it actually loses -- is that migration
 * 0081's specific backfill SQL script was, historically, written
 * correctly. That proof depended entirely on the now-unrecoverable file
 * and cannot be reconstructed by any test run against today's schema.
 *
 * Left in place (skipped, not deleted) as a historical/forensic record and
 * in case a copy of the lost 0081 file ever resurfaces (an old checkout, a
 * CI artifact, a teammate's local clone) -- at which point this can simply
 * be un-skipped again.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema.js";
import { createRepositories } from "./repositories/index.js";
import { getGroupAllowedFeatureIds } from "../accessControl/evaluateAccess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../../../drizzle");
const TARGET_MIGRATION = "0081_group_tool_access_per_group";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** Every migration tag strictly before `beforeTag`, in journal order. */
function migrationTagsBefore(beforeTag: string): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8")) as {
    entries: Array<{ tag: string }>;
  };
  const tags: string[] = [];
  for (const entry of journal.entries) {
    if (entry.tag === beforeTag) break;
    tags.push(entry.tag);
  }
  return tags;
}

async function applyMigration(db: TestDb, tag: string) {
  const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf-8");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await db.execute(sql.raw(trimmed));
  }
}

async function setupPreMigrationDb(): Promise<TestDb> {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle(client, { schema });
  for (const tag of migrationTagsBefore(TARGET_MIGRATION)) {
    await applyMigration(db, tag);
  }
  return db;
}

// RETIRED (2026-09): migration 0081's own .sql file was permanently lost
// (see the header comment above for the full incident + rationale). This
// suite can only fail with ENOENT, not a real assertion, and rewriting it
// against current schema would just duplicate evaluateAccess.test.ts's
// existing "getGroupAllowedFeatureIds / Group Access Restriction" coverage.
// Left in place, skipped, as a historical record — un-skip only if the real
// 0081 SQL file ever resurfaces.
describe.skip("migration 0081 — owner-keyed to group-keyed backfill (real pre-migration data)", () => {
  it("preserves every existing group's effective access, leaves unflagged/unrelated groups and relationship_groups untouched, and creates exactly the expected rows (no loss, no duplication)", async () => {
    const db = await setupPreMigrationDb();

    // --- Seed pre-0081 state ---------------------------------------------
    // Two owners. `owner@example.com` manages three relationship groups:
    // groupA and groupB are flagged for Group Access, groupC is NOT (a
    // control proving the backfill respects used_for_group_access).
    // `other-owner@example.com` manages an entirely unrelated flagged
    // group, proving the backfill never bleeds across owners.
    await db.execute(sql`
      insert into users (email, name, tact_id, tier) values
        ('owner@example.com', 'Owner One', 'T-OWNER', 'General'),
        ('member-a@example.com', 'Member A', 'T-MA', 'General'),
        ('member-b@example.com', 'Member B', 'T-MB', 'General'),
        ('member-c@example.com', 'Member C', 'T-MC', 'General'),
        ('other-owner@example.com', 'Other Owner', 'T-OO', 'General'),
        ('other-member@example.com', 'Other Member', 'T-OM', 'General')
    `);

    const groupARes = await db.execute<{ id: number }>(
      sql`insert into relationship_groups (name, active, used_for_group_access, created_by) values ('DH100', true, true, 'test') returning id`
    );
    const groupBRes = await db.execute<{ id: number }>(
      sql`insert into relationship_groups (name, active, used_for_group_access, created_by) values ('DH200', true, true, 'test') returning id`
    );
    const groupCRes = await db.execute<{ id: number }>(
      sql`insert into relationship_groups (name, active, used_for_group_access, created_by) values ('DH300-unflagged', true, false, 'test') returning id`
    );
    const groupOtherRes = await db.execute<{ id: number }>(
      sql`insert into relationship_groups (name, active, used_for_group_access, created_by) values ('Mentor-Guide-style', true, true, 'test') returning id`
    );
    const groupA = groupARes.rows[0].id;
    const groupB = groupBRes.rows[0].id;
    const groupC = groupCRes.rows[0].id;
    const groupOther = groupOtherRes.rows[0].id;

    await db.execute(sql`
      insert into user_relationships (owner_email, subject_email, relationship_group_id, created_by) values
        ('owner@example.com', 'member-a@example.com', ${groupA}, 'test'),
        ('owner@example.com', 'member-b@example.com', ${groupB}, 'test'),
        ('owner@example.com', 'member-c@example.com', ${groupC}, 'test'),
        ('other-owner@example.com', 'other-member@example.com', ${groupOther}, 'test')
    `);

    // OLD owner-keyed group_tool_access rows — this is the shape 0081 must
    // migrate. Under the pre-081 (buggy) model this single row for
    // `owner@example.com` applied identically to every flagged group that
    // owner manages, which is exactly the bug being fixed.
    await db.execute(sql`
      insert into group_tool_access (group_owner_email, feature_id, created_by) values
        ('owner@example.com', 'porting_assist', 'test'),
        ('other-owner@example.com', 'coverage_projection', 'test')
    `);

    const preCount = await db.execute<{ count: string }>(sql`select count(*)::int as count from group_tool_access`);
    expect(Number(preCount.rows[0].count)).toBe(2);

    // Earlier migrations (0038-era) already seed real "Mentor" / "Guide"
    // relationship_groups rows — use those as the actual Mentor/Guide
    // fixture for requirement 3 rather than inventing a stand-in.
    const relGroupsBefore = await db.execute<{ id: number; name: string; used_for_group_access: boolean }>(
      sql`select id, name, used_for_group_access from relationship_groups order by id`
    );
    expect(relGroupsBefore.rows).toContainEqual({ id: groupA, name: "DH100", used_for_group_access: true });
    expect(relGroupsBefore.rows).toContainEqual({ id: groupB, name: "DH200", used_for_group_access: true });
    expect(relGroupsBefore.rows).toContainEqual({ id: groupC, name: "DH300-unflagged", used_for_group_access: false });
    expect(relGroupsBefore.rows).toContainEqual({ id: groupOther, name: "Mentor-Guide-style", used_for_group_access: true });
    const mentorGuideRowsBefore = relGroupsBefore.rows.filter((r) => r.name === "Mentor" || r.name === "Guide");
    expect(mentorGuideRowsBefore.length).toBeGreaterThan(0);

    // --- Apply migration 0081 --------------------------------------------
    await applyMigration(db, TARGET_MIGRATION);

    // --- Requirement 6: no records lost or duplicated during backfill ----
    // owner@example.com's single old row fans out to exactly 2 new rows
    // (groupA, groupB — the two FLAGGED groups they actually have members
    // in; groupC is excluded because it isn't used for group access).
    // other-owner@example.com's row fans out to exactly 1 new row
    // (groupOther). Total = 3, not 2 (lost) and not more than 3
    // (duplicated).
    const postCount = await db.execute<{ count: string }>(sql`select count(*)::int as count from group_tool_access`);
    expect(Number(postCount.rows[0].count)).toBe(3);

    const postRows = await db.execute<{ relationship_group_id: number; feature_id: string }>(
      sql`select relationship_group_id, feature_id from group_tool_access order by relationship_group_id`
    );
    expect(postRows.rows).toEqual([
      { relationship_group_id: groupA, feature_id: "porting_assist" },
      { relationship_group_id: groupB, feature_id: "porting_assist" },
      { relationship_group_id: groupOther, feature_id: "coverage_projection" },
    ]);

    // --- Requirement 3: existing relationship_groups rows (the
    // Mentor/Guide-style groups included) are byte-for-byte unaffected --
    const relGroupsAfter = await db.execute<{ id: number; name: string; used_for_group_access: boolean }>(
      sql`select id, name, used_for_group_access from relationship_groups order by id`
    );
    expect(relGroupsAfter.rows).toEqual(relGroupsBefore.rows);
    const mentorGuideRowsAfter = relGroupsAfter.rows.filter((r) => r.name === "Mentor" || r.name === "Guide");
    expect(mentorGuideRowsAfter).toEqual(mentorGuideRowsBefore);

    // --- Requirements 1 & 4: every existing member's effective access is
    // exactly preserved through the migration, verified via the actual
    // production evaluator (getGroupAllowedFeatureIds), not a hand-rolled
    // query --------------------------------------------------------------
    const repos = createRepositories(db);
    expect(await getGroupAllowedFeatureIds(repos, "member-a@example.com", "General")).toEqual(["porting_assist"]);
    expect(await getGroupAllowedFeatureIds(repos, "member-b@example.com", "General")).toEqual(["porting_assist"]);
    // member-c's only group (groupC) was never flagged for group access,
    // so they were unrestricted before 081 and remain unrestricted after —
    // proving the migration doesn't touch used_for_group_access semantics.
    expect(await getGroupAllowedFeatureIds(repos, "member-c@example.com", "General")).toBeNull();
    expect(await getGroupAllowedFeatureIds(repos, "other-member@example.com", "General")).toEqual(["coverage_projection"]);
  });
});
