/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck, AlertTriangle, Workflow, Power, Pencil, Save, X, RefreshCw, Search } from "lucide-react";
import { AccessRule, Department, OrgTeam, AppRole } from "../types/permissions";
import { DEFAULT_FEATURE_PERMISSIONS } from "../constants/featurePermissions";
import { ADVISOR_TAG_OPTIONS } from "./AdvisorTagCheckboxes";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";

interface AccessRulesManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  departments: Department[];
  orgTeams: OrgTeam[];
  roles: AppRole[];
}

type GrantedLevel = "Viewer" | "Editor";

interface RuleFormState {
  name: string;
  resourceKey: string;
  orgTeamId: string; // "" = Any (don't care)
  departmentId: string;
  roleId: string;
  productTag: string;
  grantedLevel: GrantedLevel;
}

const EMPTY_FORM: RuleFormState = { name: "", resourceKey: "", orgTeamId: "", departmentId: "", roleId: "", productTag: "", grantedLevel: "Viewer" };

/**
 * "Access Rules" tab — Access Control Center Phase 2
 * (docs/ACCESS_CONTROL_CENTER_PHASE_PLAN.md). A rule is a population-level
 * grant: "anyone whose Team/Department/Role/Product Tag matches every
 * condition set below gets this level on this feature" (see schema.ts's
 * doc comment on `access_rules`). Every condition left as "Any" is a
 * "don't care" for that dimension — a rule with every condition set to Any
 * matches everyone.
 *
 * CRUD only, same as this page's other catalog tabs. Access Control Center
 * Phase 3 wired the shared evaluator (src/accessRuleEvaluator.ts) into real
 * enforcement, so creating or editing a rule here takes effect immediately
 * for anyone it matches.
 */
export function AccessRulesManagement({ theme, effectiveTier, departments, orgTeams, roles }: AccessRulesManagementProps) {
  const dark = theme === "dark";
  const canEdit = effectiveTier === "Developer" || effectiveTier === "Platform Admin";

  const [rules, setRules] = useState<AccessRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadRules = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/access-rules");
      const body = await res.json().catch(() => ({}));
      if (res.ok) setRules(body.entries || []);
    } catch (_) {
      // Best-effort — leaves whatever was last successfully loaded.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<RuleFormState>(EMPTY_FORM);

  const resetCreateForm = () => {
    setCreating(false);
    setForm(EMPTY_FORM);
    setActionError(null);
  };

  const toPayload = (f: RuleFormState) => ({
    name: f.name.trim(),
    resourceKey: f.resourceKey,
    orgTeamId: f.orgTeamId ? Number(f.orgTeamId) : null,
    departmentId: f.departmentId ? Number(f.departmentId) : null,
    roleId: f.roleId ? Number(f.roleId) : null,
    productTag: f.productTag || null,
    grantedLevel: f.grantedLevel,
  });

  const createRule = async () => {
    if (!form.name.trim() || !form.resourceKey) {
      setActionError("A name and a resource are both required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/access-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to create this rule (HTTP ${res.status}).`);
      resetCreateForm();
      await loadRules();
    } catch (err: any) {
      setActionError(err.message || "Failed to create this rule.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (rule: AccessRule) => {
    setEditingId(rule.id);
    setEditForm({
      name: rule.name,
      resourceKey: rule.resourceKey,
      orgTeamId: rule.orgTeamId != null ? String(rule.orgTeamId) : "",
      departmentId: rule.departmentId != null ? String(rule.departmentId) : "",
      roleId: rule.roleId != null ? String(rule.roleId) : "",
      productTag: rule.productTag || "",
      grantedLevel: rule.grantedLevel === "Editor" ? "Editor" : "Viewer",
    });
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const saveEdit = async (rule: AccessRule) => {
    if (!editForm.name.trim() || !editForm.resourceKey) {
      setActionError("A name and a resource are both required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/access-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(editForm)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save changes (HTTP ${res.status}).`);
      cancelEdit();
      await loadRules();
    } catch (err: any) {
      setActionError(err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule: AccessRule) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/access-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to update this rule (HTTP ${res.status}).`);
      await loadRules();
    } catch (err: any) {
      setActionError(err.message || "Failed to update this rule.");
    } finally {
      setSaving(false);
    }
  };

  const featureLabel = (id: string) => DEFAULT_FEATURE_PERMISSIONS.find((p) => p.id === id)?.name || id;
  const teamLabel = (id: number | null) => (id == null ? null : orgTeams.find((t) => t.id === id)?.name || `Business Unit #${id}`);
  const departmentLabel = (id: number | null) => (id == null ? null : departments.find((d) => d.id === id)?.name || `Department #${id}`);
  const roleLabel = (id: number | null) => (id == null ? null : roles.find((r) => r.id === id)?.name || `Role #${id}`);

  const conditionSummary = (rule: AccessRule): string => {
    const parts = [
      teamLabel(rule.orgTeamId) && `Business Unit: ${teamLabel(rule.orgTeamId)}`,
      departmentLabel(rule.departmentId) && `Department: ${departmentLabel(rule.departmentId)}`,
      roleLabel(rule.roleId) && `Role: ${roleLabel(rule.roleId)}`,
      rule.productTag && `Tag: ${rule.productTag}`,
    ].filter(Boolean) as string[];
    return parts.length ? parts.join(" · ") : "Anyone (no conditions set)";
  };

  const levelBadgeClass = (lvl: "None" | "Viewer" | "Editor") =>
    lvl === "Editor"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : "bg-sky-500/15 text-sky-400 border-sky-500/30";

  const inputClass = `w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1.5 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;

  const activeRules = rules.filter((r) => r.active);
  const inactiveRules = rules.filter((r) => !r.active);

  const [search, setSearch] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");

  const visibleActiveRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeRules.filter((r) => {
      if (resourceFilter && r.resourceKey !== resourceFilter) return false;
      if (q) {
        const text = `${r.name} ${featureLabel(r.resourceKey)} ${conditionSummary(r)}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRules, search, resourceFilter, orgTeams, departments, roles]);

  const renderConditionFields = (state: RuleFormState, setState: (f: RuleFormState) => void) => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
        Business Unit
        <CustomSelect
          theme={theme}
          value={state.orgTeamId}
          onChange={(v) => setState({ ...state, orgTeamId: v })}
          triggerClassName={selectTriggerClass}
          options={[{ value: "", label: "Any" }, ...orgTeams.map((t) => ({ value: String(t.id), label: t.name }))]}
        />
      </label>
      <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
        Department
        <CustomSelect
          theme={theme}
          value={state.departmentId}
          onChange={(v) => setState({ ...state, departmentId: v })}
          triggerClassName={selectTriggerClass}
          options={[{ value: "", label: "Any" }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))]}
        />
      </label>
      <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
        Role
        <CustomSelect
          theme={theme}
          value={state.roleId}
          onChange={(v) => setState({ ...state, roleId: v })}
          triggerClassName={selectTriggerClass}
          options={[{ value: "", label: "Any" }, ...roles.map((r) => ({ value: String(r.id), label: r.name }))]}
        />
      </label>
      <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
        Product Tag
        <CustomSelect
          theme={theme}
          value={state.productTag}
          onChange={(v) => setState({ ...state, productTag: v })}
          triggerClassName={selectTriggerClass}
          options={[{ value: "", label: "Any" }, ...ADVISOR_TAG_OPTIONS.map((t) => ({ value: t, label: t }))]}
        />
      </label>
    </div>
  );

  return (
    <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {activeRules.length} active {activeRules.length === 1 ? "rule" : "rules"}
          </span>
          {canEdit && !creating && (
            <ClippedButton
              type="button"
              onClick={() => setCreating(true)}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              New Rule
            </ClippedButton>
          )}
        </div>

        {actionError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {actionError}
          </div>
        )}

        {creating && (
          <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-surface-solid"}`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Name
                <input className={inputClass} placeholder="e.g. Bliss Health Advisors" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Resource
                <CustomSelect
                  theme={theme}
                  value={form.resourceKey}
                  onChange={(v) => setForm({ ...form, resourceKey: v })}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "Select..." }, ...DEFAULT_FEATURE_PERMISSIONS.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </label>
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Grants
                <CustomSelect
                  theme={theme}
                  value={form.grantedLevel}
                  onChange={(v) => setForm({ ...form, grantedLevel: v as GrantedLevel })}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "Viewer", label: "Viewer" }, { value: "Editor", label: "Editor" }]}
                />
              </label>
            </div>
            {renderConditionFields(form, setForm)}
            <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
              Everyone matching every condition set above (leave a dimension "Any" to skip it) gets this level on this resource, effective immediately. This can only raise access, never lower it.
            </p>
            <div className="flex items-center gap-2">
              <ClippedButton onClick={createRule} disabled={saving} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? "Saving..." : "Save"}
              </ClippedButton>
              <ClippedButton onClick={resetCreateForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                Cancel
              </ClippedButton>
            </div>
          </div>
        )}

        {loading ? (
          <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading rules...
          </span>
        ) : activeRules.length === 0 && !creating ? (
          <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            No active access rules. {canEdit ? "Create one to get started." : "The Developer hasn't created any yet."}
          </p>
        ) : (
          <>
          {activeRules.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, resource, or condition…"
                  className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11px] font-semibold outline-none ${
                    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
                  }`}
                />
              </div>
              <div className="min-w-[170px]">
                <CustomSelect
                  theme={theme}
                  value={resourceFilter}
                  onChange={setResourceFilter}
                  triggerClassName={selectTriggerClass}
                  options={[{ value: "", label: "All resources" }, ...DEFAULT_FEATURE_PERMISSIONS.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </div>
            </div>
          )}
          {visibleActiveRules.length === 0 ? (
            <p className={`px-3 py-8 text-center text-xs font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
              No rules match the current search/filters.
            </p>
          ) : (
          <div className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
            <table className="w-full border-collapse">
              <tbody>
                {visibleActiveRules.map((rule, idx) => {
                  const isEditing = canEdit && editingId === rule.id;
                  return (
                    <tr key={rule.id} className={`border-b last:border-b-0 align-top ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-surface-solid") : ""}`}>
                      <td className="px-3 py-2.5 w-8">
                        <Workflow className={`w-3.5 h-3.5 mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`} />
                      </td>
                      <td className="px-3 py-2.5">
                        {isEditing ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <input className={inputClass} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Name" />
                              <CustomSelect
                                theme={theme}
                                value={editForm.resourceKey}
                                onChange={(v) => setEditForm({ ...editForm, resourceKey: v })}
                                triggerClassName={selectTriggerClass}
                                options={DEFAULT_FEATURE_PERMISSIONS.map((p) => ({ value: p.id, label: p.name }))}
                              />
                              <CustomSelect
                                theme={theme}
                                value={editForm.grantedLevel}
                                onChange={(v) => setEditForm({ ...editForm, grantedLevel: v as GrantedLevel })}
                                triggerClassName={selectTriggerClass}
                                options={[{ value: "Viewer", label: "Viewer" }, { value: "Editor", label: "Editor" }]}
                              />
                            </div>
                            {renderConditionFields(editForm, setEditForm)}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`font-black text-xs ${dark ? "text-white" : "text-stone-900"}`}>{rule.name}</span>
                              <span className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>&rarr; {featureLabel(rule.resourceKey)}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border whitespace-nowrap ${levelBadgeClass(rule.grantedLevel)}`}>
                                {rule.grantedLevel}
                              </span>
                            </div>
                            <p className={`text-[10.5px] mt-0.5 ${dark ? "text-stone-500" : "text-stone-400"}`}>{conditionSummary(rule)}</p>
                            <p className={`text-[9.5px] mt-0.5 font-mono ${dark ? "text-stone-600" : "text-stone-400"}`}>
                              Created by {rule.createdBy}
                            </p>
                          </>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2.5 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <ClippedButton onClick={() => saveEdit(rule)} disabled={saving} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" title="Save">
                                <Save className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton onClick={cancelEdit} cornerBg={dark ? "#0e2236" : "#ffffff"} className="p-1.5 bg-stone-700 hover:bg-stone-600 text-stone-50" title="Cancel">
                                <X className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <ClippedButton
                                onClick={() => startEdit(rule)}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-sky-500/15 text-stone-400 hover:text-sky-400" : "hover:bg-sky-500/10 text-stone-500 hover:text-sky-600"}`}
                                title="Edit rule"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </ClippedButton>
                              <ClippedButton
                                onClick={() => toggleActive(rule)}
                                disabled={saving}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-amber-500/15 text-stone-400 hover:text-amber-400" : "hover:bg-amber-500/10 text-stone-500 hover:text-amber-600"}`}
                                title="Deactivate"
                              >
                                <Power className="w-3.5 h-3.5" />
                              </ClippedButton>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
          </>
        )}

        {inactiveRules.length > 0 && (
          <p className={`text-[10.5px] font-semibold ${dark ? "text-stone-500" : "text-stone-400"}`}>
            {inactiveRules.length} deactivated {inactiveRules.length === 1 ? "rule remains" : "rules remain"} in the audit trail (not shown above).
          </p>
        )}

        <p className="text-[10.5px] font-semibold text-content-muted">
          {canEdit
            ? "Access Rules are a population-level, condition-based grant — everyone matching a rule's Business Unit/Department/Role/Product Tag gets its level, additively on top of their tier."
            : "Admin clearance grants read-only visibility into access rules. Developer or Platform Admin clearance is required to create or edit them."}
        </p>
      </div>
    </div>
  );
}
