/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { describeUserAccessChanges, type UserAccessCatalogs } from "./describeUserAccessChanges.js";

const stubCatalogs = (names: Record<number, string> = {}): UserAccessCatalogs => {
  const lookup = { get: async (id: number) => (id in names ? { name: names[id] } : undefined) };
  return { departments: lookup, orgTeams: lookup, roles: lookup };
};

const baseUser = { tier: "General", status: "Active", tags: [] as string[], departmentId: null, orgTeamId: null, roleId: null };

describe("describeUserAccessChanges", () => {
  it("returns no clauses when nothing access-relevant changed (name/TACT ID edits aren't passed in at all)", async () => {
    const clauses = await describeUserAccessChanges(baseUser, {}, stubCatalogs());
    expect(clauses).toEqual([]);
  });

  it("returns no clauses when the 'after' values are identical to 'before'", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { tier: "General", status: "Active", tags: [] }, stubCatalogs());
    expect(clauses).toEqual([]);
  });

  it("reports a tier change", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { tier: "Admin" }, stubCatalogs());
    expect(clauses).toEqual(["tier General → Admin"]);
  });

  it("reports a status change", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { status: "Disabled" }, stubCatalogs());
    expect(clauses).toEqual(["status Active → Disabled"]);
  });

  it("reports a tags change, order-insensitive", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { tags: ["Term", "Health"] }, stubCatalogs());
    expect(clauses).toEqual(["tags none → Term/Health"]);

    // Same set, different order -> not a change.
    const noChange = await describeUserAccessChanges({ ...baseUser, tags: ["Health", "Term"] }, { tags: ["Term", "Health"] }, stubCatalogs());
    expect(noChange).toEqual([]);
  });

  it("reports a department change by resolved name, not raw id", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { departmentId: 5 }, stubCatalogs({ 5: "Advisory" }));
    expect(clauses).toEqual(["department Unassigned → Advisory"]);
  });

  it("reports unassigning a department (id -> null)", async () => {
    const clauses = await describeUserAccessChanges({ ...baseUser, departmentId: 5 }, { departmentId: null }, stubCatalogs({ 5: "Advisory" }));
    expect(clauses).toEqual(["department Advisory → Unassigned"]);
  });

  it("reports reassigning a department (id -> different id)", async () => {
    const clauses = await describeUserAccessChanges({ ...baseUser, departmentId: 5 }, { departmentId: 7 }, stubCatalogs({ 5: "Advisory", 7: "Operations" }));
    expect(clauses).toEqual(["department Advisory → Operations"]);
  });

  it("falls back to 'Unknown' if a referenced id no longer resolves", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { departmentId: 99 }, stubCatalogs());
    expect(clauses).toEqual(["department Unassigned → Unknown"]);
  });

  it("reports business unit and role changes independently, by their own catalog", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { orgTeamId: 1, roleId: 2 }, stubCatalogs({ 1: "Bliss", 2: "Mentor" }));
    expect(clauses.sort()).toEqual(["business unit Unassigned → Bliss", "role Unassigned → Mentor"].sort());
  });

  it("reports multiple simultaneous changes together", async () => {
    const clauses = await describeUserAccessChanges(baseUser, { tier: "Admin", status: "Disabled" }, stubCatalogs());
    expect(clauses).toEqual(["tier General → Admin", "status Active → Disabled"]);
  });

  it("never reports a field whose 'after' value is simply undefined (not supplied)", async () => {
    const clauses = await describeUserAccessChanges({ ...baseUser, tier: "Admin" }, { status: "Disabled" }, stubCatalogs());
    expect(clauses).toEqual(["status Active → Disabled"]);
  });
});
