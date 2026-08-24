/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { LoggedUser } from "../types/user";
import { ChangeLogEntry } from "../types/changeLog";
import { KnowledgeBaseResourceManagement } from "../components/KnowledgeBaseResourceManagement";
import { SpecialInstructions } from "../components/SpecialInstructions";
import { AcronymDictionary } from "../components/AcronymDictionary";

interface KnowledgeBaseManagementPageProps {
  theme: "light" | "dark";
  effectiveTier: "General" | "Admin" | "Platform Admin" | "Developer";
  currentUser: LoggedUser | null;
  setChangeLogs: Dispatch<SetStateAction<ChangeLogEntry[]>>;
}

type SectionKey = "documents" | "special_instructions" | "acronyms";

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
 * "Special Instructions" (added 2026-08): a dedicated section for the
 * controlled instruction-override layer Product Assist checks before
 * consulting the Documents section above — see
 * src/components/SpecialInstructions.tsx and
 * src/server/knowledgeBase/specialInstructions.ts for the full design.
 * Purely additive alongside Documents: its own section, its own tab, no
 * change to the Documents tab's own behavior or permissions.
 *
 * Previously also had a separate "Announcements" sub-tab (kb_announcements
 * — a manually-curated, always-injected override channel). Removed per
 * product decision: it duplicated the main Announcements feature without
 * ever pulling from it, and nothing had been entered into it yet. The
 * kb_announcements table/repository were left in place (unused, empty) in
 * case this is revisited later — see queryAssist.ts's SOURCE PRECEDENCE
 * comment for the current precedence order (now starting at #0 Special
 * Instructions, still announcement-free).
 *
 * "Acronym Dictionary" (added 2026-08): shorthand advisors habitually type
 * (e.g. "OS" for Optima Secure, "CBB" for Cumulative Bonus Super) mapped to
 * its full expansion — see src/components/AcronymDictionary.tsx and
 * src/server/knowledgeBase/acronyms.ts. Purely additive: its own section,
 * its own tab, same permission split as Special Instructions.
 */
export function KnowledgeBaseManagementPage({ theme, effectiveTier, currentUser, setChangeLogs }: KnowledgeBaseManagementPageProps) {
  const dark = theme === "dark";
  const [section, setSection] = useState<SectionKey>("documents");

  const tabs: { key: SectionKey; label: string }[] = [
    { key: "documents", label: "Documents" },
    { key: "special_instructions", label: "Special Instructions" },
    { key: "acronyms", label: "Acronym Dictionary" },
  ];

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h1 className={`text-page-title tracking-tight flex items-center gap-2 ${dark ? "text-white" : "text-[#111827]"}`}>
            <div className="w-8 h-0.5 flex-shrink-0" style={{ backgroundColor: dark ? "#00D3F3" : "#4673a9" }} />
            <span>Knowledge Base</span>
          </h1>
          <p className="text-xs mt-1 font-semibold text-content-muted">
            {section === "documents"
              ? "Manage Product Assist resources, rules, and reference material."
              : section === "special_instructions"
                ? "Controlled instructions Product Assist checks before consulting the Product Playbook, Policy Wording, or other resources."
                : "Shorthand advisors habitually type, mapped to its full meaning, so Product Assist recognizes it."}
            {effectiveTier === "Admin" || effectiveTier === "Platform Admin" || effectiveTier === "Developer" ? "" : " Read-only — Admin clearance is required to make changes."}
          </p>
        </div>
      </div>

      <div className={`flex items-center gap-1 border-b ${dark ? "border-white/[0.08]" : "border-stone-200"}`}>
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSection(t.key)}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wide cursor-pointer transition-colors border-b-2 -mb-px ${
              section === t.key
                ? dark ? "text-white border-[#00D3F3]" : "text-[#111827] border-[#4673a9]"
                : dark ? "text-stone-500 border-transparent hover:text-stone-300" : "text-stone-400 border-transparent hover:text-stone-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "documents" ? (
        <KnowledgeBaseResourceManagement theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
      ) : section === "special_instructions" ? (
        <SpecialInstructions theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
      ) : (
        <AcronymDictionary theme={theme} effectiveTier={effectiveTier} currentUser={currentUser} setChangeLogs={setChangeLogs} />
      )}
    </div>
  );
}
