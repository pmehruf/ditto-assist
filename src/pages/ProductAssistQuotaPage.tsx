/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, AlertTriangle, Plus, Minus, X, Save, Search, Trash2, CheckCircle2, SkipForward, RotateCcw, Download, Wrench, Pencil, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { Department, OrgTeam, AppRole } from "../types/permissions";
import { CustomSelect } from "../components/CustomSelect";
import { DateInputDMY } from "../components/DateInputDMY";
import { ADVISOR_TAG_OPTIONS } from "../components/AdvisorTagCheckboxes";
import { SpecialInstructionFormModal } from "../components/SpecialInstructionFormModal";
import type { KbCategoryLite, SpecialInstructionEntry, SpecialInstructionFormState } from "../components/specialInstructionTypes";
import { downloadCSV } from "../utils/csvExport";
import { useDialog } from "../hooks/useDialog";

interface ProductAssistQuotaPageProps {
  theme: "light" | "dark";
  /** Department/Team/Role catalogs — same lifted-in-App.tsx lists the
   * Directory tab uses (see ProfileAccessManagement), so the "Qualifying
   * Department / Team / Role" selects below always match what a Developer
   * can actually assign to a user. */
  departments: Department[];
  orgTeams: OrgTeam[];
  roles: AppRole[];
  /** Raw tier (not a governed-feature check) — used only to decide whether
   * the Unresolved Queries tab's "Resolve" action is shown at all, since
   * resolving actually creates a Special Instruction via the existing POST
   * /api/kb/special-instructions route, which is hardcoded Developer/
   * Platform Admin-only (see specialInstructionsRepository's server.ts
   * routes) — unrelated to and not governed by "product_assist_quota"
   * access. Hiding the button for anyone else avoids a guaranteed 403;
   * skip/reopen (plain status changes, no instruction created) stay
   * available to anyone with product_assist_quota Editor access. */
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  /** Same resolveAccess()-backed evaluator every other governed feature's
   * page uses — see App.tsx's hasAccess(). Every write here (Save Settings,
   * per-user override, extra-credit grants) requires Editor access on
   * "product_assist_quota" (no longer a hardcoded Developer/Platform-Admin-
   * only exception as of 2026-09 — see featurePermissions.ts); nav only
   * requires Viewer, so someone with view-only access can reach this page
   * and sees its write controls disabled rather than have them silently
   * 403 on click. */
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
}

type UnresolvedQueryStatus = "unresolved" | "resolved" | "skipped";

/** Mirrors ProductAssistUnresolvedQueryRow (schema.ts) as sent over
 * /api/product-assist/quota/unresolved-queries. */
interface UnresolvedQueryRow {
  id: number;
  domain: "Health" | "Term";
  userEmail: string;
  categoryId: number | null;
  categoryName: string | null;
  planTags: string[];
  question: string;
  status: UnresolvedQueryStatus;
  resolvedSpecialInstructionId: number | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const UNRESOLVED_STATUS_STYLE: Record<UnresolvedQueryStatus, { light: string; dark: string; label: string }> = {
  unresolved: { light: "bg-amber-50 text-amber-700 border-amber-200", dark: "bg-amber-500/10 text-amber-300 border-amber-500/30", label: "Unresolved" },
  resolved: { light: "bg-emerald-50 text-emerald-700 border-emerald-200", dark: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", label: "Resolved" },
  skipped: { light: "bg-stone-100 text-stone-600 border-stone-200", dark: "bg-white/[0.06] text-stone-400 border-white/[0.1]", label: "Skipped" },
};

type QuotaState = "unlimited" | "ok" | "warning" | "daily_exceeded" | "at_limit";

/** Minimal display info for a group a user matched — mirrors
 * MatchedGroupSummary in productAssistQuota.ts. */
interface MatchedGroupSummary {
  id: number;
  name: string;
}

interface QuotaStatus {
  userEmail: string;
  matchedGroups: MatchedGroupSummary[];
  unlimited: boolean;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  extraCredits: number;
  warningThresholdPercent: number;
  monthlyUtilizationPercent: number | null;
  state: QuotaState;
  hasOverride: boolean;
}

interface UserQuotaSummary {
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

interface QuotaSettings {
  id: string;
  tokensPerCredit: number;
  warningThresholdPercent: number;
  monthlyBudget: string;
  budgetWarningThresholdPercent: number;
  currency: string;
  modelName: string;
  inputPricePerMillionTokens: string;
  outputPricePerMillionTokens: string;
}

/** One row of ai_model_pricing (2026-09) — mirrors AiModelPricingRow in
 * schema.ts. Feeds only the Overview tab's cross-feature cost estimate. */
interface ModelPricingRow {
  modelName: string;
  inputPricePerMillionTokens: string;
  outputPricePerMillionTokens: string;
  updatedBy: string | null;
  updatedAt: string;
}

/** One admin-defined eligibility group — mirrors
 * ProductAssistEligibilityGroupRow in schema.ts. Each of departmentId/
 * orgTeamId/roleId/tag is independently nullable ("any" for that
 * dimension), and each of dailyCredits/monthlyCredits is independently
 * nullable (uncapped on that dimension). See productAssistQuota.ts's
 * header comment for how a user matching multiple groups combines them. */
interface EligibilityGroup {
  id: number;
  name: string;
  departmentId: number | null;
  orgTeamId: number | null;
  roleId: number | null;
  tag: string | null;
  dailyCredits: number | null;
  monthlyCredits: number | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface OverrideRow {
  userEmail: string;
  customDailyCredits: number | null;
  customMonthlyCredits: number | null;
  limitsEnabled: boolean;
  unlimitedAccess: boolean;
  updatedBy: string;
  updatedAt: string;
}

interface GrantRow {
  id: number;
  userEmail: string;
  amount: number;
  reason: string | null;
  grantedBy: string;
  grantedAt: string;
  /** Null = never expires (the default). Set = this grant stops counting
   * toward the balance once this date passes — see
   * productAssistExtraCreditGrantsRepository.ts's notExpired(). */
  expiresAt: string | null;
}

interface UsageRow {
  id: number;
  userEmail: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  credits: string;
  createdAt: string;
  /** Gemini model that answered this query (2026-09) — null when no linked
   * log row exists, or the answer came from the deterministic Special-
   * Instruction-conflict path (no AI call at all). Shown directly on the
   * collapsed row, not just in the expanded detail. */
  modelName: string | null;
}

interface UsageLogSource {
  title: string;
  categoryName: string;
  documentType: string;
  sourceUrl: string | null;
}

/** Full query detail for one Usage History row's expand-in-place view —
 * mirrors product_assist_logs, i.e. everything the Gsheet export carries
 * (see productAssistLogSheetsClient.ts's HEADER_ROW). Null fields are all
 * genuinely optional on the underlying row (e.g. modelName is null when the
 * answer came from the deterministic Special-Instruction-conflict path, no
 * AI call at all). */
interface UsageLogDetail {
  categoryName: string | null;
  planTags: string[];
  question: string;
  answer: string;
  share: string | null;
  sources: UsageLogSource[];
  hadNoMatches: boolean;
  retrievedChunkCount: number;
  playbookFactCount: number;
  historyTurnCount: number;
  modelName: string | null;
  latencyMs: number | null;
}

/** Cross-feature AI usage source labels (2026-09) — see ai_usage_log's
 * schema.ts comment. Plain, advisor/admin-facing names, not the internal
 * enum values. */
const AI_USAGE_SOURCE_LABELS: Record<string, string> = {
  product_assist: "Product Assist",
  declaration_assist_match: "Declaration Assist",
  specific_illness_ai_check: "Specific Illness Check",
  plan_management_ai_workflow: "Plan Management (Refine with AI)",
};

/** Display-only USD→INR conversion (2026-09) — Gemini API pricing (and
 * everything derived from it: per-token prices, estimated costs) is billed
 * in USD, so every such figure on this page is entered/computed in USD and
 * shown with an INR subline purely for the team's reference. This is a
 * static rate, not a live feed — update periodically; it never affects any
 * actual computation (quota enforcement is credit-based, budget comparisons
 * stay in whatever currency Settings' "Currency" field already specifies). */
const USD_TO_INR_RATE = 94.4;

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatInr(usdAmount: number): string {
  if (!Number.isFinite(usdAmount)) return "—";
  return `₹${(usdAmount * USD_TO_INR_RATE).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-08" -> "August 2026" (plain string split, never a Date(), so no
 * timezone shift can move it to a neighbouring month). */
function formatMonthKey(key: string): string {
  const [year, month] = key.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${name} ${year}` : key;
}

/** Overview cost text tones — theme tokens only. Order of emphasis: the INR
 * amount (accent) -> the $ amount (secondaryAmount) -> the budget line
 * (mutedLine). Light theme's --text-muted token is near-black, so light
 * steps one token up (primary -> secondary) to keep the same order. */
function overviewMoneyTones(dark: boolean) {
  return {
    secondaryAmount: { color: dark ? "var(--text-secondary)" : "var(--text-primary)" },
    mutedLine: { color: dark ? "var(--text-muted)" : "var(--text-secondary)" },
  };
}

/** Overview-only money figure: the INR amount is the highlighted one (accent
 * colour, bold, large), with the USD amount shown beside it in a quieter
 * tone. `tone` lets the Est. Cost card keep its budget-warning colour on the
 * headline figure. Same static USD->INR rate as every other INR figure on
 * this page (see USD_TO_INR_RATE). */
function InrHighlight({ usdAmount, dark, size, tone }: { usdAmount: number; dark: boolean; size: "lg" | "sm"; tone?: "warning" }) {
  const warningColor = dark ? "text-amber-300" : "text-amber-600";
  return (
    <div>
      {/* Strongest: the INR amount. Table rows (sm) use a lighter weight so
          the summary card's total stays the most prominent figure. */}
      <div className={`${size === "lg" ? "text-2xl font-black mt-1" : "text-sm font-semibold"} ${tone === "warning" ? warningColor : "text-[var(--accent)]"}`}>
        {formatInr(usdAmount)}
      </div>
      <div className={size === "lg" ? "text-sm font-semibold mt-0.5" : "text-[11px] font-semibold"} style={overviewMoneyTones(dark).secondaryAmount}>
        {formatUsd(usdAmount)}
      </div>
    </div>
  );
}

/** USD figure with an INR-converted subline below it — the standard shape
 * for every USD money value on this page (see USD_TO_INR_RATE above). Pass
 * a raw string (e.g. straight from a form field) or number; invalid/blank
 * values render as a plain em dash rather than throwing. */
function UsdWithInr({ amount, dark, size = "sm" }: { amount: string | number; dark: boolean; size?: "sm" | "lg" }) {
  const n = typeof amount === "number" ? amount : Number(amount);
  const valid = Number.isFinite(n);
  return (
    <div>
      <div className={size === "lg" ? undefined : `text-xs font-semibold ${dark ? "text-white" : "text-stone-900"}`}>
        {valid ? formatUsd(n) : "—"}
      </div>
      {valid && (
        <div className={`text-[10px] mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>≈ {formatInr(n)}</div>
      )}
    </div>
  );
}

const STATE_STYLE: Record<QuotaState, { light: string; dark: string; label: string }> = {
  unlimited: { light: "bg-sky-50 text-sky-700 border-sky-200", dark: "bg-sky-500/10 text-sky-300 border-sky-500/30", label: "Unlimited" },
  ok: { light: "bg-emerald-50 text-emerald-700 border-emerald-200", dark: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", label: "OK" },
  warning: { light: "bg-amber-50 text-amber-700 border-amber-200", dark: "bg-amber-500/10 text-amber-300 border-amber-500/30", label: "Warning" },
  // Informational only — daily's pacing figure is used up but monthly still
  // has room, so this user is NOT blocked (see productAssistQuota.ts's
  // ENFORCEMENT MODEL comment). Distinct amber-ish styling from "At Limit"
  // so admins don't read it as an actual block.
  daily_exceeded: { light: "bg-orange-50 text-orange-700 border-orange-200", dark: "bg-orange-500/10 text-orange-300 border-orange-500/30", label: "Daily Paced" },
  at_limit: { light: "bg-rose-50 text-rose-700 border-rose-200", dark: "bg-rose-500/10 text-rose-300 border-rose-500/30", label: "At Limit" },
};

/** Client-only extension of QuotaState, Users tab only. A user who matches
 * no eligibility group gets monthlyLimit=0 from the server (see
 * deriveGroupLimits in productAssistQuota.ts), which makes their computed
 * `state` come out "at_limit" — reading as if they genuinely burned through
 * a real quota, when they never had one to begin with. This is a pure
 * display fix (the server's actual AI-call blocking behavior for them is
 * unchanged): the Users table shows a distinct "Not Eligible" badge instead,
 * and skips the meaningless 0/0 Daily/Monthly figures below. */
type DisplayState = QuotaState | "ineligible";
const DISPLAY_STATE_STYLE: Record<DisplayState, { light: string; dark: string; label: string }> = {
  ...STATE_STYLE,
  ineligible: { light: "bg-stone-100 text-stone-600 border-stone-300", dark: "bg-white/[0.06] text-stone-400 border-white/[0.14]", label: "Not Eligible" },
};
function displayState(u: Pick<UserQuotaSummary, "state" | "matchedGroups">): DisplayState {
  return u.matchedGroups.length === 0 ? "ineligible" : u.state;
}
function DisplayStateBadge({ state, dark }: { state: DisplayState; dark: boolean }) {
  const s = DISPLAY_STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap ${dark ? s.dark : s.light}`}>
      {s.label}
    </span>
  );
}

function fmtLimit(used: number, limit: number | null, unlimited: boolean): string {
  if (unlimited) return "Unlimited";
  if (limit === null) return `${Math.round(used * 100) / 100} / —`;
  return `${Math.round(used * 100) / 100} / ${limit}`;
}

/** Comma-joined group names for a user's Users-tab row, or a clear "not
 * eligible" label when they match none — replaces the old fixed bucket
 * label now that eligibility is an open-ended list of admin groups. */
function groupsLabel(matchedGroups: MatchedGroupSummary[]): string {
  return matchedGroups.length > 0 ? matchedGroups.map(g => g.name).join(", ") : "Not eligible via any group";
}

type Tab = "overview" | "users" | "usage" | "unresolved" | "settings";

/**
 * "AI Usage & Limits" — Product Assist Credit & Usage Management (2026-08).
 * Developer Zone. Shipped defaults keep every read/write Developer/Platform-
 * Admin-reachable only, matching this feature's pre-2026-09 hardcoded gate —
 * but "product_assist_quota" is no longer a hard, un-overridable exception
 * (see DEVELOPER_ONLY_FEATURES's doc comment in featurePermissions.ts), so a
 * Developer can reassign it from the Permissions tab like any other feature.
 * Every read/write here goes through /api/product-assist/quota/*
 * (server.ts's requireQuotaAdmin -> requireFeatureAccess), which re-checks
 * the same registry/override/Access-Rule/Custom-Grant pipeline this page's
 * own hasAccess() reads — this page's canManage is a UX convenience, not the
 * real enforcement boundary. See productAssistQuota.ts for the eligibility
 * model (an admin-defined, open-ended list of eligibility groups — each
 * with its own optional Department/Team/Role/Tag conditions and its own
 * daily/monthly allowance; a user can match several groups at once, in
 * which case the highest limit wins independently per dimension; a user
 * matching no group gets zero credits — no tier grants automatic unlimited
 * or default access as of 2026-09-07; a user who genuinely needs access
 * outside any group gets it via a per-user override or extra-credit grant
 * from the Users tab below) — that model is unrelated to who may MANAGE
 * this page, only to who the settings here apply to.
 */
export function ProductAssistQuotaPage({ theme, departments, orgTeams, roles, effectiveTier, hasAccess }: ProductAssistQuotaPageProps) {
  const dark = theme === "dark";
  const canManage = hasAccess("product_assist_quota", "Editor");
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const cardClass = `rounded-2xl border ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[#D2DFEC]"}`;
  const rowClass = `rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"}`;

  // ── Overview ────────────────────────────────────────────────────────────
  const [overview, setOverview] = useState<any>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  // Selected month as "YYYY-MM"; "" = the current month (followed as it
  // rolls over). Month list + current-month key come back with every load
  // and are kept here so the selector stays usable while a month is loading.
  const [overviewMonth, setOverviewMonth] = useState("");
  const [overviewMonths, setOverviewMonths] = useState<string[]>([]);
  const [overviewCurrentMonth, setOverviewCurrentMonth] = useState("");
  // Only the newest request may update the page, so a slow response for a
  // previously chosen month can never land under the new month's label.
  const overviewRequestRef = useRef(0);

  const refreshOverview = async (monthOverride?: string) => {
    const month = monthOverride ?? overviewMonth;
    const requestId = ++overviewRequestRef.current;
    setOverviewLoading(true);
    try {
      const res = await fetch(`/api/product-assist/quota/overview${month ? `?month=${encodeURIComponent(month)}` : ""}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      if (requestId !== overviewRequestRef.current) return;
      setOverview(body);
      setOverviewMonths(Array.isArray(body.availableMonths) ? body.availableMonths : []);
      setOverviewCurrentMonth(body.currentMonth ?? "");
      setOverviewError(null);
    } catch (err) {
      if (requestId !== overviewRequestRef.current) return;
      setOverviewError(err instanceof Error ? err.message : "Could not load the usage overview.");
    } finally {
      if (requestId === overviewRequestRef.current) setOverviewLoading(false);
    }
  };

  const selectOverviewMonth = (key: string) => {
    const next = key === overviewCurrentMonth ? "" : key;
    setOverviewMonth(next);
    setOverview(null); // never leave the previous month's numbers on screen
    setOverviewError(null);
    refreshOverview(next);
  };

  // ── Users ───────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserQuotaSummary[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [usersSearch, setUsersSearch] = useState("");
  // "" = all users, "none" = users matching no eligibility group, otherwise
  // a group id (string, since CustomSelect works in string values).
  const [usersGroupFilter, setUsersGroupFilter] = useState<string>("");
  const [usersStateFilter, setUsersStateFilter] = useState<DisplayState | "eligible" | "">("");
  const [usersRoleFilter, setUsersRoleFilter] = useState<string>("");
  // Month-to-date usage (monthlyUsed resets each cycle) — the most direct
  // read on "who's actually using this" the Users tab's own data supports;
  // a lifetime figure would need a separate ledger-wide query.
  const [usersUsageFilter, setUsersUsageFilter] = useState<"" | "used" | "unused">("");

  const usersRoleOptions = useMemo(
    () => Array.from(new Set(users.map((u) => u.roleName).filter((r): r is string => !!r))).sort(),
    [users]
  );

  const filteredUsers = useMemo(() => {
    const q = usersSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (usersGroupFilter === "none" && u.matchedGroups.length > 0) return false;
      if (usersGroupFilter && usersGroupFilter !== "none" && !u.matchedGroups.some((g) => String(g.id) === usersGroupFilter)) return false;
      if (usersStateFilter === "eligible" && displayState(u) === "ineligible") return false;
      else if (usersStateFilter && usersStateFilter !== "eligible" && displayState(u) !== usersStateFilter) return false;
      if (usersRoleFilter && u.roleName !== usersRoleFilter) return false;
      if (usersUsageFilter === "used" && u.monthlyUsed <= 0) return false;
      if (usersUsageFilter === "unused" && u.monthlyUsed > 0) return false;
      if (q && !u.name.toLowerCase().includes(q) && !u.userEmail.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [users, usersSearch, usersGroupFilter, usersStateFilter, usersRoleFilter, usersUsageFilter]);

  const exportUsersCsv = () => {
    downloadCSV(
      filteredUsers.map((u) => ({
        Name: u.name,
        Email: u.userEmail,
        "Eligibility Group(s)": groupsLabel(u.matchedGroups),
        Tier: u.tier,
        Role: u.roleName ?? "",
        Tags: u.tags.join(", "),
        Status: DISPLAY_STATE_STYLE[displayState(u)].label,
        Unlimited: u.unlimited ? "Yes" : "No",
        "Daily Used": u.dailyUsed,
        "Daily Limit": u.dailyLimit ?? "",
        "Monthly Used": u.monthlyUsed,
        "Monthly Limit": u.monthlyLimit ?? "",
        "Extra Credits": u.extraCredits,
        "Custom Override": u.hasOverride ? "Yes" : "No",
      })),
      "product-assist-users.csv"
    );
  };

  const refreshUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/product-assist/quota/users");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setUsers(body.users ?? []);
      setUsersError(null);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Could not load user quota statuses.");
    } finally {
      setUsersLoading(false);
    }
  };

  // ── Usage History ───────────────────────────────────────────────────────
  const [usageRange, setUsageRange] = useState<"today" | "7d" | "month" | "all">("today");
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  // Expand-in-place query detail (2026-09) — keyed by usage row id. undefined
  // = not fetched yet, null = fetched but no detail recorded for this row
  // (logging was disabled, or it predates the usageLedgerId link).
  const [expandedUsageId, setExpandedUsageId] = useState<number | null>(null);
  const [usageDetails, setUsageDetails] = useState<Record<number, UsageLogDetail | null | undefined>>({});
  const [usageDetailLoading, setUsageDetailLoading] = useState<number | null>(null);
  const [usageDetailError, setUsageDetailError] = useState<Record<number, string>>({});
  // Client-side filters over the already-fetched range (usageRange above
  // controls the server-side date window; these narrow within it) — same
  // pattern as the Users tab's filteredUsers. Model options are derived
  // from whatever's actually present in the loaded rows rather than a
  // separate lookup, so the dropdown never offers a model with zero matches.
  const [usageSearch, setUsageSearch] = useState("");
  const [usageModelFilter, setUsageModelFilter] = useState("");
  const usageModelOptions = useMemo(
    () => Array.from(new Set(usageRows.map((r) => r.modelName).filter((m): m is string => !!m))).sort(),
    [usageRows]
  );
  const filteredUsageRows = useMemo(() => {
    const q = usageSearch.trim().toLowerCase();
    return usageRows.filter((r) => {
      if (usageModelFilter && r.modelName !== usageModelFilter) return false;
      if (q && !r.userEmail.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [usageRows, usageSearch, usageModelFilter]);

  const toggleUsageRow = async (id: number) => {
    if (expandedUsageId === id) {
      setExpandedUsageId(null);
      return;
    }
    setExpandedUsageId(id);
    if (usageDetails[id] !== undefined) return; // already fetched
    setUsageDetailLoading(id);
    try {
      const res = await fetch(`/api/product-assist/quota/usage/${id}/detail`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setUsageDetails((prev) => ({ ...prev, [id]: body.detail ?? null }));
      setUsageDetailError((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setUsageDetailError((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : "Could not load query detail." }));
    } finally {
      setUsageDetailLoading(null);
    }
  };

  const refreshUsage = async (range: typeof usageRange) => {
    setUsageLoading(true);
    try {
      const params = new URLSearchParams();
      const now = new Date();
      if (range === "today") {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        params.set("from", d.toISOString());
      } else if (range === "7d") {
        params.set("from", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
      } else if (range === "month") {
        params.set("from", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
      }
      params.set("limit", "500");
      const res = await fetch(`/api/product-assist/quota/usage?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setUsageRows(body.rows ?? []);
      setUsageError(null);
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : "Could not load usage history.");
    } finally {
      setUsageLoading(false);
    }
  };

  // ── Settings ────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<QuotaSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<QuotaSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  // Defaults to a read-only summary of the current settings; Edit reveals
  // the live form below, matching the Eligibility Groups/Permissions
  // pattern elsewhere on this page.
  const [editingSettings, setEditingSettings] = useState(false);

  const refreshSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/product-assist/quota/settings");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setSettings(body.settings);
      setSettingsDraft(body.settings);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not load quota settings.");
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setSettingsSaving(true);
    setSettingsSaved(false);
    try {
      const res = await fetch("/api/product-assist/quota/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsDraft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      setSettings(body.settings);
      setSettingsDraft(body.settings);
      setSettingsError(null);
      setSettingsSaved(true);
      setEditingSettings(false);
      setTimeout(() => setSettingsSaved(false), 2500);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  const cancelSettingsEdit = () => {
    setSettingsDraft(settings);
    setSettingsError(null);
    setEditingSettings(false);
  };

  // ── Model Pricing (2026-09) ─────────────────────────────────────────────
  // Feeds only the Overview tab's cross-feature "Total AI Usage" cost
  // estimate — separate from settings.modelName/inputPricePerMillionTokens/
  // outputPricePerMillionTokens above, which stay Product-Assist-specific.
  const [modelPricing, setModelPricing] = useState<ModelPricingRow[]>([]);
  const [modelPricingDrafts, setModelPricingDrafts] = useState<Record<string, { input: string; output: string }>>({});
  const [modelPricingError, setModelPricingError] = useState<string | null>(null);
  const [modelPricingLoading, setModelPricingLoading] = useState(false);
  const [modelPricingSavingRow, setModelPricingSavingRow] = useState<string | null>(null);
  const [modelPricingSavedRow, setModelPricingSavedRow] = useState<string | null>(null);

  const refreshModelPricing = async () => {
    setModelPricingLoading(true);
    try {
      const res = await fetch("/api/product-assist/quota/model-pricing");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      const rows: ModelPricingRow[] = body.pricing ?? [];
      setModelPricing(rows);
      setModelPricingDrafts(
        Object.fromEntries(rows.map((r) => [r.modelName, { input: r.inputPricePerMillionTokens, output: r.outputPricePerMillionTokens }]))
      );
      setModelPricingError(null);
    } catch (err) {
      setModelPricingError(err instanceof Error ? err.message : "Could not load model pricing.");
    } finally {
      setModelPricingLoading(false);
    }
  };

  const saveModelPricing = async (modelName: string) => {
    const draft = modelPricingDrafts[modelName];
    if (!draft) return;
    setModelPricingSavingRow(modelName);
    setModelPricingSavedRow(null);
    try {
      const res = await fetch(`/api/product-assist/quota/model-pricing/${encodeURIComponent(modelName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputPricePerMillionTokens: Number(draft.input), outputPricePerMillionTokens: Number(draft.output) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      await refreshModelPricing();
      setModelPricingSavedRow(modelName);
      setTimeout(() => setModelPricingSavedRow(null), 2500);
    } catch (err) {
      setModelPricingError(err instanceof Error ? err.message : "Failed to save model pricing.");
    } finally {
      setModelPricingSavingRow(null);
    }
  };

  // ── Eligibility Groups ──────────────────────────────────────────────────
  // Loaded alongside Settings (where they're managed) AND Users (where the
  // group filter/labels need their names) — see the lazy-load effect below.
  const [eligibilityGroups, setEligibilityGroups] = useState<EligibilityGroup[]>([]);
  const [eligibilityGroupsError, setEligibilityGroupsError] = useState<string | null>(null);
  const [eligibilityGroupsLoading, setEligibilityGroupsLoading] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  // A freshly-created group is blank, so its row opens straight into edit
  // mode instead of the (otherwise empty-looking) read view — cleared as
  // soon as another group is added, since it only needs to apply once.
  const [newlyAddedGroupId, setNewlyAddedGroupId] = useState<number | null>(null);

  const refreshEligibilityGroups = async () => {
    setEligibilityGroupsLoading(true);
    try {
      const res = await fetch("/api/product-assist/quota/eligibility-groups");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setEligibilityGroups(body.groups ?? []);
      setEligibilityGroupsError(null);
    } catch (err) {
      setEligibilityGroupsError(err instanceof Error ? err.message : "Could not load eligibility groups.");
    } finally {
      setEligibilityGroupsLoading(false);
    }
  };

  const addEligibilityGroup = async () => {
    setAddingGroup(true);
    try {
      const res = await fetch("/api/product-assist/quota/eligibility-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Group", sortOrder: eligibilityGroups.length }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to add group (HTTP ${res.status}).`);
      setEligibilityGroups((prev) => [...prev, body.group]);
      setNewlyAddedGroupId(body.group.id);
      setEligibilityGroupsError(null);
    } catch (err) {
      setEligibilityGroupsError(err instanceof Error ? err.message : "Failed to add a new group.");
    } finally {
      setAddingGroup(false);
    }
  };

  // ── Unresolved Queries (2026-09) ───────────────────────────────────────
  // Auto-recorded server-side (see product_assist_unresolved_queries's
  // schema.ts comment) whenever Product Assist has nothing to answer with —
  // this tab is purely a review/resolve/export UI over that table.
  const [unresolvedQueries, setUnresolvedQueries] = useState<UnresolvedQueryRow[]>([]);
  const [unresolvedError, setUnresolvedError] = useState<string | null>(null);
  const [unresolvedLoading, setUnresolvedLoading] = useState(false);
  const [unresolvedStatusFilter, setUnresolvedStatusFilter] = useState<"all" | UnresolvedQueryStatus>("unresolved");
  const [unresolvedDomainFilter, setUnresolvedDomainFilter] = useState<"all" | "Health" | "Term">("all");
  const [unresolvedFrom, setUnresolvedFrom] = useState<string>("");
  const [unresolvedTo, setUnresolvedTo] = useState<string>("");
  const [busyQueryId, setBusyQueryId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Only Developer/Platform Admin can actually create the Special
  // Instruction "Resolve" produces (see this file's props doc comment on
  // effectiveTier) — canManage alone (product_assist_quota Editor) is not
  // sufficient, so both are required for the Resolve button to appear.
  const canResolveViaInstruction = canManage && (effectiveTier === "Platform Admin" || effectiveTier === "Developer");

  const refreshUnresolvedQueries = async () => {
    setUnresolvedLoading(true);
    try {
      const params = new URLSearchParams();
      if (unresolvedStatusFilter !== "all") params.set("status", unresolvedStatusFilter);
      if (unresolvedDomainFilter !== "all") params.set("domain", unresolvedDomainFilter);
      if (unresolvedFrom) params.set("from", new Date(unresolvedFrom).toISOString());
      if (unresolvedTo) {
        // Inclusive of the whole selected "to" day, matching the date
        // input's own granularity (a bare date parses to that day's 00:00).
        const d = new Date(unresolvedTo);
        d.setHours(23, 59, 59, 999);
        params.set("to", d.toISOString());
      }
      const res = await fetch(`/api/product-assist/quota/unresolved-queries?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setUnresolvedQueries(body.rows ?? []);
      setUnresolvedError(null);
    } catch (err) {
      setUnresolvedError(err instanceof Error ? err.message : "Could not load Unresolved Queries.");
    } finally {
      setUnresolvedLoading(false);
    }
  };

  const setQueryStatus = async (row: UnresolvedQueryRow, status: UnresolvedQueryStatus, resolvedSpecialInstructionId: number | null = null) => {
    setBusyQueryId(row.id);
    try {
      const res = await fetch(`/api/product-assist/quota/unresolved-queries/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolvedSpecialInstructionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update (HTTP ${res.status}).`);
      setUnresolvedError(null);
      await refreshUnresolvedQueries();
    } catch (err) {
      setUnresolvedError(err instanceof Error ? err.message : "Failed to update this query.");
    } finally {
      setBusyQueryId(null);
    }
  };

  const exportUnresolvedQueries = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      const res = await fetch("/api/product-assist/quota/unresolved-queries/export", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Export failed (HTTP ${res.status}).`);
      setExportMessage(`Exported ${body.exportedCount} record${body.exportedCount === 1 ? "" : "s"} to Google Sheets (Health/Term tabs).`);
      setUnresolvedError(null);
    } catch (err) {
      setUnresolvedError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  // ── Resolve modal — same Special Instruction form Knowledge Base uses,
  // pre-filled from the unresolved question. Categories are fetched fresh
  // per-open (scoped to the row's own domain, which can differ per row)
  // rather than kept as page-level state — this tab has no other reason to
  // hold the KB category roster. ──
  const [resolvingQuery, setResolvingQuery] = useState<UnresolvedQueryRow | null>(null);
  const [resolveCategories, setResolveCategories] = useState<KbCategoryLite[]>([]);
  const [resolveCategoriesLoading, setResolveCategoriesLoading] = useState(false);

  const openResolve = async (row: UnresolvedQueryRow) => {
    setResolvingQuery(row);
    setResolveCategoriesLoading(true);
    try {
      const res = await fetch(`/api/kb/categories?domain=${row.domain}`);
      const body = await res.json().catch(() => ({}));
      setResolveCategories(res.ok ? body.entries ?? [] : []);
    } catch {
      setResolveCategories([]);
    } finally {
      setResolveCategoriesLoading(false);
    }
  };

  const resolveInitialForm: SpecialInstructionFormState | undefined = resolvingQuery
    ? {
        id: null,
        topic: resolvingQuery.question.length > 80 ? `${resolvingQuery.question.slice(0, 77)}…` : resolvingQuery.question,
        instructionText: "",
        instructionType: "override_rule",
        insurerCategoryId: resolvingQuery.categoryId !== null ? String(resolvingQuery.categoryId) : "",
        productPlanName: resolvingQuery.planTags[0] ?? "",
      }
    : undefined;

  const handleResolveSaved = async (entry: SpecialInstructionEntry) => {
    const row = resolvingQuery;
    setResolvingQuery(null);
    if (!row) return;
    await setQueryStatus(row, "resolved", entry.id);
  };

  useEffect(() => {
    if (activeTab === "overview" && !overview) refreshOverview();
    if (activeTab === "users") {
      if (users.length === 0) refreshUsers();
      if (eligibilityGroups.length === 0) refreshEligibilityGroups();
    }
    if (activeTab === "usage" && usageRows.length === 0) refreshUsage(usageRange);
    if (activeTab === "unresolved") refreshUnresolvedQueries();
    if (activeTab === "settings") {
      if (!settings) refreshSettings();
      if (eligibilityGroups.length === 0) refreshEligibilityGroups();
      if (modelPricing.length === 0) refreshModelPricing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, unresolvedStatusFilter, unresolvedDomainFilter, unresolvedFrom, unresolvedTo]);

  const inputClass = `w-full px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
    dark ? "bg-white/[0.04] border-white/[0.1] text-white focus:border-[var(--accent)]" : "bg-white border-stone-300 text-stone-900 focus:border-[var(--accent)]"
  }`;
  const labelClass = `text-[10.5px] font-bold uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`;

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${theme === "dark" ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>AI Usage &amp; Limits</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Product Assist credit quotas, usage history, and company budget tracking.
            {!canManage && " You can view this, but you don't have permission to change limits or grant credits."}
          </p>
        </div>
      </div>

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {([
          { id: "overview", label: "Overview" },
          { id: "users", label: "Users" },
          { id: "usage", label: "Usage History" },
          { id: "unresolved", label: "Unresolved Queries" },
          { id: "settings", label: "Settings" },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg -mb-0.5 border-b-[3px] cursor-pointer transition-colors ${
              activeTab === tab.id ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-content-muted hover:text-content"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── OVERVIEW ── */}
      {activeTab === "overview" && (
        <div className={`p-5 ${cardClass}`}>
          <div className="flex items-center justify-between pb-2 mb-4 border-b border-light-stone/5 dark:border-stone-800">
            <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Company Overview</h3>
            <div className="flex items-center gap-2">
              {overviewMonths.length > 0 && (
                <div className="w-[150px]" title="Choose a month">
                  <CustomSelect
                    value={overviewMonth || overviewCurrentMonth}
                    onChange={selectOverviewMonth}
                    theme={theme}
                    options={overviewMonths.map((m) => ({ value: m, label: formatMonthKey(m) }))}
                    triggerClassName={`w-full flex items-center justify-between gap-2 pl-2.5 pr-7 py-1.5 rounded-lg border outline-none text-xs font-bold cursor-pointer relative ${
                      dark ? "bg-white/[0.04] border-white/[0.08] text-stone-200" : "bg-white border-stone-200 text-stone-700"
                    }`}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => refreshOverview()}
                title="Refresh"
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${overviewLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {overviewError && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{overviewError}</span>
            </div>
          )}

          {overview && (
            <div className={`grid grid-cols-2 gap-3 ${overview.isCurrentMonth ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
              {[
                // "Credits Used Today" only exists for the current month.
                ...(overview.today ? [{ label: "Credits Used Today", value: Math.round(overview.today.totalCredits * 100) / 100 }] : []),
                { label: `Credits Used ${overview.isCurrentMonth ? "This Month" : `in ${formatMonthKey(overview.selectedMonth)}`}`, value: Math.round(overview.month.totalCredits * 100) / 100 },
                { label: `Requests ${overview.isCurrentMonth ? "This Month" : `in ${formatMonthKey(overview.selectedMonth)}`}`, value: overview.month.requestCount },
              ].map((stat) => (
                <div key={stat.label} className={`p-4 ${rowClass}`}>
                  <div className={labelClass}>{stat.label}</div>
                  <div className={`text-2xl font-black mt-1 ${dark ? "text-white" : "text-stone-900"}`}>{stat.value}</div>
                </div>
              ))}
              <div className={`p-4 ${rowClass}`}>
                <div className={labelClass}>Est. Cost {overview.isCurrentMonth ? "This Month" : `in ${formatMonthKey(overview.selectedMonth)}`}</div>
                <InrHighlight
                  usdAmount={overview.budget.estimatedCostThisMonth}
                  dark={dark}
                  size="lg"
                  tone={overview.budget.budgetUtilizationPercent !== null && overview.budget.budgetUtilizationPercent >= overview.budget.warningThresholdPercent ? "warning" : undefined}
                />
                <div className="text-[10.5px] mt-1" style={overviewMoneyTones(dark).mutedLine}>
                  of {overview.budget.currency} {overview.budget.monthlyBudget} budget
                  {overview.budget.budgetUtilizationPercent !== null ? ` — ${overview.budget.budgetUtilizationPercent}%` : ""}
                </div>
              </div>
            </div>
          )}
          <p className={`text-[10.5px] mt-4 ${dark ? "text-stone-400" : "text-stone-500"}`}>
            Budget tracking is visibility-only — reaching or exceeding the monthly budget never blocks Product Assist automatically.
            Per-user/per-day credit limits (below) are the actual enforcement mechanism.
          </p>

          {overview && Array.isArray(overview.allSources) && (
            <div className="mt-5 pt-4 border-t border-light-stone/5 dark:border-stone-800">
              <h4 className={`text-[11px] font-black uppercase tracking-wider mb-2.5 ${dark ? "text-white" : "text-stone-900"}`}>
                Total AI Usage — All Features ({overview.isCurrentMonth ? "This Month" : formatMonthKey(overview.selectedMonth)})
              </h4>
              {overview.allSources.length === 0 ? (
                <p className={`py-3 text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                  No AI usage recorded {overview.isCurrentMonth ? "this month" : `in ${formatMonthKey(overview.selectedMonth)}`}.
                </p>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className={`text-left border-b ${dark ? "border-white/10 text-stone-400" : "border-stone-200 text-stone-500"}`}>
                      <th className="py-2 pr-4 font-bold">Feature</th>
                      <th className="py-2 pr-4 font-bold">Requests</th>
                      <th className="py-2 pr-4 font-bold">Total Tokens</th>
                      <th className="py-2 pr-4 font-bold">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.allSources.map((s: { source: string; requestCount: number; totalTokens: number; estimatedCost: number; hasUnpricedModel: boolean }) => (
                      <tr key={s.source} className={`border-b ${dark ? "border-white/[0.04]" : "border-stone-100"}`}>
                        <td className={`py-2 pr-4 font-semibold ${dark ? "text-white" : "text-stone-900"}`}>
                          {AI_USAGE_SOURCE_LABELS[s.source] ?? s.source}
                        </td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{s.requestCount}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{s.totalTokens}</td>
                        <td className="py-2 pr-4">
                          <div className="flex items-start gap-1.5">
                            <InrHighlight usdAmount={s.estimatedCost} dark={dark} size="sm" />
                            {s.hasUnpricedModel && (
                              <span className={`text-[10px] font-bold ${dark ? "text-amber-300" : "text-amber-600"}`} title="One or more models used here have no price set in Settings — this total is an undercount.">
                                (partial)
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              <p className={`text-[10.5px] mt-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                Visibility only — credit limits apply to Product Assist alone. Set per-model pricing in Settings to keep cost estimates
                accurate across every feature listed here.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── USERS ── */}
      {activeTab === "users" && (
        <div className={`p-5 ${cardClass}`}>
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
            <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Users</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportUsersCsv}
                disabled={filteredUsers.length === 0}
                title="Export the currently filtered rows as a CSV file"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={refreshUsers}
                title="Refresh"
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {usersError && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{usersError}</span>
            </div>
          )}

          <div className={`flex flex-wrap items-end gap-3 mb-3 p-3 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-stone-50/70 border-stone-200"}`}>
            <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Search className="w-3 h-3" /> Search</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
                <input
                  type="text"
                  value={usersSearch}
                  onChange={(e) => setUsersSearch(e.target.value)}
                  placeholder="Name or email…"
                  className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
                    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                  }`}
                />
              </div>
            </label>
            <label className="flex-1 min-w-[170px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>Eligibility Group</span>
              <CustomSelect
                value={usersGroupFilter}
                onChange={(v) => setUsersGroupFilter(v)}
                theme={theme}
                options={[
                  { value: "", label: "All groups" },
                  { value: "none", label: "Not eligible (no group)" },
                  ...eligibilityGroups.map((g) => ({ value: String(g.id), label: g.name })),
                ]}
              />
            </label>
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>Status</span>
              <CustomSelect
                value={usersStateFilter}
                onChange={(v) => setUsersStateFilter(v as DisplayState | "eligible" | "")}
                theme={theme}
                options={[
                  { value: "", label: "All statuses" },
                  { value: "eligible", label: "Eligible (any status)" },
                  ...(Object.keys(DISPLAY_STATE_STYLE) as DisplayState[]).map((s) => ({ value: s, label: DISPLAY_STATE_STYLE[s].label })),
                ]}
              />
            </label>
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>Role</span>
              <CustomSelect
                value={usersRoleFilter}
                onChange={(v) => setUsersRoleFilter(v)}
                theme={theme}
                options={[{ value: "", label: "All roles" }, ...usersRoleOptions.map((r) => ({ value: r, label: r }))]}
              />
            </label>
            <label className="flex-1 min-w-[160px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>Usage (this month)</span>
              <CustomSelect
                value={usersUsageFilter}
                onChange={(v) => setUsersUsageFilter(v as "" | "used" | "unused")}
                theme={theme}
                options={[
                  { value: "", label: "All" },
                  { value: "used", label: "Used this month" },
                  { value: "unused", label: "No usage this month" },
                ]}
              />
            </label>
            <p className={`text-[11px] font-semibold pb-1.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              {filteredUsers.length} of {users.length} user{users.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`text-left border-b ${dark ? "border-white/10 text-stone-400" : "border-stone-200 text-stone-500"}`}>
                  <th className="py-2 pr-3 font-bold w-10">#</th>
                  <th className="py-2 pr-4 font-bold">Advisor</th>
                  <th className="py-2 pr-4 font-bold">Eligibility Group(s)</th>
                  <th className="py-2 pr-4 font-bold">Tier</th>
                  <th className="py-2 pr-4 font-bold">Role</th>
                  <th className="py-2 pr-4 font-bold">Daily</th>
                  <th className="py-2 pr-4 font-bold">Monthly</th>
                  <th className="py-2 pr-4 font-bold">Extra</th>
                  <th className="py-2 pr-4 font-bold">Status</th>
                  <th className="py-2 pr-2 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, i) => {
                  const ds = displayState(u);
                  const isOpen = expandedEmail === u.userEmail;
                  // Ineligible users' Daily/Monthly figures are meaningless
                  // placeholders (dailyLimit null, monthlyLimit forced to 0 —
                  // see DisplayState's comment above), so show a plain dash
                  // instead of "0 / —" / "0 / 0" reading like a real quota.
                  const isIneligible = ds === "ineligible";
                  return (
                    <Fragment key={u.userEmail}>
                      <tr className={`border-b ${dark ? "border-white/[0.04] hover:bg-white/[0.03]" : "border-stone-100 hover:bg-stone-50"}`}>
                        <td className={`py-2 pr-3 ${dark ? "text-stone-500" : "text-stone-400"}`}>{i + 1}</td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`font-bold ${dark ? "text-white" : "text-stone-900"}`}>{u.name}</span>
                            {u.hasOverride && (
                              <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border ${dark ? "border-white/20 text-stone-300" : "border-stone-300 text-stone-600"}`}>
                                Custom
                              </span>
                            )}
                          </div>
                          <div className={dark ? "text-stone-400" : "text-stone-500"}>{u.userEmail}</div>
                        </td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{groupsLabel(u.matchedGroups)}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{u.tier}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{u.roleName ?? "—"}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>
                          {isIneligible ? "—" : fmtLimit(u.dailyUsed, u.dailyLimit, u.unlimited)}
                        </td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>
                          {isIneligible ? "—" : fmtLimit(u.monthlyUsed, u.monthlyLimit, u.unlimited)}
                        </td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{u.extraCredits !== 0 ? `+${u.extraCredits}` : "—"}</td>
                        <td className="py-2 pr-4">
                          <DisplayStateBadge state={ds} dark={dark} />
                        </td>
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            onClick={() => setExpandedEmail(isOpen ? null : u.userEmail)}
                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer whitespace-nowrap ${dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}
                          >
                            {isOpen ? "Close" : "Manage"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className={`border-b ${dark ? "border-white/[0.04] bg-white/[0.02]" : "border-stone-100 bg-surface-solid"}`}>
                          <td colSpan={10} className="py-3 px-4">
                            <UserQuotaDetailPanel theme={theme} userEmail={u.userEmail} onChanged={refreshUsers} canManage={canManage} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filteredUsers.length === 0 && !usersLoading && (
              <p className={`text-xs font-semibold mt-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                {users.length === 0 ? "No users found." : "No users match the current search/filters."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── USAGE HISTORY ── */}
      {activeTab === "usage" && (
        <div className={`p-5 ${cardClass}`}>
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
            <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Usage History</h3>
            <div className="flex items-center gap-2">
              {([
                { id: "today", label: "Today" },
                { id: "7d", label: "7 Days" },
                { id: "month", label: "This Month" },
                { id: "all", label: "All" },
              ] as const).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setUsageRange(r.id);
                    refreshUsage(r.id);
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer ${
                    usageRange === r.id
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : dark
                      ? "border-white/[0.1] text-stone-300 hover:bg-white/[0.05]"
                      : "border-stone-300 text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => refreshUsage(usageRange)}
                title="Refresh"
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${usageLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {usageError && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{usageError}</span>
            </div>
          )}

          <div className={`flex flex-wrap items-end gap-3 mb-3 p-3 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-stone-50/70 border-stone-200"}`}>
            <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span className="flex items-center gap-1"><Search className="w-3 h-3" /> Search</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
                <input
                  type="text"
                  value={usageSearch}
                  onChange={(e) => setUsageSearch(e.target.value)}
                  placeholder="User email…"
                  className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
                    dark ? "bg-[#102236] border-[#1e3e5c] text-[#eff6ff]" : "bg-white border-stone-250 text-stone-850"
                  }`}
                />
              </div>
            </label>
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>Model</span>
              <CustomSelect
                value={usageModelFilter}
                onChange={(v) => setUsageModelFilter(v)}
                theme={theme}
                options={[{ value: "", label: "All models" }, ...usageModelOptions.map((m) => ({ value: m, label: m }))]}
              />
            </label>
            <p className={`text-[11px] font-semibold pb-1.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              {filteredUsageRows.length} of {usageRows.length} row{usageRows.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`text-left border-b ${dark ? "border-white/10 text-stone-400" : "border-stone-200 text-stone-500"}`}>
                  <th className="py-2 pr-2 font-bold w-6"></th>
                  <th className="py-2 pr-3 font-bold w-10">#</th>
                  <th className="py-2 pr-4 font-bold">When</th>
                  <th className="py-2 pr-4 font-bold">User</th>
                  <th className="py-2 pr-4 font-bold">Model</th>
                  <th className="py-2 pr-4 font-bold">Input</th>
                  <th className="py-2 pr-4 font-bold">Output</th>
                  <th className="py-2 pr-4 font-bold">Total Tokens</th>
                  <th className="py-2 pr-4 font-bold">Credits</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsageRows.map((r, i) => {
                  const isOpen = expandedUsageId === r.id;
                  const detail = usageDetails[r.id];
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => toggleUsageRow(r.id)}
                        className={`border-b cursor-pointer ${dark ? "border-white/[0.04] hover:bg-white/[0.03]" : "border-stone-100 hover:bg-stone-50"}`}
                      >
                        <td className="py-2 pr-2">
                          {isOpen ? (
                            <ChevronUp className={`w-3.5 h-3.5 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                          ) : (
                            <ChevronDown className={`w-3.5 h-3.5 ${dark ? "text-stone-400" : "text-stone-500"}`} />
                          )}
                        </td>
                        <td className={`py-2 pr-3 ${dark ? "text-stone-500" : "text-stone-400"}`}>{i + 1}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{new Date(r.createdAt).toLocaleString()}</td>
                        <td className={`py-2 pr-4 font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{r.userEmail}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>
                          {r.modelName ? (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${dark ? "border-white/20 text-stone-300" : "border-stone-300 text-stone-600"}`}>
                              {r.modelName}
                            </span>
                          ) : (
                            <span className={dark ? "text-stone-600" : "text-stone-400"}>—</span>
                          )}
                        </td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{r.inputTokens}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{r.outputTokens}</td>
                        <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{r.totalTokens}</td>
                        <td className={`py-2 pr-4 font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{r.credits}</td>
                      </tr>
                      {isOpen && (
                        <tr className={`border-b ${dark ? "border-white/[0.04] bg-white/[0.02]" : "border-stone-100 bg-surface-solid"}`}>
                          <td colSpan={9} className="py-3 px-4">
                            {usageDetailLoading === r.id && (
                              <p className={`text-[11px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>Loading query detail…</p>
                            )}
                            {usageDetailError[r.id] && (
                              <p className={`text-[11px] font-semibold ${dark ? "text-red-300" : "text-red-600"}`}>{usageDetailError[r.id]}</p>
                            )}
                            {usageDetailLoading !== r.id && !usageDetailError[r.id] && detail === null && (
                              <p className={`text-[11px] font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                                No query detail recorded for this entry (logging may have been off, or this predates detail tracking).
                              </p>
                            )}
                            {usageDetailLoading !== r.id && detail && (
                              <div className="space-y-2.5">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                                  <span className={dark ? "text-stone-400" : "text-stone-500"}>
                                    <span className="font-black">Category: </span>
                                    {detail.categoryName ?? "General"}
                                  </span>
                                  {detail.planTags.length > 0 && (
                                    <span className={dark ? "text-stone-400" : "text-stone-500"}>
                                      <span className="font-black">Plans: </span>
                                      {detail.planTags.join(", ")}
                                    </span>
                                  )}
                                  <span className={dark ? "text-stone-400" : "text-stone-500"}>
                                    <span className="font-black">Model: </span>
                                    {detail.modelName ?? "—"}
                                  </span>
                                  <span className={dark ? "text-stone-400" : "text-stone-500"}>
                                    <span className="font-black">Chunks: </span>
                                    {detail.retrievedChunkCount}
                                  </span>
                                  <span className={dark ? "text-stone-400" : "text-stone-500"}>
                                    <span className="font-black">Playbook facts: </span>
                                    {detail.playbookFactCount}
                                  </span>
                                  <span className={dark ? "text-stone-400" : "text-stone-500"}>
                                    <span className="font-black">History turns: </span>
                                    {detail.historyTurnCount}
                                  </span>
                                  {detail.latencyMs !== null && (
                                    <span className={dark ? "text-stone-400" : "text-stone-500"}>
                                      <span className="font-black">Latency: </span>
                                      {detail.latencyMs}ms
                                    </span>
                                  )}
                                  {detail.hadNoMatches && (
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border font-bold ${dark ? "bg-amber-500/10 text-amber-300 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                                      No matches found
                                    </span>
                                  )}
                                </div>

                                <div>
                                  <p className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>Question</p>
                                  <p className={`text-[11px] whitespace-pre-wrap ${dark ? "text-stone-200" : "text-stone-800"}`}>{detail.question}</p>
                                </div>

                                <div>
                                  <p className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>Answer</p>
                                  <p className={`text-[11px] whitespace-pre-wrap ${dark ? "text-stone-200" : "text-stone-800"}`}>{detail.answer}</p>
                                </div>

                                {detail.share && (
                                  <div>
                                    <p className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                                      Customer-facing draft
                                    </p>
                                    <p className={`text-[11px] whitespace-pre-wrap ${dark ? "text-stone-200" : "text-stone-800"}`}>{detail.share}</p>
                                  </div>
                                )}

                                {detail.sources.length > 0 && (
                                  <div>
                                    <p className={`text-[10px] font-black uppercase tracking-wider mb-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>Sources</p>
                                    <ul className="space-y-0.5">
                                      {detail.sources.map((s, i) => (
                                        <li key={i} className={`flex items-center gap-1.5 text-[11px] ${dark ? "text-stone-300" : "text-stone-700"}`}>
                                          <FileText className="w-3 h-3 shrink-0 opacity-60" />
                                          <span className="font-semibold">{s.title}</span>
                                          <span className={dark ? "text-stone-500" : "text-stone-400"}>
                                            ({s.categoryName} · {s.documentType})
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {usageRows.length === 0 && !usageLoading && (
              <p className={`text-xs font-semibold mt-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>No usage recorded in this range.</p>
            )}
            {usageRows.length > 0 && filteredUsageRows.length === 0 && (
              <p className={`text-xs font-semibold mt-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>No rows match the current search/filters.</p>
            )}
          </div>
        </div>
      )}

      {/* ── UNRESOLVED QUERIES ── */}
      {activeTab === "unresolved" && (
        <div className={`p-5 ${cardClass}`}>
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
            <div>
              <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Unresolved Queries</h3>
              <p className={`text-[10.5px] mt-1 max-w-2xl ${dark ? "text-stone-400" : "text-stone-500"}`}>
                Automatically recorded whenever Product Assist has nothing usable to answer a question with. Resolve by adding a Special
                Instruction (same form as Knowledge Base), or skip when no KB change is needed.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={exportUnresolvedQueries}
                disabled={exporting || !canManage}
                title={canManage ? undefined : "You don't have permission to export"}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}
              >
                <Download className={`w-3.5 h-3.5 ${exporting ? "animate-pulse" : ""}`} />
                {exporting ? "Exporting…" : "Export to Google Sheets"}
              </button>
              <button
                type="button"
                onClick={refreshUnresolvedQueries}
                title="Refresh"
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${unresolvedLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {unresolvedError && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{unresolvedError}</span>
            </div>
          )}
          {exportMessage && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{exportMessage}</span>
            </div>
          )}

          {/* Filters */}
          <div className={`flex flex-wrap items-end gap-3 mb-3 p-3 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-stone-50/70 border-stone-200"}`}>
            <label className="flex-1 min-w-[150px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>Status</span>
              <CustomSelect
                value={unresolvedStatusFilter}
                onChange={(v) => setUnresolvedStatusFilter(v as "all" | UnresolvedQueryStatus)}
                theme={theme}
                options={[
                  { value: "all", label: "All Statuses" },
                  { value: "unresolved", label: "Unresolved" },
                  { value: "resolved", label: "Resolved" },
                  { value: "skipped", label: "Skipped" },
                ]}
              />
            </label>
            <label className="flex-1 min-w-[130px] flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>Domain</span>
              <CustomSelect
                value={unresolvedDomainFilter}
                onChange={(v) => setUnresolvedDomainFilter(v as "all" | "Health" | "Term")}
                theme={theme}
                options={[
                  { value: "all", label: "Health + Term" },
                  { value: "Health", label: "Health" },
                  { value: "Term", label: "Term" },
                ]}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>From</span>
              <DateInputDMY theme={theme} value={unresolvedFrom} onChange={(v) => setUnresolvedFrom(v)} displayClassName={`${inputClass}`} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-content-muted">
              <span>To</span>
              <DateInputDMY theme={theme} value={unresolvedTo} onChange={(v) => setUnresolvedTo(v)} displayClassName={`${inputClass}`} />
            </label>
            {(unresolvedFrom || unresolvedTo) && (
              <button
                type="button"
                onClick={() => { setUnresolvedFrom(""); setUnresolvedTo(""); }}
                className={`text-[11px] font-bold underline cursor-pointer ${dark ? "text-stone-400 hover:text-stone-200" : "text-stone-500 hover:text-stone-700"}`}
              >
                Clear dates
              </button>
            )}
          </div>

          <div className="space-y-2">
            {unresolvedQueries.map((q) => (
              <div key={q.id} className={`p-3 ${rowClass}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border ${dark ? "border-white/20 text-stone-300" : "border-stone-300 text-stone-600"}`}>
                        {q.domain}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${dark ? UNRESOLVED_STATUS_STYLE[q.status].dark : UNRESOLVED_STATUS_STYLE[q.status].light}`}
                      >
                        {UNRESOLVED_STATUS_STYLE[q.status].label}
                      </span>
                      <span className={`text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>
                        {q.categoryName ?? "General"}
                        {q.planTags.length > 0 ? ` · ${q.planTags.join(", ")}` : ""}
                      </span>
                    </div>
                    <p className={`text-xs font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{q.question}</p>
                    <p className={`text-[10.5px] mt-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                      {q.userEmail} · {new Date(q.createdAt).toLocaleString()}
                      {q.status !== "unresolved" && q.resolvedBy ? ` · ${q.status === "resolved" ? "Resolved" : "Skipped"} by ${q.resolvedBy}` : ""}
                      {q.resolvedSpecialInstructionId !== null ? ` · Special Instruction #${q.resolvedSpecialInstructionId}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {q.status === "unresolved" && (
                      <>
                        {canResolveViaInstruction && (
                          <button
                            type="button"
                            onClick={() => openResolve(q)}
                            disabled={busyQueryId === q.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer disabled:opacity-50"
                          >
                            <Wrench className="w-3 h-3" />
                            Resolve
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setQueryStatus(q, "skipped")}
                            disabled={busyQueryId === q.id}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 ${dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}
                          >
                            <SkipForward className="w-3 h-3" />
                            Skip
                          </button>
                        )}
                      </>
                    )}
                    {q.status !== "unresolved" && canManage && (
                      <button
                        type="button"
                        onClick={() => setQueryStatus(q, "unresolved")}
                        disabled={busyQueryId === q.id}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 ${dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {unresolvedQueries.length === 0 && !unresolvedLoading && (
              <p className={`text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                No Unresolved Queries match the current filters.
              </p>
            )}
          </div>

          {resolvingQuery && !resolveCategoriesLoading && (
            <SpecialInstructionFormModal
              theme={theme}
              domain={resolvingQuery.domain}
              categories={resolveCategories}
              initialForm={resolveInitialForm}
              onClose={() => setResolvingQuery(null)}
              onSaved={handleResolveSaved}
            />
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {activeTab === "settings" && (
        <div className={`p-5 ${cardClass}`}>
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
            <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Settings</h3>
            <button
              type="button"
              onClick={refreshSettings}
              title="Refresh"
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${settingsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {settingsError && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{settingsError}</span>
            </div>
          )}

          <div className="mb-5">
            <div className="flex items-center justify-between pb-2 mb-1">
              <div>
                <div className={`text-xs font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Eligibility Groups</div>
                <p className={`text-[10.5px] mt-1 max-w-2xl ${dark ? "text-stone-400" : "text-stone-500"}`}>
                  Each group grants its own daily/monthly credit allowance to whoever matches ALL of its set conditions
                  (leave a condition on "Any" to ignore it). A user can match more than one group — the highest limit wins
                  on each of daily/monthly, independently. A user who matches no group gets no credits.
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={addEligibilityGroup}
                  disabled={addingGroup}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {addingGroup ? "Adding…" : "Add Group"}
                </button>
              )}
            </div>

            {eligibilityGroupsError && (
              <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{eligibilityGroupsError}</span>
              </div>
            )}

            <div className="space-y-2.5">
              {eligibilityGroups.map((g) => (
                <div key={g.id}>
                  <EligibilityGroupRow
                    theme={theme}
                    group={g}
                    departments={departments}
                    orgTeams={orgTeams}
                    roles={roles}
                    canManage={canManage}
                    defaultEditing={g.id === newlyAddedGroupId}
                    onChanged={refreshEligibilityGroups}
                  />
                </div>
              ))}
              {eligibilityGroups.length === 0 && !eligibilityGroupsLoading && (
                <p className={`text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>
                  No eligibility groups yet — everyone gets zero credits until you add one, or grant a per-user
                  override/extra-credits from the Users tab.
                </p>
              )}
            </div>
          </div>

          {settings && !editingSettings && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Tokens per Credit", value: settings.tokensPerCredit },
                  { label: "Warning Threshold (%)", value: settings.warningThresholdPercent },
                  { label: "Budget Warning Threshold (%)", value: settings.budgetWarningThresholdPercent },
                  { label: "Currency", value: settings.currency },
                  { label: "Monthly Budget", value: settings.monthlyBudget },
                  { label: "Model (cost estimate only)", value: settings.modelName },
                ].map((f) => (
                  <div key={f.label}>
                    <div className={labelClass}>{f.label}</div>
                    <div className={`mt-1 text-xs font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{f.value}</div>
                  </div>
                ))}
                <div>
                  <div className={labelClass}>Input Price / 1M Tokens</div>
                  <div className="mt-1">
                    <UsdWithInr amount={settings.inputPricePerMillionTokens} dark={dark} />
                  </div>
                </div>
                <div>
                  <div className={labelClass}>Output Price / 1M Tokens</div>
                  <div className="mt-1">
                    <UsdWithInr amount={settings.outputPricePerMillionTokens} dark={dark} />
                  </div>
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-3 mt-5 pt-4 border-t border-light-stone/5 dark:border-stone-800">
                  <button
                    type="button"
                    onClick={() => setEditingSettings(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit Settings
                  </button>
                  {settingsSaved && <span className={`text-xs font-bold ${dark ? "text-emerald-300" : "text-emerald-600"}`}>Saved.</span>}
                </div>
              )}
            </div>
          )}

          {settingsDraft && editingSettings && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { key: "tokensPerCredit", label: "Tokens per Credit" },
                  { key: "warningThresholdPercent", label: "Warning Threshold (%)" },
                  { key: "budgetWarningThresholdPercent", label: "Budget Warning Threshold (%)" },
                ].map((f) => (
                  <div key={f.key}>
                    <label className={labelClass}>{f.label}</label>
                    <input
                      type="number"
                      min={0}
                      className={`${inputClass} mt-1`}
                      value={(settingsDraft as any)[f.key]}
                      onChange={(e) => setSettingsDraft({ ...settingsDraft, [f.key]: Number(e.target.value) } as QuotaSettings)}
                    />
                  </div>
                ))}
                <div>
                  <label className={labelClass}>Currency</label>
                  <input
                    type="text"
                    className={`${inputClass} mt-1`}
                    value={settingsDraft.currency}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, currency: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Monthly Budget</label>
                  <input
                    type="number"
                    min={0}
                    className={`${inputClass} mt-1`}
                    value={settingsDraft.monthlyBudget}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, monthlyBudget: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Model (cost estimate only)</label>
                  <input
                    type="text"
                    className={`${inputClass} mt-1`}
                    value={settingsDraft.modelName}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, modelName: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Input Price / 1M Tokens (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${inputClass} mt-1`}
                    value={settingsDraft.inputPricePerMillionTokens}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, inputPricePerMillionTokens: e.target.value })}
                  />
                  {Number.isFinite(Number(settingsDraft.inputPricePerMillionTokens)) && (
                    <div className={`text-[10px] mt-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      ≈ {formatInr(Number(settingsDraft.inputPricePerMillionTokens))}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Output Price / 1M Tokens (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${inputClass} mt-1`}
                    value={settingsDraft.outputPricePerMillionTokens}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, outputPricePerMillionTokens: e.target.value })}
                  />
                  {Number.isFinite(Number(settingsDraft.outputPricePerMillionTokens)) && (
                    <div className={`text-[10px] mt-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>
                      ≈ {formatInr(Number(settingsDraft.outputPricePerMillionTokens))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 mt-5 pt-4 border-t border-light-stone/5 dark:border-stone-800">
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={settingsSaving || !settingsDraft}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  {settingsSaving ? "Saving…" : "Save Settings"}
                </button>
                <button
                  type="button"
                  onClick={cancelSettingsEdit}
                  disabled={settingsSaving}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-bold cursor-pointer disabled:opacity-50 ${dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-light-stone/5 dark:border-stone-800">
            <div className="mb-2">
              <div className={`text-xs font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Model Pricing</div>
              <p className={`text-[10.5px] mt-1 max-w-2xl ${dark ? "text-stone-400" : "text-stone-500"}`}>
                $/million-token pricing per model, used only by the Overview tab's "Total AI Usage — All Features" cost estimate above —
                separate from the Product Assist-specific pricing set above.
              </p>
            </div>

            {modelPricingError && (
              <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{modelPricingError}</span>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className={`text-left border-b ${dark ? "border-white/10 text-stone-400" : "border-stone-200 text-stone-500"}`}>
                    <th className="py-2 pr-4 font-bold">Model</th>
                    <th className="py-2 pr-4 font-bold">Input Price / 1M Tokens (USD)</th>
                    <th className="py-2 pr-4 font-bold">Output Price / 1M Tokens (USD)</th>
                    {canManage && <th className="py-2 pr-4 font-bold"></th>}
                  </tr>
                </thead>
                <tbody>
                  {modelPricing.map((m) => {
                    const draft = modelPricingDrafts[m.modelName] ?? { input: m.inputPricePerMillionTokens, output: m.outputPricePerMillionTokens };
                    const dirty = draft.input !== m.inputPricePerMillionTokens || draft.output !== m.outputPricePerMillionTokens;
                    return (
                      <tr key={m.modelName} className={`border-b ${dark ? "border-white/[0.04]" : "border-stone-100"}`}>
                        <td className={`py-2 pr-4 font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{m.modelName}</td>
                        <td className="py-2 pr-4">
                          {canManage ? (
                            <div>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className={`${inputClass} w-28`}
                                value={draft.input}
                                onChange={(e) =>
                                  setModelPricingDrafts((prev) => ({ ...prev, [m.modelName]: { ...draft, input: e.target.value } }))
                                }
                              />
                              {Number.isFinite(Number(draft.input)) && (
                                <div className={`text-[10px] mt-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>≈ {formatInr(Number(draft.input))}</div>
                              )}
                            </div>
                          ) : (
                            <UsdWithInr amount={m.inputPricePerMillionTokens} dark={dark} />
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {canManage ? (
                            <div>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className={`${inputClass} w-28`}
                                value={draft.output}
                                onChange={(e) =>
                                  setModelPricingDrafts((prev) => ({ ...prev, [m.modelName]: { ...draft, output: e.target.value } }))
                                }
                              />
                              {Number.isFinite(Number(draft.output)) && (
                                <div className={`text-[10px] mt-1 ${dark ? "text-stone-500" : "text-stone-400"}`}>≈ {formatInr(Number(draft.output))}</div>
                              )}
                            </div>
                          ) : (
                            <UsdWithInr amount={m.outputPricePerMillionTokens} dark={dark} />
                          )}
                        </td>
                        {canManage && (
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => saveModelPricing(m.modelName)}
                                disabled={!dirty || modelPricingSavingRow === m.modelName}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <Save className="w-3 h-3" />
                                {modelPricingSavingRow === m.modelName ? "Saving…" : "Save"}
                              </button>
                              {modelPricingSavedRow === m.modelName && (
                                <span className={`text-[11px] font-bold ${dark ? "text-emerald-300" : "text-emerald-600"}`}>Saved.</span>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {modelPricing.length === 0 && !modelPricingLoading && (
                <p className={`text-xs font-semibold mt-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>No models configured yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Per-user detail panel — override editor + extra-credit grant/removal.
// Fetches its own detail on mount (status/override/grants) so the parent
// Users table stays a lightweight batched summary.
// ─────────────────────────────────────────────────────────────────────────
function UserQuotaDetailPanel({
  theme,
  userEmail,
  onChanged,
  canManage,
}: {
  theme: "light" | "dark";
  userEmail: string;
  onChanged: () => void;
  /** From the parent's hasAccess("product_assist_quota", "Editor") — disables
   * the override/grant write actions below without hiding the read-only
   * status readout. */
  canManage: boolean;
}) {
  const dark = theme === "dark";
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [override, setOverride] = useState<OverrideRow | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  // Which grant IDs are expired, computed once per load() (an event/effect
  // context, not render) — Date.now() must never be called during render
  // itself (React purity rule), so this precomputed lookup is what the
  // JSX below reads instead of calling Date.now() inline.
  const [expiredGrantIds, setExpiredGrantIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [customDaily, setCustomDaily] = useState<string>("");
  const [customMonthly, setCustomMonthly] = useState<string>("");
  const [limitsEnabled, setLimitsEnabled] = useState(true);
  const [unlimitedAccess, setUnlimitedAccess] = useState(false);

  const [grantAmount, setGrantAmount] = useState<string>("");
  const [grantReason, setGrantReason] = useState<string>("");
  const [grantExpiresAt, setGrantExpiresAt] = useState<string>("");
  const [grantSaving, setGrantSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/product-assist/quota/users/${encodeURIComponent(userEmail)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setStatus(body.status);
      setOverride(body.override);
      const loadedGrants: GrantRow[] = body.grants ?? [];
      setGrants(loadedGrants);
      const nowMs = Date.now();
      setExpiredGrantIds(new Set(loadedGrants.filter((g) => g.expiresAt && new Date(g.expiresAt).getTime() <= nowMs).map((g) => g.id)));
      setCustomDaily(body.override?.customDailyCredits != null ? String(body.override.customDailyCredits) : "");
      setCustomMonthly(body.override?.customMonthlyCredits != null ? String(body.override.customMonthlyCredits) : "");
      setLimitsEnabled(body.override?.limitsEnabled ?? true);
      setUnlimitedAccess(body.override?.unlimitedAccess ?? false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this user's quota detail.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  const saveOverride = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/product-assist/quota/users/${encodeURIComponent(userEmail)}/override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customDailyCredits: customDaily.trim() === "" ? null : parseInt(customDaily, 10),
          customMonthlyCredits: customMonthly.trim() === "" ? null : parseInt(customMonthly, 10),
          limitsEnabled,
          unlimitedAccess,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override.");
    } finally {
      setSaving(false);
    }
  };

  const resetOverride = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/product-assist/quota/users/${encodeURIComponent(userEmail)}/override`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to reset (HTTP ${res.status}).`);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset override.");
    } finally {
      setSaving(false);
    }
  };

  const submitGrant = async (sign: 1 | -1) => {
    const n = parseInt(grantAmount, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive whole number of credits.");
      return;
    }
    setGrantSaving(true);
    try {
      // Expiry only makes sense on an actual grant (sign 1) — a removal
      // (sign -1) is itself just a negative-amount ledger row, not
      // something that "expires."
      const expiresAtIso = sign === 1 && grantExpiresAt ? new Date(grantExpiresAt).toISOString() : null;
      const res = await fetch(`/api/product-assist/quota/users/${encodeURIComponent(userEmail)}/extra-credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n * sign, reason: grantReason.trim() || null, expiresAt: expiresAtIso }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed (HTTP ${res.status}).`);
      setGrantAmount("");
      setGrantReason("");
      setGrantExpiresAt("");
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update extra credits.");
    } finally {
      setGrantSaving(false);
    }
  };

  const inputClass = `w-full px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
    dark ? "bg-white/[0.04] border-white/[0.1] text-white focus:border-[var(--accent)]" : "bg-white border-stone-300 text-stone-900 focus:border-[var(--accent)]"
  }`;
  const labelClass = `text-[10.5px] font-bold uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`;
  const panelClass = `mt-2 p-4 rounded-lg border ${dark ? "bg-white/[0.015] border-white/[0.06]" : "bg-stone-50 border-stone-200"}`;

  return (
    <div className={panelClass}>
      {error && (
        <div className={`flex items-start gap-2 p-2.5 mb-3 rounded-lg border text-[11px] font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className={`text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>Loading…</p>
      ) : (
        <>
          {status && (
            <div className={`text-[10.5px] mb-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
              Currently: {status.unlimited ? "Unlimited" : `Daily ${fmtLimit(status.dailyUsed, status.dailyLimit, false)}, Monthly ${fmtLimit(status.monthlyUsed, status.monthlyLimit, false)}`}{" "}
              — extra credit balance {status.extraCredits}.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className={`text-xs font-black uppercase tracking-wider mb-2 ${dark ? "text-white" : "text-stone-900"}`}>Override</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Custom Daily Credits</label>
                  <input type="number" placeholder="Group default" className={`${inputClass} mt-1`} value={customDaily} onChange={(e) => setCustomDaily(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Custom Monthly Credits</label>
                  <input type="number" placeholder="Group default" className={`${inputClass} mt-1`} value={customMonthly} onChange={(e) => setCustomMonthly(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3">
                <label className={`flex items-center gap-1.5 text-[11px] font-bold cursor-pointer ${dark ? "text-stone-300" : "text-stone-700"}`}>
                  <input type="checkbox" checked={!limitsEnabled} onChange={(e) => setLimitsEnabled(!e.target.checked)} />
                  Disable enforcement
                </label>
                <label className={`flex items-center gap-1.5 text-[11px] font-bold cursor-pointer ${dark ? "text-stone-300" : "text-stone-700"}`}>
                  <input type="checkbox" checked={unlimitedAccess} onChange={(e) => setUnlimitedAccess(e.target.checked)} />
                  Unlimited access
                </label>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={saveOverride}
                  disabled={saving || !canManage}
                  title={canManage ? undefined : "You don't have permission to change this"}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Override"}
                </button>
                {override && (
                  <button
                    type="button"
                    onClick={resetOverride}
                    disabled={saving || !canManage}
                    title={canManage ? undefined : "You don't have permission to change this"}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 ${dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"}`}
                  >
                    <X className="w-3 h-3" />
                    Reset to Default
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className={`text-xs font-black uppercase tracking-wider mb-2 ${dark ? "text-white" : "text-stone-900"}`}>Extra Credits</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Amount</label>
                  <input type="number" min={1} className={`${inputClass} mt-1`} value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Reason (optional)</label>
                  <input type="text" className={`${inputClass} mt-1`} value={grantReason} onChange={(e) => setGrantReason(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Expires (optional — leave blank for "Grant" to never expire)</label>
                  <DateInputDMY theme={theme} displayClassName={`${inputClass} mt-1`} value={grantExpiresAt} onChange={(v) => setGrantExpiresAt(v)} />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => submitGrant(1)}
                  disabled={grantSaving || !canManage}
                  title={canManage ? undefined : "You don't have permission to change this"}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  Grant
                </button>
                <button
                  type="button"
                  onClick={() => submitGrant(-1)}
                  disabled={grantSaving || !canManage}
                  title={canManage ? undefined : "You don't have permission to change this"}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 ${dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"}`}
                >
                  <Minus className="w-3 h-3" />
                  Remove
                </button>
              </div>
              {grants.length > 0 && (
                <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
                  {grants.map((g) => {
                    const isExpired = expiredGrantIds.has(g.id);
                    return (
                      <div key={g.id} className={`text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>
                        {g.amount > 0 ? "+" : ""}
                        {g.amount} by {g.grantedBy} on {new Date(g.grantedAt).toLocaleDateString()}
                        {g.reason ? ` — ${g.reason}` : ""}
                        {g.expiresAt && (
                          <span className={`ml-1.5 font-bold ${isExpired ? (dark ? "text-rose-400" : "text-rose-600") : ""}`}>
                            {isExpired ? "· Expired" : `· Expires ${new Date(g.expiresAt).toLocaleDateString()}`}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// One eligibility group's row — name, its four optional matching conditions
// (Department/Team/Role/Tag, each with an "Any" option), its two
// independently-optional credit limits (blank = uncapped), Save and Delete.
// Defaults to a read-only summary view; an explicit Edit action reveals the
// editable form (per the user's request that Settings not present every
// field as directly, always editable). Local draft state initialized from
// `group` and re-synced whenever the group's own id/updatedAt changes (e.g.
// after Save, or another admin's concurrent edit surfaces on refresh) —
// same self-contained load/edit/save shape as UserQuotaDetailPanel above,
// just without its own fetch (the parent already has the full list loaded
// for the Settings tab).
// ─────────────────────────────────────────────────────────────────────────
function EligibilityGroupRow({
  theme,
  group,
  departments,
  orgTeams,
  roles,
  canManage,
  defaultEditing = false,
  onChanged,
}: {
  theme: "light" | "dark";
  group: EligibilityGroup;
  departments: Department[];
  orgTeams: OrgTeam[];
  roles: AppRole[];
  canManage: boolean;
  /** True for a group just created via "Add Group" — it's blank, so it
   * opens straight into the editable form rather than an empty-looking read
   * view the admin would have to click Edit on immediately anyway. */
  defaultEditing?: boolean;
  onChanged: () => void;
}) {
  const dark = theme === "dark";
  const { confirm } = useDialog();
  const [editing, setEditing] = useState(defaultEditing);
  const [draft, setDraft] = useState(group);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, group.updatedAt]);

  const dirty =
    draft.name !== group.name ||
    draft.departmentId !== group.departmentId ||
    draft.orgTeamId !== group.orgTeamId ||
    draft.roleId !== group.roleId ||
    draft.tag !== group.tag ||
    draft.dailyCredits !== group.dailyCredits ||
    draft.monthlyCredits !== group.monthlyCredits;

  const save = async () => {
    if (!draft.name.trim()) {
      setError("Name cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/product-assist/quota/eligibility-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          departmentId: draft.departmentId,
          orgTeamId: draft.orgTeamId,
          roleId: draft.roleId,
          tag: draft.tag,
          dailyCredits: draft.dailyCredits,
          monthlyCredits: draft.monthlyCredits,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save (HTTP ${res.status}).`);
      setError(null);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save this group.");
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDraft(group);
    setError(null);
    setEditing(false);
  };

  const remove = async () => {
    if (!(await confirm(`Delete the "${group.name}" eligibility group? Anyone who only qualified through it will lose that allowance immediately.`))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/product-assist/quota/eligibility-groups/${group.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to delete (HTTP ${res.status}).`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete this group.");
      setDeleting(false);
    }
  };

  const inputClass = `w-full px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
    dark ? "bg-white/[0.04] border-white/[0.1] text-white focus:border-[var(--accent)]" : "bg-white border-stone-300 text-stone-900 focus:border-[var(--accent)]"
  }`;
  const labelClass = `text-[10px] font-bold uppercase tracking-wide ${dark ? "text-stone-400" : "text-stone-500"}`;
  const valueClass = `text-xs font-semibold ${dark ? "text-white" : "text-stone-900"}`;

  const departmentName = group.departmentId != null ? departments.find((d) => d.id === group.departmentId)?.name ?? "—" : "Any";
  const orgTeamName = group.orgTeamId != null ? orgTeams.find((t) => t.id === group.orgTeamId)?.name ?? "—" : "Any";
  const roleName = group.roleId != null ? roles.find((r) => r.id === group.roleId)?.name ?? "—" : "Any";

  if (!editing) {
    return (
      <div className={`p-3.5 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.08]" : "bg-white border-stone-200"}`}>
        {error && (
          <div className={`flex items-start gap-2 p-2 mb-2.5 rounded-lg border text-[11px] font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-x-4 gap-y-2 flex-1 min-w-0">
            <div className="col-span-2 sm:col-span-4 md:col-span-6">
              <span className={`text-sm font-black ${dark ? "text-white" : "text-stone-900"}`}>{group.name}</span>
            </div>
            <div>
              <div className={labelClass}>Business Unit</div>
              <div className={valueClass}>{orgTeamName}</div>
            </div>
            <div>
              <div className={labelClass}>Department</div>
              <div className={valueClass}>{departmentName}</div>
            </div>
            <div>
              <div className={labelClass}>Role</div>
              <div className={valueClass}>{roleName}</div>
            </div>
            <div>
              <div className={labelClass}>Tag</div>
              <div className={valueClass}>{group.tag ?? "Any"}</div>
            </div>
            <div>
              <div className={labelClass}>Daily Credits</div>
              <div className={valueClass}>{group.dailyCredits ?? "Uncapped"}</div>
            </div>
            <div>
              <div className={labelClass}>Monthly Credits</div>
              <div className={valueClass}>{group.monthlyCredits ?? "Uncapped"}</div>
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Edit"
                className={`p-1.5 rounded-lg cursor-pointer transition-colors ${dark ? "text-stone-400 hover:text-white hover:bg-white/[0.08]" : "text-stone-500 hover:text-stone-900 hover:bg-stone-200"}`}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                title="Delete"
                className={`p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40 ${dark ? "text-stone-400 hover:text-red-400 hover:bg-red-500/10" : "text-stone-500 hover:text-red-600 hover:bg-red-50"}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`p-3.5 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.08]" : "bg-white border-stone-200"}`}>
      {error && (
        <div className={`flex items-start gap-2 p-2 mb-2.5 rounded-lg border text-[11px] font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_0.8fr_0.8fr] gap-2.5 items-end">
        <div>
          <label className={labelClass}>Group Name</label>
          <input
            type="text"
            className={`${inputClass} mt-1`}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Business Unit</label>
          <CustomSelect
            theme={theme}
            value={draft.orgTeamId != null ? String(draft.orgTeamId) : ""}
            onChange={(val) => setDraft({ ...draft, orgTeamId: val ? Number(val) : null })}
            triggerClassName={`${inputClass} mt-1`}
            options={[{ value: "", label: "Any" }, ...orgTeams.map((t) => ({ value: String(t.id), label: t.name }))]}
          />
        </div>
        <div>
          <label className={labelClass}>Department</label>
          <CustomSelect
            theme={theme}
            value={draft.departmentId != null ? String(draft.departmentId) : ""}
            onChange={(val) => setDraft({ ...draft, departmentId: val ? Number(val) : null })}
            triggerClassName={`${inputClass} mt-1`}
            options={[{ value: "", label: "Any" }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))]}
          />
        </div>
        <div>
          <label className={labelClass}>Role</label>
          <CustomSelect
            theme={theme}
            value={draft.roleId != null ? String(draft.roleId) : ""}
            onChange={(val) => setDraft({ ...draft, roleId: val ? Number(val) : null })}
            triggerClassName={`${inputClass} mt-1`}
            options={[{ value: "", label: "Any" }, ...roles.map((r) => ({ value: String(r.id), label: r.name }))]}
          />
        </div>
        <div>
          <label className={labelClass}>Tag</label>
          <CustomSelect
            theme={theme}
            value={draft.tag ?? ""}
            onChange={(val) => setDraft({ ...draft, tag: val || null })}
            triggerClassName={`${inputClass} mt-1`}
            options={[{ value: "", label: "Any" }, ...ADVISOR_TAG_OPTIONS.map((t) => ({ value: t, label: t }))]}
          />
        </div>
        <div>
          <label className={labelClass}>Daily Credits</label>
          <input
            type="number"
            min={0}
            placeholder="Uncapped"
            className={`${inputClass} mt-1`}
            value={draft.dailyCredits ?? ""}
            onChange={(e) => setDraft({ ...draft, dailyCredits: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <div>
          <label className={labelClass}>Monthly Credits</label>
          <input
            type="number"
            min={0}
            placeholder="Uncapped"
            className={`${inputClass} mt-1`}
            value={draft.monthlyCredits ?? ""}
            onChange={(e) => setDraft({ ...draft, monthlyCredits: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--on-action-navy)] bg-[var(--action-navy)] hover:bg-[var(--action-navy-hover)] cursor-pointer disabled:opacity-50"
        >
          <Save className="w-3 h-3" />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          disabled={saving}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 ${dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}
        >
          <X className="w-3 h-3" />
          Cancel
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-50 ${dark ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10" : "border-rose-300 text-rose-600 hover:bg-rose-50"}`}
        >
          <Trash2 className="w-3 h-3" />
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
