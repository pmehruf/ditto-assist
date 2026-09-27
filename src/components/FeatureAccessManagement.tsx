/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from "react";
import { Save, RefreshCw, AlertTriangle, ShieldCheck, Lock, RotateCcw, Search, Pencil, X } from "lucide-react";
import { DEFAULT_FEATURE_PERMISSIONS, DEVELOPER_ONLY_FEATURES } from "../constants/featurePermissions";
import { FeatureAccessOverride } from "../types/permissions";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";

type AccessLevel = "None" | "Viewer" | "Editor";
const ACCESS_LEVELS: AccessLevel[] = ["None", "Viewer", "Editor"];

interface FeatureAccessManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  overrides: FeatureAccessOverride[];
  /** Called after a successful save/reset so App.tsx's live override state
   * (the one hasAccess() actually reads) refreshes immediately, instead of
   * only taking effect on this Developer's next page load. */
  onChanged: () => void;
  logAction: (actionType: string, description: string) => void;
}

/**
 * "Permissions" tab — Developer-editable UI for feature_access_overrides,
 * the DB-backed override of DEFAULT_FEATURE_PERMISSIONS (see
 * featurePermissions.ts and App.tsx's hasAccess()). Lists every shipped
 * feature; a Developer can raise or lower General/Admin access per feature,
 * or reset a feature back to its shipped default. Admin gets a read-only
 * view — same posture as the Directory tab next to this one.
 *
 * A row still renders as locked (rather than editable) whenever its id is
 * in DEVELOPER_ONLY_FEATURES — that Set is empty as of 2026-09 (Feature
 * Visibility/Connections/Smoke Test/AI Usage & Limits all became ordinary
 * reassignable features at the user's request), so nothing renders locked
 * today. Left in place as the mechanism for the next genuinely code-level
 * (not policy-level) Developer-only feature, rather than removed.
 */
export function FeatureAccessManagement({ theme, effectiveTier, overrides, onChanged, logAction }: FeatureAccessManagementProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { generalAccess: AccessLevel; adminAccess: AccessLevel; platformAdminAccess: AccessLevel }>>({});
  // Which feature rows are currently showing the editable dropdowns — every
  // row defaults to a read-only badge view (per the user's explicit ask),
  // switching to the live CustomSelect form only once its own Edit button is
  // clicked, rather than every row always being directly editable.
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  const startEdit = (featureId: string) => setEditingIds((prev) => new Set(prev).add(featureId));
  const cancelEdit = (featureId: string) => {
    setEditingIds((prev) => {
      const next = new Set(prev);
      next.delete(featureId);
      return next;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[featureId];
      return next;
    });
  };

  const overrideById = new Map(overrides.map((o) => [o.featureId, o]));

  // Platform Admin has no shipped per-feature default in
  // DEFAULT_FEATURE_PERMISSIONS (unlike General/Admin) — a universal
  // "Editor" fallback when unconfigured, matching the resolution in
  // App.tsx's hasAccess() / server.ts's requireFeatureAccess().
  const SHIPPED_PLATFORM_ADMIN: AccessLevel = "Editor";

  // The saved baseline (override row, or the shipped default when there's no
  // override) — deliberately never looks at `drafts`, unlike rowValues()
  // below. isDirty() needs this to stay the actual "before" state so it can
  // compare against it; rowValues() previously did double duty as both "the
  // baseline" and "what to display," which meant that once a draft existed,
  // isDirty()'s own "current" value silently resolved to that same draft —
  // comparing the draft to itself and always reporting not-dirty, which kept
  // Save permanently disabled after a real edit.
  const baselineValues = (featureId: string, shippedGeneral: AccessLevel, shippedAdmin: AccessLevel) => {
    const override = overrideById.get(featureId);
    return {
      generalAccess: override?.generalAccess ?? shippedGeneral,
      adminAccess: override?.adminAccess ?? shippedAdmin,
      platformAdminAccess: override?.platformAdminAccess ?? SHIPPED_PLATFORM_ADMIN,
    };
  };

  // What to actually display for a row — the in-progress draft if one
  // exists, otherwise the saved baseline.
  const rowValues = (featureId: string, shippedGeneral: AccessLevel, shippedAdmin: AccessLevel) =>
    drafts[featureId] ?? baselineValues(featureId, shippedGeneral, shippedAdmin);

  const setDraftLevel = (
    featureId: string,
    field: "generalAccess" | "adminAccess" | "platformAdminAccess",
    value: AccessLevel,
    shippedGeneral: AccessLevel,
    shippedAdmin: AccessLevel
  ) => {
    setDrafts((prev) => {
      const base = prev[featureId] ?? rowValues(featureId, shippedGeneral, shippedAdmin);
      return { ...prev, [featureId]: { ...base, [field]: value } };
    });
  };

  const isDirty = (featureId: string, shippedGeneral: AccessLevel, shippedAdmin: AccessLevel) => {
    const draft = drafts[featureId];
    if (!draft) return false;
    const baseline = baselineValues(featureId, shippedGeneral, shippedAdmin);
    return draft.generalAccess !== baseline.generalAccess || draft.adminAccess !== baseline.adminAccess || draft.platformAdminAccess !== baseline.platformAdminAccess;
  };

  const save = async (featureId: string, name: string, shippedGeneral: AccessLevel, shippedAdmin: AccessLevel) => {
    const draft = drafts[featureId] ?? rowValues(featureId, shippedGeneral, shippedAdmin);
    // null only where the draft exactly matches the shipped default — keeps
    // the override table storing genuine overrides, not a full duplicate of
    // DEFAULT_FEATURE_PERMISSIONS.
    const generalAccess = draft.generalAccess === shippedGeneral ? null : draft.generalAccess;
    const adminAccess = draft.adminAccess === shippedAdmin ? null : draft.adminAccess;
    const platformAdminAccess = draft.platformAdminAccess === SHIPPED_PLATFORM_ADMIN ? null : draft.platformAdminAccess;
    setSavingId(featureId);
    setActionError(null);
    try {
      const res = await fetch(`/api/feature-access/${encodeURIComponent(featureId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generalAccess, adminAccess, platformAdminAccess }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save this change (HTTP ${res.status}).`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[featureId];
        return next;
      });
      setEditingIds((prev) => {
        const next = new Set(prev);
        next.delete(featureId);
        return next;
      });
      logAction(
        "Feature Access Changed",
        `Set "${name}" access to General: ${generalAccess ?? "default"}, Admin: ${adminAccess ?? "default"}, Platform Admin: ${platformAdminAccess ?? "default"}.`
      );
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to save this change.");
    } finally {
      setSavingId(null);
    }
  };

  const resetToDefault = async (featureId: string, name: string) => {
    setSavingId(featureId);
    setActionError(null);
    try {
      const res = await fetch(`/api/feature-access/${encodeURIComponent(featureId)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to reset this feature (HTTP ${res.status}).`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[featureId];
        return next;
      });
      setEditingIds((prev) => {
        const next = new Set(prev);
        next.delete(featureId);
        return next;
      });
      logAction("Feature Access Changed", `Reset "${name}" access to its shipped default.`);
      onChanged();
    } catch (err: any) {
      setActionError(err.message || "Failed to reset this feature.");
    } finally {
      setSavingId(null);
    }
  };

  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const levelBadgeClass = (level: AccessLevel) =>
    level === "Editor"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : level === "Viewer"
        ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
        : dark
          ? "bg-stone-500/15 text-stone-400 border-stone-500/30"
          : "bg-stone-500/15 text-stone-700 border-stone-500/30";
  const overriddenBadge = (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${
      dark ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200"
    }`}>
      Overridden
    </span>
  );

  const [featureSearch, setFeatureSearch] = useState("");
  const [overriddenOnly, setOverriddenOnly] = useState(false);

  const visiblePermissions = useMemo(() => {
    const q = featureSearch.trim().toLowerCase();
    return DEFAULT_FEATURE_PERMISSIONS.filter((perm) => {
      if (overriddenOnly && !overrideById.get(perm.id)) return false;
      if (q && !perm.name.toLowerCase().includes(q) && !perm.description.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureSearch, overriddenOnly, overrides]);

  return (
    <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {DEFAULT_FEATURE_PERMISSIONS.length} governed features
          </span>
        </div>

        {actionError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {actionError}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
            <input
              type="text"
              value={featureSearch}
              onChange={(e) => setFeatureSearch(e.target.value)}
              placeholder="Search features…"
              className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] font-semibold outline-none ${
                dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
              }`}
            />
          </div>
          <button
            type="button"
            onClick={() => setOverriddenOnly((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg border text-[10.5px] font-bold cursor-pointer whitespace-nowrap ${
              overriddenOnly
                ? "border-[var(--accent)] text-[var(--accent)]"
                : dark ? "border-stone-850 text-stone-400 hover:bg-white/[0.04]" : "border-stone-200 text-stone-500 hover:bg-stone-50"
            }`}
          >
            Overridden only
          </button>
        </div>

        {visiblePermissions.length === 0 ? (
          <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            No features match the current search/filters.
          </p>
        ) : (
        <div className={`rounded-xl border overflow-x-auto ${dark ? "border-stone-850" : "border-stone-200"}`}>
          <table className="w-full border-collapse min-w-[900px]">
            <thead>
              <tr className={`border-b ${dark ? "bg-white/[0.02] border-stone-850" : "bg-[var(--table-header-bg)] border-stone-200"}`}>
                <th className={`px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>Feature</th>
                <th className={`px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>General</th>
                <th className={`px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>Admin</th>
                <th className={`px-3 py-2.5 text-left text-[9.5px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>Platform Admin</th>
                {canEdit && <th className={`px-3 py-2.5 text-right text-[9.5px] font-black uppercase tracking-wider ${dark ? "text-stone-400" : "text-stone-500"}`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visiblePermissions.map((perm, idx) => {
                const locked = DEVELOPER_ONLY_FEATURES.has(perm.id);
                const values = rowValues(perm.id, perm.generalAccess, perm.adminAccess);
                const dirty = isDirty(perm.id, perm.generalAccess, perm.adminAccess);
                const overridden = !!overrideById.get(perm.id);
                const editing = editingIds.has(perm.id);
                const rowBg = idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : "";
                return (
                  <tr key={perm.id} className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${rowBg}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{perm.name}</span>
                        {locked && <Lock className={`w-3 h-3 shrink-0 ${dark ? "text-amber-400" : "text-amber-600"}`} />}
                        {!locked && overridden && overriddenBadge}
                      </div>
                      <p className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>{perm.description}</p>
                    </td>
                    {locked ? (
                      <td colSpan={canEdit ? 4 : 3} className="px-3 py-2.5">
                        <span className={`text-[10.5px] font-bold ${dark ? "text-amber-400" : "text-amber-600"}`}>
                          Always Developer-only — can't be reassigned here.
                        </span>
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2.5">
                          {canEdit && editing ? (
                            <CustomSelect
                              theme={theme}
                              value={values.generalAccess}
                              onChange={(val) => setDraftLevel(perm.id, "generalAccess", val as AccessLevel, perm.generalAccess, perm.adminAccess)}
                              triggerClassName={selectTriggerClass}
                              options={ACCESS_LEVELS.map((l) => ({ value: l, label: l }))}
                            />
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${levelBadgeClass(values.generalAccess)}`}>
                              {values.generalAccess}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {canEdit && editing ? (
                            <CustomSelect
                              theme={theme}
                              value={values.adminAccess}
                              onChange={(val) => setDraftLevel(perm.id, "adminAccess", val as AccessLevel, perm.generalAccess, perm.adminAccess)}
                              triggerClassName={selectTriggerClass}
                              options={ACCESS_LEVELS.map((l) => ({ value: l, label: l }))}
                            />
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${levelBadgeClass(values.adminAccess)}`}>
                              {values.adminAccess}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {canEdit && editing ? (
                            <CustomSelect
                              theme={theme}
                              value={values.platformAdminAccess}
                              onChange={(val) => setDraftLevel(perm.id, "platformAdminAccess", val as AccessLevel, perm.generalAccess, perm.adminAccess)}
                              triggerClassName={selectTriggerClass}
                              options={ACCESS_LEVELS.map((l) => ({ value: l, label: l }))}
                            />
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${levelBadgeClass(values.platformAdminAccess)}`}>
                              {values.platformAdminAccess}
                            </span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {editing ? (
                                <>
                                  <ClippedButton
                                    onClick={() => cancelEdit(perm.id)}
                                    disabled={savingId === perm.id}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className={`p-1.5 ${dark ? "hover:bg-stone-700 text-stone-400 hover:text-stone-200" : "hover:bg-stone-100 text-stone-500 hover:text-stone-700"}`}
                                    title="Cancel"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                  <ClippedButton
                                    onClick={() => save(perm.id, perm.name, perm.generalAccess, perm.adminAccess)}
                                    disabled={savingId === perm.id || !dirty}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                                    title="Save"
                                  >
                                    {savingId === perm.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                  </ClippedButton>
                                </>
                              ) : (
                                <>
                                  {overridden && (
                                    <ClippedButton
                                      onClick={() => resetToDefault(perm.id, perm.name)}
                                      disabled={savingId === perm.id}
                                      cornerBg={dark ? "#0e2236" : "#ffffff"}
                                      className={`p-1.5 ${dark ? "hover:bg-stone-700 text-stone-400 hover:text-stone-200" : "hover:bg-stone-100 text-stone-500 hover:text-stone-700"}`}
                                      title="Reset to shipped default"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </ClippedButton>
                                  )}
                                  <ClippedButton
                                    onClick={() => startEdit(perm.id)}
                                    cornerBg={dark ? "#0e2236" : "#ffffff"}
                                    className={`p-1.5 ${dark ? "hover:bg-stone-700 text-stone-400 hover:text-stone-200" : "hover:bg-stone-100 text-stone-500 hover:text-stone-700"}`}
                                    title="Edit"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </ClippedButton>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}

        <p className="text-[10.5px] font-semibold text-content-muted">
          {canEdit
            ? "Overriding a feature here takes effect immediately for every signed-in user of that tier. Resetting removes the override — the feature falls back to its shipped default."
            : "Admin clearance grants read-only visibility into feature access. Developer clearance is required to change it."}
        </p>
      </div>
    </div>
  );
}
