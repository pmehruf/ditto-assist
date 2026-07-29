/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { BookMarked, Bot } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { PedSuggestionsManagement } from "../components/PedSuggestionsManagement";
import { AiMappingReview } from "../components/AiMappingReview";

interface PedSuggestionsPageProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

/**
 * "PED Directory" tab content — thin wrapper page, same pattern as
 * ProfileAccessPage.tsx. The `activeTab === "ped_suggestions"` condition
 * and wrapping `<motion.div key="ped_suggestions">` stay in App.tsx (the
 * feature id / table name stayed "ped_suggestions" through the rename —
 * only the admin-facing label changed).
 *
 * Admin+ only (gated in App.tsx's sidebar/hasAccess via the
 * "ped_suggestions" feature id). Manages the dropdown/autocomplete term
 * list an advisor sees while typing a PED on the Lookup page, plus an
 * optional mapping category per term. Assigning that category is LIVE —
 * see PedSuggestionsManagement.tsx and promotePedMappingOverride in
 * server.ts — it's promoted into the deterministic engine for every plan,
 * not just this directory listing.
 */
export function PedSuggestionsPage({ theme, effectiveTier, currentUser, setChangeLogs }: PedSuggestionsPageProps) {
  // Two surfaces live under PED Repository: the curated PED Library
  // (unchanged) and AI Mapping Review (review of AI-generated answers held
  // in the L2 AI Memory cache).
  const [activeSubTab, setActiveSubTab] = useState<"library" | "queue">("library");

  const tabClass = (isActive: boolean) =>
    `px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer border flex items-center gap-2 ${
      isActive
        ? theme === "dark"
          ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300"
          : "bg-cyan-50 border-cyan-300 text-cyan-800"
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
            <span>PED Repository</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Manage the application's PED repository and review AI-assisted mapping recommendations before they become part of the knowledge base.
            {effectiveTier === "Admin" || effectiveTier === "Developer" ? " Changes apply to every advisor immediately." : " Read-only — Admin clearance is required to make changes."}
          </p>
        </div>
      </div>

      {/* Sub-tab toggle */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setActiveSubTab("library")} className={tabClass(activeSubTab === "library")}>
          <BookMarked className="w-3.5 h-3.5 shrink-0" />
          PED Library
        </button>
        <button type="button" onClick={() => setActiveSubTab("queue")} className={tabClass(activeSubTab === "queue")}>
          <Bot className="w-3.5 h-3.5 shrink-0" />
          AI Mapping Review
        </button>
      </div>

      <div className="space-y-5 pb-6">
        {activeSubTab === "library" ? (
          <PedSuggestionsManagement theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
        ) : (
          <AiMappingReview theme={theme} effectiveTier={effectiveTier} />
        )}
      </div>
    </div>
  );
}
