/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useState, type ComponentProps } from "react";
import { BookMarked, FolderTree, History, ListOrdered, Waypoints } from "lucide-react";
import { PedSuggestionsPage } from "./PedSuggestionsPage";
import { MappingRulesPanel } from "../components/MappingRulesPanel";
import { MappingCategoriesPanel } from "../components/MappingCategoriesPanel";
import { MappingHistoryPanel } from "../components/MappingHistoryPanel";
import { TabLoadingFallback } from "../components/ErrorBoundary";

const PlanManagementPage = lazy(() => import("./PlanManagementPage").then((m) => ({ default: m.PlanManagementPage })));

type PlanPageProps = ComponentProps<typeof PlanManagementPage>;
type PedPageProps = Parameters<typeof PedSuggestionsPage>[0];

type SubView = "dictionary" | "plans" | "categories" | "rules" | "history";

interface MappingControlPageProps {
  theme: "light" | "dark";
  /** Passed straight through to the two existing screens this section now hosts (nothing was removed from them). */
  planPage: Omit<PlanPageProps, "theme" | "canManage">;
  pedPage: Omit<PedPageProps, "theme" | "canManage">;
  /** hasAccess("plan_scope", "Viewer" / "Editor") and hasAccess("ped_suggestions", "Viewer" / "Editor") from App.tsx. */
  access: { planView: boolean; planEdit: boolean; pedView: boolean; pedEdit: boolean };
}

/**
 * Mapping Control — the one admin section for the declaration engine (R3/R9). It hosts, as sub-views, everything that
 * used to live on two separate pages plus the new rule / category administration:
 *
 *   PED Library & AI Review  (was: PED Repository)            access: ped_suggestions
 *   Plans & Questions        (was: DA Mapping Config —         access: plan_scope
 *                             questions, category maps, plan-specific PED mappings, restrictions)
 *   Categories               (new)                              access: plan_scope (edit) / either (view)
 *   Rules                    (new — pipeline order, enable/disable, custom rules, "which rule decided this")
 *   History                  (new — every change with undo)
 *
 * Each sub-view keeps its own existing permission; a person only sees the sub-views they may use.
 */
export function MappingControlPage({ theme, planPage, pedPage, access }: MappingControlPageProps) {
  const dark = theme === "dark";
  const either = access.planView || access.pedView;
  const views: Array<{ key: SubView; label: string; Icon: typeof Waypoints; show: boolean }> = [
    { key: "dictionary", label: "PED Library & AI Review", Icon: BookMarked, show: access.pedView },
    { key: "plans", label: "Plans & Questions", Icon: Waypoints, show: access.planView },
    { key: "categories", label: "Categories", Icon: FolderTree, show: either },
    { key: "rules", label: "Rules", Icon: ListOrdered, show: either },
    { key: "history", label: "History", Icon: History, show: either },
  ];
  const visible = views.filter((v) => v.show);
  const [view, setView] = useState<SubView>(visible[0]?.key ?? "history");
  const current = visible.find((v) => v.key === view) ? view : visible[0]?.key;

  const tabClass = (active: boolean) =>
    `px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer border flex items-center gap-2 ${
      active ? "bg-[var(--tab-active-bg)] border-transparent text-[var(--tab-active-text)] shadow-md" : dark ? "bg-white/[0.03] border-white/[0.08] text-stone-400 hover:bg-white/[0.06]" : "bg-black/[0.02] border-black/[0.08] text-stone-500 hover:bg-black/[0.04]"
    }`;

  return (
    <div className="space-y-5 text-left">
      <div className="pb-3 border-b border-stone-200 dark:border-stone-800">
        <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
          <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
          <span>Mapping Control</span>
        </h1>
        <p className="text-xs mt-1 font-semibold text-content-muted">
          Everything that decides how a condition is routed, in one place: the dictionary, categories, each plan's questions and mappings, and the rules. Changes show their impact first and apply to every advisor immediately.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {visible.map((v) => (
            <button key={v.key} type="button" className={tabClass(current === v.key)} onClick={() => setView(v.key)}>
              <v.Icon className="w-3.5 h-3.5" />
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {current === "dictionary" && <PedSuggestionsPage theme={theme} canManage={access.pedEdit} {...pedPage} />}
      {current === "plans" && (
        <Suspense fallback={<TabLoadingFallback theme={theme} />}>
          <PlanManagementPage theme={theme} canManage={access.planEdit} {...planPage} />
        </Suspense>
      )}
      {current === "categories" && <MappingCategoriesPanel theme={theme} canManage={access.planEdit} />}
      {current === "rules" && <MappingRulesPanel theme={theme} canManage={access.planEdit} />}
      {current === "history" && <MappingHistoryPanel theme={theme} canManage={access.planEdit || access.pedEdit} />}
    </div>
  );
}
