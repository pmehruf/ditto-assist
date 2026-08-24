/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the Product Assist Credit & Usage Management engine
 * (2026-08). Covers the eligibility model given verbatim by the user
 * (Developer tier -> automatic unlimited; Health-tagged Advisor role ->
 * the configurable default; everyone else -> the trial allotment),
 * per-user overrides, non-expiring extra credits, and the enforcement
 * check — against a real (PGlite) Postgres instance so the SQL aggregation
 * (SUM/GROUP BY) is exercised for real, not mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testUtils.js";
import { createRepositories, type Repositories } from "../db/repositories/index.js";
import { resolveQuotaBucket, getQuotaStatus, checkQuota, recordUsage } from "./productAssistQuota.js";

describe("resolveQuotaBucket (pure)", () => {
  it("gives Developer tier automatic unlimited, regardless of tags/role", () => {
    expect(resolveQuotaBucket({ tier: "Developer", tags: [] }, null)).toBe("developer_unlimited");
    expect(resolveQuotaBucket({ tier: "Developer", tags: ["Health"] }, "Advisor")).toBe("developer_unlimited");
  });

  it("gives the default bucket only to Health-tagged users whose role is Advisor", () => {
    expect(resolveQuotaBucket({ tier: "General", tags: ["Health"] }, "Advisor")).toBe("health_advisor");
    expect(resolveQuotaBucket({ tier: "General", tags: ["Health"] }, "advisor")).toBe("health_advisor"); // case-insensitive
  });

  it("Platform Admin is NOT auto-unlimited (only real Developer tier is)", () => {
    expect(resolveQuotaBucket({ tier: "Platform Admin", tags: [] }, null)).toBe("trial");
  });

  it("eligibility is tag+role based, independent of tier (except the Developer carve-out) — an Admin who is also a Health-tagged Advisor still qualifies", () => {
    expect(resolveQuotaBucket({ tier: "Admin", tags: ["Health"] }, "Advisor")).toBe("health_advisor");
  });

  it("falls through to trial when the tag/role combination doesn't match", () => {
    expect(resolveQuotaBucket({ tier: "General", tags: ["Term"] }, "Advisor")).toBe("trial"); // Term-tagged, not Health
    expect(resolveQuotaBucket({ tier: "General", tags: ["Health"] }, "Mentor")).toBe("trial"); // Health-tagged but wrong role
    expect(resolveQuotaBucket({ tier: "General", tags: ["Health"] }, null)).toBe("trial"); // Health-tagged but no role at all
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

  // Migration 0038 seeds "Advisor" (among others) as a convenience starting
  // role — a fresh test DB already has it, so tests must reuse that row
  // rather than inserting a second row with the same name (roles.name is
  // unique).
  const getSeededAdvisorRole = async (r: Repositories) => {
    const existing = (await r.roles.list()).find(role => role.name === "Advisor");
    if (existing) return existing;
    return r.roles.create({ name: "Advisor", description: null, createdBy: "test" });
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

  it("a Health-tagged Advisor gets the configurable default daily+monthly allowance", async () => {
    const role = await getSeededAdvisorRole(repos);
    await makeUser("advisor@ditto.com", { tags: ["Health"], roleId: role.id });
    const status = await getQuotaStatus(repos, "advisor@ditto.com");
    expect(status.bucket).toBe("health_advisor");
    expect(status.unlimited).toBe(false);
    const settings = await repos.productAssistQuotaSettings.get();
    expect(status.dailyLimit).toBe(settings.defaultDailyCredits);
    expect(status.monthlyLimit).toBe(settings.defaultMonthlyCredits);
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

  it("extra credits raise the monthly limit only, never the daily cap, and never expire (stay after being 'used')", async () => {
    const role = await getSeededAdvisorRole(repos);
    await makeUser("extra@ditto.com", { tags: ["Health"], roleId: role.id });
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

  it("a daily cap independently blocks a Health Advisor even with monthly credits still remaining", async () => {
    const role = await getSeededAdvisorRole(repos);
    await makeUser("daily-cap@ditto.com", { tags: ["Health"], roleId: role.id });
    const settings = await repos.productAssistQuotaSettings.get();
    // Exhaust only the daily allowance — monthly limit is much larger.
    await recordUsage(repos, "daily-cap@ditto.com", settings.defaultDailyCredits * settings.tokensPerCredit, 0);

    const { allowed, status } = await checkQuota(repos, "daily-cap@ditto.com");
    expect(allowed).toBe(false);
    expect(status.dailyRemaining).toBeLessThanOrEqual(0);
    expect(status.monthlyRemaining).toBeGreaterThan(0);
  });
});
