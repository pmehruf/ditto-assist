/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Search, UserPlus, Trash2, RefreshCw, AlertTriangle, ShieldCheck, Download } from "lucide-react";
import { UserProfile } from "../types/user";
import { ClippedButton } from "./ClippedButton";
import { CustomSelect } from "./CustomSelect";
import { formatDisplayTimestamp } from "../utils/timestamps";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { downloadCSV } from "../utils/csvExport";

type QaRoleType = "admin" | "guide" | "mentor";

interface QaRoleRow {
  email: string;
  role: QaRoleType;
  displayName: string | null;
  assignedBy: string;
  assignedAt: string;
}

interface QaDashboardAccessManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
}

const ROLE_LABEL: Record<QaRoleType, string> = { admin: "Admin", guide: "Guide", mentor: "Mentor" };
const ROLE_SECTIONS: { role: QaRoleType; title: string; blurb: string }[] = [
  { role: "admin", title: "Admins", blurb: "Sees every advisor on the QA Dashboard." },
  { role: "guide", title: "Guides", blurb: "Sees only their own team, matched by name in the QA sheet." },
  { role: "mentor", title: "Mentors", blurb: "Sees only their own mentees, matched by name in the QA sheet." },
];

/**
 * "QA Dashboard Access" tab — manages who holds Admin/Guide/Mentor access on
 * the QA Dashboard (src/server/qaDashboard/qaRoles.ts), backed by the
 * qa_dashboard_roles table via /api/qa-dashboard/roles. This replaced the
 * former QA_ADMIN_EMAILS/QA_GUIDE_EMAILS/QA_MENTOR_EMAILS env vars — see the
 * 2026-07-30 cutover migration (drizzle/0022_qa_dashboard_roles.sql).
 *
 * Unlike the "User Directory" tab next to this one (where editing core
 * WebApp tiers is Developer-only), both viewing and editing here are
 * Admin+Developer — QA role assignment is a narrower, QA-team-specific
 * permission, not the sensitive WebApp-tier change the rest of this page
 * gates more strictly.
 *
 * Only shows people who currently hold a role — not the full user
 * directory. To grant access, search the directory inline (server-side,
 * via GET /api/users) and assign one of the three roles.
 */
export function QaDashboardAccessManagement({ theme, effectiveTier }: QaDashboardAccessManagementProps) {
  const dark = theme === "dark";
  const canManage = effectiveTier === "Admin" || effectiveTier === "Platform Admin" || effectiveTier === "Developer";

  const [roles, setRoles] = useState<QaRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/qa-dashboard/roles");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load QA Dashboard access (HTTP ${res.status}).`);
      setRoles(Array.isArray(body.roles) ? body.roles : []);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  // --- Assign-access form: search the directory, pick a role, save ---
  const [assigning, setAssigning] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const searchQuery = useDebouncedValue(searchInput, 350);
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedRole, setSelectedRole] = useState<QaRoleType>("guide");
  const [sheetDisplayName, setSheetDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!assigning || selectedUser || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    fetch(`/api/users?paginated=1&pageSize=8&search=${encodeURIComponent(searchQuery)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSearchResults(Array.isArray(data.entries) ? data.entries : []);
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assigning, selectedUser, searchQuery]);

  const pickUser = (user: UserProfile) => {
    setSelectedUser(user);
    setSearchResults([]);
    setSearchInput(user.name);
    // Best starting guess — the QA sheet's Guide/Mentor Name column may use
    // a different name (nickname, full name, etc.), so this stays editable.
    setSheetDisplayName(user.name);
  };

  const resetAssignForm = () => {
    setAssigning(false);
    setSearchInput("");
    setSearchResults([]);
    setSelectedUser(null);
    setSelectedRole("guide");
    setSheetDisplayName("");
    setActionError(null);
  };

  const saveAssignment = async () => {
    if (!selectedUser) {
      setActionError("Search for and select a person first.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/qa-dashboard/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: selectedUser.email,
          role: selectedRole,
          displayName: selectedRole === "admin" ? null : sheetDisplayName,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to save this assignment (HTTP ${res.status}).`);
      resetAssignForm();
      await loadRoles();
    } catch (err: any) {
      setActionError(err.message || "Failed to save this assignment.");
    } finally {
      setSaving(false);
    }
  };

  const revokeAccess = async (email: string, role: QaRoleType) => {
    if (!window.confirm(`Revoke QA Dashboard ${ROLE_LABEL[role]} access for ${email}?`)) return;
    setRemovingEmail(email);
    setActionError(null);
    try {
      const res = await fetch(`/api/qa-dashboard/roles/${encodeURIComponent(email)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to revoke access (HTTP ${res.status}).`);
      setRoles((prev) => prev.filter((r) => r.email !== email));
    } catch (err: any) {
      setActionError(err.message || "Failed to revoke access.");
    } finally {
      setRemovingEmail(null);
    }
  };

  const inputClass = `w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none font-semibold ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const selectTriggerClass = `w-full flex items-center justify-between gap-1 text-[11px] pl-2 pr-6 py-1.5 rounded-lg border outline-none font-semibold relative ${
    dark ? "bg-[#060a12] border-stone-850 text-white focus:border-sky-500" : "bg-white border-stone-200 text-stone-900 focus:border-sky-400"
  }`;
  const roleBadgeClass = (role: QaRoleType) =>
    role === "admin"
      ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
      : role === "guide"
        ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
        : "bg-teal-500/15 text-teal-400 border-teal-500/30";

  return (
    <div className={`rounded-2xl border p-5 transition-all ${dark ? "bg-white/[0.03] border-white/[0.08]" : "bg-black/[0.02] border-black/[0.08]"}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            {loading ? (
              <span className={`text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Loading QA Dashboard access...
              </span>
            ) : loadError ? (
              <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-amber-500">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {loadError}
              </span>
            ) : (
              <span className="text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap text-emerald-500">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                {roles.length} {roles.length === 1 ? "person has" : "people have"} special access
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ClippedButton
              onClick={() =>
                downloadCSV(
                  roles.map((r) => ({
                    Email: r.email,
                    Role: ROLE_LABEL[r.role],
                    "Display Name": r.displayName || "",
                    "Assigned By": r.assignedBy,
                    "Assigned At": r.assignedAt ? formatDisplayTimestamp(r.assignedAt) : "",
                  })),
                  "qa-dashboard-access.csv"
                )
              }
              disabled={roles.length === 0}
              title="Export QA Dashboard access as a CSV file"
              className="flex items-center gap-1.5 px-3 py-2 text-white text-[10px] font-black uppercase tracking-wider bg-[#117FDA] hover:bg-[#0d6dbb] shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Export CSV</span>
            </ClippedButton>
            {canManage && !assigning && (
            <ClippedButton
              type="button"
              onClick={() => setAssigning(true)}
              cornerBg={dark ? "#0e2236" : "#ffffff"}
              style={{ backgroundColor: "var(--action-navy)", borderColor: "var(--action-navy)", color: "var(--on-action-navy)" }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] px-3 py-2 border hover:brightness-110 shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              Assign Access
            </ClippedButton>
            )}
          </div>
        </div>

        {actionError && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/25 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {actionError}
          </div>
        )}

        {assigning && (
          <div className={`rounded-xl border p-4 space-y-3 ${dark ? "border-white/[0.08] bg-white/[0.02]" : "border-stone-200 bg-stone-50/60"}`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted md:col-span-1 relative">
                Search the user directory
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint pointer-events-none" />
                  <input
                    className={`${inputClass} pl-7`}
                    placeholder="Name or email..."
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value);
                      setSelectedUser(null);
                    }}
                  />
                </div>
                {!selectedUser && searchInput.trim() && (
                  <ul
                    className={`absolute z-20 top-full mt-1 left-0 right-0 max-h-56 overflow-y-auto rounded-lg border shadow-lg py-1 ${
                      dark ? "bg-[#0d1c3f] border-white/10" : "bg-white border-stone-200"
                    }`}
                  >
                    {searchLoading ? (
                      <li className={`px-3 py-2 text-xs ${dark ? "text-slate-400" : "text-stone-500"}`}>Searching...</li>
                    ) : searchResults.length === 0 ? (
                      <li className={`px-3 py-2 text-xs ${dark ? "text-slate-400" : "text-stone-500"}`}>No match in the user directory.</li>
                    ) : (
                      searchResults.map((u) => (
                        <li
                          key={u.email}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickUser(u);
                          }}
                          className={`px-3 py-2 text-xs flex justify-between gap-2 cursor-pointer hover:bg-[var(--accent-subtle-bg)]`}
                        >
                          <span className="font-semibold">{u.name}</span>
                          <span className={dark ? "text-slate-400" : "text-stone-400"}>{u.email}</span>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </label>

              <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                Access level
                <CustomSelect
                  theme={theme}
                  value={selectedRole}
                  onChange={(val) => setSelectedRole(val as QaRoleType)}
                  triggerClassName={selectTriggerClass}
                  options={ROLE_SECTIONS.map((s) => ({ value: s.role, label: ROLE_LABEL[s.role] }))}
                />
              </label>

              {selectedRole !== "admin" && (
                <label className="flex flex-col gap-1 text-[10.5px] font-bold text-content-muted">
                  Name as it appears in the QA sheet
                  <input
                    className={inputClass}
                    placeholder="e.g. Ankita"
                    value={sheetDisplayName}
                    onChange={(e) => setSheetDisplayName(e.target.value)}
                  />
                </label>
              )}
            </div>

            <p className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>
              {selectedUser
                ? `Assigning ${selectedUser.name} (${selectedUser.email}) as ${ROLE_LABEL[selectedRole]}.`
                : "Everyone else keeps their normal General Advisor access — this only grants Admin/Guide/Mentor-level visibility on the QA Dashboard."}
            </p>

            <div className="flex items-center gap-2">
              <ClippedButton onClick={saveAssignment} disabled={saving || !selectedUser} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving ? "Saving..." : "Save"}
              </ClippedButton>
              <ClippedButton onClick={resetAssignForm} cornerBg={dark ? "#0e2236" : "#f0f9ff"} className="px-3 py-1.5 text-[11px] font-bold bg-stone-700 hover:bg-stone-600 text-stone-50">
                Cancel
              </ClippedButton>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {ROLE_SECTIONS.map((section) => {
            const sectionRows = roles.filter((r) => r.role === section.role);
            return (
              <div key={section.role} className={`rounded-xl border overflow-hidden ${dark ? "border-stone-850" : "border-stone-200"}`}>
                <div className={`px-3 py-2 flex items-center justify-between gap-2 border-b ${dark ? "bg-white/[0.02] border-stone-850" : "bg-stone-50 border-stone-200"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border whitespace-nowrap ${roleBadgeClass(section.role)}`}>
                      {section.title}
                    </span>
                    <span className={`text-[10.5px] ${dark ? "text-stone-500" : "text-stone-400"}`}>{section.blurb}</span>
                  </div>
                  <span className={`text-[10.5px] font-bold ${dark ? "text-stone-400" : "text-stone-500"}`}>{sectionRows.length}</span>
                </div>
                {sectionRows.length === 0 ? (
                  <p className={`px-3 py-4 text-xs ${dark ? "text-stone-500" : "text-stone-400"}`}>No one currently has {section.title.toLowerCase()} access.</p>
                ) : (
                  <table className="w-full border-collapse">
                    <tbody>
                      {sectionRows.map((row, idx) => (
                        <tr key={row.email} className={`border-b last:border-b-0 ${dark ? "border-stone-850" : "border-stone-150"} ${idx % 2 === 1 ? (dark ? "bg-white/[0.015]" : "bg-stone-50/60") : ""}`}>
                          <td className="px-3 py-2 text-xs font-mono text-content-muted whitespace-nowrap">{row.email}</td>
                          {section.role !== "admin" && (
                            <td className="px-3 py-2 text-xs font-semibold whitespace-nowrap">{row.displayName || "—"}</td>
                          )}
                          <td className={`px-3 py-2 text-[10.5px] whitespace-nowrap ${dark ? "text-stone-400" : "text-stone-500"}`}>
                            {row.assignedAt ? formatDisplayTimestamp(row.assignedAt) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canManage && (
                              <ClippedButton
                                onClick={() => revokeAccess(row.email, row.role)}
                                disabled={removingEmail === row.email}
                                cornerBg={dark ? "#0e2236" : "#ffffff"}
                                className={`p-1.5 ${dark ? "hover:bg-red-500/15 text-stone-400 hover:text-red-400" : "hover:bg-red-500/10 text-stone-500 hover:text-red-600"}`}
                                title="Revoke access"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </ClippedButton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[10.5px] font-semibold text-content-muted">
          {canManage
            ? "Everyone not listed here sees the standard General Advisor view (their own QA record only, if they have one)."
            : "Admin clearance grants read-only visibility into QA Dashboard access."}
        </p>
      </div>
    </div>
  );
}
