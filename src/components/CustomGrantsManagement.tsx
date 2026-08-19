/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Plus, ShieldCheck, AlertTriangle, KeyRound, Undo2, RefreshCw } from "lucide-react";
import { CustomAccessGrant } from "../types/permissions";
import { UserProfile } from "../types/user";
import { DEFAULT_FEATURE_PERMISSIONS } from "../constants/featurePermissions";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";

interface CustomGrantsManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  /** For resolving a grant's userEmail into a display name — best-effort,
   * same caveat as every other tab that reads App.tsx's usersList cache. */
  usersList: UserProfile[];
  logAction: (actionType: string, description: string) => void;
}

type AccessLevel = "None" | "Viewer" | "Editor";

/**
 * "Custom Grants" tab — the per-individual flexibility valve for when Team/
 * Department/Role structure alone doesn't fit someone (see schema.ts's doc
 * comment on `custom_access_grants`). A grant can only RAISE a person's
 * effective access above what their tier already gives them — see
 * App.tsx's hasAccess(), which takes the max of the two, never the grant
 * alone. Only "Feature Access" grants (grantType "feature_access") are
 * functional today; other grant kinds aren't wired into any enforcement
 * yet, so this tab only offers that one kind.
 *
 * Revoking (soft-delete, `active: false`) preserves the audit record of
 * what was granted and to whom — see customAccessGrantsRepository.ts.
 */
export function CustomGrantsManagement({ theme, effectiveTier, usersList, logAction }: CustomGrantsManagementProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [grants, setGrants] = useState<CustomAccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadGrants = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-access-grants");
      const body = await res.json().catch(() => ({}));
      if (res.ok) setGrants(body.entries || []);
    } catch (_) {
      // Best-effort — leaves whatever was last successfully loaded.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGrants();
  }, []);

  const [granting, setGranting] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [level, setLevel] = useState<AccessLevel>("Viewer");
  const [note, setNote] = useState("");

  const resetForm = () => {
    setGranting(false);
    setUserEmail("");
    setFeatureId("");
    setLevel("Viewer");
    setNote("");
    setActionError(null);
  };

  const createGrant = async () => {
    if (!userEmail.trim() || !featureId) {
      setActionError("A user email and a feature are both required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/custom-access-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail: userEmail.trim().toLowerCase(),
          grantType: "feature_access",
          targetId: featureId,
          level,
          note: note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this grant (HTTP ${res.status}).`);
      const featureName = DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === featureId)?.name || featureId;
      logAction("Custom Access Granted", `Granted ${userEmail.trim()} "${level}" access to "${featureName}".`);
      resetForm();
      await loadGrants();
    } catch (err: any) {
      setActionError(err.message || "Failed to create this grant.");
    } finally {
      setSaving(false);
    }
  };

  const revokeGrant = async (grant: CustomAccessGrant) => {
    if (!window.confirm(`Revoke ${grant.userEmail}'s custom grant for "${featureLabel(grant.targetId)}"?`)) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/custom-access-grants/${grant.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to revoke this grant (HTTP ${res.status}).`);
      logAction("Custom Access Revoked", `Revoked ${grant.userEmail}'s custom grant for "${featureLabel(grant.targetId)}".`);
      await loadGrants();
    } catch (err: any) {
      setActionError(err.message || "Failed to revoke this grant.");
    } finally {
      setSaving(false);
    }
  };

  const featureLabel = (id: string) => DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === id)?.name || id;
  const nameFor = (email: string) => usersList.find((u) => u.email === email)?.name || null;

  const levelBadgeClass = (lvl: AccessLevel | null) =>
    lvl === "Editor"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : lvl === "Viewer"
        ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
        : dark
          ? "bg-stone-500/15 text-stone-400 border-stone-500/30"
          : "bg-stone-500/15 text-stone-700 border-stone-500/30";

  const inputClass = `w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1.5 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;

  const activeGrants = grants.filter((g) => g.active);
  const revokedGrants = grants.filter((g) => !g.active);

  return (
    <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {activeGrants.length} active {activeGrants.length === 1 ? "grant" : "grants"}
          </span>
          {canEdit && !granting && (
            <ClippedButton
              type="button"
              onClick={() => setGranting(true)}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              New Grant
            </ClippedButton>
          )}
        </div>

        {actionError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {actionError}
          </div>
        )}

        {granting && (
          <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                User email
                <input className={inputClass} placeholder="advisor@joinditto.in" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Feature
                <CustomSelect
                  theme={theme}
                  value={featureId}
                  onChange={setFeatureId}
                  triggerClassName={selectTriggerClass}
                  options={[
                    { value: "", label: "Select..." },
                    ...DEFAULT_FEATURE_PERMISSIONS.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </label>
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Level
                <CustomSelect
                  theme={theme}
                  value={level}
                  onChange={(v) => setLevel(v as AccessLevel)}
                  triggerClassName={selectTriggerClass}
                  options={[
                    { value: "Viewer", label: "Viewer" },
                    { value: "Editor", label: "Editor" },
                  ]}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
              Note (optional — why this grant exists)
              <input className={inputClass} placeholder="e.g. Covering for another advisor's department this quarter" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
              This can only RAISE this person's access to the feature above what their tier already gives them — it never lowers it.
            </p>
            <div className="flex items-center gap-2">
              <ClippedButton onClick={createGrant} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? "Saving..." : "Grant"}
              </ClippedButton>
              <ClippedButton onClick={resetForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                Cancel
              </ClippedButton>
            </div>
          </div>
        )}

        {loading ? (
          <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading grants...
          </span>
        ) : activeGrants.length === 0 && !granting ? (
          <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            No active custom grants. {canEdit ? "Grant one to get started." : "The Developer hasn't granted any yet."}
          </p>
        ) : (
          <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
            <table className="w-full border-collapse">
              <tbody>
                {activeGrants.map((grant, idx) => (
                  <tr key={grant.id} className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""}`}>
                    <td className="px-3 py-2.5 w-8">
                      <KeyRound className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{nameFor(grant.userEmail) || grant.userEmail}</span>
                        <span className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>&rarr; {featureLabel(grant.targetId)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${levelBadgeClass(grant.level)}`}>
                          {grant.level ?? "None"}
                        </span>
                      </div>
                      {grant.note && (
                        <p className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>{grant.note}</p>
                      )}
                      <p className={`text-[9.5px] mt-0.5 font-mono ${dark ? "text-stone-600" : "text-stone-400"}`}>
                        Granted by {grant.grantedBy}
                      </p>
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2.5 text-right">
                        <ClippedButton
                          onClick={() => revokeGrant(grant)}
                          disabled={saving}
                          cornerBg={dark ? "#0e2236" : "#ffffff"}
                          className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                          title="Revoke grant"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </ClippedButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {revokedGrants.length > 0 && (
          <p className={`text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            {revokedGrants.length} previously-revoked {revokedGrants.length === 1 ? "grant remains" : "grants remain"} in the audit trail (not shown above).
          </p>
        )}

        <p className="text-[10.5px] font-semibold text-content-muted">
          {canEdit
            ? "Custom grants are the flexibility valve for when Team/Department/Role structure doesn't fit someone — a grant can only raise a person's access, never lower it below what their tier already gives them."
            : "Admin clearance grants read-only visibility into custom grants. Developer or Platform Admin clearance is required to grant or revoke them."}
        </p>
      </div>
    </div>
  );
}
