/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the Product Assist Credit & Usage Management engine
 * (2026-08, revised 2026-08-25 — "Wire the Access Control Center to the
 * Real Authorization System + Correct Product Assist Eligibility"). Covers
 * the CORRECTED eligibility model — Department + Team + Role (all three,
 * admin-configured via product_assist_quota_settings.eligibleDepartmentId/
 * eligibleOrgTeamId/eligibleRoleId) AND the Health tag — plus per-user
 * overrides, extra credits (including the new optional expiry), and the
 * enforcement check — against a real (PGlite) Postgres instance so the SQL
 * aggregation (SUM/GROUP BY) is exercised for real, not mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { createRepositories, type Repositories } from "../db/repositories/index.js";
import { resolveQuotaBucket, getQuotaStatus, checkQuota, recordUsage, type ProductAssistEligibilityConfig } from "./productAssistQuota.js";

const FULLY_CONFIGURED: ProductAssistEligibilityConfig = { eligibleDepartmentId: 1, eligibleOrgTeamId: 2, eligibleRoleId: 3 };
const UNCONFIGURED: ProductAssistEligibilityConfig = { eligibleDepartmentId: null, eligibleOrgTeamId: null, eligibleRoleId: null };

describe("resolveQuotaBucket (pure) — Section 7's exact rule: Department AND Team AND Role AND Health", () => {
  it("gives Developer tier automatic unlimited, regardless of tags/dept/team/role", () => {
    expect(resolveQuotaBucket({ tier: "Developer", tags: [] }, UNCONFIGURED)).toBe("developer_unlimited");
    expect(
      resolveQuotaBucket({ tier: "Developer", tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("developer_unlimited");
  });

  it("Advisory + Bliss + Advisor + Health -> eligible (health_advisor)", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("health_advisor");
  });

  it("Advisory + Bliss + Advisor + Health + Term (extra tag doesn't disqualify) -> still eligible", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Health", "Term"], departmentId: 1, orgTeamId: 2, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("health_advisor");
  });

  it("Advisory + Bliss + Advisor + Term ONLY (no Health tag) -> NOT eligible", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Term"], departmentId: 1, orgTeamId: 2, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("trial");
  });

  it("right Team + Role + Health but WRONG Department -> NOT eligible", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Health"], departmentId: 999, orgTeamId: 2, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("trial");
  });

  it("right Department + Role + Health but WRONG Team -> NOT eligible", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Health"], departmentId: 1, orgTeamId: 999, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("trial");
  });

  it("right Department + Team + Health but WRONG Role -> NOT eligible", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 999 }, FULLY_CONFIGURED)
    ).toBe("trial");
  });

  it("Health tag with no Department/Team/Role assigned at all -> NOT eligible", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Health"], departmentId: null, orgTeamId: null, roleId: null }, FULLY_CONFIGURED)
    ).toBe("trial");
  });

  it("Platform Admin is NOT auto-unlimited (only real Developer tier is) even with a perfect match", () => {
    expect(
      resolveQuotaBucket({ tier: "Platform Admin", tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("health_advisor"); // Platform Admin isn't auto-unlimited, but CAN still qualify for health_advisor like anyone else
    expect(resolveQuotaBucket({ tier: "Platform Admin", tags: [] }, UNCONFIGURED)).toBe("trial");
  });

  it("eligibility is department/team/role/tag based, independent of tier (except the Developer carve-out) — an Admin who matches still qualifies", () => {
    expect(
      resolveQuotaBucket({ tier: "Admin", tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 3 }, FULLY_CONFIGURED)
    ).toBe("health_advisor");
  });

  it("when eligibility is unconfigured (any of the 3 IDs unset), NOBODY qualifies — not even a user whose own IDs are also null", () => {
    expect(
      resolveQuotaBucket({ tier: "General", tags: ["Health"], departmentId: null, orgTeamId: null, roleId: null }, UNCONFIGURED)
    ).toBe("trial");
    expect(
      resolveQuotaBucket(
        { tier: "General", tags: ["Health"], departmentId: 1, orgTeamId: 2, roleId: 3 },
        { eligibleDepartmentId: 1, eligibleOrgTeamId: 2, eligibleRoleId: null }
      )
    ).toBe("trial");
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
  // has. Configures product_assist_quota_settings' eligibility columns to
  // point at Advisory + Bliss + Advisor, mirroring what a Developer would
  // pick from the "AI Usage & Limits" Settings tab, and returns the three
  // IDs so tests can assign a user to a matching or deliberately-mismatched
  // combination.
  const configureAdvisoryBlissAdvisorEligibility = async (r: Repositories) => {
    const [departments, orgTeams, roles] = await Promise.all([r.departments.list(), r.orgTeams.list(), r.roles.list()]);
    const advisory = departments.find((d) => d.name === "Advisory");
    const bliss = orgTeams.find((t) => t.name === "Bliss");
    const advisor = roles.find((role) => role.name === "Advisor");
    if (!advisory || !bliss || !advisor) {
      throw new Error("Expected migrations 0038/0049 to have seeded Advisory/Bliss/Advisor.");
    }
    await r.productAssistQuotaSettings.update(
      { eligibleDepartmentId: advisory.id, eligibleOrgTeamId: bliss.id, eligibleRoleId: advisor.id },
      "test"
    );
    return { departmentId: advisory.id, orgTeamId: bliss.id, roleId: advisor.id };
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

  it("Developer tier is always unlimited", async () => {
    await makeUser("dev@ditto.com", { tier: "Developer" });
    const status = await getQuotaStatus(repos, "dev@ditto.com");
    expect(status.bucket).toBe("developer_unlimited");
    expect(status.unlimited).toBe(true);
    expect(status.dailyLimit).toBeNull();
    expect(status.monthlyLimit).toBeNull();
  });

  it("Advisory + Bliss + Advisor + Health gets the configurable default daily+monthly allowance", async () => {
    const { departmentId, orgTeamId, roleId } = await configureAdvisoryBlissAdvisorEligibility(repos);
    await makeUser("advisor@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });
    const status = await getQuotaStatus(repos, "advisor@ditto.com");
    expect(status.bucket).toBe("health_advisor");
    expect(status.unlimited).toBe(false);
    const settings = await repos.productAssistQuotaSettings.get();
    expect(status.dailyLimit).toBe(settings.defaultDailyCredits);
    expect(status.monthlyLimit).toBe(settings.defaultMonthlyCredits);
  });

  it("a Health-tagged Advisor in the WRONG department falls back to trial (Department is required, not just Role+tag)", async () => {
    const { orgTeamId, roleId } = await configureAdvisoryBlissAdvisorEligibility(repos);
    const otherDept = await repos.departments.create({ name: "Operations", description: null, createdBy: "test" });
    await makeUser("wrong-dept@ditto.com", { tags: ["Health"], departmentId: otherDept.id, orgTeamId, roleId });
    const status = await getQuotaStatus(repos, "wrong-dept@ditto.com");
    expect(status.bucket).toBe("trial");
  });

  it("before any admin configures eligibility (all three unset), nobody lands in health_advisor even with Health + Advisor", async () => {
    const role = (await repos.roles.list()).find((r) => r.name === "Advisor")!;
    await makeUser("unconfigured@ditto.com", { tags: ["Health"], roleId: role.id });
    const status = await getQuotaStatus(repos, "unconfigured@ditto.com");
    expect(status.bucket).toBe("trial");
  });

  it("everyone else gets the small monthly-only trial allotment, no daily cap", async () => {
    await makeUser("general@ditto.com");
    const status = await getQuotaStatus(repos, "general@ditto.com");
    expect(status.bucket).toBe("trial");
    expect(status.dailyLimit).toBeNull();
    const settings = await repos.productAssistQuotaSettings.get();
    expect(status.monthlyLimit).toBe(settings.trialMonthlyCredits);
  });

  it("recordUsage converts tokens to credits via the configured tokensPerCredit and updates used/remaining", async () => {
    await makeUser("trial-user@ditto.com");
    const settings = await repos.productAssistQuotaSettings.get();
    // 500 input + 500 output = 1000 tokens = exactly 1 credit at the default 1000 tokens/credit.
    await recordUsage(repos, "trial-user@ditto.com", 500, 500);
    const status = await getQuotaStatus(repos, "trial-user@ditto.com");
    expect(status.monthlyUsed).toBe(1);
    expect(status.monthlyRemaining).toBe(settings.trialMonthlyCredits - 1);
  });

  it("a per-user override's custom limits take precedence over the bucket default", async () => {
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

  it("unlimitedAccess and limitsEnabled=false both force unlimited regardless of bucket", async () => {
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

  it("extra credits raise the monthly limit only, never the daily cap, and (with no expiry set) never expire", async () => {
    const { departmentId, orgTeamId, roleId } = await configureAdvisoryBlissAdvisorEligibility(repos);
    await makeUser("extra@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });
    const settings = await repos.productAssistQuotaSettings.get();

    await repos.productAssistExtraCreditGrants.create({ userEmail: "extra@ditto.com", amount: 100, reason: "test grant", grantedBy: "dev" });
    let status = await getQuotaStatus(repos, "extra@ditto.com");
    expect(status.dailyLimit).toBe(settings.defaultDailyCredits); // unaffected
    expect(status.monthlyLimit).toBe(settings.defaultMonthlyCredits + 100);
    expect(status.extraCredits).toBe(100);

    // Consume some credits — the extra balance itself doesn't shrink (it's
    // not a separate bucket being drawn down, it's a permanent ceiling
    // raise); only monthlyUsed/monthlyRemaining move.
    await recordUsage(repos, "extra@ditto.com", 5000, 5000); // 10 credits
    status = await getQuotaStatus(repos, "extra@ditto.com");
    expect(status.extraCredits).toBe(100);
    expect(status.monthlyUsed).toBe(10);
    expect(status.monthlyLimit).toBe(settings.defaultMonthlyCredits + 100);
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

  it("checkQuota blocks once the monthly allowance is exhausted, and reports the correct 'at_limit' state", async () => {
    await makeUser("exhausted@ditto.com");
    const settings = await repos.productAssistQuotaSettings.get();
    // Consume the entire trial allotment in one shot.
    await recordUsage(repos, "exhausted@ditto.com", settings.trialMonthlyCredits * settings.tokensPerCredit, 0);

    const { allowed, status } = await checkQuota(repos, "exhausted@ditto.com");
    expect(allowed).toBe(false);
    expect(status.state).toBe("at_limit");
    expect(status.monthlyRemaining).toBeLessThanOrEqual(0);
  });

  it("checkQuota never blocks an unlimited (Developer) user no matter how much is recorded", async () => {
    await makeUser("dev2@ditto.com", { tier: "Developer" });
    await recordUsage(repos, "dev2@ditto.com", 10_000_000, 10_000_000);
    const { allowed, status } = await checkQuota(repos, "dev2@ditto.com");
    expect(allowed).toBe(true);
    expect(status.state).toBe("unlimited");
  });

  it("a daily cap independently blocks a matching Health Advisor even with monthly credits still remaining", async () => {
    const { departmentId, orgTeamId, roleId } = await configureAdvisoryBlissAdvisorEligibility(repos);
    await makeUser("daily-cap@ditto.com", { tags: ["Health"], departmentId, orgTeamId, roleId });
    const settings = await repos.productAssistQuotaSettings.get();
    // Exhaust only the daily allowance — monthly limit is much larger.
    await recordUsage(repos, "daily-cap@ditto.com", settings.defaultDailyCredits * settings.tokensPerCredit, 0);

    const { allowed, status } = await checkQuota(repos, "daily-cap@ditto.com");
    expect(allowed).toBe(false);
    expect(status.dailyRemaining).toBeLessThanOrEqual(0);
    expect(status.monthlyRemaining).toBeGreaterThan(0);
  });
});
