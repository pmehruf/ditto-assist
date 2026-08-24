/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, Plus, Minus, X, Save } from "lucide-react";
import { Department, OrgTeam, AppRole } from "../types/permissions";
import { CustomSelect } from "../components/CustomSelect";

interface ProductAssistQuotaPageProps {
  theme: "light" | "dark";
  /** Department/Team/Role catalogs — same lifted-in-App.tsx lists the
   * Directory tab uses (see ProfileAccessManagement), so the "Qualifying
   * Department / Team / Role" selects below always match what a Developer
   * can actually assign to a user. */
  departments: Department[];
  orgTeams: OrgTeam[];
  roles: AppRole[];
}

type QuotaBucket = "developer_unlimited" | "health_advisor" | "trial";
type QuotaState = "unlimited" | "ok" | "warning" | "at_limit";

interface QuotaStatus {
  userEmail: string;
  bucket: QuotaBucket;
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

interface QuotaSettings {
  id: string;
  defaultDailyCredits: number;
  defaultMonthlyCredits: number;
  trialMonthlyCredits: number;
  tokensPerCredit: number;
  warningThresholdPercent: number;
  monthlyBudget: string;
  budgetWarningThresholdPercent: number;
  currency: string;
  modelName: string;
  inputPricePerMillionTokens: string;
  outputPricePerMillionTokens: string;
  /** The Department/Team/Role a user must simultaneously hold (alongside
   * the Health tag) to land in the health_advisor bucket — see
   * productAssistQuota.ts's resolveQuotaBucket(). Null = unset (nobody
   * qualifies via this rule until a Developer picks all three below). */
  eligibleDepartmentId: number | null;
  eligibleOrgTeamId: number | null;
  eligibleRoleId: number | null;
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
}

const BUCKET_LABEL: Record<QuotaBucket, string> = {
  developer_unlimited: "Developer (Unlimited)",
  health_advisor: "Health Advisor",
  trial: "Trial",
};

const STATE_STYLE: Record<QuotaState, { light: string; dark: string; label: string }> = {
  unlimited: { light: "bg-sky-50 text-sky-700 border-sky-200", dark: "bg-sky-500/10 text-sky-300 border-sky-500/30", label: "Unlimited" },
  ok: { light: "bg-emerald-50 text-emerald-700 border-emerald-200", dark: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", label: "OK" },
  warning: { light: "bg-amber-50 text-amber-700 border-amber-200", dark: "bg-amber-500/10 text-amber-300 border-amber-500/30", label: "Warning" },
  at_limit: { light: "bg-rose-50 text-rose-700 border-rose-200", dark: "bg-rose-500/10 text-rose-300 border-rose-500/30", label: "At Limit" },
};

function StateBadge({ state, dark }: { state: QuotaState; dark: boolean }) {
  const s = STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${dark ? s.dark : s.light}`}>
      {s.label}
    </span>
  );
}

function fmtLimit(used: number, limit: number | null, unlimited: boolean): string {
  if (unlimited) return "Unlimited";
  if (limit === null) return `${Math.round(used * 100) / 100} / —`;
  return `${Math.round(used * 100) / 100} / ${limit}`;
}

type Tab = "overview" | "users" | "usage" | "settings";

/**
 * "AI Usage & Limits" — Product Assist Credit & Usage Management (2026-08).
 * Developer Zone, Developer/Platform Admin ONLY (see DEVELOPER_ONLY_FEATURES
 * for "product_assist_quota" in App.tsx — deliberately narrower than the
 * typical Admin-Zone gate). Every read/write here goes through
 * /api/product-assist/quota/* (server.ts), which re-checks isDeveloperPower
 * itself — this page's own tier gate is a UX convenience, not the real
 * enforcement boundary. See productAssistQuota.ts for the eligibility model
 * (Developer tier -> automatic unlimited; Health-tagged Advisors -> the
 * configurable default; everyone else -> a small trial allotment).
 */
export function ProductAssistQuotaPage({ theme, departments, orgTeams, roles }: ProductAssistQuotaPageProps) {
  const dark = theme === "dark";
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const cardClass = `rounded-2xl border ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-surface-elevated border-[#D2DFEC]"}`;
  const rowClass = `rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.06]" : "bg-white border-[#D2DFEC]"}`;

  // ── Overview ────────────────────────────────────────────────────────────
  const [overview, setOverview] = useState<any>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const refreshOverview = async () => {
    setOverviewLoading(true);
    try {
      const res = await fetch("/api/product-assist/quota/overview");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load (HTTP ${res.status}).`);
      setOverview(body);
      setOverviewError(null);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : "Could not load the usage overview.");
    } finally {
      setOverviewLoading(false);
    }
  };

  // ── Users ───────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserQuotaSummary[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

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
      setTimeout(() => setSettingsSaved(false), 2500);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  useEffect(() => {
    if (activeTab === "overview" && !overview) refreshOverview();
    if (activeTab === "users" && users.length === 0) refreshUsers();
    if (activeTab === "usage" && usageRows.length === 0) refreshUsage(usageRange);
    if (activeTab === "settings" && !settings) refreshSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
            Product Assist credit quotas, usage history, and company budget tracking. Restricted to Developer / Platform Admin.
          </p>
        </div>
      </div>

      <nav className={`flex gap-1 border-b-2 ${dark ? "border-white/10" : "border-stone-200"}`}>
        {([
          { id: "overview", label: "Overview" },
          { id: "users", label: "Users" },
          { id: "usage", label: "Usage History" },
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
            <button
              type="button"
              onClick={refreshOverview}
              title="Refresh"
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${overviewLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {overviewError && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{overviewError}</span>
            </div>
          )}

          {overview && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Credits Used Today", value: Math.round(overview.today.totalCredits * 100) / 100 },
                { label: "Credits Used This Month", value: Math.round(overview.month.totalCredits * 100) / 100 },
                { label: "Requests This Month", value: overview.month.requestCount },
                {
                  label: `Est. Cost This Month (${overview.budget.currency})`,
                  value: overview.budget.estimatedCostThisMonth,
                  sub: `of ${overview.budget.monthlyBudget} budget${
                    overview.budget.budgetUtilizationPercent !== null ? ` — ${overview.budget.budgetUtilizationPercent}%` : ""
                  }`,
                  warn: overview.budget.budgetUtilizationPercent !== null && overview.budget.budgetUtilizationPercent >= overview.budget.warningThresholdPercent,
                },
              ].map((stat) => (
                <div key={stat.label} className={`p-4 ${rowClass}`}>
                  <div className={labelClass}>{stat.label}</div>
                  <div className={`text-2xl font-black mt-1 ${stat.warn ? (dark ? "text-amber-300" : "text-amber-600") : dark ? "text-white" : "text-stone-900"}`}>
                    {stat.value}
                  </div>
                  {stat.sub && <div className={`text-[10.5px] mt-1 ${dark ? "text-stone-400" : "text-stone-500"}`}>{stat.sub}</div>}
                </div>
              ))}
            </div>
          )}
          <p className={`text-[10.5px] mt-4 ${dark ? "text-stone-400" : "text-stone-500"}`}>
            Budget tracking is visibility-only — reaching or exceeding the monthly budget never blocks Product Assist automatically.
            Per-user/per-day credit limits (below) are the actual enforcement mechanism.
          </p>
        </div>
      )}

      {/* ── USERS ── */}
      {activeTab === "users" && (
        <div className={`p-5 ${cardClass}`}>
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-light-stone/5 dark:border-stone-800">
            <h3 className={`text-sm font-black uppercase tracking-wider ${dark ? "text-white" : "text-stone-900"}`}>Users</h3>
            <button
              type="button"
              onClick={refreshUsers}
              title="Refresh"
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${dark ? "border-white/[0.08] hover:bg-white/[0.05] text-stone-300" : "border-stone-200 hover:bg-stone-100 text-stone-600"}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {usersError && (
            <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg border text-xs font-semibold ${dark ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{usersError}</span>
            </div>
          )}

          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.userEmail}>
                <div className={`flex flex-wrap items-center justify-between gap-3 p-3 ${rowClass}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold ${dark ? "text-white" : "text-stone-900"}`}>{u.name}</span>
                      <span className={`text-[10.5px] ${dark ? "text-stone-400" : "text-stone-500"}`}>{u.userEmail}</span>
                      {u.hasOverride && (
                        <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border ${dark ? "border-white/20 text-stone-300" : "border-stone-300 text-stone-600"}`}>
                          Custom
                        </span>
                      )}
                    </div>
                    <div className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                      {BUCKET_LABEL[u.bucket]} · {u.tier}
                      {u.roleName ? ` · ${u.roleName}` : ""} · Daily {fmtLimit(u.dailyUsed, u.dailyLimit, u.unlimited)} · Monthly{" "}
                      {fmtLimit(u.monthlyUsed, u.monthlyLimit, u.unlimited)}
                      {u.extraCredits !== 0 ? ` · +${u.extraCredits} extra` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StateBadge state={u.state} dark={dark} />
                    <button
                      type="button"
                      onClick={() => setExpandedEmail(expandedEmail === u.userEmail ? null : u.userEmail)}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer ${dark ? "border-white/[0.12] text-stone-200 hover:bg-white/[0.06]" : "border-stone-300 text-stone-700 hover:bg-stone-50"}`}
                    >
                      {expandedEmail === u.userEmail ? "Close" : "Manage"}
                    </button>
                  </div>
                </div>
                {expandedEmail === u.userEmail && (
                  <UserQuotaDetailPanel
                    theme={theme}
                    userEmail={u.userEmail}
                    onChanged={refreshUsers}
                  />
                )}
              </div>
            ))}
            {users.length === 0 && !usersLoading && (
              <p className={`text-xs font-semibold ${dark ? "text-stone-400" : "text-stone-500"}`}>No users found.</p>
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

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`text-left border-b ${dark ? "border-white/10 text-stone-400" : "border-stone-200 text-stone-500"}`}>
                  <th className="py-2 pr-4 font-bold">When</th>
                  <th className="py-2 pr-4 font-bold">User</th>
                  <th className="py-2 pr-4 font-bold">Input</th>
                  <th className="py-2 pr-4 font-bold">Output</th>
                  <th className="py-2 pr-4 font-bold">Total Tokens</th>
                  <th className="py-2 pr-4 font-bold">Credits</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.map((r) => (
                  <tr key={r.id} className={`border-b ${dark ? "border-white/[0.04]" : "border-stone-100"}`}>
                    <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{new Date(r.createdAt).toLocaleString()}</td>
                    <td className={`py-2 pr-4 font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{r.userEmail}</td>
                    <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{r.inputTokens}</td>
                    <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{r.outputTokens}</td>
                    <td className={`py-2 pr-4 ${dark ? "text-stone-300" : "text-stone-700"}`}>{r.totalTokens}</td>
                    <td className={`py-2 pr-4 font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{r.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {usageRows.length === 0 && !usageLoading && (
              <p className={`text-xs font-semibold mt-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>No usage recorded in this range.</p>
            )}
          </div>
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

          {settingsDraft && (
            <div className={`p-4 mb-4 rounded-lg border ${dark ? "bg-white/[0.02] border-white/[0.08]" : "bg-stone-50 border-stone-200"}`}>
              <div className={`text-xs font-black uppercase tracking-wider mb-1 ${dark ? "text-white" : "text-stone-900"}`}>
                Health Advisor Eligibility
              </div>
              <p className={`text-[10.5px] mb-3 ${dark ? "text-stone-400" : "text-stone-500"}`}>
                A user gets the Health Advisor allowance only if they hold ALL THREE of this Department, Team, and Role — AND
                have the Health tag. Leaving any of the three unset means nobody qualifies via this rule (falls back to the
                Trial allotment).
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Qualifying Department</label>
                  <CustomSelect
                    theme={theme}
                    value={settingsDraft.eligibleDepartmentId != null ? String(settingsDraft.eligibleDepartmentId) : ""}
                    onChange={(val) => setSettingsDraft({ ...settingsDraft, eligibleDepartmentId: val ? Number(val) : null })}
                    triggerClassName={`${inputClass} mt-1`}
                    options={[{ value: "", label: "Unset" }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))]}
                  />
                </div>
                <div>
                  <label className={labelClass}>Qualifying Team</label>
                  <CustomSelect
                    theme={theme}
                    value={settingsDraft.eligibleOrgTeamId != null ? String(settingsDraft.eligibleOrgTeamId) : ""}
                    onChange={(val) => setSettingsDraft({ ...settingsDraft, eligibleOrgTeamId: val ? Number(val) : null })}
                    triggerClassName={`${inputClass} mt-1`}
                    options={[{ value: "", label: "Unset" }, ...orgTeams.map((t) => ({ value: String(t.id), label: t.name }))]}
                  />
                </div>
                <div>
                  <label className={labelClass}>Qualifying Role</label>
                  <CustomSelect
                    theme={theme}
                    value={settingsDraft.eligibleRoleId != null ? String(settingsDraft.eligibleRoleId) : ""}
                    onChange={(val) => setSettingsDraft({ ...settingsDraft, eligibleRoleId: val ? Number(val) : null })}
                    triggerClassName={`${inputClass} mt-1`}
                    options={[{ value: "", label: "Unset" }, ...roles.map((r) => ({ value: String(r.id), label: r.name }))]}
                  />
                </div>
              </div>
            </div>
          )}

          {settingsDraft && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { key: "defaultDailyCredits", label: "Default Daily Credits (Health Advisor)" },
                { key: "defaultMonthlyCredits", label: "Default Monthly Credits (Health Advisor)" },
                { key: "trialMonthlyCredits", label: "Trial Monthly Credits (everyone else)" },
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
                <label className={labelClass}>Input Price / 1M Tokens</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${inputClass} mt-1`}
                  value={settingsDraft.inputPricePerMillionTokens}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, inputPricePerMillionTokens: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Output Price / 1M Tokens</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${inputClass} mt-1`}
                  value={settingsDraft.outputPricePerMillionTokens}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, outputPricePerMillionTokens: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-light-stone/5 dark:border-stone-800">
            <button
              type="button"
              onClick={saveSettings}
              disabled={settingsSaving || !settingsDraft}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5" />
              {settingsSaving ? "Saving…" : "Save Settings"}
            </button>
            {settingsSaved && <span className={`text-xs font-bold ${dark ? "text-emerald-300" : "text-emerald-600"}`}>Saved.</span>}
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
}: {
  theme: "light" | "dark";
  userEmail: string;
  onChanged: () => void;
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
                  <input type="number" placeholder="Bucket default" className={`${inputClass} mt-1`} value={customDaily} onChange={(e) => setCustomDaily(e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Custom Monthly Credits</label>
                  <input type="number" placeholder="Bucket default" className={`${inputClass} mt-1`} value={customMonthly} onChange={(e) => setCustomMonthly(e.target.value)} />
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
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save Override"}
                </button>
                {override && (
                  <button
                    type="button"
                    onClick={resetOverride}
                    disabled={saving}
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
                  <input type="date" className={`${inputClass} mt-1`} value={grantExpiresAt} onChange={(e) => setGrantExpiresAt(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => submitGrant(1)}
                  disabled={grantSaving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  Grant
                </button>
                <button
                  type="button"
                  onClick={() => submitGrant(-1)}
                  disabled={grantSaving}
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
