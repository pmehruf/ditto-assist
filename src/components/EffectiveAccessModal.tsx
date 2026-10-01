/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { X, ShieldQuestion, RefreshCw, KeyRound } from "lucide-react";
import { UserProfile } from "../types/user";
import { Department, FeatureAccessOverride, OrgTeam, AppRole, CustomAccessGrant, AccessRule } from "../types/permissions";
import { DEFAULT_FEATURE_PERMISSIONS } from "../constants/featurePermissions";
import { resolveAccess, type AccessLevel } from "../accessRuleEvaluator";
import { ClippedButton } from "./ClippedButton";

type QaRoleType = "admin" | "guide" | "mentor";
const QA_ROLE_LABEL: Record<QaRoleType, string> = { admin: "Admin", guide: "Guide", mentor: "Mentor" };

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
  const [rules, setRules] = useState<AccessRule[]>([]);
  const [groupFeatureLevels, setGroupFeatureLevels] = useState<Record<string, "Viewer" | "Editor"> | null>(null);

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

  // Full Access Rules list is Admin+Developer+Platform-Admin-only (see
  // server.ts's GET /api/access-rules) — same posture as the grants fetch
  // above. Unlike grants, rules aren't filtered by userEmail server-side
  // (a rule has no owner) — resolveAccess() below does the actual
  // Team/Department/Role/Product Tag matching against `user`'s own
  // attributes, same as it does for the signed-in caller elsewhere.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/access-rules")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setRules(Array.isArray(body.entries) ? body.entries : []);
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // This user's Group Access grants (2026-09f) — GET /api/group-access/
  // effective/:email, the arbitrary-user counterpart to GET /api/
  // my-group-access. Admin+Developer-gated server-side, same posture as the
  // grants/rules fetches above. Without this, resolveAccess() below would
  // silently omit Group Access's contribution entirely — both the raise it
  // was always missing and, since 2026-09f, the restriction it can now also
  // apply to this user's General/Admin-tier features.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/group-access/effective/${encodeURIComponent(user.email)}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setGroupFeatureLevels(body.featureLevels ?? null);
      })
      .catch(() => {
        if (!cancelled) setGroupFeatureLevels(null);
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
        className={`w-full max-w-lg vp-modal vp-scroll p-6 rounded-2xl border shadow-2xl ${
          dark ? "bg-[#0b1220] border-white/10" : "bg-[#ffffff] border-stone-200"
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
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Tier</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{user.tier}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Business Unit</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{teamName}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>QA Dashboard</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>
              {qaRole === undefined ? <RefreshCw className="w-3 h-3 animate-spin inline" /> : qaRole ? QA_ROLE_LABEL[qaRole] : "—"}
            </p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Department</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{departmentName}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${dark ? "text-stone-500" : "text-stone-400"}`}>Role</p>
            <p className={`text-xs font-bold mt-0.5 ${dark ? "text-white" : "text-stone-900"}`}>{roleName}</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${dark ? "border-stone-800 bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
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
                <div key={g.id} className={`text-[10.5px] px-2.5 py-1.5 rounded-lg border ${dark ? "border-stone-800 bg-white/[0.02] text-stone-300" : "border-stone-200 bg-surface-solid text-stone-700"}`}>
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
        <div className={`rounded-xl border vp-table-wrap ${dark ? "border-stone-850" : "border-stone-200"}`}>
          <table className="w-full border-collapse">
            <tbody>
              {DEFAULT_FEATURE_PERMISSIONS.map((perm, idx) => {
                // Same evaluator App.tsx's hasAccess() and server.ts's
                // requireFeatureAccess() call (see accessRuleEvaluator.ts) —
                // this is a read-only re-derivation for THIS user (not the
                // signed-in admin viewing this modal), not a second
                // enforcement path. Actual enforcement always stays
                // server-side.
                const { level, source } = resolveAccess({
                  featureId: perm.id,
                  tier: user.tier,
                  featureDefaults: DEFAULT_FEATURE_PERMISSIONS,
                  overrides: featureAccessOverrides,
                  hiddenPages,
                  grants: myActiveGrants,
                  accessRules: rules,
                  caller: { orgTeamId: user.orgTeamId, departmentId: user.departmentId, roleId: user.roleId, tags: user.tags },
                  groupFeatureLevels,
                });
                return (
                  <tr key={perm.id} className={`border-b last:border-b-0 ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""}`}>
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
