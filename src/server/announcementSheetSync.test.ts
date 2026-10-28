/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db/testUtils.js";
import { AnnouncementsRepository } from "./db/repositories/announcementsRepository.js";
import { parseCsv, parseFeed, toIsoDate, syncAnnouncementsFromSheet, isAutoSyncDue, SYNC_COOLDOWN_MS } from "./announcementSheetSync.js";

const HEADER = "ID,Applies To,Title,Announcement Date,Effective Date,Severity,Summary (HTML),Review Note,Method,Already In-Force,Effective Immediately,Content Hash";
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
function row(o: { id: string; team?: string; title: string; ann: string; eff?: string; sev?: string; html: string; inForce?: string; imm?: string }) {
  return [o.id, o.team ?? "Health", o.title, o.ann, o.eff ?? "", o.sev ?? "", q(o.html), "", "Script", o.inForce ?? "", o.imm ?? "", "abc123"].join(",");
}
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n");

describe("parseCsv / toIsoDate", () => {
  it("handles quotes, doubled quotes and newlines inside fields", () => {
    const rows = parseCsv('a,b\r\n"x, y","he said ""hi""\nthere"\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'he said "hi"\nthere']]);
  });
  it("reads dd/mm/yyyy and iso dates, rejects impossible ones", () => {
    expect(toIsoDate("27/10/2026")).toBe("2026-10-27");
    expect(toIsoDate("2026-10-27")).toBe("2026-10-27");
    expect(toIsoDate("31/02/2026")).toBeNull();
    expect(toIsoDate("")).toBeNull();
  });
});

describe("parseFeed", () => {
  it("maps columns, keeps HTML with colours and commas, and skips unusable rows", () => {
    const html = '<p><strong><span style="color:#d32f2f">Effective Date:</span></strong> <strong>29 October 2026</strong>, rated 3</p>';
    const { items, skipped } = parseFeed(csv(
      row({ id: "QAH261008", title: "Age-Related Premium Changes", ann: "27/10/2026", eff: "29/10/2026", sev: "3", html }),
      row({ id: "QAT261001", team: "Term", title: "WOP Rider", ann: "01/10/2026", imm: "Yes", html: "<p>x</p>" }),
      row({ id: "BAD", title: "bad id", ann: "01/10/2026", html: "<p>x</p>" }),
      row({ id: "QAH261009", title: "no date", ann: "", html: "<p>x</p>" }),
    ));
    expect(skipped).toBe(2);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ qaId: "QAH261008", team: "Health", announcementDate: "2026-10-27", effectiveDate: "2026-10-29", rating: 3, html });
    expect(items[1]).toMatchObject({ team: "Term", effectiveDate: "2026-10-01", effectiveImmediately: true, rating: null });
  });
  it("fails clearly when a column is missing", () => {
    expect(() => parseFeed("ID,Title\r\nQAH261008,x")).toThrow(/missing the "Applies To" column/);
  });
});

describe("syncAnnouncementsFromSheet", () => {
  let db: TestDb;
  let repo: AnnouncementsRepository;
  beforeEach(async () => { db = await createTestDb(); repo = new AnnouncementsRepository(db); });
  afterEach(async () => { await db.$client.close(); });

  const now = new Date("2026-10-28T10:00:00Z");
  const base = [
    row({ id: "QAH261008", title: "Age-Related Premium Changes", ann: "27/10/2026", eff: "29/10/2026", sev: "3", html: "<p>Premiums change with age across plans</p>" }),
    row({ id: "QAH250801", title: "Claim Shield Rider Updates", ann: "14/08/2025", html: "<p>Update regarding Claim Shield Plus riders</p>" }),
  ];

  it("first sync imports history without acknowledgement popups and is idempotent", async () => {
    const r1 = await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...base), now, force: true });
    expect(r1).toMatchObject({ ok: true, added: 2, updated: 0, linked: 0 });
    const rows = await repo.listAllForSync();
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.requiresAck === false)).toBe(true);
    expect(rows.every((x) => x.addedBy === "QA Sheet Sync" && x.type === "QA Announcement")).toBe(true);
    const a = rows.find((x) => x.qaId === "QAH261008")!;
    expect(a).toMatchObject({ title: "Age-Related Premium Changes", category: "Age-Related Premium Changes", rating: 3, team: "Health", effectiveDate: "2026-10-29", announcementDate: "2026-10-27" });
    expect(a.createdAt.toISOString().slice(0, 10)).toBe("2026-10-27");

    const r2 = await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...base), now, force: true });
    expect(r2).toMatchObject({ ok: true, added: 0, updated: 0, unchanged: 2 });
    expect(await repo.listAllForSync()).toHaveLength(2);
  });

  it("a recent announcement after the first sync requires acknowledgement; old late entries do not", async () => {
    await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...base), now, force: true });
    const later = new Date("2026-10-29T10:00:00Z");
    const r = await syncAnnouncementsFromSheet(db, {
      trigger: "t", now: later, force: true,
      csvText: csv(...base,
        row({ id: "QAH261009", title: "New thing", ann: "28/10/2026", html: "<p>fresh</p>" }),
        row({ id: "QAT250101", team: "Term", title: "Late backfill", ann: "01/01/2025", html: "<p>old</p>" })),
    });
    expect(r.added).toBe(2);
    expect(r.newItems.map((n) => n.qaId)).toEqual(["QAT250101", "QAH261009"]);
    const rows = await repo.listAllForSync();
    expect(rows.find((x) => x.qaId === "QAH261009")!.requiresAck).toBe(true);
    expect(rows.find((x) => x.qaId === "QAT250101")!.requiresAck).toBe(false);
  });

  it("links hand-typed announcements by date + title instead of duplicating, and keeps their content", async () => {
    const legacy = await repo.create({ announcement: "Hand typed body", category: "Age-Related Premium Changes", title: "Age-Related Premium Changes", addedBy: "Admin", announcementDate: "2026-10-27", effectiveDate: "2026-11-01", type: "QA Announcement" });
    const stray = await repo.create({ announcement: "Something else", category: "Unrelated", title: "Unrelated", addedBy: "Admin", announcementDate: "2026-01-01", type: "QA Announcement" });
    const r = await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...base), now, force: true });
    expect(r).toMatchObject({ added: 1, linked: 1 });
    const after = await repo.getById(legacy.id);
    expect(after).toMatchObject({ qaId: "QAH261008", announcement: "Hand typed body", effectiveDate: "2026-11-01" });
    expect(r.effectiveDateDiffs).toEqual([{ qaId: "QAH261008", title: "Age-Related Premium Changes", app: "2026-11-01", sheet: "2026-10-29" }]);
    expect(r.unmatchedLegacy.map((u) => u.id)).toEqual([stray.id]);
    expect((await repo.listAllForSync())).toHaveLength(3);
  });

  it("tells same-day same-title announcements apart by their body", async () => {
    const p1 = await repo.create({ announcement: "<p>Overpromising about applicability of the plan guarantee underwriting</p>", category: "Payments", title: "Payments", addedBy: "A", announcementDate: "2026-10-17", type: "QA Announcement" });
    const p2 = await repo.create({ announcement: "<p>Customers must receive the premium breakup before payment link generation</p>", category: "Payments", title: "Payments", addedBy: "A", announcementDate: "2026-10-17", type: "QA Announcement" });
    await syncAnnouncementsFromSheet(db, { trigger: "t", now, force: true, csvText: csv(
      row({ id: "QAH261006", title: "Payments", ann: "17/10/2026", html: "<p>Customers must receive the premium breakup before payment link generation today</p>" }),
      row({ id: "QAH261007", title: "Payments", ann: "17/10/2026", html: "<p>Overpromising about applicability of the plan guarantee underwriting</p>" })) });
    expect((await repo.getById(p1.id))!.qaId).toBe("QAH261007");
    expect((await repo.getById(p2.id))!.qaId).toBe("QAH261006");
  });

  it("updates a linked row only when the sheet content changed, never deletes, and never wipes on an empty feed", async () => {
    await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...base), now, force: true });
    const edited = [
      row({ id: "QAH261008", title: "Age-Related Premium Changes", ann: "27/10/2026", eff: "30/10/2026", sev: "2", html: "<p>Premiums change with age across plans</p>" }),
    ];
    const r = await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...edited), now, force: true });
    expect(r).toMatchObject({ updated: 1, added: 0 });
    const a = (await repo.listAllForSync()).find((x) => x.qaId === "QAH261008")!;
    expect(a).toMatchObject({ effectiveDate: "2026-10-30", rating: 2 });
    expect(await repo.listAllForSync()).toHaveLength(2); // the sheet no longer lists QAH250801, but it is kept

    const empty = await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: HEADER, now, force: true });
    expect(empty.ok).toBe(false);
    expect(await repo.listAllForSync()).toHaveLength(2);
    expect((await repo.getSyncState())?.lastError).toMatch(/no usable announcements/);
  });

  it("throttles repeat syncs and reports the daily auto-sync as due only after 24h", async () => {
    await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...base), now });
    const again = await syncAnnouncementsFromSheet(db, { trigger: "t", csvText: csv(...base), now: new Date(now.getTime() + SYNC_COOLDOWN_MS - 1000) });
    expect(again.throttled).toBe(true);
    expect(await isAutoSyncDue(db, new Date(now.getTime() + 3 * 3600_000))).toBe(false);
    expect(await isAutoSyncDue(db, new Date(now.getTime() + 25 * 3600_000))).toBe(true);
  });
});
