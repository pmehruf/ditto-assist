/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { createTestDb } from "../testUtils.js";
import { createRepositories } from "./index.js";
import { getGroupAllowedFeatureIds } from "../../accessControl/evaluateAccess.js";

async function seedUser(repos: ReturnType<typeof createRepositories>, email: string, name: string, tactId: string) {
  await repos.users.create({ email, name, tactId, tier: "General" });
}

async function seedGroup(repos: ReturnType<typeof createRepositories>, name: string) {
  return repos.relationshipGroups.create({ name, description: null, departmentId: null, createdBy: "test" });
}

describe("UserRelationshipsRepository.reassignOwner — Reassign Owner action", () => {
  it("moves every mapping from the old owner to the new owner within one group, in a single call", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await seedUser(repos, "old-owner@example.com", "Old Owner", "T-OLD");
    await seedUser(repos, "new-owner@example.com", "New Owner", "T-NEW");
    await seedUser(repos, "member-a@example.com", "Member A", "T-MA");
    await seedUser(repos, "member-b@example.com", "Member B", "T-MB");
    const group = await seedGroup(repos, "Coach");
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member-a@example.com", relationshipGroupId: group.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member-b@example.com", relationshipGroupId: group.id, createdBy: "test" });

    const result = await repos.userRelationships.reassignOwner(group.id, "old-owner@example.com", "new-owner@example.com");
    expect(result).toEqual({ reassigned: 2, duplicatesDropped: 0 });

    const rows = await repos.userRelationships.list();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ownerEmail === "new-owner@example.com")).toBe(true);
    expect(new Set(rows.map((r) => r.subjectEmail))).toEqual(new Set(["member-a@example.com", "member-b@example.com"]));
  });

  it("drops the old-owner row instead of erroring when the new owner already has that same subject in the group (dedup)", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await seedUser(repos, "old-owner@example.com", "Old Owner", "T-OLD");
    await seedUser(repos, "new-owner@example.com", "New Owner", "T-NEW");
    await seedUser(repos, "member-x@example.com", "Member X", "T-MX");
    await seedUser(repos, "member-y@example.com", "Member Y", "T-MY");
    await seedUser(repos, "member-z@example.com", "Member Z", "T-MZ");
    const group = await seedGroup(repos, "Coach");
    // old-owner has x, y, z. new-owner already independently has y in this
    // same group (a pre-existing overlap) — reassigning old-owner's roster
    // onto new-owner would otherwise collide on (new-owner, y, group).
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member-x@example.com", relationshipGroupId: group.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member-y@example.com", relationshipGroupId: group.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member-z@example.com", relationshipGroupId: group.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "new-owner@example.com", subjectEmail: "member-y@example.com", relationshipGroupId: group.id, createdBy: "test" });

    const result = await repos.userRelationships.reassignOwner(group.id, "old-owner@example.com", "new-owner@example.com");
    expect(result).toEqual({ reassigned: 2, duplicatesDropped: 1 });

    // Exactly 3 rows survive (x, y, z), all under new-owner — no duplicate
    // row for y, and nothing lost.
    const rows = await repos.userRelationships.list();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.ownerEmail === "new-owner@example.com")).toBe(true);
    expect(new Set(rows.map((r) => r.subjectEmail))).toEqual(new Set(["member-x@example.com", "member-y@example.com", "member-z@example.com"]));
  });

  it("is a no-op when the old owner has no roster in that group", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await seedUser(repos, "old-owner@example.com", "Old Owner", "T-OLD");
    await seedUser(repos, "new-owner@example.com", "New Owner", "T-NEW");
    const group = await seedGroup(repos, "Coach");

    const result = await repos.userRelationships.reassignOwner(group.id, "old-owner@example.com", "new-owner@example.com");
    expect(result).toEqual({ reassigned: 0, duplicatesDropped: 0 });
    expect(await repos.userRelationships.list()).toHaveLength(0);
  });

  it("only touches the roster in the specified group — the same owner's roster in a different group is untouched", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await seedUser(repos, "old-owner@example.com", "Old Owner", "T-OLD");
    await seedUser(repos, "new-owner@example.com", "New Owner", "T-NEW");
    await seedUser(repos, "member-a@example.com", "Member A", "T-MA");
    await seedUser(repos, "member-b@example.com", "Member B", "T-MB");
    const groupA = await seedGroup(repos, "DH100");
    const groupB = await seedGroup(repos, "DH200");
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member-a@example.com", relationshipGroupId: groupA.id, createdBy: "test" });
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member-b@example.com", relationshipGroupId: groupB.id, createdBy: "test" });

    await repos.userRelationships.reassignOwner(groupA.id, "old-owner@example.com", "new-owner@example.com");

    const rows = await repos.userRelationships.list();
    const rowA = rows.find((r) => r.relationshipGroupId === groupA.id)!;
    const rowB = rows.find((r) => r.relationshipGroupId === groupB.id)!;
    expect(rowA.ownerEmail).toBe("new-owner@example.com");
    expect(rowB.ownerEmail).toBe("old-owner@example.com"); // untouched
  });

  it("never changes any member's effective Group Access — access is keyed by group, not owner (migration 0081 invariant)", async () => {
    const db = await createTestDb();
    const repos = createRepositories(db);
    await seedUser(repos, "old-owner@example.com", "Old Owner", "T-OLD");
    await seedUser(repos, "new-owner@example.com", "New Owner", "T-NEW");
    await seedUser(repos, "member@example.com", "Member One", "T1");
    const group = await seedGroup(repos, "Coach");
    await repos.relationshipGroups.update(group.id, { usedForGroupAccess: true });
    await repos.userRelationships.create({ ownerEmail: "old-owner@example.com", subjectEmail: "member@example.com", relationshipGroupId: group.id, createdBy: "test" });
    await repos.groupToolAccess.replaceForGroup(group.id, ["porting_assist"], "test");

    expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toEqual(["porting_assist"]);

    await repos.userRelationships.reassignOwner(group.id, "old-owner@example.com", "new-owner@example.com");

    // Same group, same tool grants, same member — reassigning who "owns"
    // the roster has no bearing on what the member can access.
    expect(await getGroupAllowedFeatureIds(repos, "member@example.com", "General")).toEqual(["porting_assist"]);
  });
});
