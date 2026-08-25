/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { X, ShieldQuestion, RefreshCw, KeyRound } from "lucide-react";
import { UserProfile } from "../types/user";
import { Department, FeatureAccessOverride, OrgTeam, AppRole, CustomAccessGrant } from "../types/permissions";
import { DEFAULT_FEATURE_PERMISSIONS, DEVELOPER_ONLY_FEATURES } from "../constants/featurePermissions";
import { ClippedButton } from "./ClippedButton";

type AccessLevel = "None" | "Viewer" | "Editor";
type QaRoleType = "admin" | "guide" | "mentor";
const QA_ROLE_LABEL: Record<QaRoleType, string> = { admin: "Admin", guide: "Guide", mentor: "Mentor" };
const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = { None: 0, Viewer: 1, Editor: 2 };

interface EffectiveAccessModalProps {
  theme: "light" | "dark";
  user: UserProfile;
  departments: Department[];
  orgTeams: OrgTeam[];
  roles: AppRole[];
  featureAccessOverrides: FeatureAccessOverride[];
  hiddenPages: string[];
  onClose: () => void;
}

/**
 * Resolves what `user` can actually do on one feature, and WHY — mirrors
 * App.tsx's hasAccess() check order (Developer-only hard gate → Feature
 * Visibility kill switch → Developer bypass → override → shipped default)
 * as a read-only summary. Deliberately NOT reused directly from App.tsx
 * (hasAccess() is a closure over live component state, not an exportable
 * pure function) — this is a lightweight, display-only re-derivation for
 * the "why does this person see what they see" question, not a second
 * enforcement path. Actual enforcement always stays server-side.
 */
function resolveEffectiveAccess(
  featureId: string,
  tier: UserProfile["tier"],
  overrides: FeatureAccessOverride[],
  hiddenPages: string[],
  grants: CustomAccessGrant[]
): { level: AccessLevel; source: string } {
  const isDeveloperPowerTier = tier === "Developer" || tier === "Platform Admin";
  if (DEVELOPER_ONLY_FEATURES.has(featureId)) {
    return isDeveloperPowerTier ? { level: "Editor", source: "Developer-only feature" } : { level: "None", source: "Developer-only feature" };
  }
  if (hiddenPages.includes(featureId) && !isDeveloperPowerTier) {
    return { level: "None", source: "Hidden (Feature Visibility)" };
  }
  // Only a real Developer bypasses everything from here — Platform Admin
  // (migration 0050) resolves through the registry/override path below,
  // same as App.tsx's hasAccess() / server.ts's requireFeatureAccess().
  if (tier === "Developer") return { level: "Editor", source: "Developer (full access)" };

  const perm = DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === featureId);
  if (!perm) return { level: "Editor", source: "Not a governed feature" };

  const override = overrides.find((o) => o.featureId === featureId);

  let baseLevel: AccessLevel;
  let baseSource: string;
  if (tier === "Platform Admin") {
    // No shipped per-feature default for Platform Admin — "Editor" is the
    // universal fallback when unconfigured (see schema.ts's doc comment on
    // platform_admin_access).
    baseLevel = override?.platformAdminAccess ?? "Editor";
    baseSource = override?.platformAdminAccess != null ? "Override" : "Default (Platform Admin)";
  } else {
    const shippedLevel = tier === "Admin" ? perm.adminAccess : perm.generalAccess;
    const overrideLevel = tier === "Admin" ? override?.adminAccess : override?.generalAccess;
    baseLevel = overrideLevel ?? shippedLevel;
    baseSource = overrideLevel != null ? "Override" : "Default";
  }

  // Custom Access Grants — same max-of, grant-only merge as App.tsx's
  // hasAccess(); mirrored here for display purposes only.
  const grant = grants.find((g) => g.active && g.grantType === "feature_access" && g.targetId === featureId);
  if (grant?.level && ACCESS_LEVEL_RANK[grant.level] > ACCESS_LEVEL_RANK[baseLevel]) {
    return { level: grant.level, source: "Custom Grant" };
  }
  return { level: baseLevel, source: baseSource };
}

/**
 * Read-only "what can this person actually do, and why" breakdown — one
 * modal per directory row (see ProfileAccessManagement's Effective Access
 * button). Shows Tier, Department, and QA Dashboard role at a glance, then
 * every governed feature's resolved level + source for this person's tier.
 */
export function EffectiveAccessModal({ theme, user, departments, orgTeams, roles, featureAccessOverrides, hiddenPages, onClose }: EffectiveAccessModalProps) {
  const dark = theme === "dark";
  const [qaRole, setQaRole] = useState<QaRoleType | null | undefined>(undefined); // undefined = loading
  const [grants, setGrants] = useState<CustomAccessGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/qa-dashboard/roles")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const match = Array.isArray(body.roles) ? body.roles.find((r: any) => r.email === user.email) : null;
        setQaRole(match ? match.role : null);
      })
      .catch(() => {
        if (!cancelled) setQaRole(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user.email]);

  // Full grants list is Admin+Developer+Platform-Admin-only (see server.ts's
  // GET /api/custom-access-grants) — same posture as every other admin-only
  // read this modal already does. Filtered to just this user + active below.
  useEffect(() => {
    let cancelled = false;
    setGrantsLoading(true);
    fetch("/api/custom-access-grants")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setGrants(Array.isArray(body.entries) ? body.entries : []);
      })
      .catch(() => {
        if (!cancelled) setGrants([]);
      })
      .finally(() => {
        if (!cancelled) setGrantsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.email]);

  const myActiveGrants = grants.filter((g) => g.active && g.userEmail === user.email);

  const departmentName = departments.find((d) => d.id === user.departmentId)?.name || "Unassigned";
  const teamName = orgTeams.find((t) => t.id === user.orgTeamId)?.name || "Unassigned";
  const roleName = roles.find((r) => r.id === user.roleId)?.name || "Unassigned";

  const levelBadgeClass = (level: AccessLevel) =>
    level === "Editor"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : level === "Viewer"
        ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
        : dark
          ? "bg-stone-500/15 text-stone-400 border-stone-500/30"
          : "bg-stone-500/15 text-stone-700 border-stone-500/30";

  return (
    <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 rounded-2xl border shadow-2xl ${
          dark ? "bg-[#0b1220] border-white/10" : "bg-white border-stone-200"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <ShieldQuestion className={`w-5 h-5 shrink-0 ${dark ? "text-sky-400" : "text-sky-600"}`} />
            <div>
              <h2 className={`text-sm font-black ${dark ? "text-white" : "text-stone-900"}`}>{user.name}</h2>
              <p className="text-[10.5px] font-mono text-content-muted">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg ${dark ? "hover:bg-white/10 text-stone-400" : "hover:bg-stone-100 text-stone-500"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Tier</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{user.tier}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Team</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{teamName}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>QA Dashboard</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>
              {qaRole === undefined ? <RefreshCw className="w-3 h-3 animate-spin inline" /> : qaRole ? QA_ROLE_LABEL[qaRole] : "—"}
            </p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Department</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{departmentName}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Role</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{roleName}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Custom Grants</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>
              {grantsLoading ? <RefreshCw className="w-3 h-3 animate-spin inline" /> : myActiveGrants.length}
            </p>
          </div>
        </div>

        {myActiveGrants.length > 0 && (
          <div className="mb-4">
            <p className={`text-[10px] font-black uppercase tracking-wider mb-2 flex items-center gap-1.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>
              <KeyRound className="w-3 h-3" /> Active Custom Grants
            </p>
            <div className="flex flex-col gap-1.5">
              {myActiveGrants.map((g) => (
                <div key={g.id} className={`text-[10.5px] px-2.5 py-1.5 rounded-lg border ${dark ? "border-stone-800 bg-white/[0.02] text-stone-300" : "border-stone-200 bg-stone-50/60 text-stone-700"}`}>
                  <span className="font-bold">{g.level ?? "None"}</span> access to <span className="font-mono">{DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === g.targetId)?.name || g.targetId}</span>
                  {g.note && <span className={dark ? "text-stone-500" : "text-stone-400"}> — {g.note}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className={`text-[10px] font-black uppercase tracking-wider mb-2 ${dark ? "text-stone-500" : "text-stone-400"}`}>
          Feature Access ({user.tier} tier)
        </p>
        <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
          <table className="w-full border-collapse">
            <tbody>
              {DEFAULT_FEATURE_PERMISSIONS.map((perm, idx) => {
                const { level, source } = resolveEffectiveAccess(perm.id, user.tier, featureAccessOverrides, hiddenPages, myActiveGrants);
                return (
                  <tr key={perm.id} className={`border-b last:border-b-0 ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""}`}>
                    <td className={`px-2.5 py-1.5 text-[11px] font-bold ${dark ? "text-stone-200" : "text-stone-800"}`}>{perm.name}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${levelBadgeClass(level)}`}>{level}</span>
                    </td>
                    <td className={`px-2.5 py-1.5 text-[10px] ${dark ? "text-stone-500" : "text-stone-400"}`}>{source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <ClippedButton onClick={onClose} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
            Close
          </ClippedButton>
        </div>
      </div>
    </div>
  );
}
