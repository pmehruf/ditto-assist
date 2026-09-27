/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Users, Building2, IdCard } from "lucide-react";
import { OrgTeam, Department, AppRole } from "../types/permissions";
import { UserProfile } from "../types/user";
import { TeamsManagement } from "./TeamsManagement";
import { DepartmentsManagement } from "./DepartmentsManagement";
import { RolesManagement } from "./RolesManagement";

interface OrganizationManagementProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  orgTeams: OrgTeam[];
  departments: Department[];
  roles: AppRole[];
  usersList: UserProfile[];
  onOrgTeamsChanged: () => void;
  onDepartmentsChanged: () => void;
  onRolesChanged: () => void;
  logAction: (actionType: string, description: string) => void;
}

type OrgCategory = "business_units" | "departments" | "roles";

/**
 * "Organization" tab — 2026-09, consolidates what used to be three separate
 * Access Control Center tabs (Business Unit, Departments, Roles) into one
 * section with a category switcher, per the Organization consolidation
 * request. This is a pure presentation/navigation change: Business Units,
 * Departments, and Roles remain three separate entity types/tables/routes
 * underneath (org_teams, departments, roles — see schema.ts) — nothing here
 * merges their data model. Each category still renders its own existing
 * management component (TeamsManagement/DepartmentsManagement/
 * RolesManagement) unmodified in behavior, just switched via the segmented
 * control below instead of three adjacent top-level tabs.
 */
export function OrganizationManagement({
  theme,
  effectiveTier,
  orgTeams,
  departments,
  roles,
  usersList,
  onOrgTeamsChanged,
  onDepartmentsChanged,
  onRolesChanged,
  logAction,
}: OrganizationManagementProps) {
  const dark = theme === "dark";
  const [category, setCategory] = useState<OrgCategory>("business_units");

  const categories: { id: OrgCategory; label: string; icon: typeof Users; count: number }[] = [
    { id: "business_units", label: "Business Units", icon: Users, count: orgTeams.length },
    { id: "departments", label: "Departments", icon: Building2, count: departments.length },
    { id: "roles", label: "Roles", icon: IdCard, count: roles.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {categories.map((c) => {
          const Icon = c.icon;
          const active = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                active
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/[0.08]"
                  : dark ? "border-stone-850 text-stone-400 hover:bg-white/[0.04]" : "border-stone-200 text-stone-500 hover:bg-stone-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {c.label}
              <span
                className={`text-[9.5px] font-black px-1.5 py-0.5 rounded-full ${
                  active
                    ? dark ? "bg-white/10 text-[var(--accent)]" : "bg-white text-[var(--accent)]"
                    : dark ? "bg-white/5 text-stone-500" : "bg-stone-100 text-stone-500"
                }`}
              >
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      {category === "business_units" && (
        <TeamsManagement theme={theme} effectiveTier={effectiveTier} orgTeams={orgTeams} usersList={usersList} onChanged={onOrgTeamsChanged} logAction={logAction} />
      )}
      {category === "departments" && (
        <DepartmentsManagement theme={theme} effectiveTier={effectiveTier} departments={departments} usersList={usersList} onChanged={onDepartmentsChanged} logAction={logAction} />
      )}
      {category === "roles" && (
        <RolesManagement theme={theme} effectiveTier={effectiveTier} roles={roles} usersList={usersList} onChanged={onRolesChanged} logAction={logAction} />
      )}
    </div>
  );
}
