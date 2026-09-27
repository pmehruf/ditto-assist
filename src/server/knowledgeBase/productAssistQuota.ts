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
 * ELIGIBILITY MODEL (revised 2026-09-07 — "multiple eligibility groups, no
 * trial fallback", replacing the single Department+Team+Role+Health rule
 * plus its "everyone else gets a small trial allotment" fallback).
 *
 * An admin (from the "AI Usage & Limits" Settings tab) defines any number of
 * named eligibility groups (product_assist_eligibility_groups), each with:
 *   - its own optional Department/Team/Role/Tag matching conditions — null
 *     on any of the four means "don't care about this dimension" for that
 *     group; every non-null one must match simultaneously (AND). This is
 *     the exact same "null = any, AND across the set ones" semantics
 *     access_rules already uses — see ruleMatchesCaller() in
 *     accessRuleEvaluator.ts, which groupMatchesUser() below mirrors.
 *   - its own daily/monthly credit limits — each independently nullable
 *     (null = uncapped on that dimension for anyone who matches this
 *     group).
 * A user can match more than one group at once (e.g. "Falcon Advisory" and
 * a separate "Health Advisors" group). When that happens, the user's
 * effective daily limit is the highest daily limit among every group they
 * match, and likewise independently for the monthly limit — a null (no
 * cap) on either dimension in ANY matched group wins outright for that
 * dimension. See deriveGroupLimits() below.
 *
 * A user who matches NO group gets zero monthly credits — as of 2026-09-07
 * there is no automatic "everyone else" trial allotment; being in Product
 * Assist's user directory no longer grants a baseline allowance by itself.
 * An admin who wants a specific non-matching user to have access uses the
 * per-user override or extra-credit mechanisms below (or defines a
 * deliberately broad/wildcard group with every condition left blank).
 *
 * No tier (including Developer or Platform Admin) grants automatic
 * unlimited or default access — every user, regardless of tier, is
 * evaluated purely by which eligibility group(s) their Department/Team/
 * Role/tags match.
 *
 * A Developer or Platform Admin can still individually override ANY user's
 * limits (custom daily/monthly, disable enforcement, or grant explicit
 * unlimited access) via product_assist_user_quota_overrides, or top up
 * their monthly balance with non-expiring/expiring extra-credit grants
 * (product_assist_extra_credit_grants) — both are per-user, admin-initiated
 * actions from the "AI Usage & Limits" Users tab, layered on top of
 * whichever group(s) the user matches (an override's custom limit replaces
 * the group-derived one; extra credits add to the monthly limit only — see
 * ENFORCEMENT MODEL below for why that's still enough to unblock someone
 * instantly). This override mechanism, the credit calculation, and the
 * usage ledger are unchanged by this revision.
 *
 * ENFORCEMENT MODEL (revised 2026-09-07 — "monthly is the sole gate"): the
 * daily limit/bar is informational/pacing only and NEVER blocks a request
 * by itself — checkQuota() only denies once the MONTHLY allowance (group/
 * override limit + extra credits) is exhausted. A user who's used up
 * today's typical daily pace keeps going against their monthly balance;
 * getQuotaStatus() reports this as the "daily_exceeded" state so the UI can
 * show it (e.g. the daily bar fills and stays full) without implying
 * they're blocked. This replaces the old design where daily and monthly were both
 * independent hard gates (AND'd together) — that meant an admin's extra-
 * credit grant, or simply having monthly headroom, still left someone stuck
 * behind an exhausted daily cap until the next IST midnight reset.
 *
 * RESET BOUNDARIES: daily/monthly windows reset on the IST (Asia/Kolkata,
 * UTC+5:30, no DST) calendar day/month, not UTC midnight — the whole
 * product (currency, advisors, company budget) is India-based, so an
 * advisor's "daily" pacing figure should reset at their actual midnight.
 * Flagged as a decision the user can override in Settings if a different
 * timezone is ever wanted; nothing else in this file depends on it beyond
 * the two boundary functions below.
 */

import type { Repositories } from "../db/repositories/index.js";
import type { ProductAssistUsageLedgerRow } from "../db/schema.js";

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

/** One eligibility group's matching conditions + limits — the minimal
 * structural shape this module actually reads (a superset of
 * ProductAssistEligibilityGroupRow, so a real DB row can be passed straight
 * through). */
export interface EligibilityGroupLike {
  id: number;
  name: string;
  departmentId: number | null;
  orgTeamId: number | null;
  roleId: number | null;
  tag: string | null;
  dailyCredits: number | null;
  monthlyCredits: number | null;
}

/** A user's own Department/Team/Role/tags — everything a group's matching
 * conditions are checked against. */
export interface EligibilityUserAttributes {
  tags: string[];
  departmentId?: number | null;
  orgTeamId?: number | null;
  roleId?: number | null;
}

/** True if every non-null condition on `group` matches `user` — AND
 * semantics within one group, mirroring ruleMatchesCaller() in
 * accessRuleEvaluator.ts exactly (same null-means-any, AND-the-rest
 * pattern access_rules already uses elsewhere in this app). A group with
 * every condition null matches every user — a valid, if unusual,
 * wildcard/blanket group; the admin UI is responsible for making that
 * obvious to whoever creates one, not this function. */
export function groupMatchesUser(group: EligibilityGroupLike, user: EligibilityUserAttributes): boolean {
  if (group.departmentId != null && group.departmentId !== (user.departmentId ?? null)) return false;
  if (group.orgTeamId != null && group.orgTeamId !== (user.orgTeamId ?? null)) return false;
  if (group.roleId != null && group.roleId !== (user.roleId ?? null)) return false;
  if (group.tag != null && !user.tags.includes(group.tag)) return false;
  return true;
}

/** Every group (from `groups`) that `user` matches — order-preserving. */
export function resolveMatchedGroups<G extends EligibilityGroupLike>(user: EligibilityUserAttributes, groups: G[]): G[] {
  return groups.filter(g => groupMatchesUser(g, user));
}

/** Combines every matched group's own daily/monthly limits into one
 * effective pair — independently per dimension, taking the highest value
 * (a null/uncapped limit on either dimension in ANY matched group wins
 * outright for that dimension, since it's more generous than any finite
 * number). No matched groups at all -> blocked: null daily (no daily cap
 * to speak of) but a hard 0 monthly limit, so checkQuota denies every
 * request by default until the user matches a group or gets a per-user
 * override/extra-credit grant (see this file's header comment). */
function deriveGroupLimits(matchedGroups: EligibilityGroupLike[]): { dailyLimit: number | null; monthlyLimit: number | null } {
  if (matchedGroups.length === 0) return { dailyLimit: null, monthlyLimit: 0 };
  const dailyLimit = matchedGroups.some(g => g.dailyCredits === null)
    ? null
    : Math.max(...matchedGroups.map(g => g.dailyCredits as number));
  const monthlyLimit = matchedGroups.some(g => g.monthlyCredits === null)
    ? null
    : Math.max(...matchedGroups.map(g => g.monthlyCredits as number));
  return { dailyLimit, monthlyLimit };
}

/** "daily_exceeded" — today's pacing figure is used up but the monthly
 * balance still has room, so the user is NOT blocked; it's purely a UI
 * signal (fill the daily bar, no "contact a Developer" copy). "at_limit" is
 * reserved for an actual block, which now only happens when the monthly
 * allowance itself is exhausted. See this file's ENFORCEMENT MODEL comment
 * above. */
export type QuotaState = "unlimited" | "ok" | "warning" | "daily_exceeded" | "at_limit";

/** Minimal display info for a group a user matched — used by QuotaStatus/
 * UserQuotaSummary below instead of a full EligibilityGroupLike, since
 * that's all the admin UI needs to show ("via: Falcon Advisory, Health
 * Advisors"). */
export interface MatchedGroupSummary {
  id: number;
  name: string;
}

export interface QuotaStatus {
  userEmail: string;
  /** Every eligibility group this user currently matches — empty array
   * means they're not eligible via any group (blocked unless an override/
   * extra-credit grant applies). */
  matchedGroups: MatchedGroupSummary[];
  unlimited: boolean;
  /** null = no daily pacing figure applies to this user. Informational
   * only — see ENFORCEMENT MODEL above; a user can keep going past this
   * once it's exhausted as long as monthlyRemaining is still positive. */
  dailyLimit: number | null;
  /** null = no monthly cap applies (unlimited). Otherwise the combined
   * matched-group/override limit PLUS any non-expiring extra-credit
   * balance. This is the ONLY limit that can actually block a request —
   * see checkQuota(). */
  monthlyLimit: number | null;
  dailyUsed: number;
  monthlyUsed: number;
  /** null when there's no cap to be remaining against. Going to/below zero
   * does NOT block requests by itself — see dailyLimit's comment. */
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

/** Pure — the shared limit-derivation logic used by both the single-user
 * status lookup and the batched admin table below, so the two can never
 * drift apart.
 *
 * Extra-credit grants top up the monthly ceiling only. Since monthly is now
 * the sole enforcement gate (see ENFORCEMENT MODEL above), that alone is
 * enough for a grant to unblock someone instantly — dailyLimit intentionally
 * stays untouched by extraCredits, since it's just a pacing figure to
 * display, not something that needs "unblocking". */
function deriveEffectiveLimits(
  matchedGroups: EligibilityGroupLike[],
  override: OverrideLike | undefined,
  extraCredits: number
): { unlimited: boolean; dailyLimit: number | null; monthlyLimit: number | null } {
  const unlimited = override?.unlimitedAccess === true || override?.limitsEnabled === false;
  const groupLimits = deriveGroupLimits(matchedGroups);
  const dailyLimitBase = override?.customDailyCredits ?? groupLimits.dailyLimit;
  const monthlyLimitBase = override?.customMonthlyCredits ?? groupLimits.monthlyLimit;
  const dailyLimit = unlimited ? null : dailyLimitBase;
  const monthlyLimit = unlimited ? null : monthlyLimitBase === null ? null : monthlyLimitBase + extraCredits;
  return { unlimited, dailyLimit, monthlyLimit };
}

/** "at_limit" is reserved for the monthly allowance actually running out
 * (the only thing checkQuota() blocks on). Running out of the daily pacing
 * figure while monthly still has room reports "daily_exceeded" instead —
 * informational, never blocking. Checked before "warning" since it's the
 * more specific/visible condition when both are true at once. */
function deriveState(
  unlimited: boolean,
  dailyRemaining: number | null,
  monthlyRemaining: number | null,
  monthlyUtilizationPercent: number | null,
  warningThresholdPercent: number
): QuotaState {
  if (unlimited) return "unlimited";
  if (monthlyRemaining !== null && monthlyRemaining <= 0) return "at_limit";
  if (dailyRemaining !== null && dailyRemaining <= 0) return "daily_exceeded";
  if (monthlyUtilizationPercent !== null && monthlyUtilizationPercent >= warningThresholdPercent) return "warning";
  return "ok";
}

/** Resolves a directory user's raw tags/Department/Team/Role against the
 * full list of eligibility groups via groupMatchesUser() above. `groups` is
 * passed in (rather than fetched here) so listAllUserQuotaStatuses can
 * fetch the list once and reuse it across the whole directory instead of
 * once per user. */
function matchedGroupsForUser<G extends EligibilityGroupLike>(
  user: { tags: string[]; departmentId: number | null; orgTeamId: number | null; roleId: number | null } | undefined,
  groups: G[]
): G[] {
  return resolveMatchedGroups(
    { tags: user?.tags ?? [], departmentId: user?.departmentId ?? null, orgTeamId: user?.orgTeamId ?? null, roleId: user?.roleId ?? null },
    groups
  );
}

/**
 * Full quota status for one user — used both by the pre-call enforcement
 * check and by the utilization-bar / admin "User detail" GET endpoints.
 * Always reads live from the DB (settings, eligibility groups, override,
 * extra-credit grants, and today's/this-month's usage sums) — no caching,
 * since correctness matters more than shaving a handful of queries off a
 * chat request.
 */
export async function getQuotaStatus(repos: Repositories, userEmail: string, now: Date = new Date()): Promise<QuotaStatus> {
  const email = userEmail.toLowerCase();
  const [user, override, settings, extraCredits, groups] = await Promise.all([
    repos.users.findByEmail(email),
    repos.productAssistUserQuotaOverrides.get(email),
    repos.productAssistQuotaSettings.get(),
    repos.productAssistExtraCreditGrants.balanceForUser(email),
    repos.productAssistEligibilityGroups.list(),
  ]);

  const matchedGroups = matchedGroupsForUser(user, groups);
  const { unlimited, dailyLimit, monthlyLimit } = deriveEffectiveLimits(matchedGroups, override, extraCredits);

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
    matchedGroups: matchedGroups.map(g => ({ id: g.id, name: g.name })),
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
  matchedGroups: MatchedGroupSummary[];
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
  const [users, overrides, extraBalances, settings, roles, groups] = await Promise.all([
    repos.users.list(),
    repos.productAssistUserQuotaOverrides.list(),
    repos.productAssistExtraCreditGrants.balancesByUser(),
    repos.productAssistQuotaSettings.get(),
    repos.roles.list(),
    repos.productAssistEligibilityGroups.list(),
  ]);

  const dayStart = startOfDayIST(now);
  const monthStart = startOfMonthIST(now);
  const [dailyByUser, monthlyByUser] = await Promise.all([
    repos.productAssistUsageLedger.sumCreditsGroupedByUserSince(dayStart),
    repos.productAssistUsageLedger.sumCreditsGroupedByUserSince(monthStart),
  ]);

  const overrideByEmail = new Map(overrides.map(o => [o.userEmail, o]));
  // roleById is used purely for the display-only roleName field below — the
  // eligibility decision itself compares raw roleId to each group's own
  // roleId (see matchedGroupsForUser), never a role name.
  const roleById = new Map(roles.map(r => [r.id, r]));

  return users.map(u => {
    const email = u.email.toLowerCase();
    const override = overrideByEmail.get(email);
    const matchedGroups = matchedGroupsForUser(u, groups);
    const extraCredits = extraBalances.get(email) ?? 0;
    const { unlimited, dailyLimit, monthlyLimit } = deriveEffectiveLimits(matchedGroups, override, extraCredits);
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
      matchedGroups: matchedGroups.map(g => ({ id: g.id, name: g.name })),
      unlimited,
      dailyLimit,
      monthlyLimit,
      dailyUsed,
      monthlyUsed,
      extraCredits,
      hasOverride: !!override,
      state,
    };
  });
}

export interface QuotaCheckResult {
  allowed: boolean;
  status: QuotaStatus;
}

/**
 * Pre-call gate: block only when the MONTHLY allowance has already been
 * exhausted (monthlyRemaining <= 0) — see this file's ENFORCEMENT MODEL
 * comment. The daily figure is informational/pacing only and never causes a
 * block by itself, so a user who's used up today's typical pace but still
 * has monthly room keeps going uninterrupted. Deliberately NOT a "will this
 * exact request fit" check — the actual token cost of a Product Assist
 * answer isn't known until the Gemini call returns, so like most token-based
 * quota systems this allows a request to start whenever monthly allowance
 * remains, and lets the final request of a window go slightly over
 * (recorded by `recordUsage` afterward) rather than guessing a request's
 * cost upfront.
 */
export async function checkQuota(repos: Repositories, userEmail: string): Promise<QuotaCheckResult> {
  const status = await getQuotaStatus(repos, userEmail);
  if (status.unlimited) return { allowed: true, status };
  const monthlyOk = status.monthlyRemaining === null || status.monthlyRemaining > 0;
  return { allowed: monthlyOk, status };
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
 *
 * Returns the created ledger row (2026-09) so the caller can link it —
 * product_assist_logs.usageLedgerId — to the same request's query-detail
 * log row, letting the Usage History admin tab look up one usage row's full
 * detail directly. Previously returned void.
 */
export async function recordUsage(
  repos: Repositories,
  userEmail: string,
  inputTokens: number,
  outputTokens: number
): Promise<ProductAssistUsageLedgerRow> {
  const settings = await repos.productAssistQuotaSettings.get();
  const totalTokens = inputTokens + outputTokens;
  const credits = settings.tokensPerCredit > 0 ? totalTokens / settings.tokensPerCredit : 0;
  return repos.productAssistUsageLedger.record({
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
