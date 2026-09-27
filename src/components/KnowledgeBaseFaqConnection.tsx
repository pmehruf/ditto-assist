/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HelpCircle } from "lucide-react";
import { ConnectionRowCard, type BaseConnectionStatus } from "./connections/ConnectionRowCard";
import { iconColorFor } from "./connections/connectionIconColors";

interface KnowledgeBaseFaqConnectionProps {
  theme: "light" | "dark";
  /** Same resolveAccess()-backed evaluator every other governed feature's
   * page uses — see App.tsx's hasAccess(). Gates connect/disconnect/resync
   * on the "connections" governed feature (no longer a hardcoded
   * Developer-only exception as of 2026-09 — see featurePermissions.ts). */
  hasAccess: (featureId: string, actionType: "Viewer" | "Editor") => boolean;
  refreshSignal?: number;
  onStatusChange?: (info: { connected: boolean; attention: boolean }) => void;
}

interface FaqConnectionStatus extends BaseConnectionStatus {
  resource: {
    status: "processing" | "active" | "error" | "archived";
    lastFetchedAt: string | null;
    errorMessage: string | null;
    totalRecords: number;
    answerableCount: number;
    incompleteCount: number;
    conflictingCount: number;
    healthProductCount: number;
    operationsHealthCount: number;
  } | null;
}

/**
 * "Health FAQ" row — one of the Connections page's "Data Sources".
 * Connect/disconnect the FAQ Sheet's own Google OAuth grant (separate from
 * the Playbook's — see server.ts's /api/kb/faq/* routes and
 * src/server/knowledgeBase/faqIngest.ts) and trigger a manual resync. A thin
 * config wrapper around ConnectionRowCard (2026-09 redesign) — see
 * KnowledgeBasePlaybook.tsx for the sibling this mirrors.
 */
export function KnowledgeBaseFaqConnection({ theme, hasAccess, refreshSignal, onStatusChange }: KnowledgeBaseFaqConnectionProps) {
  const dark = theme === "dark";
  const canManage = hasAccess("connections", "Editor");

  return (
    <ConnectionRowCard<FaqConnectionStatus>
      dark={dark}
      icon={<HelpCircle className="w-4 h-4" />}
      iconColor={iconColorFor("teal", dark)}
      title="Health FAQ"
      purpose="Ditto's own official Health FAQ — the team's authoritative position on operational questions (what Ditto can/does facilitate) for Health plans, equal in authority to the Product Playbook."
      usedBy="Product Assist's Q&A answers, and the Home Dashboard's Did You Know card."
      syncCadence="Refreshes automatically up to every 6 hours, only when someone actually opens a page that uses it. Use Resync to update it immediately after editing the Sheet."
      statusEndpoint="/api/kb/faq/connection-status"
      connectHref="/api/kb/faq/connect-google"
      disconnectEndpoint="/api/kb/faq/connection"
      resyncEndpoint="/api/kb/faq/resync"
      flaggedEndpoint="/api/kb/faq/records?hasConflict=true"
      loadErrorFallback="Could not load the Health FAQ's connection status."
      gateByTier={{ canManage }}
      refreshSignal={refreshSignal}
      onStatusChange={onStatusChange}
      renderDetails={(status) => (
        <>
          {status.resource ? (
            <>
              Last synced: {status.resource.lastFetchedAt ? new Date(status.resource.lastFetchedAt).toLocaleString() : "never"} ·{" "}
              {status.resource.healthProductCount} Health Product · {status.resource.operationsHealthCount} Operations Health
              {status.resource.incompleteCount > 0 && <span> · {status.resource.incompleteCount} incomplete</span>}
              {status.resource.conflictingCount > 0 && (
                <span className={dark ? "text-amber-300" : "text-amber-700"}> · {status.resource.conflictingCount} flagged for review</span>
              )}
              {status.resource.status === "error" && (
                <span className={dark ? "text-red-300" : "text-red-600"}> · last sync failed: {status.resource.errorMessage}</span>
              )}
            </>
          ) : (
            "Never synced yet."
          )}
        </>
      )}
      formatResyncMessage={(body) => {
        const parts: string[] = [];
        if (body.skipped) {
          parts.push("No changes since the last sync.");
        } else {
          parts.push(`Synced ${body.totalRecords} FAQ record${body.totalRecords === 1 ? "" : "s"}.`);
          if (body.conflictingCount > 0) parts.push(`${body.conflictingCount} flagged for review (conflicting duplicate answers).`);
          if (body.incompleteCount > 0) parts.push(`${body.incompleteCount} incomplete (no answer yet).`);
        }
        return parts.join(" ");
      }}
    />
  );
}
