/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dispatch, SetStateAction } from "react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { KnowledgeBaseResourceManagement } from "../components/KnowledgeBaseResourceManagement";

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
 * General/Others bucket, extensible) with PDF upload/embedding. The Product
 * Playbook Sheet's own connection/resync controls live on the Connections
 * page (Developer Zone — see ConnectionsPage.tsx) alongside the QA
 * Dashboard's, since both are "backend plumbing, not a permission" settings;
 * this page only manages document content. Web-page crawling is still a
 * later phase.
 *
 * Previously also had a separate "Announcements" sub-tab (kb_announcements
 * — a manually-curated, always-injected override channel). Removed per
 * product decision: it duplicated the main Announcements feature without
 * ever pulling from it, and nothing had been entered into it yet. The
 * kb_announcements table/repository were left in place (unused, empty) in
 * case this is revisited later — see queryAssist.ts's SOURCE PRECEDENCE
 * comment for the current (announcement-free) precedence order.
 */
export function KnowledgeBaseManagementPage({ theme, effectiveTier, currentUser, setChangeLogs }: KnowledgeBaseManagementPageProps) {
  const dark = theme === "dark";

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Knowledge Base</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            Manage the documents "Ask the Playbook" answers advisor questions from, organized per-insurer plus a General/Others bucket.
            {effectiveTier === "Admin" || effectiveTier === "Developer" ? "" : " Read-only — Admin clearance is required to make changes."}
          </p>
        </div>
      </div>

      <KnowledgeBaseResourceManagement theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
    </div>
  );
}
