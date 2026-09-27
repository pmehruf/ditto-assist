/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testUtils.js";
import { AnnouncementAcksRepository } from "./announcementAcksRepository.js";
import { AnnouncementsRepository } from "./announcementsRepository.js";
import { UsersRepository } from "./usersRepository.js";

describe("AnnouncementAcksRepository", () => {
  let db: TestDb;
  let acks: AnnouncementAcksRepository;
  let announcements: AnnouncementsRepository;
  let users: UsersRepository;

  beforeEach(async () => {
    db = await createTestDb();
    acks = new AnnouncementAcksRepository(db);
    announcements = new AnnouncementsRepository(db);
    users = new UsersRepository(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  const baseAnnouncement = {
    announcement: "New PED mapping released.",
    category: "Plan A",
    addedBy: "Alice",
    requiresAck: true,
  };

  const baseUser = {
    name: "Bob",
    tactId: "TACT-101",
    tier: "General" as const,
    status: "Active" as const,
  };

  // "Both Advisors" audience (2026-09) — a Health-only or Term-only tagged
  // user must still be required to ack a "Both"-tagged announcement, not
  // just ones tagged exactly their own team. Mirrors the equivalent fix in
  // announcementsRepository.ts's list-filtering (see its own tests).
  // Note: listUnackedForUser only ever returns announcements with
  // createdAt >= the user's own createdAt (a newly joined user is never
  // asked to ack pre-existing notices) — so every test below creates the
  // user FIRST, then the announcements, to land on the right side of that
  // comparison.
  describe("listUnackedForUser with the 'Both' audience", () => {
    it("a Health-only tagged user must ack Health AND Both, not Term", async () => {
      await users.create({ ...baseUser, email: "health@joinditto.in", tags: ["Health"] });
      await announcements.create({ ...baseAnnouncement, announcement: "health", team: "Health" });
      await announcements.create({ ...baseAnnouncement, announcement: "term", team: "Term" });
      await announcements.create({ ...baseAnnouncement, announcement: "both", team: "Both" });

      const unacked = await acks.listUnackedForUser("health@joinditto.in");
      expect(unacked.map((r) => r.announcement).sort()).toEqual(["both", "health"].sort());
    });

    it("a Term-only tagged user must ack Term AND Both, not Health", async () => {
      await users.create({ ...baseUser, email: "term@joinditto.in", tags: ["Term"] });
      await announcements.create({ ...baseAnnouncement, announcement: "health", team: "Health" });
      await announcements.create({ ...baseAnnouncement, announcement: "term", team: "Term" });
      await announcements.create({ ...baseAnnouncement, announcement: "both", team: "Both" });

      const unacked = await acks.listUnackedForUser("term@joinditto.in");
      expect(unacked.map((r) => r.announcement).sort()).toEqual(["both", "term"].sort());
    });

    it("an unassigned (no-tag) user must ack every audience, including Both", async () => {
      await users.create({ ...baseUser, email: "unassigned@joinditto.in", tags: [] });
      await announcements.create({ ...baseAnnouncement, announcement: "health", team: "Health" });
      await announcements.create({ ...baseAnnouncement, announcement: "term", team: "Term" });
      await announcements.create({ ...baseAnnouncement, announcement: "both", team: "Both" });

      const unacked = await acks.listUnackedForUser("unassigned@joinditto.in");
      expect(unacked).toHaveLength(3);
    });

    it("a user tagged with BOTH Health and Term must ack everything too", async () => {
      await users.create({ ...baseUser, email: "dual@joinditto.in", tags: ["Health", "Term"] });
      await announcements.create({ ...baseAnnouncement, announcement: "health", team: "Health" });
      await announcements.create({ ...baseAnnouncement, announcement: "term", team: "Term" });
      await announcements.create({ ...baseAnnouncement, announcement: "both", team: "Both" });

      const unacked = await acks.listUnackedForUser("dual@joinditto.in");
      expect(unacked).toHaveLength(3);
    });

    it("already-acknowledged announcements are excluded regardless of audience", async () => {
      await users.create({ ...baseUser, email: "health2@joinditto.in", tags: ["Health"] });
      const both = await announcements.create({ ...baseAnnouncement, announcement: "both", team: "Both" });
      await acks.acknowledge(both.id, "health2@joinditto.in");

      const unacked = await acks.listUnackedForUser("health2@joinditto.in");
      expect(unacked).toHaveLength(0);
    });
  });
});
