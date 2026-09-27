/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the Product Assist Credit & Usage Management engine
 * (2026-08, revised 2026-09-07 — "multiple eligibility groups, no trial
 * fallback"). Covers the CURRENT eligibility model: any number of
 * admin-defined eligibility groups (product_assist_eligibility_groups),
 * each with independently-optional Department/Team/Role/Tag matching
 * conditions (null = "any" for that dimension, AND across the non-null
 * ones) and independently-nullable daily/monthly credit limits. A user
 * matching multiple groups gets the highest limit per dimension, with a
 * null (uncapped) limit in any matched group winning outright. A user
 * matching NO group is blocked entirely (zero monthly credits, no
 * automatic trial allotment) — plus per-user overrides, extra credits
 * (including optional expiry), and the enforcement check — against a real
 * (PGlite) Postgres instance so the SQL aggregation (SUM/GROUP BY) is
 * exercised for real, not mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { createRepositories, type Repositories } from "../db/repositories/index.js";
import {
  groupMatchesUser,
  resolveMatchedGroups,
  getQuotaStatus,
  checkQuota,
  recordUsage,
  type EligibilityGroupLike,
} from "./productAssistQuota.js";

function group(overrides: Partial<EligibilityGroupLike> = {}): EligibilityGroupLike {
  return {
    id: 1,
    name: "Test Group",
    departmentId: null,
    orgTeamId: null,
    roleId: null,
    tag: null,
    dailyCredits: null,
    monthlyCredits: null,
    ...overrides,
  };
}

describe("groupMatchesUser (pure) — null = any dimension, AND across the non-null ones", () => {
  it("a wildcard group (every condition null) matches every user", () => {
    expect(groupMatchesUser(group(), { tags: [] })).toBe(true);
    expect(groupMatchesUser(group(), { tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 3 })).toBe(true);
  });

  it("a fully-specified group requires every dimension to match simultaneously", () => {
    const g = group({ departmentId: 1, orgTeamId: 2, roleId: 3, tag: "Health" });
    expect(groupMatchesUser(g, { tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 3 })).toBe(true);
    // extra tags don't disqualify
    expect(groupMatchesUser(g, { tags: ["Health", "Term"], departmentId: 1, orgTeamId: 2, roleId: 3 })).toBe(true);
  });

  it("wrong department alone fails the match even if team/role/tag all match", () => {
    const g = group({ departmentId: 1, orgTeamId: 2, roleId: 3, tag: "Health" });
    expect(groupMatchesUser(g, { tags: ["Health"], departmentId: 999, orgTeamId: 2, roleId: 3 })).toBe(false);
  });

  it("wrong team alone fails the match", () => {
    const g = group({ departmentId: 1, orgTeamId: 2, roleId: 3, tag: "Health" });
    expect(groupMatchesUser(g, { tags: ["Health"], departmentId: 1, orgTeamId: 999, roleId: 3 })).toBe(false);
  });

  it("wrong role alone fails the match", () => {
    const g = group({ departmentId: 1, orgTeamId: 2, roleId: 3, tag: "Health" });
    expect(groupMatchesUser(g, { tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 999 })).toBe(false);
  });

  it("missing the required tag fails the match", () => {
    const g = group({ departmentId: 1, orgTeamId: 2, roleId: 3, tag: "Health" });
    expect(groupMatchesUser(g, { tags: ["Term"], departmentId: 1, orgTeamId: 2, roleId: 3 })).toBe(false);
  });

  it("a group with only a tag condition (dept/team/role left blank) matches regardless of dept/team/role", () => {
    const g = group({ tag: "Health" });
    expect(groupMatchesUser(g, { tags: ["Health"], departmentId: null, orgTeamId: null, roleId: null })).toBe(true);
    expect(groupMatchesUser(g, { tags: ["Health"], departmentId: 42, orgTeamId: 43, roleId: 44 })).toBe(true);
    expect(groupMatchesUser(g, { tags: [], departmentId: 42, orgTeamId: 43, roleId: 44 })).toBe(false);
  });

  it("a user with null dept/team/role only matches a group whose corresponding conditions are also null", () => {
    const g = group({ departmentId: 1 });
    expect(groupMatchesUser(g, { tags: [], departmentId: null })).toBe(false);
  });
});

describe("resolveMatchedGroups (pure)", () => {
  it("returns every group the user matches, order-preserving, and none they don't", () => {
    const groups = [
      group({ id: 1, name: "A", tag: "Health" }),
      group({ id: 2, name: "B", tag: "Term" }),
      group({ id: 3, name: "C" }), // wildcard
    ];
    const matched = resolveMatchedGroups({ tags: ["Health"] }, groups);
    expect(matched.map((g) => g.id)).toEqual([1, 3]);
  });

  it("no groups matched -> empty array", () => {
    const groups = [group({ id: 1, tag: "Health" })];
    expect(resolveMatchedGroups({ tags: ["Term"] }, groups)).toEqual([]);
  });
});

describe("productAssistQuota engine (real test DB)", () => {
  let db: TestDb;
  let repos: Repositories;

  beforeEach(async () => {
    db = await createTestDb();
    repos = createRepositories(db);
  });

  afterEach(async () => {
    await db.$client.close();
  });

  // Migration 0049 seeds "Advisory" as a department; migration 0038 seeds
  // "Bliss"/"Falcon"/"Central" org_teams and "Advisor"/"Mentor"/"Guide"
  // roles — all convenience starting catalog rows a fresh test DB already
  // has.
  const advisoryBlissAdvisorIds = async (r: Repositories) => {
    const [departments, orgTeams, roles] = await Promise.all([r.departments.list(), r.orgTeams.list(), r.roles.list()]);
    const advisory = departments.find((d) => d.name === "Advisory");
    const bliss = orgTeams.find((t) => t.name === "Bliss");
    const advisor = roles.find((role) => role.name === "Advisor");
    if (!advisory || !bliss || !advisor) {
      throw new Error("Expected migrations 0038/0049 to have seeded Advisory/Bliss/Advisor.");
    }
    return { departmentId: advisory.id, orgTeamId: bliss.id, roleId: advisor.id };
  };

  // Creates a "Health Advisors" eligibility group scoped to Advisory +
  // Bliss + Advisor + the Health tag, mirroring what a Developer would
  // configure from the "AI Usage & Limits" Settings tab.
  const createHealthAdvisorsGroup = async (r: Repositories, overrides: { dailyCredits?: number | null; monthlyCredits?: number | null } = {}) => {
    const ids = await advisoryBlissAdvisorIds(r);
    const created = await r.productAssistEligibilityGroups.create({
      name: "Health Advisors",
      departmentId: ids.departmentId,
      orgTeamId: ids.orgTeamId,
      roleId: ids.roleId,
      tag: "Health",
      dailyCredits: overrides.dailyCredits ?? 20,
      monthlyCredits: overrides.monthlyCredits ?? 500,
      createdBy: "test",
    });
    return { ...ids, group: created };
  };

  const makeUser = async (email: string, overrides: Partial<Parameters<Repositories["users"]["create"]>[0]> = {}) => {
    return repos.users.create({
      email,
      name: email,
      tactId: `TACT-${email}`,
      tier: "General",
      status: "Active",
      tags: [],
      ...overrides,
    } as Parameters<Repositories["users"]["create"]>[0]);
  };

  it("a user matching NO eligibility group is blocked entirely — zero monthly credits, no daily cap, not unlimited", async () => {
    await makeUser("nobody@ditto.com");
    const status = await getQuotaStatus(repos, "nobody@ditto.com");
    expect(status.matchedGroups).toEqual([]);
    expect(status.unlimited).toBe(false);
    expect(status.dailyLimit).toBeNull();
    expect(status.monthlyLimit).toBe(0);
  });

  it("Developer tier gets no automatic exception — blocked like any other non-matching user (2026-09-07)", async () => {
    await makeUser("dev@ditto.com", { tier: "Developer" });
    const status = await getQuotaStatus(repos, "dev@ditto.com");
    expect(status.matchedGroups).toEqual([]);
    expect(status.unlimited).toBe(false);
    expect(status.monthlyLimit).toBe(0);
  });

  it("a Developer who matches a configured eligibility group gets that group's allowance, same as anyone else", async () => {
    const { departmentId, orgTeamId, roleId, group: g } = await createHealthAdvisorsGroup(repos);
    await makeUser("dev-advisor@ditto.com", { tier: "Developer", tags: ["Health"], departmentId, orgTeamId, roleId });
    const status = await getQuotaStatus(repos, "dev-advisor@ditto.com");
    expect(status.matchedGroups).toEqual([{ id: g.id, name: "Health Advisors" }]);
    expect(status.unlimited).toBe(false);
    expect(status.dailyLimit).toBe(20);
    expect(status.monthlyLimit).toBe(500);
  });

  it("a Developer who needs access despite matching no group gets it via a per-user override, not an automatic tier exception", async () => {
    await makeUser("dev-override@ditto.com", { tier: "Developer" });
    await repos.productAssistUserQuotaOverrides.upsert("dev-override@ditto.com", {
      customDailyCredits: null,
      customMonthlyCredits: null,
      limitsEnabled: true,
      unlimitedAccess: true,
      updatedBy: "developer@ditto.com",
    });
    const status = await getQuotaStatus(repos, "dev-override@ditto.com");
    expect(status.matchedGroups).toEqual([]);
    expect(status.unlimited).toBe(true); // from the override, not group membership
  });

  it("Advisory + Bliss + Advisor + Health gets the matched group's daily+monthly allowance", async () => {
    const { departmentId, orgTeamId, roleId } = await createHealthAdvisorsGroup(repos);
    await makeUser("advisor@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });
    const status = await getQuotaStatus(repos, "advisor@ditto.com");
    expect(status.unlimited).toBe(false);
    expect(status.dailyLimit).toBe(20);
    expect(status.monthlyLimit).toBe(500);
  });

  it("a Health-tagged Advisor in the WRONG department matches no group and is blocked (Department is required, not just Role+tag)", async () => {
    const { orgTeamId, roleId } = await createHealthAdvisorsGroup(repos);
    const otherDept = await repos.departments.create({ name: "Operations", description: null, createdBy: "test" });
    await makeUser("wrong-dept@ditto.com", { tags: ["Health"], departmentId: otherDept.id, orgTeamId, roleId });
    const status = await getQuotaStatus(repos, "wrong-dept@ditto.com");
    expect(status.matchedGroups).toEqual([]);
    expect(status.monthlyLimit).toBe(0);
  });

  it("before any admin defines an eligibility group, nobody is eligible even with Health + Advisor", async () => {
    const role = (await repos.roles.list()).find((r) => r.name === "Advisor")!;
    await makeUser("unconfigured@ditto.com", { tags: ["Health"], roleId: role.id });
    const status = await getQuotaStatus(repos, "unconfigured@ditto.com");
    expect(status.matchedGroups).toEqual([]);
    expect(status.monthlyLimit).toBe(0);
  });

  it("matching two groups combines their limits by taking the highest value independently per dimension", async () => {
    const { departmentId, orgTeamId, roleId } = await createHealthAdvisorsGroup(repos, { dailyCredits: 10, monthlyCredits: 200 });
    // A second, broader group (matches anyone with the Health tag) with a
    // higher daily limit but a lower monthly limit than the first group.
    await repos.productAssistEligibilityGroups.create({
      name: "Health Wildcard",
      departmentId: null,
      orgTeamId: null,
      roleId: null,
      tag: "Health",
      dailyCredits: 50,
      monthlyCredits: 100,
      createdBy: "test",
    });
    await makeUser("multi@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });
    const status = await getQuotaStatus(repos, "multi@ditto.com");
    expect(status.matchedGroups).toHaveLength(2);
    // Highest daily (50 from Wildcard) and highest monthly (200 from Health Advisors) win independently.
    expect(status.dailyLimit).toBe(50);
    expect(status.monthlyLimit).toBe(200);
  });

  it("a null (uncapped) limit in ANY matched group wins outright for that dimension", async () => {
    const { departmentId, orgTeamId, roleId } = await createHealthAdvisorsGroup(repos, { dailyCredits: 10, monthlyCredits: 200 });
    await repos.productAssistEligibilityGroups.create({
      name: "Uncapped Daily",
      departmentId: null,
      orgTeamId: null,
      roleId: null,
      tag: "Health",
      dailyCredits: null,
      monthlyCredits: 50, // lower than Health Advisors' 200, but that doesn't matter — Health Advisors' 200 still wins for monthly
      createdBy: "test",
    });
    await makeUser("uncapped@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });
    const status = await getQuotaStatus(repos, "uncapped@ditto.com");
    expect(status.dailyLimit).toBeNull(); // uncapped, from the second group
    expect(status.monthlyLimit).toBe(200); // highest finite value across matched groups
  });

  it("everyone else with a broad wildcard group (every condition blank) gets that group's allowance", async () => {
    await repos.productAssistEligibilityGroups.create({
      name: "Everyone",
      departmentId: null,
      orgTeamId: null,
      roleId: null,
      tag: null,
      dailyCredits: null,
      monthlyCredits: 30,
      createdBy: "test",
    });
    await makeUser("general@ditto.com");
    const status = await getQuotaStatus(repos, "general@ditto.com");
    expect(status.dailyLimit).toBeNull();
    expect(status.monthlyLimit).toBe(30);
  });

  it("recordUsage converts tokens to credits via the configured tokensPerCredit and updates used/remaining", async () => {
    await repos.productAssistEligibilityGroups.create({
      name: "Everyone",
      departmentId: null,
      orgTeamId: null,
      roleId: null,
      tag: null,
      dailyCredits: null,
      monthlyCredits: 50,
      createdBy: "test",
    });
    await makeUser("trial-user@ditto.com");
    // 500 input + 500 output = 1000 tokens = exactly 1 credit at the default 1000 tokens/credit.
    await recordUsage(repos, "trial-user@ditto.com", 500, 500);
    const status = await getQuotaStatus(repos, "trial-user@ditto.com");
    expect(status.monthlyUsed).toBe(1);
    expect(status.monthlyRemaining).toBe(49);
  });

  it("a per-user override's custom limits take precedence over matched-group limits", async () => {
    await makeUser("custom@ditto.com");
    await repos.productAssistUserQuotaOverrides.upsert("custom@ditto.com", {
      customDailyCredits: 5,
      customMonthlyCredits: 999,
      limitsEnabled: true,
      unlimitedAccess: false,
      updatedBy: "developer@ditto.com",
    });
    const status = await getQuotaStatus(repos, "custom@ditto.com");
    expect(status.dailyLimit).toBe(5);
    expect(status.monthlyLimit).toBe(999);
    expect(status.hasOverride).toBe(true);
  });

  it("unlimitedAccess and limitsEnabled=false both force unlimited regardless of matched groups", async () => {
    await makeUser("unlimited-a@ditto.com");
    await repos.productAssistUserQuotaOverrides.upsert("unlimited-a@ditto.com", {
      customDailyCredits: null,
      customMonthlyCredits: null,
      limitsEnabled: true,
      unlimitedAccess: true,
      updatedBy: "developer@ditto.com",
    });
    expect((await getQuotaStatus(repos, "unlimited-a@ditto.com")).unlimited).toBe(true);

    await makeUser("unlimited-b@ditto.com");
    await repos.productAssistUserQuotaOverrides.upsert("unlimited-b@ditto.com", {
      customDailyCredits: null,
      customMonthlyCredits: null,
      limitsEnabled: false,
      unlimitedAccess: false,
      updatedBy: "developer@ditto.com",
    });
    expect((await getQuotaStatus(repos, "unlimited-b@ditto.com")).unlimited).toBe(true);
  });

  it("extra credits raise the monthly limit only, never the daily pacing figure, and (with no expiry set) never expire", async () => {
    const { departmentId, orgTeamId, roleId } = await createHealthAdvisorsGroup(repos);
    await makeUser("extra@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });

    await repos.productAssistExtraCreditGrants.create({ userEmail: "extra@ditto.com", amount: 100, reason: "test grant", grantedBy: "dev" });
    let status = await getQuotaStatus(repos, "extra@ditto.com");
    expect(status.dailyLimit).toBe(20); // unaffected — daily is informational only, doesn't need "unblocking"
    expect(status.monthlyLimit).toBe(600); // 500 + 100
    expect(status.extraCredits).toBe(100);

    // Consume some credits — the extra balance itself doesn't shrink (it's
    // not a separate bucket being drawn down, it's a permanent ceiling
    // raise); only monthlyUsed/monthlyRemaining move.
    await recordUsage(repos, "extra@ditto.com", 5000, 5000); // 10 credits
    status = await getQuotaStatus(repos, "extra@ditto.com");
    expect(status.extraCredits).toBe(100);
    expect(status.monthlyUsed).toBe(10);
    expect(status.monthlyLimit).toBe(600);
    expect(status.dailyLimit).toBe(20);
  });

  it("extra credits granted after the MONTHLY cap is exhausted unblock checkQuota immediately, without waiting for next month", async () => {
    await repos.productAssistEligibilityGroups.create({
      name: "Everyone",
      departmentId: null,
      orgTeamId: null,
      roleId: null,
      tag: null,
      dailyCredits: null,
      monthlyCredits: 10,
      createdBy: "test",
    });
    await makeUser("blocked@ditto.com");
    const settings = await repos.productAssistQuotaSettings.get();
    await recordUsage(repos, "blocked@ditto.com", 10 * settings.tokensPerCredit, 0);

    let check = await checkQuota(repos, "blocked@ditto.com");
    expect(check.allowed).toBe(false);
    expect(check.status.monthlyRemaining).toBeLessThanOrEqual(0);

    // Admin grants extra credits expecting them to be usable right away.
    await repos.productAssistExtraCreditGrants.create({ userEmail: "blocked@ditto.com", amount: 10, reason: "unblock", grantedBy: "dev" });
    check = await checkQuota(repos, "blocked@ditto.com");
    expect(check.allowed).toBe(true);
    expect(check.status.monthlyRemaining).toBe(10);
  });

  it("an expired grant is excluded from the balance, while a non-expired (future-dated) grant still counts", async () => {
    await makeUser("expiry@ditto.com");
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await repos.productAssistExtraCreditGrants.create({ userEmail: "expiry@ditto.com", amount: 40, reason: "expired", grantedBy: "dev", expiresAt: past });
    await repos.productAssistExtraCreditGrants.create({ userEmail: "expiry@ditto.com", amount: 15, reason: "still active", grantedBy: "dev", expiresAt: future });
    await repos.productAssistExtraCreditGrants.create({ userEmail: "expiry@ditto.com", amount: 25, reason: "never expires", grantedBy: "dev" });

    // Only the two non-expired rows (15 + 25 = 40) count toward the balance;
    // the expired 40-credit row is excluded even though it was never deleted.
    expect(await repos.productAssistExtraCreditGrants.balanceForUser("expiry@ditto.com")).toBe(40);
    // The row itself is still there for audit history — nothing is deleted.
    expect(await repos.productAssistExtraCreditGrants.listForUser("expiry@ditto.com")).toHaveLength(3);

    const balances = await repos.productAssistExtraCreditGrants.balancesByUser();
    expect(balances.get("expiry@ditto.com")).toBe(40);
  });

  it("a removal is recorded as a new negative-amount row, never mutating the original grant", async () => {
    await makeUser("removal@ditto.com");
    await repos.productAssistExtraCreditGrants.create({ userEmail: "removal@ditto.com", amount: 50, reason: "grant", grantedBy: "dev" });
    await repos.productAssistExtraCreditGrants.create({ userEmail: "removal@ditto.com", amount: -20, reason: "reduce", grantedBy: "dev" });
    const grants = await repos.productAssistExtraCreditGrants.listForUser("removal@ditto.com");
    expect(grants).toHaveLength(2);
    expect(await repos.productAssistExtraCreditGrants.balanceForUser("removal@ditto.com")).toBe(30);
  });

  it("checkQuota blocks a user matching no eligibility group outright (0 monthly credits)", async () => {
    await makeUser("nobody2@ditto.com");
    const { allowed, status } = await checkQuota(repos, "nobody2@ditto.com");
    expect(allowed).toBe(false);
    expect(status.state).toBe("at_limit");
    expect(status.monthlyRemaining).toBe(0);
  });

  it("checkQuota blocks once a matched group's monthly allowance is exhausted, and reports 'at_limit'", async () => {
    await repos.productAssistEligibilityGroups.create({
      name: "Everyone",
      departmentId: null,
      orgTeamId: null,
      roleId: null,
      tag: null,
      dailyCredits: null,
      monthlyCredits: 10,
      createdBy: "test",
    });
    await makeUser("exhausted@ditto.com");
    const settings = await repos.productAssistQuotaSettings.get();
    // Consume the entire monthly allotment in one shot.
    await recordUsage(repos, "exhausted@ditto.com", 10 * settings.tokensPerCredit, 0);

    const { allowed, status } = await checkQuota(repos, "exhausted@ditto.com");
    expect(allowed).toBe(false);
    expect(status.state).toBe("at_limit");
    expect(status.monthlyRemaining).toBeLessThanOrEqual(0);
  });

  it("checkQuota never blocks a user with an explicit unlimitedAccess override, no matter how much is recorded", async () => {
    await makeUser("dev2@ditto.com", { tier: "Developer" });
    await repos.productAssistUserQuotaOverrides.upsert("dev2@ditto.com", {
      customDailyCredits: null,
      customMonthlyCredits: null,
      limitsEnabled: true,
      unlimitedAccess: true,
      updatedBy: "developer@ditto.com",
    });
    await recordUsage(repos, "dev2@ditto.com", 10_000_000, 10_000_000);
    const { allowed, status } = await checkQuota(repos, "dev2@ditto.com");
    expect(allowed).toBe(true);
    expect(status.state).toBe("unlimited");
  });

  it("exhausting only the daily pacing figure does NOT block — monthly is the sole gate, and the state reports 'daily_exceeded'", async () => {
    const { departmentId, orgTeamId, roleId } = await createHealthAdvisorsGroup(repos, { dailyCredits: 5, monthlyCredits: 500 });
    await makeUser("daily-cap@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });
    const settings = await repos.productAssistQuotaSettings.get();
    // Exhaust only the daily allowance — monthly limit is much larger.
    await recordUsage(repos, "daily-cap@ditto.com", 5 * settings.tokensPerCredit, 0);

    const { allowed, status } = await checkQuota(repos, "daily-cap@ditto.com");
    expect(allowed).toBe(true);
    expect(status.dailyRemaining).toBeLessThanOrEqual(0);
    expect(status.monthlyRemaining).toBeGreaterThan(0);
    expect(status.state).toBe("daily_exceeded");
  });
});
