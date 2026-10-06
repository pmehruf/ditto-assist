/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { BookMarked, Bot } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { PedRepositoryManagement } from "../components/PedRepositoryManagement";
import { AiMappingReview } from "../components/AiMappingReview";

interface PedSuggestionsPageProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
  // Whether the caller can add/edit/delete PED entries/aliases and
  // approve/reject AI mapping suggestions — resolved from
  // hasAccess("ped_suggestions", "Editor") in App.tsx (2026-09 permission
  // architecture fix). Both sub-tabs share this single feature id.
  canManage: boolean;
}

/**
 * "PED Directory" tab content — thin wrapper page, same pattern as
 * ProfileAccessPage.tsx. The `activeTab === "ped_suggestions"` condition
 * and wrapping `<motion.div key="ped_suggestions">` stay in App.tsx (the
 * feature id / table name stayed "ped_suggestions" through the rename —
 * only the admin-facing label changed).
 *
 * Admin+ only (gated in App.tsx's sidebar/hasAccess via the
 * "ped_suggestions" feature id). "PED Library" now renders
 * PedRepositoryManagement — the `ped_repository`/`ped_aliases` schema the
 * deterministic engine actually reads when the database-backed engine (cutover,
 * 2026-07-28/29; see PED_REPOSITORY_PHASE5_CUTOVER_REPORT.md and
 * pedRepositoryLive.ts). Edits here ARE the live source of truth — no
 * separate promotion step — and also feed the Lookup page's autocomplete
 * dropdown (GET /api/ped-repository/autocomplete). The legacy
 * `ped_directory`-backed PedSuggestionsManagement component still exists
 * (its API routes are untouched) but is no longer wired into any tab.
 */
export function PedSuggestionsPage({ theme, effectiveTier, currentUser, setChangeLogs, canManage }: PedSuggestionsPageProps) {
  // Two surfaces live under PED Repository: the curated PED Library
  // (unchanged) and AI Mapping Review (review of AI-generated answers held
  // in the L2 AI Memory cache).
  const [activeSubTab, setActiveSubTab] = useState<"library" | "queue">("library");

  // Active state uses the app-wide --tab-active-bg/-text tokens (solid
  // brand navy, same as Coverage Projection Studio's Add Claim/Copy Table
  // buttons) — same tab-selection color used by every other tab toggle in
  // the app (Plan Reference, Plan Management, Activity Log). Previously a
  // one-off pale cyan "ghost" fill that didn't match any of those.
  const tabClass = (isActive: boolean) =>
    `px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer border flex items-center gap-2 ${
      isActive
        ? "bg-[var(--tab-active-bg)] border-transparent text-[var(--tab-active-text)] shadow-md"
        : theme === "dark"
        ? "bg-white/[0.03] border-white/[0.08] text-stone-400 hover:bg-white/[0.06]"
        : "bg-black/[0.02] border-black/[0.08] text-stone-500 hover:bg-black/[0.04]"
    }`;

  return (
    <div className="space-y-5 text-left">
      {/* PAGE-LEVEL HEADER — standardized app-wide (see Coverage Projection
          Studio, the reference implementation): flat, no card surface,
          accent line + title sitting directly on the page. */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${
            theme === "dark" ? "text-white" : "text-[#111827]"
          }`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: theme === "dark" ? "#00D3F3" : "#4673a9" }} />
            <span>Conditions</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Manage the list of conditions (PEDs) the system recognises, and review the AI's suggested answers before they are trusted.
            {canManage ? " Changes apply to every advisor immediately." : " Read-only — you don't have permission to make changes."}
          </p>
        </div>
      </div>

      {/* Sub-tab toggle */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setActiveSubTab("library")} className={tabClass(activeSubTab === "library")}>
          <BookMarked className="w-3.5 h-3.5 shrink-0" />
          Condition List
        </button>
        <button type="button" onClick={() => setActiveSubTab("queue")} className={tabClass(activeSubTab === "queue")}>
          <Bot className="w-3.5 h-3.5 shrink-0" />
          AI Suggestions to Review
        </button>
      </div>

      <div className="space-y-5 pb-6">
        {activeSubTab === "library" ? (
          <PedRepositoryManagement theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} canManage={canManage} />
        ) : (
          <AiMappingReview theme={theme} canReview={canManage} />
        )}
      </div>
    </div>
  );
}
