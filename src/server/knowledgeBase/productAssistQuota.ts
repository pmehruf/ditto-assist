/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Product Assist Credit & Usage Management — the quota calculation engine
 * (2026-08). Sits entirely OUTSIDE productAssist.ts's retrieval/answer
 * logic: server.ts calls `checkQuota()` before `answerQuery()` and
 * `recordUsage()` (awaited) right after — see the /api/product-assist/ask
 * route. Nothing in this file touches retrieval, prompts, or the AI call
 * itself.
 *
 * ELIGIBILITY MODEL (product decision, 2026-08, given verbatim by the
 * user — not inferred):
 *   - tier === "Developer" (NOT Platform Admin) -> automatic, permanent,
 *     unrevocable unlimited access. "He is the top most authority of this
 *     whole setup."
 *   - tags includes "Health" AND the user's roleId resolves to a role
 *     named "Advisor" (case-insensitive; see the `roles` table) -> the
 *     configurable default daily+monthly credit allowance
 *     (product_assist_quota_settings.defaultDailyCredits/
 *     defaultMonthlyCredits).
 *   - everyone else (including Platform Admin, Admin, and any General-tier
 *     or non-Advisor/non-Health user) -> a small monthly-only trial
 *     allotment (product_assist_quota_settings.trialMonthlyCredits), no
 *     daily cap needed at that size.
 * A Developer or Platform Admin can still individually override ANY
 * user's limits (custom daily/monthly, disable enforcement, or grant
 * explicit unlimited access) via product_assist_user_quota_overrides,
 * regardless of which bucket they fall into above — that's the "Developer
 * will decide user specific allocation as well above health advisors
 * group" part of the same product decision.
 *
 * RESET BOUNDARIES: daily/monthly windows reset on the IST (Asia/Kolkata,
 * UTC+5:30, no DST) calendar day/month, not UTC midnight — the whole
 * product (currency, advisors, company budget) is India-based, so an
 * advisor's "daily" limit should reset at their actual midnight. Flagged
 * as a decision the user can override in Settings if a different
 * timezone is ever wanted; nothing else in this file depends on it beyond
 * the two boundary functions below.
 */

import type { Repositories } from "../db/repositories/index.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function startOfDayIST(now: Date): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0);
  return new Date(istMidnight - IST_OFFSET_MS);
}

function startOfMonthIST(now: Date): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMonthStart = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0);
  return new Date(istMonthStart - IST_OFFSET_MS);
}

export type QuotaBucket = "developer_unlimited" | "health_advisor" | "trial";

/** Pure function — no DB access — so it's independently testable. */
export function resolveQuotaBucket(user: { tier: string; tags: string[] }, roleName: string | null | undefined): QuotaBucket {
  if (user.tier === "Developer") return "developer_unlimited";
  const isHealthAdvisor = user.tags.includes("Health") && (roleName ?? "").trim().toLowerCase() === "advisor";
  return isHealthAdvisor ? "health_advisor" : "trial";
}

export type QuotaState = "unlimited" | "ok" | "warning" | "at_limit";

export interface QuotaStatus {
  userEmail: string;
  bucket: QuotaBucket;
  unlimited: boolean;
  /** null = no daily cap applies to this user. */
  dailyLimit: number | null;
  /** null = no monthly cap applies (unlimited). Otherwise base bucket/
   * override limit PLUS any non-expiring extra-credit balance. */
  monthlyLimit: number | null;
  dailyUsed: number;
  monthlyUsed: number;
  /** null when there's no cap to be remaining against. */
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  extraCredits: number;
  warningThresholdPercent: number;
  /** 0-100+ (can exceed 100 on the final over-the-limit request); null
   * when unlimited or there's no monthly cap. */
  monthlyUtilizationPercent: number | null;
  state: QuotaState;
  /** True when this user has an explicit override row (custom limits,
   * disabled enforcement, or unlimited) — surfaced so the admin UI can
   * show "Custom" vs "Default". */
  hasOverride: boolean;
}

interface OverrideLike {
  customDailyCredits: number | null;
  customMonthlyCredits: number | null;
  limitsEnabled: boolean;
  unlimitedAccess: boolean;
}

interface SettingsLike {
  defaultDailyCredits: number;
  defaultMonthlyCredits: number;
  trialMonthlyCredits: number;
}

/** Pure — the shared limit-derivation logic used by both the single-user
 * status lookup and the batched admin table below, so the two can never
 * drift apart. */
function deriveEffectiveLimits(
  bucket: QuotaBucket,
  override: OverrideLike | undefined,
  settings: SettingsLike,
  extraCredits: number
): { unlimited: boolean; dailyLimit: number | null; monthlyLimit: number | null } {
  const unlimited = bucket === "developer_unlimited" || override?.unlimitedAccess === true || override?.limitsEnabled === false;
  const bucketDefaultDaily = bucket === "health_advisor" ? settings.defaultDailyCredits : null;
  const bucketDefaultMonthly =
    bucket === "health_advisor" ? settings.defaultMonthlyCredits : bucket === "trial" ? settings.trialMonthlyCredits : null;
  const dailyLimitBase = override?.customDailyCredits ?? bucketDefaultDaily;
  const monthlyLimitBase = override?.customMonthlyCredits ?? bucketDefaultMonthly;
  const dailyLimit = unlimited ? null : dailyLimitBase;
  const monthlyLimit = unlimited ? null : monthlyLimitBase === null ? null : monthlyLimitBase + extraCredits;
  return { unlimited, dailyLimit, monthlyLimit };
}

function deriveState(
  unlimited: boolean,
  dailyRemaining: number | null,
  monthlyRemaining: number | null,
  monthlyUtilizationPercent: number | null,
  warningThresholdPercent: number
): QuotaState {
  if (unlimited) return "unlimited";
  if ((monthlyRemaining !== null && monthlyRemaining <= 0) || (dailyRemaining !== null && dailyRemaining <= 0)) return "at_limit";
  if (monthlyUtilizationPercent !== null && monthlyUtilizationPercent >= warningThresholdPercent) return "warning";
  return "ok";
}

async function resolveBucketForUser(
  repos: Repositories,
  user: { tier: string; tags: string[]; roleId: number | null } | undefined,
  roleById?: Map<number, { name: string }>
): Promise<QuotaBucket> {
  const tags = user?.tags ?? [];
  const tier = user?.tier ?? "General";
  let roleName: string | null = null;
  if (user?.roleId) {
    if (roleById) {
      roleName = roleById.get(user.roleId)?.name ?? null;
    } else {
      const role = await repos.roles.get(user.roleId);
      roleName = role?.name ?? null;
    }
  }
  return resolveQuotaBucket({ tier, tags }, roleName);
}

/**
 * Full quota status for one user — used both by the pre-call enforcement
 * check and by the utilization-bar / admin "User detail" GET endpoints.
 * Always reads live from the DB (settings, override, extra-credit grants,
 * and today's/this-month's usage sums) — no caching, since correctness
 * matters more than shaving a handful of queries off a chat request.
 */
export async function getQuotaStatus(repos: Repositories, userEmail: string, now: Date = new Date()): Promise<QuotaStatus> {
  const email = userEmail.toLowerCase();
  const [user, override, settings, extraCredits] = await Promise.all([
    repos.users.findByEmail(email),
    repos.productAssistUserQuotaOverrides.get(email),
    repos.productAssistQuotaSettings.get(),
    repos.productAssistExtraCreditGrants.balanceForUser(email),
  ]);

  const bucket = await resolveBucketForUser(repos, user);
  const { unlimited, dailyLimit, monthlyLimit } = deriveEffectiveLimits(bucket, override, settings, extraCredits);

  const dayStart = startOfDayIST(now);
  const monthStart = startOfMonthIST(now);
  const [dailyUsed, monthlyUsed] = await Promise.all([
    repos.productAssistUsageLedger.sumCreditsSince(email, dayStart),
    repos.productAssistUsageLedger.sumCreditsSince(email, monthStart),
  ]);

  const dailyRemaining = unlimited || dailyLimit === null ? null : dailyLimit - dailyUsed;
  const monthlyRemaining = unlimited || monthlyLimit === null ? null : monthlyLimit - monthlyUsed;

  const monthlyUtilizationPercent =
    unlimited || monthlyLimit === null || monthlyLimit <= 0 ? null : Math.round((monthlyUsed / monthlyLimit) * 100);

  const state = deriveState(unlimited, dailyRemaining, monthlyRemaining, monthlyUtilizationPercent, settings.warningThresholdPercent);

  return {
    userEmail: email,
    bucket,
    unlimited,
    dailyLimit,
    monthlyLimit,
    dailyUsed,
    monthlyUsed,
    dailyRemaining,
    monthlyRemaining,
    extraCredits,
    warningThresholdPercent: settings.warningThresholdPercent,
    monthlyUtilizationPercent,
    state,
    hasOverride: !!override,
  };
}

export interface UserQuotaSummary {
  userEmail: string;
  name: string;
  tier: string;
  tags: string[];
  roleName: string | null;
  bucket: QuotaBucket;
  unlimited: boolean;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyUsed: number;
  monthlyUsed: number;
  extraCredits: number;
  hasOverride: boolean;
  state: QuotaState;
}

/**
 * Every user's quota status in one pass — powers the admin "AI Usage &
 * Limits" Users table. Deliberately batched (a handful of grouped queries
 * total, not one set of queries per user) rather than calling
 * getQuotaStatus() in a loop, since this runs across the whole directory.
 */
export async function listAllUserQuotaStatuses(repos: Repositories, now: Date = new Date()): Promise<UserQuotaSummary[]> {
  const [users, overrides, extraBalances, settings, roles] = await Promise.all([
    repos.users.list(),
    repos.productAssistUserQuotaOverrides.list(),
    repos.productAssistExtraCreditGrants.balancesByUser(),
    repos.productAssistQuotaSettings.get(),
    repos.roles.list(),
  ]);

  const dayStart = startOfDayIST(now);
  const monthStart = startOfMonthIST(now);
  const [dailyByUser, monthlyByUser] = await Promise.all([
    repos.productAssistUsageLedger.sumCreditsGroupedByUserSince(dayStart),
    repos.productAssistUsageLedger.sumCreditsGroupedByUserSince(monthStart),
  ]);

  const overrideByEmail = new Map(overrides.map(o => [o.userEmail, o]));
  const roleById = new Map(roles.map(r => [r.id, r]));

  return Promise.all(
    users.map(async u => {
      const email = u.email.toLowerCase();
      const override = overrideByEmail.get(email);
      const bucket = await resolveBucketForUser(repos, u, roleById);
      const extraCredits = extraBalances.get(email) ?? 0;
      const { unlimited, dailyLimit, monthlyLimit } = deriveEffectiveLimits(bucket, override, settings, extraCredits);
      const dailyUsed = dailyByUser.get(email) ?? 0;
      const monthlyUsed = monthlyByUser.get(email) ?? 0;
      const dailyRemaining = unlimited || dailyLimit === null ? null : dailyLimit - dailyUsed;
      const monthlyRemaining = unlimited || monthlyLimit === null ? null : monthlyLimit - monthlyUsed;
      const monthlyUtilizationPercent =
        unlimited || monthlyLimit === null || monthlyLimit <= 0 ? null : Math.round((monthlyUsed / monthlyLimit) * 100);
      const state = deriveState(unlimited, dailyRemaining, monthlyRemaining, monthlyUtilizationPercent, settings.warningThresholdPercent);
      const roleName = u.roleId ? roleById.get(u.roleId)?.name ?? null : null;

      return {
        userEmail: email,
        name: u.name,
        tier: u.tier,
        tags: u.tags,
        roleName,
        bucket,
        unlimited,
        dailyLimit,
        monthlyLimit,
        dailyUsed,
        monthlyUsed,
        extraCredits,
        hasOverride: !!override,
        state,
      };
    })
  );
}

export interface QuotaCheckResult {
  allowed: boolean;
  status: QuotaStatus;
}

/**
 * Pre-call gate: block only when a real cap has already been exhausted
 * (remaining <= 0). Deliberately NOT a "will this exact request fit"
 * check — the actual token cost of a Product Assist answer isn't known
 * until the Gemini call returns, so like most token-based quota systems
 * this allows a request to start whenever ANY allowance remains, and lets
 * the final request of a window go slightly over (recorded by
 * `recordUsage` afterward) rather than guessing a request's cost upfront.
 */
export async function checkQuota(repos: Repositories, userEmail: string): Promise<QuotaCheckResult> {
  const status = await getQuotaStatus(repos, userEmail);
  if (status.unlimited) return { allowed: true, status };
  const dailyOk = status.dailyRemaining === null || status.dailyRemaining > 0;
  const monthlyOk = status.monthlyRemaining === null || status.monthlyRemaining > 0;
  return { allowed: dailyOk && monthlyOk, status };
}

/**
 * Records actual consumption for a completed AI call. Called SYNCHRONOUSLY
 * (awaited) right after answerQuery() returns in the /ask route — this is
 * the only place that ever writes to product_assist_usage_ledger, and it
 * must never be skipped for a call that actually reached Gemini (a null
 * inputTokens/outputTokens on the *productAssist.ts* answer means no AI
 * call happened at all — e.g. a deterministic Special-Instruction-conflict
 * short-circuit — so the caller should skip recordUsage entirely in that
 * case rather than call it with zeros; see the /ask route).
 */
export async function recordUsage(repos: Repositories, userEmail: string, inputTokens: number, outputTokens: number): Promise<void> {
  const settings = await repos.productAssistQuotaSettings.get();
  const totalTokens = inputTokens + outputTokens;
  const credits = settings.tokensPerCredit > 0 ? totalTokens / settings.tokensPerCredit : 0;
  await repos.productAssistUsageLedger.record({
    userEmail: userEmail.toLowerCase(),
    inputTokens,
    outputTokens,
    totalTokens,
    credits,
  });
}

/** Cost-estimation only (never affects enforcement, which is credit-based)
 * — used by the admin Overview tab's company-budget tracking. */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: { inputPricePerMillionTokens: number; outputPricePerMillionTokens: number }
): number {
  return (inputTokens / 1_000_000) * pricing.inputPricePerMillionTokens + (outputTokens / 1_000_000) * pricing.outputPricePerMillionTokens;
}

export { startOfDayIST, startOfMonthIST };
