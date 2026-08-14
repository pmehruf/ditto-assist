/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { FolderOpen, Megaphone } from "lucide-react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { KnowledgeBaseResourceManagement } from "../components/KnowledgeBaseResourceManagement";
import { KnowledgeBaseAnnouncements } from "../components/KnowledgeBaseAnnouncements";

interface KnowledgeBaseManagementPageProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

/**
 * "Knowledge Base" tab content — thin wrapper page, same pattern as
 * PedSuggestionsPage.tsx. Admin Zone only (gated in App.tsx's sidebar/
 * hasAccess via the "knowledge_base" feature id).
 *
 * "Ask the Playbook": category-wise resource organization (per-insurer + a
 * General/Others bucket, extensible) with PDF upload/embedding, plus a
 * dated Announcements channel that always overrides older resource
 * content. The Product Playbook Sheet's own connection/resync controls
 * live on the Connections page (Developer Zone — see ConnectionsPage.tsx)
 * alongside the QA Dashboard's, since both are "backend plumbing, not a
 * permission" settings; this page only manages document/announcement
 * content. Web-page crawling is still a later phase.
 */
export function KnowledgeBaseManagementPage({ theme, effectiveTier, currentUser, setChangeLogs }: KnowledgeBaseManagementPageProps) {
  const dark = theme === "dark";
  const [activeSubTab, setActiveSubTab] = useState<"resources" | "announcements">("resources");

  const tabClass = (isActive: boolean) =>
    `px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer border flex items-center gap-2 ${
      isActive
        ? "bg-[var(--tab-active-bg)] border-transparent text-[var(--tab-active-text)] shadow-md"
        : dark
        ? "bg-white/[0.03] border-white/[0.08] text-stone-400 hover:bg-white/[0.06]"
        : "bg-black/[0.02] border-black/[0.08] text-stone-500 hover:bg-black/[0.04]"
    }`;

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Knowledge Base</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Manage the documents and announcements "Ask the Playbook" answers advisor questions from, organized per-insurer plus a General/Others bucket.
            {effectiveTier === "Admin" || effectiveTier === "Developer" ? "" : " Read-only — Admin clearance is required to make changes."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setActiveSubTab("resources")} className={tabClass(activeSubTab === "resources")}>
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          Categories & Documents
        </button>
        <button type="button" onClick={() => setActiveSubTab("announcements")} className={tabClass(activeSubTab === "announcements")}>
          <Megaphone className="w-3.5 h-3.5 shrink-0" />
          Announcements
        </button>
      </div>

      {activeSubTab === "resources" && (
        <KnowledgeBaseResourceManagement theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
      )}
      {activeSubTab === "announcements" && (
        <KnowledgeBaseAnnouncements theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
      )}
    </div>
  );
}
